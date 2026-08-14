// Ticket 03 acceptance driver: drives the Device Bundle over the data port.
// Run: bun device/verify.ts   (watch the Deck's OLED/LEDs where prompted)
// Transport duplicated from spikes/serial-fs-spike.ts; that file dies at ticket 04.
import { closeSync, constants, openSync, readdirSync, readSync, writeSync } from "node:fs"
import pkg from "../package.json"

const VERSION = pkg.version

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a)
let failures = 0
const check = (ok: boolean, name: string) => {
	console.log(ok ? `  PASS ${name}` : `  FAIL ${name}`)
	if (!ok) failures++
}

const buf = Buffer.alloc(4096)
const openPort = (path: string): number | null => {
	if (Bun.spawnSync(["stty", "-f", path, "raw", "-echo"]).exitCode !== 0) return null
	try {
		return openSync(path, constants.O_RDWR | constants.O_NOCTTY | constants.O_NONBLOCK)
	} catch {
		return null
	}
}
const tryRead = (fd: number): string | null => {
	try {
		const n = readSync(fd, buf)
		return n > 0 ? buf.subarray(0, n).toString("utf8") : ""
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EAGAIN" ? "" : null
	}
}
// Nonblocking fd: EAGAIN when the tty buffer fills (device drains slowly during
// its ~200ms OLED refresh) — retry until accepted.
const writeAll = async (fd: number, data: string) => {
	let buf = Buffer.from(data)
	for (;;) {
		try {
			const n = writeSync(fd, buf)
			if (n >= buf.length) return
			buf = buf.subarray(n)
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "EAGAIN") throw e
		}
		await Bun.sleep(20)
	}
}
const write = (fd: number, obj: unknown) => writeAll(fd, JSON.stringify(obj) + "\n")

// Collect JSONL frames until predicate matches or timeout.
const waitFor = async (fd: number, pred: (m: any) => boolean, ms: number): Promise<any | null> => {
	let acc = ""
	const deadline = Date.now() + ms
	while (Date.now() < deadline) {
		const chunk = tryRead(fd)
		if (chunk === null) return null
		acc += chunk
		let nl: number
		while ((nl = acc.indexOf("\n")) >= 0) {
			const line = acc.slice(0, nl)
			acc = acc.slice(nl + 1)
			try {
				const m = JSON.parse(line)
				if (pred(m)) return m
			} catch {
				// non-JSON noise: skip
			}
		}
		await Bun.sleep(20)
	}
	return null
}

const findDataPort = async (): Promise<[string, number]> => {
	for (const name of readdirSync("/dev").filter((n) => n.startsWith("cu.usbmodem"))) {
		const path = `/dev/${name}`
		const fd = openPort(path)
		if (fd === null) continue
		// A fresh open raises DTR: the device may emit its own hello unprompted.
		const m = await waitFor(fd, (m) => m.t === "hello", 2000)
		if (m) return [path, fd]
		await write(fd, { t: "hello" })
		const m2 = await waitFor(fd, (m) => m.t === "hello", 1500)
		if (m2) return [path, fd]
		closeSync(fd)
	}
	console.error("no data port found — is the Deck plugged in and deployed?")
	process.exit(1)
}

log("== 1. DTR-edge hello + handshake (app version match)")
const [path, fd] = await findDataPort()
log(`data port: ${path}`)
await write(fd, { t: "hello", host: VERSION })
const helloReply = await waitFor(fd, (m) => m.t === "hello" && typeof m.fw === "string", 1500)
check(helloReply !== null, `host hello answered (fw=${helloReply?.fw})`)
check(helloReply?.fw === VERSION, `deck version ${helloReply?.fw} matches host ${VERSION}`)

log("== 2. render (WATCH: LEDs green ramp, OLED shows RENDER OK)")
await write(fd, {
	t: "render",
	led: Array.from({ length: 12 }, (_, i) => [0, 40 + i * 18, 0]),
	text: ["RENDER OK", "twelve green leds", "four text lines", "last-write-wins"],
})
await Bun.sleep(600)

log("== 3. malformed + oversized input, then recovery")
await writeAll(fd, "this is not json\n")
await writeAll(fd, "{" + "x".repeat(3000) + "\n") // > 1 KiB cap: discard-to-newline
await writeAll(fd, '{"t":"key-with-no-newline') // partial frame left dangling
await writeAll(fd, "\n")
await write(fd, { t: "hello", host: VERSION })
check((await waitFor(fd, (m) => m.t === "hello", 1500)) !== null, "device alive after garbage (resync)")

log("== 4. hid tap: Deck types 'a' (focus doesn't matter for the check)")
await write(fd, { t: "hid", key: "A" })
await Bun.sleep(300)

log("== 5. app-version mismatch fails closed (WATCH: OLED shows 'version mismatch')")
await write(fd, { t: "hello", host: "9.9.9" })
await Bun.sleep(400)
await write(fd, {
	t: "render",
	led: Array.from({ length: 12 }, () => [255, 0, 0]),
	text: ["MUST NOT APPEAR", "", "", ""],
})
await Bun.sleep(600)
log("  (if OLED shows MUST NOT APPEAR or LEDs went red, mismatch is NOT failing closed)")

log("== 6. reconnect: close (DTR falls) -> reopen (DTR rises) -> fresh hello")

closeSync(fd)
await Bun.sleep(800)
const fd2 = openPort(path)
if (fd2 === null) {
	check(false, "reopen")
} else {
	const fresh = await waitFor(fd2, (m) => m.t === "hello", 3000)
	check(fresh !== null, "unsolicited hello on DTR rising edge")
	await write(fd2, { t: "hello", host: VERSION })
	await waitFor(fd2, (m) => m.t === "hello", 1500)
	await write(fd2, {
		t: "render",
		led: Array.from({ length: 12 }, () => [0, 0, 60]),
		text: ["VERIFY DONE", "session recovered", "", ""],
	})
	await Bun.sleep(400)
	closeSync(fd2)
}

log(failures === 0 ? "ALL SCRIPTED CHECKS PASSED — confirm the WATCH steps visually" : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
