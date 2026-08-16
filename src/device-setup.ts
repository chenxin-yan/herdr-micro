import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";

import { Data, Effect } from "effect";

import { DEVICE_MANIFEST, type DeviceLibrary } from "./device-manifest.ts";

const CACHE_DIR = `${homedir()}/Library/Caches/herdr-micro`;
const VOLUMES_DIR = "/Volumes";
const VOLUME_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const POLL_MS = 500;

export class DeviceSetupError extends Data.TaggedError("DeviceSetupError")<{
  readonly message: string;
}> {}

const deviceError = (message: string) => new DeviceSetupError({ message });

export type VolumeClassification =
  | { readonly kind: "missing" }
  | { readonly kind: "circuitpy"; readonly path: string }
  | { readonly kind: "bootloader"; readonly path: string }
  | { readonly kind: "ambiguous"; readonly paths: readonly string[] };

export function classifyVolumes(paths: readonly string[]): VolumeClassification {
  const matches = paths.filter((path) => {
    const name = basename(path);
    return name.startsWith("CIRCUITPY") || name.startsWith("RPI-RP2");
  });
  if (matches.length === 0) return { kind: "missing" };
  if (matches.length !== 1) return { kind: "ambiguous", paths: matches };
  const path = matches[0]!;
  return basename(path).startsWith("CIRCUITPY")
    ? { kind: "circuitpy", path }
    : { kind: "bootloader", path };
}

export interface BootOut {
  readonly version: string | undefined;
  readonly boardId: string | undefined;
}

export function parseBootOut(text: string): BootOut {
  return {
    version: text.match(/^Adafruit CircuitPython ([^ ]+) on /m)?.[1],
    boardId: text.match(/^Board ID:([^\r\n]+)$/m)?.[1]?.trim(),
  };
}

export function isCompatibleCircuitPython(version: string | undefined): boolean {
  return version?.split(".")[0] === "10";
}

export type FileTree = Readonly<Record<string, string>>;
export type LibraryTrees = Readonly<Partial<Record<DeviceLibrary, FileTree>>>;

function treesEqual(left: FileTree | undefined, right: FileTree | undefined): boolean {
  if (!left || !right) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

export function planLibrarySync(
  libraries: readonly DeviceLibrary[],
  sources: LibraryTrees,
  targets: LibraryTrees,
): readonly DeviceLibrary[] {
  return libraries.filter((library) => !treesEqual(sources[library], targets[library]));
}

export type HashDecision = "use-cache" | "redownload";

export function sha256Decision(actual: string | undefined, expected: string): HashDecision {
  return actual === expected ? "use-cache" : "redownload";
}

const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

function fileSha256(path: string): string | undefined {
  return existsSync(path) ? sha256(readFileSync(path)) : undefined;
}

function snapshotPath(path: string): FileTree | undefined {
  if (!existsSync(path)) return;
  const files: Record<string, string> = {};
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith("._")) continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files[relative(path, child) || "."] = fileSha256(child)!;
    }
  };
  try {
    visit(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOTDIR") throw cause;
    files["."] = fileSha256(path)!;
  }
  return files;
}

function scanVolumes(): readonly string[] {
  return readdirSync(VOLUMES_DIR)
    .filter((name) => name.startsWith("CIRCUITPY") || name.startsWith("RPI-RP2"))
    .map((name) => join(VOLUMES_DIR, name));
}

async function waitForVolume(
  expected: "either" | "circuitpy" | "bootloader",
  timeoutMs = VOLUME_TIMEOUT_MS,
): Promise<Extract<VolumeClassification, { kind: "circuitpy" | "bootloader" }>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const classified = classifyVolumes(scanVolumes());
    if (classified.kind === "ambiguous") {
      throw deviceError(`Multiple Deck candidate volumes found: ${classified.paths.join(", ")}`);
    }
    if ((expected === "either" && classified.kind !== "missing") || classified.kind === expected) {
      return classified as Extract<VolumeClassification, { kind: "circuitpy" | "bootloader" }>;
    }
    await Bun.sleep(POLL_MS);
  }
  throw deviceError(`Timed out after ${timeoutMs / 1000}s waiting for ${expected} volume`);
}

async function confirm(message: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw deviceError(`${message} Interactive confirmation requires a TTY.`);
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`${message} [y/N] `);
    if (!/^y(?:es)?$/i.test(answer.trim())) throw deviceError("Setup cancelled");
  } finally {
    prompt.close();
  }
}

async function waitForReset(): Promise<void> {
  if (!process.stdin.isTTY) {
    throw deviceError("A hard reset is required; rerun setup from an interactive terminal");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await prompt.question("Press the Deck reset button, then press Enter to continue: ");
  } finally {
    prompt.close();
  }
}

