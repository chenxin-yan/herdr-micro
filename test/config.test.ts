import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { Effect } from "effect";

import { DEFAULT_CONFIG, loadConfig as loadConfigEffect } from "../src/config.ts";

const paths: string[] = [];
const tempPath = () => {
  const path = `${tmpdir()}/herdr-micro-${crypto.randomUUID()}.json`;
  paths.push(path);
  return path;
};
const loadConfig = (path: string) =>
  loadConfigEffect(path).pipe(Effect.provide(BunFileSystem.layer));

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

describe("loadConfig", () => {
  test("returns built-in defaults when the file is missing", async () => {
    const config = await Effect.runPromise(loadConfig(tempPath()));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("fills missing command keys with none", async () => {
    const path = tempPath();
    await Bun.write(
      path,
      JSON.stringify({
        defaultAgentCommand: ["pi"],
        commandKeys: { "2": { type: "closeTab" } },
        appearance: DEFAULT_CONFIG.appearance,
      }),
    );

    const config = await Effect.runPromise(loadConfig(path));
    expect(config.commandKeys).toEqual({
      "1": { type: "none" },
      "2": { type: "closeTab" },
      "3": { type: "none" },
      "4": { type: "none" },
      "5": { type: "none" },
      "6": { type: "none" },
    });
  });

  test("fills all missing fields with defaults", async () => {
    const path = tempPath();
    await Bun.write(path, JSON.stringify({}));

    const config = await Effect.runPromise(loadConfig(path));
    expect(config).toEqual({
      ...DEFAULT_CONFIG,
      // Provided-file per-key default is none, not the built-in bindings.
      commandKeys: {
        "1": { type: "none" },
        "2": { type: "none" },
        "3": { type: "none" },
        "4": { type: "none" },
        "5": { type: "none" },
        "6": { type: "none" },
      },
    });
  });

  test("fills missing nested appearance fields around provided ones", async () => {
    const path = tempPath();
    await Bun.write(
      path,
      JSON.stringify({
        appearance: { states: { blocked: "#123456" } },
      }),
    );

    const config = await Effect.runPromise(loadConfig(path));
    expect(config.appearance).toEqual({
      brightness: DEFAULT_CONFIG.appearance.brightness,
      states: { ...DEFAULT_CONFIG.appearance.states, blocked: "#123456" },
    });
  });

  test("rejects malformed JSON with a schema error", async () => {
    const path = tempPath();
    await Bun.write(path, '{"defaultAgentCommand":["pi"');

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain(
      `Invalid configuration at ${path}: Expected a valid JSON string`,
    );
  });

  test("rejects invalid config with an exact error", async () => {
    const path = tempPath();
    await Bun.write(path, JSON.stringify({ appearance: { brightness: 1.5 } }));

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toBe(
      `Invalid configuration at ${path}: Expected a value between 0 and 1, got 1.5\n  at ["appearance"]["brightness"]`,
    );
  });

  test("rejects unknown key aliases", async () => {
    const path = tempPath();
    await Bun.write(
      path,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        commandKeys: { "1": { type: "keyAlias", key: "NOT_A_KEY" } },
      }),
    );

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain("NOT_A_KEY");
  });
});
