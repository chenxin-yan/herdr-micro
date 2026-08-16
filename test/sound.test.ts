import { describe, expect, test } from "bun:test";

import type { Agent, AgentState } from "../src/projection.ts";
import { detectFleetSound } from "../src/sound.ts";

const agent = (paneId: string, state: AgentState): Agent => ({
  paneId,
  name: paneId,
  state,
  workspaceId: "w1",
  tabId: "t1",
});

describe("detectFleetSound", () => {
  test("establishes the initial or reconnect snapshot without a chime", () => {
    expect(detectFleetSound(undefined, [agent("p1", "blocked")], true)).toBeUndefined();
  });

  test("chimes when an existing agent enters blocked", () => {
    expect(detectFleetSound([agent("p1", "idle")], [agent("p1", "blocked")], true)).toBe("attn");
    expect(detectFleetSound([], [agent("p1", "blocked")], true)).toBeUndefined();
  });

  test("chimes done only for working to idle", () => {
    expect(detectFleetSound([agent("p1", "working")], [agent("p1", "idle")], true)).toBe("done");
    expect(detectFleetSound([agent("p1", "done")], [agent("p1", "idle")], true)).toBeUndefined();
  });

  test("lets attention win when both events occur in one update", () => {
    expect(
      detectFleetSound(
        [agent("p1", "working"), agent("p2", "idle")],
        [agent("p1", "idle"), agent("p2", "blocked")],
        true,
      ),
    ).toBe("attn");
  });

  test("stays silent when sounds are disabled", () => {
    expect(
      detectFleetSound([agent("p1", "idle")], [agent("p1", "blocked")], false),
    ).toBeUndefined();
  });
});
