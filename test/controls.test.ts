import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG, type Config } from "../src/config.ts";
import {
  cycleNumbered,
  initialControlState,
  reconcileControls,
  reduceControlMessage,
  shellCommand,
  type ControlMessage,
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

type Maps = Partial<Pick<Config, "commandKeys" | "layerKeys" | "layerEncoder">>;
const reduce = (
  state: ControlState,
  message: ControlMessage,
  fleet: ReadonlyArray<Agent> = [],
  maps: Maps = {},
) => reduceControlMessage(state, message, fleet, { ...DEFAULT_CONFIG, ...maps });
const key = (
  state: ControlState,
  physicalKey: number,
  down: boolean,
  fleet: ReadonlyArray<Agent>,
  maps?: Maps,
) => reduce(state, { t: "key", k: physicalKey, down }, fleet, maps);
const press = (state: ControlState, physicalKey: number, fleet: ReadonlyArray<Agent>) =>
  key(state, physicalKey, true, fleet);

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
    expect(press(selected, 6, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["ctrl+c"] },
    ]);
    expect(press(selected, 7, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["esc"] },
    ]);
    expect(press(selected, 8, [agent(1)]).effects).toEqual([]);
    const aliasDown = press(selected, 9, [agent(1)]);
    expect(aliasDown.effects).toEqual([{ type: "hid", key: "RIGHT_GUI", down: true }]);
    expect(key(aliasDown.state, 9, false, [agent(1)]).effects).toEqual([
      { type: "hid", key: "RIGHT_GUI", down: false },
    ]);
    expect(press(selected, 10, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["enter"] },
    ]);
    expect(press(selected, 11, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["alt+enter"] },
    ]);
  });

  test("uses layered actions only while the layer key is held", () => {
    const fleet = [agent(1)];
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    const layerDown = key(selected, 8, true, fleet);
    expect(layerDown.effects).toEqual([]);
    expect(press(layerDown.state, 6, fleet).effects).toEqual([{ type: "newAgent" }]);

    const layerUp = key(layerDown.state, 8, false, fleet);
    expect(layerUp.effects).toEqual([]);
    expect(press(layerUp.state, 6, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["ctrl+c"] },
    ]);
  });

  test("releases the action resolved at key-down after the layer is released", () => {
    const fleet = [agent(1)];
    const layerKeys = {
      ...DEFAULT_CONFIG.layerKeys,
      "4": { type: "keyAlias" as const, key: "RIGHT_SHIFT" as const, color: "#ffff00" },
    };
    const layerDown = key(initialControlState, 8, true, fleet, { layerKeys });
    const aliasDown = key(layerDown.state, 9, true, fleet, { layerKeys });
    expect(aliasDown.effects).toEqual([{ type: "hid", key: "RIGHT_SHIFT", down: true }]);
    const layerUp = key(aliasDown.state, 8, false, fleet, { layerKeys });
    expect(key(layerUp.state, 9, false, fleet, { layerKeys }).effects).toEqual([
      { type: "hid", key: "RIGHT_SHIFT", down: false },
    ]);
  });

  test("forwards a configured Send Keys sequence unchanged", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    const commandKeys = {
      ...DEFAULT_CONFIG.commandKeys,
      "3": {
        type: "sendKeys" as const,
        keys: ["esc", "ctrl+c"] as const,
        color: "#ff8800",
      },
    };
    expect(key(selected, 8, true, [agent(1)], { commandKeys }).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["esc", "ctrl+c"] },
    ]);
  });

  test("logs selected-agent actions without a selection instead of acting", () => {
    expect(press(initialControlState, 6, [agent(1)]).effects).toEqual([
      { type: "log", message: "ctrl+c ignored: no agent selected" },
    ]);
    expect(press(initialControlState, 10, [agent(1)]).effects).toEqual([
      { type: "log", message: "enter ignored: no agent selected" },
    ]);
    expect(press(initialControlState, 11, [agent(1)]).effects).toEqual([
      { type: "log", message: "alt+enter ignored: no agent selected" },
    ]);
  });

  test("flips encoder direction in Workspace mode", () => {
    expect(reduce(initialControlState, { t: "encoder", delta: -1 }).effects).toEqual([
      { type: "selectWorkspace", delta: 1 },
    ]);
  });

  test("toggles Tab mode, flips rotation, and exits on timeout or another press", () => {
    const entered = press(initialControlState, 12, []);
    expect(entered).toEqual({
      state: { ...initialControlState, encoderMode: "tabs" },
      effects: [{ type: "enterTabMode" }],
    });
    expect(reduce(entered.state, { t: "encoder", delta: 1 }).effects).toEqual([
      { type: "selectTab", delta: 1 },
    ]);
    expect(press(entered.state, 12, []).state.encoderMode).toBe("workspaces");
    expect(reduce(entered.state, { t: "encoderTimeout" }).state.encoderMode).toBe("workspaces");
  });

  test("enters Model mode through Layer and rotates models in both directions", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    const layerDown = key(selected, 8, true, [agent(1)]).state;
    const entered = press(layerDown, 12, [agent(1)]);
    expect(entered.state.encoderMode).toBe("model");
    expect(reduce(entered.state, { t: "encoder", delta: 2 }).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["ctrl+p", "ctrl+p"] },
    ]);
    expect(reduce(entered.state, { t: "encoder", delta: -1 }).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["shift+ctrl+p"] },
    ]);
    expect(press(entered.state, 12, [agent(1)]).state.encoderMode).toBe("workspaces");
    expect(reduce(entered.state, { t: "encoderTimeout" }).state.encoderMode).toBe("workspaces");
  });

  test("keeps Model mode after Layer release", () => {
    const fleet = [agent(1)];
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    const layerDown = key(selected, 8, true, fleet).state;
    const entered = press(layerDown, 12, fleet).state;
    const layerUp = key(entered, 8, false, fleet).state;
    expect(layerUp.encoderMode).toBe("model");
    expect(reduce(layerUp, { t: "encoder", delta: 1 }).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["ctrl+p"] },
    ]);
  });

  test("enters Model mode from Tab mode when Layer is held", () => {
    const fleet = [agent(1)];
    const tabs = press(initialControlState, 12, fleet).state;
    const layerDown = key(tabs, 8, true, fleet).state;
    expect(press(layerDown, 12, fleet)).toEqual({
      state: { ...layerDown, encoderMode: "model", tabId: undefined },
      effects: [],
    });
  });

  test("logs Model rotation without a selected agent", () => {
    const layerDown = key(initialControlState, 8, true, [agent(1)]).state;
    const entered = press(layerDown, 12, [agent(1)]).state;
    expect(reduce(entered, { t: "encoder", delta: 1 }).effects).toEqual([
      { type: "log", message: "ctrl+p ignored: no agent selected" },
    ]);
  });

  test("maps the remaining layered keys to arrows and Thinking cycle", () => {
    const fleet = [agent(1)];
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    const layerDown = key(selected, 8, true, fleet).state;
    expect(press(layerDown, 9, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["left"] },
    ]);
    expect(press(layerDown, 10, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["right"] },
    ]);
    expect(press(layerDown, 11, fleet).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["shift+tab"] },
    ]);
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

test("cycleNumbered follows Herdr numbers with wraparound", () => {
  const workspaces: Workspace[] = [
    { id: "w2", number: 2, label: "two", focused: false, activeTabId: "t2" },
    { id: "w1", number: 1, label: "one", focused: true, activeTabId: "t1" },
  ];
  const tabs: Tab[] = [
    { id: "t2", number: 2, label: "two", focused: false },
    { id: "t1", number: 1, label: "one", focused: true },
  ];
  expect(cycleNumbered(workspaces, "w1", 1)?.id).toBe("w2");
  expect(cycleNumbered(tabs, "t1", -1)?.id).toBe("t2");
});

test("shellCommand preserves configured argv boundaries", () => {
  expect(shellCommand(["pi", "--name", "two words", "it's"])).toBe(
    "pi --name 'two words' 'it'\\''s'",
  );
});
