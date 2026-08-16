import { expect, test } from "bun:test";

import { initialControlState } from "../src/controls.ts";
import { initialScreensaverState } from "../src/presentation.ts";
import { resetTargetSessionState, type TargetSessionState } from "../src/target-state.ts";

const dirtyState = (): TargetSessionState => ({
  fleet: [{ paneId: "same-id", workspaceId: "w", tabId: "t", name: "agent", state: "working" }],
  controls: {
    pageIndex: 2,
    selectedPaneId: "same-id",
    workspaceId: "w",
    encoderMode: "tabs",
    tabId: "t",
    pressedCommandActions: { "1": { type: "newAgent", color: "#ffffff" } },
    targetPreviewName: "remote",
  },
  workspaces: [{ id: "w", number: 1, label: "work", focused: true, activeTabId: "t" }],
  tabs: [{ id: "t", number: 1, label: "tab", focused: true }],
  selectedDetail: { paneId: "same-id", value: undefined },
  sleeping: true,
  stateSince: new Map([["same-id", { state: "working", since: 1 }]]),
  screensaverState: { fleetSignature: "same-id:working", idleSince: 1, sleeping: true },
});

test("Target switch resets all Target-scoped state in one step", () => {
  const state = dirtyState();
  resetTargetSessionState(state);

  expect(state.fleet).toEqual([]);
  expect(state.controls).toBe(initialControlState);
  expect(state.workspaces).toEqual([]);
  expect(state.tabs).toEqual([]);
  expect(state.selectedDetail).toBeUndefined();
  expect(state.sleeping).toBe(false);
  expect(state.stateSince.size).toBe(0);
  expect(state.screensaverState).toBe(initialScreensaverState);
});
