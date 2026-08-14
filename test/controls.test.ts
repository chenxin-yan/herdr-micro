import { describe, expect, test } from "bun:test";

import { DEFAULT_CONFIG } from "../src/config.ts";
import {
  cycleWorkspace,
  initialControlState,
  reconcileControls,
  reduceDeckMessage,
  shellCommand,
  type ControlState,
} from "../src/controls.ts";
import type { Workspace } from "../src/herdr.ts";
import type { Agent } from "../src/projection.ts";

const agent = (index: number, state: Agent["state"] = "idle"): Agent => ({
  paneId: `p${index}`,
  name: `agent-${index}`,
  state,
  workspaceId: "w1",
  tabId: `t${index}`,
});

const press = (state: ControlState, key: number, fleet: ReadonlyArray<Agent>) =>
  reduceDeckMessage(state, { t: "key", k: key, down: true }, fleet, DEFAULT_CONFIG.commandKeys);

describe("reduceDeckMessage", () => {
  test("selects and focuses the pressed Agent Slot", () => {
    expect(press(initialControlState, 1, [agent(1), agent(2)])).toEqual({
      state: { ...initialControlState, selectedPaneId: "p2" },
      effects: [{ type: "focusAgent", paneId: "p2" }],
    });
  });

  test("clears selection on page change and ignores selected actions without one", () => {
    const fleet = Array.from({ length: 7 }, (_, index) => agent(index + 1));
    const selected = press(initialControlState, 0, fleet).state;
    const changed = press(selected, 7, fleet);
    expect(changed.state).toEqual({ ...initialControlState, pageIndex: 1 });
    expect(press(changed.state, 9, fleet).effects).toEqual([]);
    expect(press(changed.state, 10, fleet).effects).toEqual([]);
  });

  test("maps configured Command Keys and ignores releases", () => {
    const selected = { ...initialControlState, selectedPaneId: "p1" };
    expect(press(selected, 6, [agent(1)]).effects).toEqual([{ type: "newAgent" }]);
    expect(press(selected, 8, [agent(1)]).effects).toEqual([{ type: "hid", key: "RIGHT_GUI" }]);
    expect(press(selected, 9, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["enter"] },
    ]);
    expect(press(selected, 10, [agent(1)]).effects).toEqual([
      { type: "sendKeys", paneId: "p1", keys: ["ctrl+c"] },
    ]);
    expect(press(selected, 11, [agent(1)]).effects).toEqual([]);
    expect(
      reduceDeckMessage(
        selected,
        { t: "key", k: 6, down: false },
        [agent(1)],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([]);
  });

  test("focuses a Workspace on rotation", () => {
    expect(
      reduceDeckMessage(
        initialControlState,
        { t: "encoder", delta: -1 },
        [],
        DEFAULT_CONFIG.commandKeys,
      ).effects,
    ).toEqual([{ type: "selectWorkspace", delta: -1 }]);
  });

  test("jumps through blocked agents before done agents and wraps", () => {
    const fleet = [agent(1, "done"), agent(2, "blocked"), agent(3, "done"), agent(4, "blocked")];

    const first = press(initialControlState, 12, fleet);
    expect(first.effects).toEqual([{ type: "jumpToAttention", paneId: "p2" }]);
    const second = press(first.state, 12, fleet);
    expect(second.effects).toEqual([{ type: "jumpToAttention", paneId: "p4" }]);
    const third = press(second.state, 12, fleet);
    expect(third.effects).toEqual([{ type: "jumpToAttention", paneId: "p1" }]);
    const wrapped = press({ ...third.state, selectedPaneId: "p3" }, 12, fleet);
    expect(wrapped.effects).toEqual([{ type: "jumpToAttention", paneId: "p2" }]);
  });

  test("does nothing when no agent needs attention", () => {
    expect(press(initialControlState, 12, [agent(1), agent(2, "working")])).toEqual({
      state: initialControlState,
      effects: [],
    });
  });

  test("flips to the attention agent page and selects it", () => {
    const fleet = [
      ...Array.from({ length: 6 }, (_, index) => agent(index + 1)),
      agent(7, "blocked"),
    ];
    expect(press({ ...initialControlState, selectedPaneId: "p1" }, 12, fleet)).toEqual({
      state: { ...initialControlState, pageIndex: 1, selectedPaneId: "p7" },
      effects: [{ type: "jumpToAttention", paneId: "p7" }],
    });
  });
});

test("reconcileControls clamps a removed page and clears a missing Selected Agent", () => {
  expect(
    reconcileControls({ pageIndex: 1, selectedPaneId: "p7", workspaceId: undefined }, [agent(1)]),
  ).toEqual(initialControlState);
});

test("cycleWorkspace follows Herdr numbers with wraparound", () => {
  const workspaces: Workspace[] = [
    { id: "w2", number: 2, label: "two", focused: false },
    { id: "w1", number: 1, label: "one", focused: true },
  ];
  expect(cycleWorkspace(workspaces, "w1", 1)?.id).toBe("w2");
  expect(cycleWorkspace(workspaces, "w1", -1)?.id).toBe("w2");
});

test("shellCommand preserves configured argv boundaries", () => {
  expect(shellCommand(["pi", "--name", "two words", "it's"])).toBe(
    "pi --name 'two words' 'it'\\''s'",
  );
});
