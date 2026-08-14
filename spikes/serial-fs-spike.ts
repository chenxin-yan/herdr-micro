// Spike B variant: no serialport addon — stty + node:fs on /dev/cu.usbmodem*.
// Run: bun spikes/serial-fs-spike.ts
// serialport@13 crashes Bun 1.3.10 on open (uv_default_loop, bun#18546).
// macOS asserts DTR on open, satisfying usb_cdc.data.connected on the Deck.
import { closeSync, constants, openSync, readdirSync, readSync, writeSync } from "node:fs"

const log = (...args: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...args)

const listCandidates = () =>
	readdirSync("/dev")
		.filter((n) => n.startsWith("cu.usbmodem"))
		.map((n) => `/dev/${n}`)

const openPort = (path: string): number | null => {
	// raw -echo: no canonical buffering, no echo of protocol bytes back at us
	const stty = Bun.spawnSync(["stty", "-f", path, "raw", "-echo"])
	if (stty.exitCode !== 0) {
		log(`stty ${path} failed:`, stty.stderr.toString().trim())
		return null
	}
	try {
		// O_NONBLOCK: cu.* open can block waiting for carrier; reads poll with EAGAIN
		return openSync(path, constants.O_RDWR | constants.O_NOCTTY | constants.O_NONBLOCK)
	} catch (e) {
		log(`open ${path} failed:`, (e as Error).message)
		return null
	}
}

const readBuf = Buffer.alloc(4096)
// Returns available bytes, "" when none, null on disconnect.
const tryRead = (fd: number): string | null => {
	try {
		const n = readSync(fd, readBuf)
		return n > 0 ? readBuf.subarray(0, n).toString("utf8") : ""
	} catch (e) {
		const code = (e as NodeJS.ErrnoException).code
		if (code === "EAGAIN") return ""
		log("read error:", code)
		return null
	}
}

const tryWrite = (fd: number, line: string): boolean => {
	try {
		writeSync(fd, line)
		return true
	} catch (e) {
		log("write error:", (e as NodeJS.ErrnoException).code)
		return false
	}
}

// Write hello, poll up to 1.5s for a hello frame; console port never sends one.
const helloProbe = async (path: string): Promise<number | null> => {
	const fd = openPort(path)
	if (fd === null) return null
	if (!tryWrite(fd, '{"t":"hello"}\n')) {
		closeSync(fd)
		return null
	}
	let buf = ""
	const deadline = Date.now() + 1500
	while (Date.now() < deadline) {
		const chunk = tryRead(fd)
		if (chunk === null) break
		buf += chunk
		let nl: number
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl)
			buf = buf.slice(nl + 1)
			try {
				if (JSON.parse(line).t === "hello") {
					log(`probe ${path}: got hello -> DATA port`)
					return fd
				}
			} catch {
				// console port noise: keep scanning
			}
		}
		await Bun.sleep(20)
	}
	closeSync(fd)
	return null
}

const findDataPort = async (): Promise<number> => {
	for (;;) {
		const candidates = listCandidates()
		log("candidates:", candidates)
		for (const c of candidates) {
			const fd = await helloProbe(c)
			if (fd !== null) return fd
		}
		await Bun.sleep(1000)
	}
}

const maxRender = JSON.stringify({
	t: "render",
	led: Array.from({ length: 12 }, (_, i) => [i * 20, 255 - i * 20, 128]),
	text: ["agent-one [working]", "agent-two [blocked]", "agent-three [idle]", "Page 1/2 sel:3"],
})

const session = async (fd: number) => {
	log(`sending max-size render (${maxRender.length + 1} bytes)`)
	let renderSentAt = Date.now()
	if (!tryWrite(fd, maxRender + "\n")) return

	let hidSent = false
	let buf = ""
	log("session live: press keys / turn encoder; unplug to test recovery. Ctrl+C quits.")
	for (;;) {
		if (!hidSent && Date.now() - renderSentAt > 3000) {
			hidSent = true
			log("sending hid RIGHT_GUI tap — watch macOS")
			if (!tryWrite(fd, '{"t":"hid","key":"RIGHT_GUI"}\n')) return
		}
		const chunk = tryRead(fd)
		if (chunk === null) return // disconnect
		buf += chunk
		let nl: number
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl)
			buf = buf.slice(nl + 1)
			try {
				const msg = JSON.parse(line)
				if (msg.t === "stat") {
					log(`stat: device render_ms=${msg.render_ms}, host round-trip=${Date.now() - renderSentAt}ms`)
				} else {
					log("recv:", line)
				}
			} catch {
				log("recv (unparsed):", JSON.stringify(line))
			}
		}
		// ponytail: 20ms poll loop (~50Hz) — Bun exposes no fd events; revisit if CPU or latency matters
		await Bun.sleep(20)
	}
}

for (;;) {
	const fd = await findDataPort()
	try {
		await session(fd)
	} finally {
		try {
			closeSync(fd)
		} catch {
			// fd may already be invalid after unplug
		}
	}
	log("disconnected, rescanning…")
}
