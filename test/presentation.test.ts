import { describe, expect, test } from "bun:test";

import {
  initialScreensaverState,
  reconcileScreensaver,
  syncStateSince,
} from "../src/presentation.ts";
import type { Agent } from "../src/projection.ts";

const agent = (paneId: string, state: Agent["state"]): Agent => ({
  paneId,
  name: paneId,
  state,
  workspaceId: "workspace",
  tabId: "tab",
});

describe("syncStateSince", () => {
  test("preserves timestamps across unchanged snapshots and updates changed states", () => {
    const stateSince = new Map<string, { state: Agent["state"]; since: number }>();
    syncStateSince(stateSince, [agent("p1", "idle"), agent("p2", "working")], 100);
    syncStateSince(stateSince, [agent("p1", "idle"), agent("p2", "done")], 200);

    expect([...stateSince]).toEqual([
      ["p1", { state: "idle", since: 100 }],
      ["p2", { state: "done", since: 200 }],
    ]);

    syncStateSince(stateSince, [agent("p1", "idle")], 300);
    expect([...stateSince]).toEqual([["p1", { state: "idle", since: 100 }]]);
  });
});

describe("reconcileScreensaver", () => {
  test("sleeps only after an all-idle window and wakes on fleet or Deck activity", () => {
    const timeout = 10_000;
    const idle = [agent("p1", "idle")];
    const working = [agent("p1", "working")];

    const armed = reconcileScreensaver(initialScreensaverState, idle, 100, timeout);
    expect(armed).toEqual({ fleetSignature: "p1:idle", idleSince: 100, sleeping: false });
    expect(reconcileScreensaver(armed, idle, 10_099, timeout).sleeping).toBe(false);

    const sleeping = reconcileScreensaver(armed, idle, 10_100, timeout);
    expect(sleeping.sleeping).toBe(true);
    expect(reconcileScreensaver(sleeping, idle, 11_000, timeout, true)).toEqual({
      fleetSignature: "p1:idle",
      idleSince: 11_000,
      sleeping: false,
    });
    expect(reconcileScreensaver(sleeping, working, 11_000, timeout)).toEqual({
      fleetSignature: "p1:working",
      idleSince: undefined,
      sleeping: false,
    });
  });

  test("treats an empty Fleet as idle", () => {
    expect(reconcileScreensaver(initialScreensaverState, [], 100, 10_000)).toEqual({
      fleetSignature: "",
      idleSince: 100,
      sleeping: false,
    });
  });
});
