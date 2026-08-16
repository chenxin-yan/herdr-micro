import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";

import { BunFileSystem } from "@effect/platform-bun";
import { Effect } from "effect";

import {
  DEFAULT_CONFIG,
  initializeConfig as initializeConfigEffect,
  loadConfig as loadConfigEffect,
} from "../src/config.ts";
import { resolveTarget } from "../src/targets.ts";

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
    expect(config).toEqual({
      ...DEFAULT_CONFIG,
      targets: { local: { socket: `${homedir()}/.config/herdr/herdr.sock` } },
    });
    expect(resolveTarget(config)).toEqual({
      name: "local",
      config: { socket: `${homedir()}/.config/herdr/herdr.sock` },
      socket: `${homedir()}/.config/herdr/herdr.sock`,
    });
  });

  test("rejects an incomplete provided file", async () => {
    const path = tempPath();
    await Bun.write(path, JSON.stringify({ defaultAgentCommand: ["pi"] }));

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain(`Invalid configuration at ${path}`);
    expect(error.message).toContain('Missing key\n  at ["targets"]');
  });

  test("rejects unknown properties", async () => {
    const path = tempPath();
    await Bun.write(path, JSON.stringify({ ...DEFAULT_CONFIG, bogus: 1 }));

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain(`Invalid configuration at ${path}`);
    expect(error.message).toContain('at ["bogus"]');
  });

  test("rejects a default Target not present in targets", async () => {
    const path = tempPath();
    await Bun.write(path, JSON.stringify({ ...DEFAULT_CONFIG, defaultTarget: "missing" }));

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain('defaultTarget "missing" is not present in targets');
  });

  test("rejects a provided file without targets", async () => {
    const path = tempPath();
    const { targets: _, ...missingTargets } = DEFAULT_CONFIG;
    await Bun.write(path, JSON.stringify(missingTargets));

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain('Missing key\n  at ["targets"]');
  });

  test("expands local socket homes and preserves the remote home for SSH resolution", async () => {
    const path = tempPath();
    const provided = {
      ...DEFAULT_CONFIG,
      targets: {
        local: { socket: "~/.config/herdr/herdr.sock" },
        minipc: { ssh: "cyan-minipc", socket: "~/run/herdr.sock" },
      },
      defaultTarget: "minipc",
    };
    await Bun.write(path, JSON.stringify(provided));

    const config = await Effect.runPromise(loadConfig(path));
    expect(config.targets).toEqual({
      local: { socket: `${homedir()}/.config/herdr/herdr.sock` },
      minipc: { ssh: "cyan-minipc", socket: "~/run/herdr.sock" },
    });
    expect(resolveTarget(config)).toMatchObject({
      name: "minipc",
      socket: "~/run/herdr.sock",
    });
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

    expect(await Effect.runPromise(loadConfig(path))).toEqual({
      ...provided,
      targets: { local: { socket: `${homedir()}/.config/herdr/herdr.sock` } },
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

  test("rejects nested layer actions", async () => {
    const path = tempPath();
    await Bun.write(
      path,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        layerKeys: {
          ...DEFAULT_CONFIG.layerKeys,
          "1": { type: "layer", color: "#00ffff" },
        },
      }),
    );

    const error = await Effect.runPromise(loadConfig(path).pipe(Effect.flip));
    expect(error.message).toContain(`Invalid configuration at ${path}`);
    expect(error.message).toContain('at ["layerKeys"]["1"]');
  });

  test("rejects unknown key aliases", async () => {
    const path = tempPath();
    await Bun.write(
      path,
      JSON.stringify({
        ...DEFAULT_CONFIG,
        commandKeys: {
          ...DEFAULT_CONFIG.commandKeys,
          "1": { type: "keyAlias", key: "NOT_A_KEY", color: "#ffff00" },
        },
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
    expect(await Effect.runPromise(loadConfig(path))).toEqual({
      ...DEFAULT_CONFIG,
      targets: { local: { socket: `${homedir()}/.config/herdr/herdr.sock` } },
    });
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
