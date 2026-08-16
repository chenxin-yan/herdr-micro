import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Data, Effect } from "effect";

import type { Config, TargetConfig } from "./config.ts";

const DEFAULT_REMOTE_SOCKET = "~/.config/herdr/herdr.sock";

export interface ResolvedTarget {
  readonly name: string;
  readonly config: TargetConfig;
  readonly socket: string;
}

export class TargetUnavailable extends Data.TaggedError("TargetUnavailable")<{
  readonly message: string;
}> {}

export const targetNames = (config: Config): ReadonlyArray<string> => Object.keys(config.targets);

export function resolveTarget(config: Config, name = config.defaultTarget): ResolvedTarget {
  const target = config.targets[name];
  if (!target) throw new Error(`Unknown Herdr Target ${JSON.stringify(name)}`);
  return {
    name,
    config: target,
    socket: target.socket ?? DEFAULT_REMOTE_SOCKET,
  };
}

export const makeTargetRuntimeDirectory = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "herdr-micro-"))),
  (path) => Effect.sync(() => rmSync(path, { force: true, recursive: true })),
);

export interface TunnelPaths {
  readonly socket: string;
  readonly control: string;
}

export const tunnelPaths = (runtimeDirectory: string, targetName: string): TunnelPaths => ({
  socket: join(runtimeDirectory, `herdr-${targetName}.sock`),
  control: join(runtimeDirectory, `ssh-${targetName}`),
});

export const sshTunnelArguments = (
  ssh: string,
  paths: TunnelPaths,
  remoteSocket: string,
): Array<string> => {
  return [
    "ssh",
    "-N",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "StreamLocalBindUnlink=yes",
    "-o",
    "ServerAliveInterval=5",
    "-o",
    "ServerAliveCountMax=2",
    "-o",
    "ControlMaster=yes",
    "-o",
    "ControlPersist=no",
    "-o",
    `ControlPath=${paths.control}`,
    "-L",
    `${paths.socket}:${remoteSocket}`,
    ssh,
  ];
};

const readProcessText = async (stream: ReadableStream<Uint8Array> | number | undefined) =>
  stream instanceof ReadableStream ? new Response(stream).text() : "";

const resolveRemoteSocket = (target: ResolvedTarget): Effect.Effect<string, TargetUnavailable> => {
  if (!("ssh" in target.config)) return Effect.succeed(target.socket);
  if (!target.socket.startsWith("~")) return Effect.succeed(target.socket);
  const ssh = target.config.ssh;
  return Effect.tryPromise({
    try: async (signal) => {
      const process = Bun.spawn(
        [
          "ssh",
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=5",
          "-o",
          "ControlMaster=no",
          "-o",
          "ControlPath=none",
          ssh,
          'printf %s "$HOME"',
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      // Interrupting the fleet fiber mid-probe (switch-away) must not orphan
      // the ssh child or block the interrupt on a slow connect.
      signal.addEventListener("abort", () => process.kill());
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        readProcessText(process.stdout),
        readProcessText(process.stderr),
      ]);
      if (exitCode !== 0) throw new Error(stderr.trim() || `ssh exited ${exitCode}`);
      return `${stdout.trim()}${target.socket.slice(1)}`;
    },
    catch: (cause) =>
      new TargetUnavailable({
        message: `Herdr Target ${target.name} unavailable: cannot resolve remote home: ${String(cause)}`,
      }),
  });
};

export const withTargetSocket = <A, E, R>(
  target: ResolvedTarget,
  runtimeDirectory: string,
  use: (socket: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TargetUnavailable, R> => {
  if (!("ssh" in target.config)) return use(target.socket);
  const ssh = target.config.ssh;
  return Effect.gen(function* () {
    const remoteSocket = yield* resolveRemoteSocket(target);
    const paths = tunnelPaths(runtimeDirectory, target.name);
    const process = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn(sshTunnelArguments(ssh, paths, remoteSocket), {
          stdout: "ignore",
          stderr: "pipe",
        }),
      ),
      (child) =>
        Effect.promise(async () => {
          child.kill();
          await child.exited;
        }),
    );
    const exited = Effect.tryPromise({
      try: async () => {
        const [exitCode, stderr] = await Promise.all([
          process.exited,
          readProcessText(process.stderr),
        ]);
        throw new Error(stderr.trim() || `ssh exited ${exitCode}`);
      },
      catch: (cause) =>
        new TargetUnavailable({
          message: `Herdr Target ${target.name} unavailable: ${String(cause)}`,
        }),
    });
    return yield* Effect.raceFirst(use(paths.socket), exited);
  }).pipe(Effect.scoped);
};
