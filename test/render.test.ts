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
  buildRender(fleet, 0, selectedPaneId, "project", { mode: "workspaces" }, false, DEFAULT_CONFIG, {
    targetName: "local",
    ...options,
  });

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

  test("parses the fresh-session footer with no cost and the post-switch unknown context", () => {
    // Before the first response, pi omits $cost entirely for non-subscription providers.
    expect(parsePiStatus("0.0%/272k (auto)  (openai) codex • high")).toEqual({
      model: "codex",
      thinking: "high",
      cost: undefined,
      contextPercent: 0,
    });
    // Right after a model switch pi shows "?" until it knows the context percent.
    expect(parsePiStatus("?/272k (auto)  claude-fable-5 • high")).toEqual({
      model: "claude-fable-5",
      thinking: "high",
      cost: undefined,
      contextPercent: undefined,
    });
  });

  test("returns undefined for non-pi output", () => {
    expect(parsePiStatus("build passed\nready")).toBeUndefined();
  });

  test("parses subscription cost and disabled thinking footer variants", () => {
    expect(parsePiStatus("↑4k ↓1k $12.400 (sub) 40.0%/272k  (openai) gpt-5.6-sol • high")).toEqual({
      model: "gpt-5.6-sol",
      thinking: "high",
      cost: 12.4,
      contextPercent: 40,
    });
    expect(parsePiStatus("↑4k ↓1k $0.100 5.0%/272k  gpt-5.6-sol • thinking off")).toEqual({
      model: "gpt-5.6-sol",
      thinking: "off",
      cost: 0.1,
      contextPercent: 5,
    });
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
    expect(snapshot.led[0]).toEqual([0, 0, 102, "breathe"]);
    expect(snapshot.led[1]).toEqual([102, 102, 102]);
    expect(snapshot.led[5]).toEqual([102, 0, 0, "blink"]);
    expect(snapshot.hdr).toEqual({
      boxes: ["w", "i", "i", "i", "i", "b"],
      sel: 0,
      page: 1,
      pages: 2,
    });
    expect(snapshot.text).toEqual([
      "local project",
      "> agent-1  working 4m",
      "fable-5 high $34 15%",
    ]);
    expect(snapshot.text.every((text) => text.length <= 21)).toBe(true);
  });

  test("renders minimally without a selected agent and marks an all-idle fleet calm", () => {
    const snapshot = render([agent(1)]);
    expect(snapshot.hdr).toEqual({ boxes: ["i"], sel: null, page: 1, pages: 1 });
    expect(snapshot.text).toEqual(["local project", "no agent selected", ""]);
    expect(snapshot.sleep).toBeUndefined();
    expect(snapshot.calm).toBe(true);
    expect(render([agent(1, "working")]).calm).toBeUndefined();
  });

  test("maps working/blocked states to LED effects without a selection highlight", () => {
    const snapshot = render([agent(1, "working"), agent(2)], "p2");
    expect(snapshot.led[0]).toEqual([0, 0, 102, "breathe"]);
  });

  test("truncates a long selected line to the display width", () => {
    const snapshot = render([{ ...agent(1), name: "a-very-long-agent-name" }], "p1");
    expect(snapshot.text[1]).toBe("> a-very-long-agent-n");
  });

  test("renders Target identity, preview, error, and Tab encoder mode on the context line", () => {
    const tabMode = { mode: "tabs" as const, tab: { label: "tests", index: 1, count: 3 } };
    expect(
      buildRender([agent(1)], 0, "p1", "project", tabMode, false, DEFAULT_CONFIG, {
        targetName: "remote",
      }).text[0],
    ).toBe("remote tabs 2/3 tests");
    // The error marker belongs to the active Target, not a previewed candidate.
    expect(
      render([agent(1)], "p1", { targetPreviewName: "remote", targetError: true }).text[0],
    ).toBe("target: remote");
    expect(
      render([agent(1)], "p1", { targetPreviewName: "local", targetError: true }).text[0],
    ).toBe("target: local !");
    expect(render([agent(1)], "p1", { targetError: true }).text[0]).toBe("local ! project");
  });

  test("caps the graphical header and omits an out-of-range selection", () => {
    const fleet = Array.from({ length: 18 }, (_, index) => agent(index + 1));
    const snapshot = render(fleet, "p18");
    expect(snapshot.hdr.boxes).toHaveLength(16);
    expect(snapshot.hdr.sel).toBeNull();
    expect(snapshot.hdr.pages).toBe(4);
  });

  test("flashes Target color then blanks LEDs while connecting", () => {
    const flash = render([agent(1)], undefined, { targetFlash: "#00ffff" });
    expect(flash.led.every((led) => JSON.stringify(led) === JSON.stringify([0, 102, 102]))).toBe(
      true,
    );
    expect(render([agent(1)], undefined, { connecting: true }).led).toEqual(
      Array.from({ length: 12 }, () => [0, 0, 0]),
    );
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
      [102, 54, 0],
      [102, 54, 0],
      [0, 102, 102],
      [102, 102, 0],
      [102, 54, 0],
      [102, 54, 0],
    ]);
    expect(layered.led.slice(6)).toEqual([
      [0, 102, 102],
      [102, 54, 0],
      [0, 102, 102],
      [102, 102, 0],
      [102, 102, 0],
      [102, 54, 0],
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
