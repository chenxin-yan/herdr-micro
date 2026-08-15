import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import type { Agent } from "../src/projection.ts";
import {
  buildRender,
  formatDuration,
  LatestRenderQueue,
  parsePiStatus,
  type RenderSnapshot,
} from "../src/render.ts";

const agent = (index: number, state: Agent["state"] = "idle"): Agent => ({
  paneId: `p${index}`,
  name: `agent-${index}`,
  state,
  workspaceId: "workspace",
  tabId: `tab-${index}`,
});

const render = (
  fleet: ReadonlyArray<Agent>,
  selectedPaneId?: string,
  options: Parameters<typeof buildRender>[7] = {},
) =>
  buildRender(
    fleet,
    0,
    selectedPaneId,
    "project",
    { mode: "workspaces" },
    false,
    DEFAULT_CONFIG,
    options,
  );

describe("parsePiStatus", () => {
  test("extracts pi model, thinking, cost, and context from the visible status bar", () => {
    const text = [
      "other output",
      "↑460k ↓65k R21M W1.3M $34.879 15.5%/1.0M (auto)                    (anthropic) claude-fable-5 • high",
    ].join("\n");

    expect(parsePiStatus(text)).toEqual({
      model: "claude-fable-5",
      thinking: "high",
      cost: 34.879,
      contextPercent: 15.5,
    });
  });

  test("returns undefined for non-pi output", () => {
    expect(parsePiStatus("build passed\nready")).toBeUndefined();
  });
});

test("formats compact state durations", () => {
  expect(formatDuration(42_999)).toBe("42s");
  expect(formatDuration(59_999)).toBe("59s");
  expect(formatDuration(60_000)).toBe("1m");
  expect(formatDuration(4 * 60_000)).toBe("4m");
  expect(formatDuration(3_600_000)).toBe("1h0m");
  expect(formatDuration((62 * 60 + 30) * 1_000)).toBe("1h2m");
});

describe("buildRender", () => {
  test("builds the graphical fleet header and selected-agent detail", () => {
    const fleet = Array.from({ length: 6 }, (_, index) => agent(index + 1));
    fleet[0] = agent(1, "working");
    fleet[5] = agent(6, "blocked");

    const snapshot = render(fleet, "p1", {
      now: 4 * 60_000,
      selectedStateSince: 0,
      detail: {
        model: "claude-fable-5",
        thinking: "high",
        cost: 34.879,
        contextPercent: 15.5,
      },
    });

    expect(snapshot.led).toHaveLength(12);
    expect(snapshot.led[0]).toEqual([18, 18, 51, "breathe"]);
    expect(snapshot.led[1]).toEqual([51, 51, 51]);
    expect(snapshot.led[5]).toEqual([51, 0, 0, "blink"]);
    expect(snapshot.hdr).toEqual({
      boxes: ["w", "i", "i", "i", "i", "b"],
      sel: 0,
      page: 1,
      pages: 2,
    });
    expect(snapshot.text).toEqual(["project", "> agent-1  working 4m", "fable-5·high $34 15%"]);
    expect(snapshot.text.every((text) => text.length <= 21)).toBe(true);
  });

  test("renders minimally without a selected agent", () => {
    const snapshot = render([agent(1)]);
    expect(snapshot.hdr).toEqual({ boxes: ["i"], sel: null, page: 1, pages: 1 });
    expect(snapshot.text).toEqual(["project", "no agent selected", ""]);
    expect(snapshot.sleep).toBeUndefined();
  });

  test("maps working/blocked states to LED effects without a selection highlight", () => {
    const snapshot = render([agent(1, "working"), agent(2)], "p2");
    expect(snapshot.led[0]).toEqual([0, 0, 51, "breathe"]);
  });

  test("truncates a long selected name so state and duration still fit", () => {
    const snapshot = render([{ ...agent(1), name: "a-very-long-agent-name" }], "p1");
    expect(snapshot.text[1]).toBe("> a-very-long-a  idle");
    expect(snapshot.text[1]).toHaveLength(21);
  });

  test("renders Tab and Model encoder modes on the context line", () => {
    const tabMode = { mode: "tabs" as const, tab: { label: "tests", index: 1, count: 3 } };
    expect(
      buildRender([agent(1)], 0, "p1", "project", tabMode, false, DEFAULT_CONFIG).text[0],
    ).toBe("tabs 2/3 tests");
    expect(
      buildRender([], 0, undefined, "project", { mode: "model" }, false, DEFAULT_CONFIG).text[0],
    ).toBe("model");
  });

  test("caps the graphical header and omits an out-of-range selection", () => {
    const fleet = Array.from({ length: 18 }, (_, index) => agent(index + 1));
    const snapshot = render(fleet, "p18");
    expect(snapshot.hdr.boxes).toHaveLength(16);
    expect(snapshot.hdr.sel).toBeNull();
    expect(snapshot.hdr.pages).toBe(4);
  });

  test("passes the sleep presentation hint", () => {
    const snapshot = render([], undefined, { sleep: true });
    expect(snapshot.sleep).toBe(true);
  });

  test("uses binding colors and switches to layer colors while preserving the Layer LED", () => {
    const base = buildRender(
      [],
      0,
      undefined,
      undefined,
      { mode: "workspaces" },
      false,
      DEFAULT_CONFIG,
    );
    const layered = buildRender(
      [],
      0,
      undefined,
      undefined,
      { mode: "workspaces" },
      true,
      DEFAULT_CONFIG,
    );

    expect(base.led.slice(6)).toEqual([
      [51, 27, 0],
      [51, 27, 0],
      [0, 51, 51],
      [51, 51, 0],
      [51, 27, 0],
      [51, 27, 0],
    ]);
    expect(layered.led.slice(6)).toEqual([
      [0, 51, 51],
      [51, 27, 0],
      [0, 51, 51],
      [51, 51, 0],
      [51, 51, 0],
      [51, 27, 0],
    ]);
  });
});

test("LatestRenderQueue keeps only the newest pending Render Snapshot", async () => {
  const writes: RenderSnapshot[] = [];
  const { promise: first, resolve: release } = Promise.withResolvers<void>();
  const queue = new LatestRenderQueue(
    async (snapshot) => {
      writes.push(snapshot);
      if (writes.length === 1) await first;
    },
    () => {},
  );
  const snapshot = (label: string): RenderSnapshot => ({
    t: "render",
    led: Array.from({ length: 12 }, () => [0, 0, 0] as const),
    hdr: { boxes: [], sel: null, page: 1, pages: 1 },
    text: [label, "", ""],
  });

  queue.enqueue(snapshot("first"));
  await Bun.sleep(0);
  queue.enqueue(snapshot("second"));
  queue.enqueue(snapshot("latest"));
  release();
  await Bun.sleep(0);

  expect(writes.map(({ text }) => text[0])).toEqual(["first", "latest"]);
});
