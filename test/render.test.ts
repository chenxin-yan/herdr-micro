import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import type { Agent } from "../src/projection.ts";
import { buildRender, LatestRenderQueue, type RenderSnapshot } from "../src/render.ts";

const agent = (index: number, state: Agent["state"] = "idle"): Agent => ({
  paneId: `p${index}`,
  name: `agent-${index}`,
  state,
  workspaceId: "workspace",
  tabId: `tab-${index}`,
});

describe("buildRender", () => {
  test("renders agent state LEDs, off-page priority, and selected-agent OLED", () => {
    const fleet = Array.from({ length: 7 }, (_, index) => agent(index + 1));
    fleet[0] = agent(1, "working");
    fleet[6] = agent(7, "blocked");

    const render = buildRender(fleet, 0, "p1", "project", DEFAULT_CONFIG);
    expect(render.led).toHaveLength(12);
    expect(render.led[0]).toEqual([0, 0, 51]);
    expect(render.led[7]).toEqual([51, 0, 0]);
    expect(render.text).toEqual(["agent-1", "working", "workspace/tab-1", "Page 1/2"]);
  });

  test("renders target, focused Workspace, page, and fleet count without selection", () => {
    const render = buildRender([agent(1)], 0, undefined, "project", DEFAULT_CONFIG);
    expect(render.text).toEqual(["Target: local", "Workspace: project", "Page 1/1", "Fleet: 1"]);
  });
});

test("LatestRenderQueue keeps only the newest pending Render Snapshot", async () => {
  const writes: RenderSnapshot[] = [];
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new LatestRenderQueue(
    async (snapshot) => {
      writes.push(snapshot);
      if (writes.length === 1) await first;
    },
    () => {},
  );
  const snapshot = (label: string): RenderSnapshot => ({
    t: "render",
    led: Array.from({ length: 12 }, () => [0, 0, 0]),
    text: [label, "", "", ""],
  });

  queue.enqueue(snapshot("first"));
  await Bun.sleep(0);
  queue.enqueue(snapshot("second"));
  queue.enqueue(snapshot("latest"));
  release();
  await Bun.sleep(0);

  expect(writes.map(({ text }) => text[0])).toEqual(["first", "latest"]);
});
