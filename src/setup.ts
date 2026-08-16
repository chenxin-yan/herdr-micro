import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Data, Effect } from "effect";

import { configFileExists, initializeConfig } from "./config.ts";
import { provisionDeck } from "./device-setup.ts";

export const LAUNCHD_LABEL = "dev.herdr.herdr-micro";
export const PLIST_MARKER = "HerdrMicroManaged";

const HOME = homedir();
const INSTALL_DIR = `${HOME}/.local/share/herdr-micro`;
const INSTALLED_BINARY = `${INSTALL_DIR}/herdr-micro`;
const SHIM_PATH = `${HOME}/.local/bin/herdr-micro`;
const PLIST_PATH = `${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
const STDOUT_PATH = `${HOME}/Library/Logs/herdr-micro/stdout.log`;
const STDERR_PATH = `${HOME}/Library/Logs/herdr-micro/stderr.log`;

export class SetupError extends Data.TaggedError("SetupError")<{
  readonly message: string;
}> {}

const setupError = (message: string) => new SetupError({ message });

export function failureDetail(
  stderr: string | null,
  error: Error | undefined,
  status: number | null,
): string {
  return stderr?.trim() || error?.message || `exit ${String(status)}`;
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function composeLaunchPath(herdrPath: string): string {
  return [...new Set(["/usr/bin", "/bin", "/usr/sbin", "/sbin", dirname(herdrPath)])].join(":");
}

interface LaunchAgentPaths {
  readonly executable: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly path: string;
}

export function renderLaunchAgentPlist(paths: LaunchAgentPaths): string {
  const value = (text: string) => `<string>${xmlEscape(text)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${value(LAUNCHD_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${value(paths.executable)}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>StandardOutPath</key>
  ${value(paths.stdout)}
  <key>StandardErrorPath</key>
  ${value(paths.stderr)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    ${value(paths.path)}
  </dict>
  <key>${PLIST_MARKER}</key>
  <true/>
</dict>
</plist>
`;
}

export function isManagedPlist(text: string): boolean {
  return text.includes(`<key>${PLIST_MARKER}</key>`);
}

export type PlistState =
  | { readonly kind: "missing" }
  | { readonly kind: "regular"; readonly text: string }
  | { readonly kind: "other" };

export type PlistOwnership = "ours" | "external";

export function decidePlistOwnership(state: PlistState): PlistOwnership {
  if (state.kind === "missing") return "ours";
  return state.kind === "regular" && isManagedPlist(state.text) ? "ours" : "external";
}

export type UninstallDecision = "stop-and-remove" | "stop-only" | "refuse";

export function decideUninstall(state: PlistState): UninstallDecision {
  if (decidePlistOwnership(state) === "external") return "refuse";
  return state.kind === "missing" ? "stop-only" : "stop-and-remove";
}

export function launchctlTarget(uid: number): string {
  return `gui/${uid}/${LAUNCHD_LABEL}`;
}

export function launchctlServiceIsRunning(output: string): boolean {
  return /^\s*state = running\s*$/m.test(output);
}

export function upLaunchctlCommands(uid: number, plistPath: string) {
  return [
    ["/bin/launchctl", "enable", launchctlTarget(uid)],
    ["/bin/launchctl", "bootstrap", `gui/${uid}`, plistPath],
    ["/bin/launchctl", "kickstart", launchctlTarget(uid)],
  ] as const;
}

function plistState(path: string): PlistState {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return { kind: "missing" };
  if (!stat.isFile()) return { kind: "other" };
  return { kind: "regular", text: readFileSync(path, "utf8") };
}

export function isNixManagedExecutable(executable: string): boolean {
  return resolve(executable).startsWith("/nix/store/");
}

export function packageRootCandidates(moduleUrl: string, executable: string): readonly string[] {
  return [
    dirname(dirname(fileURLToPath(moduleUrl))),
    dirname(dirname(resolve(executable))),
    join(INSTALL_DIR, "build"),
  ];
}

function packageRoot(): string {
  for (const candidate of packageRootCandidates(import.meta.url, process.execPath)) {
    if (existsSync(join(candidate, "package.json"))) return candidate;
  }
  throw setupError("Cannot locate the herdr-micro package files");
}

function runCommand(command: string, args: readonly string[], cwd?: string): void {
  const result = spawnSync(command, [...args], { cwd, encoding: "utf8" });
  if (result.status === 0) return;
  throw setupError(
    `${command} ${args.join(" ")} failed: ${failureDetail(result.stderr, result.error, result.status)}`,
  );
}

function installHostBinary(bun: string): void {
  const source = packageRoot();
  const build = join(INSTALL_DIR, "build");
  mkdirSync(INSTALL_DIR, { recursive: true });
  if (resolve(source) !== resolve(build)) {
    rmSync(build, { force: true, recursive: true });
    mkdirSync(build, { recursive: true });
    cpSync(join(source, "package.json"), join(build, "package.json"));
    cpSync(join(source, "bun.lock"), join(build, "bun.lock"));
    cpSync(join(source, "src"), join(build, "src"), { recursive: true });
    cpSync(join(source, "device"), join(build, "device"), { recursive: true });
  }

  runCommand(bun, ["install", "--production", "--frozen-lockfile"], build);
  const temporary = join(INSTALL_DIR, `.herdr-micro-${process.pid}`);
  rmSync(temporary, { force: true });
  try {
    runCommand(
      bun,
      [
        "build",
        "./src/main.ts",
        "--compile",
        "--minify",
        "--no-compile-autoload-dotenv",
        "--outfile",
        temporary,
      ],
      build,
    );
    renameSync(temporary, INSTALLED_BINARY);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function installShim(): void {
  mkdirSync(dirname(SHIM_PATH), { recursive: true });
  const stat = lstatSync(SHIM_PATH, { throwIfNoEntry: false });
  if (stat) {
    if (!stat.isSymbolicLink()) {
      throw setupError(`Cannot replace ${SHIM_PATH}: it is not a symbolic link`);
    }
    if (readlinkSync(SHIM_PATH) !== INSTALLED_BINARY) {
      rmSync(SHIM_PATH);
      symlinkSync(INSTALLED_BINARY, SHIM_PATH);
    }
  } else {
    symlinkSync(INSTALLED_BINARY, SHIM_PATH);
  }
  if (!(process.env.PATH ?? "").split(":").includes(dirname(SHIM_PATH))) {
    console.warn(`warning: ${dirname(SHIM_PATH)} is not on PATH`);
  }
}

function writeManagedPlist(text: string): void {
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  mkdirSync(dirname(STDOUT_PATH), { recursive: true });
  const temporary = `${PLIST_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o644 });
  renameSync(temporary, PLIST_PATH);
}

interface CommandResult {
  readonly status: number | null;
  readonly output: string;
  readonly detail: string;
}

function runLaunchctl(command: readonly string[]): CommandResult {
  const executable = command[0];
  if (!executable) throw setupError("Cannot run an empty launchctl command");
  const result = spawnSync(executable, command.slice(1), { encoding: "utf8" });
  return {
    status: result.status,
    output: result.stdout ?? "",
    detail: result.status === 0 ? "" : failureDetail(result.stderr, result.error, result.status),
  };
}

function serviceIsRunning(uid: number): boolean {
  const result = runLaunchctl(["/bin/launchctl", "print", launchctlTarget(uid)]);
  return result.status === 0 && launchctlServiceIsRunning(result.output);
}

function requireLaunchctl(command: readonly string[], allow?: RegExp): void {
  const result = runLaunchctl(command);
  if (result.status === 0 || (allow && allow.test(result.detail))) return;
  throw setupError(`${command.join(" ")} failed: ${result.detail}`);
}

function registerService(uid: number): void {
  runLaunchctl(["/bin/launchctl", "bootout", launchctlTarget(uid)]);
  const [enable, bootstrap] = upLaunchctlCommands(uid, PLIST_PATH);
  requireLaunchctl(enable);
  requireLaunchctl(bootstrap);
}

export const setupHost = (configPath: string, version: string) =>
  Effect.gen(function* () {
    const nixManaged = isNixManagedExecutable(process.execPath);
    if (nixManaged) {
      // Nix owns the Host binary; setup only initializes config and provisions the Deck.
      console.log("Host binary is Nix-managed; leaving it unchanged");
    } else {
      const bun = Bun.which("bun");
      if (!bun) return yield* Effect.fail(setupError("Cannot find bun; install Bun before setup"));

      yield* Effect.try({
        try: () => {
          installHostBinary(bun);
          installShim();
        },
        catch: (cause) =>
          cause instanceof SetupError
            ? cause
            : setupError(`Cannot install herdr-micro: ${String(cause)}`),
      });
    }

    const configured = yield* configFileExists(configPath);
    if (!configured) yield* initializeConfig(configPath);

    const herdr = Bun.which("herdr");
    if (!herdr) {
      return yield* Effect.fail(setupError("Cannot find herdr; install Herdr before setup"));
    }

    if (nixManaged) {
      console.log("Service registration is Nix-managed; leaving it unchanged");
    } else {
      yield* Effect.try({
        try: () => {
          const state = plistState(PLIST_PATH);
          if (decidePlistOwnership(state) === "external") {
            console.log(`Service at ${PLIST_PATH} is managed elsewhere; leaving it unchanged`);
            return;
          }
          writeManagedPlist(
            renderLaunchAgentPlist({
              executable: INSTALLED_BINARY,
              stdout: STDOUT_PATH,
              stderr: STDERR_PATH,
              path: composeLaunchPath(herdr),
            }),
          );
          registerService(process.getuid!());
          console.log(`herdr-micro installed and started (${LAUNCHD_LABEL})`);
        },
        catch: (cause) =>
          cause instanceof SetupError
            ? cause
            : setupError(`Cannot configure service: ${String(cause)}`),
      });
    }

    yield* provisionDeck({
      packageRoot: packageRoot(),
      version,
      isHostRunning: () => serviceIsRunning(process.getuid!()),
    });
  });

export const startService = Effect.try({
  try: () => {
    const uid = process.getuid!();
    const [enable, bootstrap, kickstart] = upLaunchctlCommands(uid, PLIST_PATH);
    requireLaunchctl(enable);
    if (runLaunchctl(["/bin/launchctl", "print", launchctlTarget(uid)]).status !== 0) {
      requireLaunchctl(bootstrap);
    }
    requireLaunchctl(kickstart);
    console.log(`Started ${LAUNCHD_LABEL}`);
  },
  catch: (cause) =>
    cause instanceof SetupError ? cause : setupError(`Cannot start service: ${String(cause)}`),
});

export const stopService = Effect.try({
  try: () => {
    const target = launchctlTarget(process.getuid!());
    requireLaunchctl(
      ["/bin/launchctl", "bootout", target],
      /No such process|Could not find service/i,
    );
    requireLaunchctl(["/bin/launchctl", "disable", target]);
    console.log(`Stopped ${LAUNCHD_LABEL}`);
  },
  catch: (cause) =>
    cause instanceof SetupError ? cause : setupError(`Cannot stop service: ${String(cause)}`),
});

export const uninstallService = Effect.gen(function* () {
  const state = yield* Effect.try({
    try: () => plistState(PLIST_PATH),
    catch: (cause) => setupError(`Cannot inspect service registration: ${String(cause)}`),
  });
  const decision = decideUninstall(state);
  if (decision === "refuse") {
    return yield* Effect.fail(
      setupError(
        `Cannot uninstall service at ${PLIST_PATH}: it is managed elsewhere or lacks the ${PLIST_MARKER} marker`,
      ),
    );
  }

  yield* stopService;
  if (decision === "stop-only") {
    console.log(`No service plist at ${PLIST_PATH}`);
    return;
  }

  yield* Effect.try({
    try: () => {
      rmSync(PLIST_PATH);
      console.log(`Removed service registration at ${PLIST_PATH}`);
      console.log("CLI, configuration, logs, and Deck were left unchanged");
    },
    catch: (cause) => setupError(`Cannot remove service registration: ${String(cause)}`),
  });
});
