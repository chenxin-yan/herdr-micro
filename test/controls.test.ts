import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  initialControlState,
  reconcileControls,
  reduceControlMessage,
  shellCommand,
  type ControlState,
} from "../src/controls.ts";
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
      state: { ...initialControlState, selectedPaneId: "p5" },
      effects: [{ type: "focusAgent", paneId: "p5" }],
    });
    const selected = press(initialControlState, 0, fleet).state;
    expect(press(selected, 5, fleet)).toEqual({
      state: { ...initialControlState, pageIndex: 1 },
      effects: [],
    });
  });

  test("maps command keys 6-11 to the default layout", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    expect(press(selected, 6, [agent(1)]).effects).toEqual([{ type: "newAgent" }]);
    expect(press(selected, 7, [agent(1)]).effects).toEqual([{ type: "closeTab" }]);
    expect(press(selected, 8, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["ctrl+c"] },
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
      { type: "sendKeys", paneId: "p1", keys: ["esc"] },
    ]);
  });

  test("ignores selected-agent actions without a selection", () => {
    expect(press(initialControlState, 8, [agent(1)]).effects).toEqual([]);
    expect(press(initialControlState, 10, [agent(1)]).effects).toEqual([]);
    expect(press(initialControlState, 11, [agent(1)]).effects).toEqual([]);
  });

  test("cycles thinking forward for either encoder direction", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    for (const delta of [-2, 1]) {
      expect(
        reduceControlMessage(
          selected,
          { t: "encoder", delta },
          [agent(1)],
          DEFAULT_CONFIG.commandKeys,
        ).effects,
      ).toEqual([
        {
          type: "sendKeys",
          paneId: "p1",
          keys: Array.from({ length: Math.abs(delta) }, () => "shift+tab"),
        },
      ]);
    }
  });

  test("toggles Model layer, cycles models with flipped direction, and exits", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    const entered = press(selected, 12, [agent(1)]);
    expect(entered).toEqual({
      state: { ...selected, encoderMode: "model" },
      effects: [],
    });
    expect(
      reduceControlMessage(
        entered.state,
        { t: "encoder", delta: -2 },
        [agent(1)],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([{ type: "sendKeys", paneId: "p1", keys: ["ctrl+p", "ctrl+p"] }]);
    expect(
      reduceControlMessage(
        entered.state,
        { t: "encoder", delta: 1 },
        [agent(1)],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([{ type: "sendKeys", paneId: "p1", keys: ["shift+ctrl+p"] }]);
    expect(press(entered.state, 12, [agent(1)]).state.encoderMode).toBe("thinking");
    expect(
      reduceControlMessage(
        entered.state,
        { t: "encoderTimeout" },
        [agent(1)],
        DEFAULT_CONFIG.commandKeys,
      ).state.encoderMode,
    ).toBe("thinking");
  });

  test("ignores encoder input without a Selected Agent", () => {
    expect(press(initialControlState, 12, [agent(1)])).toEqual({
      state: initialControlState,
      effects: [],
    });
    expect(
      reduceControlMessage(
        initialControlState,
        { t: "encoder", delta: 1 },
        [agent(1)],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([]);
  });
});

test("reconcileControls clamps a removed page and clears a missing Selected Agent", () => {
  expect(
    reconcileControls({ ...initialControlState, pageIndex: 1, selectedPaneId: "p6" }, [agent(1)]),
  ).toEqual(initialControlState);
});

test("shellCommand preserves configured argv boundaries", () => {
  expect(shellCommand(["pi", "--name", "two words", "it's"])).toBe(
    "pi --name 'two words' 'it'\\''s'",
  );
});