async function ensureArtifact(artifact: {
  readonly url: string;
  readonly sha256: string;
}): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const filename = basename(new URL(artifact.url).pathname);
  const path = join(CACHE_DIR, filename);
  if (sha256Decision(fileSha256(path), artifact.sha256) === "use-cache") return path;

  rmSync(path, { force: true });
  console.log(`Downloading ${filename}`);
  const response = await fetch(artifact.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw deviceError(`Cannot download ${artifact.url}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (sha256(data) !== artifact.sha256) {
    throw deviceError(`SHA-256 mismatch for ${filename}`);
  }
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, path);
  return path;
}

async function bundleLibDirectory(): Promise<string> {
  const archive = await ensureArtifact(DEVICE_MANIFEST.bundle);
  const extracted = join(CACHE_DIR, DEVICE_MANIFEST.bundle.root);
  const marker = join(extracted, ".herdr-micro-sha256");
  if (
    !existsSync(marker) ||
    readFileSync(marker, "utf8").trim() !== DEVICE_MANIFEST.bundle.sha256
  ) {
    rmSync(extracted, { force: true, recursive: true });
    const result = spawnSync("/usr/bin/unzip", ["-q", "-o", archive, "-d", CACHE_DIR], {
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw deviceError(
        `Cannot extract ${basename(archive)}: ${result.stderr?.trim() || result.error?.message || `exit ${String(result.status)}`}`,
      );
    }
    writeFileSync(marker, `${DEVICE_MANIFEST.bundle.sha256}\n`);
  }
  const lib = join(extracted, "lib");
  for (const library of DEVICE_MANIFEST.libraries) {
    if (!existsSync(join(lib, library))) {
      throw deviceError(`Pinned bundle is missing lib/${library}`);
    }
  }
  return lib;
}

function readBootOut(volume: string): BootOut {
  const path = join(volume, "boot_out.txt");
  if (!existsSync(path)) return { version: undefined, boardId: undefined };
  return parseBootOut(readFileSync(path, "utf8"));
}

function verifyBoard(volume: string): BootOut {
  const boot = readBootOut(volume);
  if (boot.boardId !== DEVICE_MANIFEST.circuitPython.boardId) {
    throw deviceError(
      `Expected Board ID:${DEVICE_MANIFEST.circuitPython.boardId}, found ${boot.boardId ? `Board ID:${boot.boardId}` : "no Board ID"}`,
    );
  }
  return boot;
}

async function flashCircuitPython(bootloader: string): Promise<string> {
  await confirm(
    `RPI-RP2 identifies only an RP2040, not a MacroPad. Confirm this is the Adafruit MacroPad RP2040 to flash CircuitPython ${DEVICE_MANIFEST.circuitPython.version}.`,
  );
  const uf2 = await ensureArtifact(DEVICE_MANIFEST.circuitPython);
  console.log(`Flashing CircuitPython ${DEVICE_MANIFEST.circuitPython.version}`);
  try {
    cpSync(uf2, join(bootloader, basename(uf2)));
  } catch {
    // The RP2040 unmounts as soon as it accepts the UF2, so macOS can report a copy error on success.
  }
  const mounted = await waitForVolume("circuitpy");
  verifyBoard(mounted.path);
  return mounted.path;
}

async function findCircuitPythonVolume(): Promise<string> {
  let volume = classifyVolumes(scanVolumes());
  if (volume.kind === "ambiguous") {
    throw deviceError(`Multiple Deck candidate volumes found: ${volume.paths.join(", ")}`);
  }
  if (volume.kind === "missing") {
    console.log(
      "No Deck volume found. Unplug the Deck, hold the rotary encoder (BOOTSEL), plug it in, then tap reset.",
    );
    volume = await waitForVolume("either");
  }
  if (volume.kind === "bootloader") return flashCircuitPython(volume.path);

  const boot = verifyBoard(volume.path);
  if (isCompatibleCircuitPython(boot.version)) {
    console.log(`CircuitPython ${boot.version} detected`);
    return volume.path;
  }

  await confirm(
    `CircuitPython ${boot.version ?? "version could not be read"} is not compatible; reflash ${DEVICE_MANIFEST.circuitPython.version} while preserving CIRCUITPY files?`,
  );
  console.log(
    "Hold the rotary encoder (BOOTSEL), tap reset, and keep holding until RPI-RP2 mounts.",
  );
  const bootloader = await waitForVolume("bootloader");
  return flashCircuitPython(bootloader.path);
}

function copyLibrary(source: string, target: string): void {
  rmSync(target, { force: true, recursive: true });
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !basename(path).startsWith("._"),
  });
  if (!treesEqual(snapshotPath(source), snapshotPath(target))) {
    throw deviceError(`Verification failed after copying ${basename(source)}`);
  }
}

function syncLibraries(sourceLib: string, volume: string): readonly DeviceLibrary[] {
  const targetLib = join(volume, "lib");
  mkdirSync(targetLib, { recursive: true });
  const sources: Partial<Record<DeviceLibrary, FileTree>> = {};
  const targets: Partial<Record<DeviceLibrary, FileTree>> = {};
  for (const library of DEVICE_MANIFEST.libraries) {
    sources[library] = snapshotPath(join(sourceLib, library))!;
    const target = snapshotPath(join(targetLib, library));
    if (target) targets[library] = target;
  }
  const changed = planLibrarySync(DEVICE_MANIFEST.libraries, sources, targets);
  for (const library of changed) {
    copyLibrary(join(sourceLib, library), join(targetLib, library));
  }
  return changed;
}

function writeVerified(path: string, data: Uint8Array): void {
  writeFileSync(path, data);
  if (!Buffer.from(readFileSync(path)).equals(Buffer.from(data))) {
    throw deviceError(`Verification failed after writing ${basename(path)}`);
  }
}

function copyDeviceBundle(
  packageRoot: string,
  volume: string,
  version: string,
): { readonly bootChanged: boolean; readonly order: readonly string[] } {
  const device = join(packageRoot, "device");
  const bootSource = readFileSync(join(device, "boot.py"));
  const bootTarget = join(volume, "boot.py");
  const bootChanged =
    !existsSync(bootTarget) || !readFileSync(bootTarget).equals(Buffer.from(bootSource));

  const files: readonly (readonly [string, Uint8Array])[] = DEVICE_MANIFEST.deviceFiles.map(
    (name) => [
      name,
      name === "version.py"
        ? Buffer.from(`VERSION = ${JSON.stringify(version)}\n`)
        : readFileSync(join(device, name)),
    ],
  );
  for (const [name, data] of files) writeVerified(join(volume, name), data);
  return { bootChanged, order: files.map(([name]) => name) };
}

export function findDeckSerialPorts(paths: readonly string[]): readonly string[] | undefined {
  // CircuitPython's console/data CDC ports share a macOS device stem and end in 1/3.
  const endpoints = new Map<string, Partial<Record<"1" | "3", string>>>();
  for (const path of paths) {
    const match = path.match(/^(.*\/cu\.usbmodem\d+)([13])$/);
    if (!match) continue;
    const [, device, endpoint] = match;
    if (!device || (endpoint !== "1" && endpoint !== "3")) continue;
    const ports = endpoints.get(device) ?? {};
    ports[endpoint] = path;
    endpoints.set(device, ports);
  }
  for (const ports of endpoints.values()) {
    if (ports["1"] && ports["3"]) return [ports["1"], ports["3"]];
  }
}

async function waitForSerialPorts(timeoutMs = VOLUME_TIMEOUT_MS): Promise<readonly string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ports = findDeckSerialPorts(
      readdirSync("/dev")
        .filter((name) => name.startsWith("cu.usbmodem"))
        .map((name) => `/dev/${name}`),
    );
    if (ports) return ports;
    await Bun.sleep(POLL_MS);
  }
  throw deviceError(`Timed out after ${timeoutMs / 1000}s waiting for both Deck serial ports`);
}

export interface ProvisionDeckOptions {
  readonly packageRoot: string;
  readonly version: string;
  readonly isHostRunning: () => boolean;
}

export const provisionDeck = (options: ProvisionDeckOptions) =>
  Effect.tryPromise({
    try: async () => {
      console.log("Provisioning Deck");
      const volume = await findCircuitPythonVolume();
      const sourceLib = await bundleLibDirectory();
      const changedLibraries = syncLibraries(sourceLib, volume);
      const copied = copyDeviceBundle(options.packageRoot, volume, options.version);
      console.log(
        `Copied ${changedLibraries.length} changed libraries, then ${copied.order.join(", ")}`,
      );

      if (copied.bootChanged) await waitForReset();
      const ports = await waitForSerialPorts();
      if (!options.isHostRunning()) {
        throw deviceError("Host launchd service is registered but not running");
      }
      console.log(`Setup complete: Deck ready, ${ports.length} serial ports, Host running`);
    },
    catch: (cause) =>
      cause instanceof DeviceSetupError
        ? cause
        : deviceError(`Cannot provision Deck: ${String(cause)}`),
  });
