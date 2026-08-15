import type { CommandKeys } from "./config.ts";
import { PAGE_SIZE, projectFleet, type Agent } from "./projection.ts";
import type { DeckMessage } from "./serial.ts";

export interface ControlState {
  readonly pageIndex: number;
  readonly selectedPaneId: string | undefined;
  readonly encoderMode: "thinking" | "model";
}

export type ControlMessage = DeckMessage | { readonly t: "encoderTimeout" };

export type ControlEffect =
  | { readonly type: "focusAgent"; readonly paneId: string }
  | { readonly type: "sendKeys"; readonly paneId: string; readonly keys: readonly string[] }
  | { readonly type: "newAgent" }
  | { readonly type: "closeTab" }
  | { readonly type: "hid"; readonly key: string; readonly down: boolean };

export const initialControlState: ControlState = {
  pageIndex: 0,
  selectedPaneId: undefined,
  encoderMode: "thinking",
};

export function reconcileControls(state: ControlState, fleet: ReadonlyArray<Agent>): ControlState {
  const pageIndex = projectFleet(fleet, state.pageIndex).pageIndex;
  const selectedPaneId = fleet.some(({ paneId }) => paneId === state.selectedPaneId)
    ? state.selectedPaneId
    : undefined;
  const selection = pageIndex === state.pageIndex ? selectedPaneId : undefined;
  return {
    ...state,
    pageIndex,
    selectedPaneId: selection,
    encoderMode: selection ? state.encoderMode : "thinking",
  };
}

const sendSelected = (
  state: ControlState,
  keys: readonly string[],
): ReadonlyArray<ControlEffect> =>
  state.selectedPaneId ? [{ type: "sendKeys", paneId: state.selectedPaneId, keys }] : [];

export function reduceControlMessage(
  state: ControlState,
  message: ControlMessage,
  fleet: ReadonlyArray<Agent>,
  commandKeys: CommandKeys,
): { readonly state: ControlState; readonly effects: ReadonlyArray<ControlEffect> } {
  if (message.t === "encoderTimeout") {
    return { state: { ...state, encoderMode: "thinking" }, effects: [] };
  }
  if (message.t === "hello") return { state, effects: [] };
  if (message.t === "encoder") {
    if (message.delta === 0 || !state.selectedPaneId) return { state, effects: [] };
    const delta = -message.delta;
    const key =
      state.encoderMode === "thinking" ? "shift+tab" : delta > 0 ? "ctrl+p" : "shift+ctrl+p";
    return {
      state,
      effects: sendSelected(
        state,
        Array.from({ length: Math.abs(delta) }, () => key),
      ),
    };
  }
  if (message.k === 12) {
    if (!message.down || !state.selectedPaneId) return { state, effects: [] };
    return {
      state: {
        ...state,
        encoderMode: state.encoderMode === "thinking" ? "model" : "thinking",
      },
      effects: [],
    };
  }

  const page = projectFleet(fleet, state.pageIndex);
  if (message.k < PAGE_SIZE) {
    if (!message.down) return { state, effects: [] };
    const selected = page.slots[message.k];
    if (!selected) return { state, effects: [] };
    return {
      state: { ...state, selectedPaneId: selected.paneId },
      effects: [{ type: "focusAgent", paneId: selected.paneId }],
    };
  }
  if (message.k === PAGE_SIZE) {
    if (!message.down) return { state, effects: [] };
    return {
      state: {
        ...state,
        pageIndex: (page.pageIndex + 1) % page.pageCount,
        selectedPaneId: undefined,
        encoderMode: "thinking",
      },
      effects: [],
    };
  }

  const action = commandKeys[String(message.k - 5) as keyof CommandKeys];
  if (action.type === "keyAlias") {
    return { state, effects: [{ type: "hid", key: action.key, down: message.down }] };
  }
  if (!message.down) return { state, effects: [] };
  switch (action.type) {
    case "none":
      return { state, effects: [] };
    case "newAgent":
      return { state, effects: [{ type: "newAgent" }] };
    case "closeTab":
      return { state, effects: [{ type: "closeTab" }] };
    case "enter":
      return { state, effects: sendSelected(state, ["enter"]) };
    case "sendCtrlC":
      return { state, effects: sendSelected(state, ["ctrl+c"]) };
    case "sendEsc":
      return { state, effects: sendSelected(state, ["esc"]) };
  }
}

export const shellCommand = (argv: readonly string[]): string =>
  argv
    .map((argument) =>
      /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
        ? argument
        : `'${argument.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
