#!/usr/bin/env bun
import { homedir } from "node:os";

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { version } from "../package.json";
import { loadConfig } from "./config.ts";
import { renderConsole } from "./console.ts";
import { watchFleet } from "./herdr.ts";

const HERDR_VERSION_TIMEOUT = "5 seconds";

const herdrVersion = Effect.tryPromise({
  try: async (signal) => {
    const child = Bun.spawn(["herdr", "--version"], { stdout: "pipe", stderr: "pipe" });
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`);
      return stdout.trim();
    } finally {
      signal.removeEventListener("abort", abort);
    }
  },
  catch: (cause) => new Error(`Cannot run herdr --version: ${String(cause)}`),
}).pipe(
  Effect.timeoutOrElse({
    duration: HERDR_VERSION_TIMEOUT,
    orElse: () =>
      Effect.fail(
        new Error(`Cannot run herdr --version: timed out after ${HERDR_VERSION_TIMEOUT}`),
      ),
  }),
);

const command = Command.make(
  "herdr-micro",
  {
    config: Flag.file("config").pipe(
      Flag.withDescription("Path to the configuration file"),
      Flag.withDefault(`${homedir()}/.config/herdr-micro/config.json`),
    ),
  },
  ({ config }) =>
    Effect.gen(function* () {
      yield* loadConfig(config);
      const herdr = yield* herdrVersion;
      yield* Effect.sync(() => console.error(`herdr-micro: ${herdr}`));
      yield* watchFleet(`${homedir()}/.config/herdr/herdr.sock`, (fleet) => {
        console.log(`${renderConsole(fleet)}\n`);
      });
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message);
          process.exitCode = 1;
        }),
      ),
    ),
);

command.pipe(Command.run({ version }), Effect.provide(BunServices.layer), BunRuntime.runMain);
