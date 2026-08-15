import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  cycleTab,
  cycleWorkspace,
  initialControlState,
  reconcileControls,
  reduceControlMessage,
  shellCommand,
  type ControlState,
} from "../src/controls.ts";
import type { Tab, Workspace } from "../src/herdr.ts";
import type { Agent } from "../src/projection.ts";

const agent = (index: number, state: Agent["state"] = "idle"): Agent => ({
  paneId: `p${index}`,
  name: `agent-${index}`,
  state,
  workspaceId: "w1",
  tabId: `t${index}`,
});

const press = (state: ControlState, key: number, fleet: ReadonlyArray<Agent>) =>
  reduceControlMessage(state, { t: "key", k: key, down: true }, fleet, DEFAULT_CONFIG.commandKeys);

describe("reduceControlMessage", () => {
  test("uses keys 0-4 as Agent Slots and key 5 as the fixed Page Key", () => {
    const fleet = Array.from({ length: 6 }, (_, index) => agent(index + 1));
    expect(press(initialControlState, 4, fleet)).toEqual({
      state: initialControlState,
      effects: [{ type: "focusAgent", paneId: "p5" }],
    });
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    expect(press(selected, 5, fleet)).toEqual({
      state: { ...selected, pageIndex: 1 },
      effects: [],
    });
  });

  test("maps command keys 6-11 to the default layout", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    expect(press(selected, 6, [agent(1)]).effects).toEqual([{ type: "newAgent" }]);
    expect(press(selected, 7, [agent(1)]).effects).toEqual([{ type: "closeTab" }]);
    expect(press(selected, 8, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["esc"] },
    ]);
    expect(press(selected, 9, [agent(1)]).effects).toEqual([
      { type: "hid", key: "RIGHT_GUI", down: true },
    ]);
    expect(
      reduceControlMessage(
        selected,
        { t: "key", k: 9, down: false },
        [agent(1)],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([{ type: "hid", key: "RIGHT_GUI", down: false }]);
    expect(press(selected, 10, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["enter"] },
    ]);
    expect(press(selected, 11, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["ctrl+c"] },
    ]);
  });

  test("logs selected-agent actions without a selection instead of acting", () => {
    expect(press(initialControlState, 8, [agent(1)]).effects).toEqual([
      { type: "log", message: "esc ignored: no agent selected" },
    ]);
    expect(press(initialControlState, 10, [agent(1)]).effects).toEqual([
      { type: "log", message: "enter ignored: no agent selected" },
    ]);
    expect(press(initialControlState, 11, [agent(1)]).effects).toEqual([
      { type: "log", message: "ctrl+c ignored: no agent selected" },
    ]);
  });

  test("flips encoder direction in Workspace mode", () => {
    expect(
      reduceControlMessage(
        initialControlState,
        { t: "encoder", delta: -1 },
        [],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([{ type: "selectWorkspace", delta: 1 }]);
  });

  test("toggles Tab mode, flips rotation, and exits on timeout or another press", () => {
    const entered = press(initialControlState, 12, []);
    expect(entered).toEqual({
      state: { ...initialControlState, encoderMode: "tabs" },
      effects: [{ type: "enterTabMode" }],
    });
    expect(
      reduceControlMessage(
        entered.state,
        { t: "encoder", delta: 1 },
        [],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([{ type: "selectTab", delta: 1 }]);
    expect(press(entered.state, 12, []).state.encoderMode).toBe("workspaces");
    expect(
      reduceControlMessage(entered.state, { t: "encoderTimeout" }, [], DEFAULT_CONFIG.commandKeys)
        .state.encoderMode,
    ).toBe("workspaces");
  });
});

test("reconcileControls derives selection from Herdr focus and clamps a removed page", () => {
  const state = { ...initialControlState, pageIndex: 1, selectedPaneId: "p6" };
  expect(reconcileControls(state, [agent(1)], "p1")).toEqual({
    ...initialControlState,
    selectedPaneId: "p1",
  });
  expect(reconcileControls(state, [agent(1)], "not-an-agent")).toEqual(initialControlState);
  expect(reconcileControls(state, [agent(1)], undefined)).toEqual(initialControlState);
});

test("cycleWorkspace and cycleTab follow Herdr numbers with wraparound", () => {
  const workspaces: Workspace[] = [
    { id: "w2", number: 2, label: "two", focused: false, activeTabId: "t2" },
    { id: "w1", number: 1, label: "one", focused: true, activeTabId: "t1" },
  ];
  const tabs: Tab[] = [
    { id: "t2", number: 2, label: "two", focused: false },
    { id: "t1", number: 1, label: "one", focused: true },
  ];
  expect(cycleWorkspace(workspaces, "w1", 1)?.id).toBe("w2");
  expect(cycleTab(tabs, "t1", -1)?.id).toBe("t2");
});

test("shellCommand preserves configured argv boundaries", () => {
  expect(shellCommand(["pi", "--name", "two words", "it's"])).toBe(
    "pi --name 'two words' 'it'\\''s'",
  );
});
