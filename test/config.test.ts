import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { Effect } from "effect";

import {
  DEFAULT_CONFIG,
  initializeConfig as initializeConfigEffect,
  loadConfig as loadConfigEffect,
} from "../src/config.ts";

const paths: string[] = [];
const tempPath = () => {
  const path = `${tmpdir()}/herdr-micro-${crypto.randomUUID()}.json`;
  paths.push(path);
  return path;
};
const loadConfig = (path: string) =>
  loadConfigEffect(path).pipe(Effect.provide(BunFileSystem.layer));
const initializeConfig = (path: string) =>
  initializeConfigEffect(path).pipe(Effect.provide(BunFileSystem.layer));

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("loadConfig", () => {
  test("returns built-in defaults when the file is missing", async () => {
    const config = await Effect.runPromise(loadConfig(tempPath()));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("rejects an incomplete provided file", async () => {
    const path = tempPath();
    await Bun.write(path, JSON.stringify({ defaultAgentCommand: ["pi"] }));

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain(`Invalid configuration at ${path}`);
    expect(error.message).toContain('Missing key\n  at ["commandKeys"]');
  });

  test("rejects unknown properties", async () => {
    const path = tempPath();
    await Bun.write(path, JSON.stringify({ ...DEFAULT_CONFIG, bogus: 1 }));

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain(`Invalid configuration at ${path}`);
    expect(error.message).toContain('at ["bogus"]');
  });

  test("decodes a complete file without merging defaults", async () => {
    const path = tempPath();
    const provided = {
      ...DEFAULT_CONFIG,
      defaultAgentCommand: ["claude"],
      commandKeys: { ...DEFAULT_CONFIG.commandKeys, "1": { type: "none" as const } },
      appearance: {
        ...DEFAULT_CONFIG.appearance,
        brightness: 0.75,
        states: { ...DEFAULT_CONFIG.appearance.states, blocked: "#123456" },
      },
    };
    await Bun.write(path, JSON.stringify(provided));

    expect(await Effect.runPromise(loadConfig(path))).toEqual(provided);
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
    await Bun.write(
      path,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        appearance: { ...DEFAULT_CONFIG.appearance, brightness: 1.5 },
      }),
    );

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toBe(
      `Invalid configuration at ${path}: Expected a value between 0 and 1, got 1.5\n  at ["appearance"]["brightness"]`,
    );
  });

  test("accepts a configured Send Keys sequence", async () => {
    const path = tempPath();
    const provided = {
      ...DEFAULT_CONFIG,
      commandKeys: {
        ...DEFAULT_CONFIG.commandKeys,
        "6": { type: "sendKeys" as const, keys: ["esc", "ctrl+c"] },
      },
    };
    await Bun.write(path, JSON.stringify(provided));

    const config = await Effect.runPromise(loadConfig(path));
    expect(config.commandKeys["6"]).toEqual({ type: "sendKeys", keys: ["esc", "ctrl+c"] });
  });

  test("rejects empty Send Keys sequences and key names", async () => {
    for (const keys of [[], [""]]) {
      const path = tempPath();
      await Bun.write(
        path,
        JSON.stringify({
          ...DEFAULT_CONFIG,
          commandKeys: {
            ...DEFAULT_CONFIG.commandKeys,
            "1": { type: "sendKeys", keys },
          },
        }),
      );

      const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
      expect(error.message).toContain(`Invalid configuration at ${path}`);
    }
  });

  test("rejects unknown key aliases", async () => {
    const path = tempPath();
    await Bun.write(
      path,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        commandKeys: { ...DEFAULT_CONFIG.commandKeys, "1": { type: "keyAlias", key: "NOT_A_KEY" } },
      }),
    );

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain("NOT_A_KEY");
  });
});

describe("initializeConfig", () => {
  test("creates parent directories and writes defaults that round-trip", async () => {
    const root = tempPath();
    const path = `${root}/nested/config.json`;
    await Effect.runPromise(initializeConfig(path));

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(DEFAULT_CONFIG);
    expect(await Effect.runPromise(loadConfig(path))).toEqual(DEFAULT_CONFIG);
  });

  test("refuses to overwrite an existing file", async () => {
    const path = tempPath();
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    await Bun.write(path, "keep me");

    const error = await Effect.runPromise(initializeConfig(path).pipe(Effect.flip));
    expect(error.message).toBe(`Configuration already exists at ${path}; refusing to overwrite it`);
    expect(readFileSync(path, "utf8")).toBe("keep me");
  });
});
