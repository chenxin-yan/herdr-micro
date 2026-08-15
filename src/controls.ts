import type { CommandKeys } from "./config.ts";
import type { Tab, Workspace } from "./herdr.ts";
import { PAGE_SIZE, projectFleet, type Agent } from "./projection.ts";
import type { DeckMessage } from "./serial.ts";

export interface ControlState {
  readonly pageIndex: number;
  readonly selectedPaneId: string | undefined;
  readonly workspaceId: string | undefined;
  readonly encoderMode: "workspaces" | "tabs";
  readonly tabId: string | undefined;
}

export type ControlMessage = DeckMessage | { readonly t: "encoderTimeout" };

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
};

export function reconcileControls(state: ControlState, fleet: ReadonlyArray<Agent>): ControlState {
  const pageIndex = projectFleet(fleet, state.pageIndex).pageIndex;
  const selectedPaneId = fleet.some(({ paneId }) => paneId === state.selectedPaneId)
    ? state.selectedPaneId
    : undefined;
  return {
    ...state,
    pageIndex,
    selectedPaneId: pageIndex === state.pageIndex ? selectedPaneId : undefined,
  };
}

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
  commandKeys: CommandKeys,
): { readonly state: ControlState; readonly effects: ReadonlyArray<ControlEffect> } {
  if (message.t === "encoderTimeout") {
    return {
      state: { ...state, encoderMode: "workspaces", tabId: undefined },
      effects: [],
    };
  }
  if (message.t === "hello") return { state, effects: [] };
  if (message.t === "encoder") {
    if (message.delta === 0) return { state, effects: [] };
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
    const enteringTabs = state.encoderMode === "workspaces";
    return {
      state: {
        ...state,
        encoderMode: enteringTabs ? "tabs" : "workspaces",
        tabId: undefined,
      },
      effects: enteringTabs ? [{ type: "enterTabMode" }] : [],
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

const cycleNumbered = <
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

export const cycleWorkspace = (
  workspaces: ReadonlyArray<Workspace>,
  currentId: string | undefined,
  delta: number,
): Workspace | undefined => cycleNumbered(workspaces, currentId, delta);

export const cycleTab = (
  tabs: ReadonlyArray<Tab>,
  currentId: string | undefined,
  delta: number,
): Tab | undefined => cycleNumbered(tabs, currentId, delta);

export const shellCommand = (argv: readonly string[]): string =>
  argv
    .map((argument) =>
      /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
        ? argument
        : `'${argument.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
