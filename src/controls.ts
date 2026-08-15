import type { CommandAction, CommandKeys, Config } from "./config.ts";
import { PAGE_SIZE, projectFleet, type Agent } from "./projection.ts";
import type { DeckMessage } from "./serial.ts";

export interface ControlState {
  readonly pageIndex: number;
  readonly selectedPaneId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly encoderMode: "workspaces" | "tabs" | "model";
  readonly tabId: string | undefined;
  readonly pressedCommandActions: Readonly<Partial<Record<keyof CommandKeys, CommandAction>>>;
}

export type ControlMessage =
  | Exclude<DeckMessage, { readonly t: "hello" }>
  | { readonly t: "encoderTimeout" };

export type ControlEffect =
  | { readonly type: "focusAgent"; readonly paneId: string }
  | { readonly type: "sendKeys"; readonly paneId: string; readonly keys: readonly string[] }
  | { readonly type: "newAgent" }
  | { readonly type: "closeTab" }
  | { readonly type: "hid"; readonly key: string; readonly down: boolean }
  | { readonly type: "selectWorkspace"; readonly delta: number }
  | { readonly type: "enterTabMode" }
  | { readonly type: "selectTab"; readonly delta: number }
  | { readonly type: "log"; readonly message: string };

export const initialControlState: ControlState = {
  pageIndex: 0,
  selectedPaneId: undefined,
  workspaceId: undefined,
  encoderMode: "workspaces",
  tabId: undefined,
  pressedCommandActions: {},
};

export function reconcileControls(
  state: ControlState,
  fleet: ReadonlyArray<Agent>,
  focusedPaneId: string | undefined,
): ControlState {
  return {
    ...state,
    pageIndex: projectFleet(fleet, state.pageIndex).pageIndex,
    selectedPaneId: fleet.some(({ paneId }) => paneId === focusedPaneId)
      ? focusedPaneId
      : undefined,
  };
}

export const isLayerHeld = (pressed: ControlState["pressedCommandActions"]): boolean =>
  Object.values(pressed).some((action) => action.type === "layer");

const sendSelected = (
  state: ControlState,
  keys: readonly string[],
): ReadonlyArray<ControlEffect> =>
  state.selectedPaneId
    ? [{ type: "sendKeys", paneId: state.selectedPaneId, keys }]
    : // Dropped actions were invisible at the desk and got reported as "key does nothing".
      [{ type: "log", message: `${keys.join("+")} ignored: no agent selected` }];

export function reduceControlMessage(
  state: ControlState,
  message: ControlMessage,
  fleet: ReadonlyArray<Agent>,
  config: Pick<Config, "commandKeys" | "layerKeys" | "layerEncoder">,
): { readonly state: ControlState; readonly effects: ReadonlyArray<ControlEffect> } {
  if (message.t === "encoderTimeout") {
    return {
      state: { ...state, encoderMode: "workspaces", tabId: undefined },
      effects: [],
    };
  }
  if (message.t === "encoder") {
    if (message.delta === 0) return { state, effects: [] };
    if (state.encoderMode === "model") {
      const binding = message.delta > 0 ? config.layerEncoder.cw : config.layerEncoder.ccw;
      const keys = Array.from({ length: Math.abs(message.delta) }, () => binding).flat();
      return { state, effects: sendSelected(state, keys) };
    }
    return {
      state,
      effects: [
        // Workspace rotation is inverted (user preference); tab rotation is not.
        state.encoderMode === "tabs"
          ? { type: "selectTab", delta: message.delta }
          : { type: "selectWorkspace", delta: -message.delta },
      ],
    };
  }
  if (message.k === 12) {
    if (!message.down) return { state, effects: [] };
    const layerHeld = isLayerHeld(state.pressedCommandActions);
    const nextMode =
      state.encoderMode === "model"
        ? "workspaces"
        : layerHeld
          ? "model"
          : state.encoderMode === "workspaces"
            ? "tabs"
            : "workspaces";
    return {
      state: { ...state, encoderMode: nextMode, tabId: undefined },
      effects: nextMode === "tabs" ? [{ type: "enterTabMode" }] : [],
    };
  }

  const page = projectFleet(fleet, state.pageIndex);
  if (message.k < PAGE_SIZE) {
    if (!message.down) return { state, effects: [] };
    const selected = page.slots[message.k];
    if (!selected) return { state, effects: [] };
    return {
      state,
      effects: [{ type: "focusAgent", paneId: selected.paneId }],
    };
  }
  if (message.k === PAGE_SIZE) {
    if (!message.down) return { state, effects: [] };
    return {
      state: {
        ...state,
        pageIndex: (page.pageIndex + 1) % page.pageCount,
      },
      effects: [],
    };
  }

  const slot = String(message.k - 5) as keyof CommandKeys;
  let action: CommandAction | undefined;
  let pressedCommandActions: Partial<Record<keyof CommandKeys, CommandAction>>;
  if (message.down) {
    action = isLayerHeld(state.pressedCommandActions)
      ? config.layerKeys[slot]
      : config.commandKeys[slot];
    pressedCommandActions = { ...state.pressedCommandActions, [slot]: action };
  } else {
    action = state.pressedCommandActions[slot];
    if (!action) return { state, effects: [] };
    pressedCommandActions = { ...state.pressedCommandActions };
    delete pressedCommandActions[slot];
  }

  const nextState = { ...state, pressedCommandActions };
  if (action.type === "keyAlias") {
    return { state: nextState, effects: [{ type: "hid", key: action.key, down: message.down }] };
  }
  if (!message.down) return { state: nextState, effects: [] };
  switch (action.type) {
    case "none":
    case "layer":
      return { state: nextState, effects: [] };
    case "newAgent":
      return { state: nextState, effects: [{ type: "newAgent" }] };
    case "closeTab":
      return { state: nextState, effects: [{ type: "closeTab" }] };
    case "sendKeys":
      return { state: nextState, effects: sendSelected(state, action.keys) };
  }
}

export const cycleNumbered = <
  A extends { readonly id: string; readonly number: number; readonly focused: boolean },
>(
  values: ReadonlyArray<A>,
  currentId: string | undefined,
  delta: number,
): A | undefined => {
  const ordered = [...values].sort((left, right) => left.number - right.number);
  if (ordered.length === 0) return;
  const focusedIndex = ordered.findIndex((value) => value.focused);
  const current = ordered.findIndex(({ id }) => id === currentId);
  const start = current >= 0 ? current : focusedIndex >= 0 ? focusedIndex : 0;
  const index = (((start + delta) % ordered.length) + ordered.length) % ordered.length;
  return ordered[index];
};

export const shellCommand = (argv: readonly string[]): string =>
  argv
    .map((argument) =>
      /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
        ? argument
        : `'${argument.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
