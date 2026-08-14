import type { CommandKeys } from "./config.ts";
import type { Workspace } from "./herdr.ts";
import { PAGE_SIZE, projectFleet, type Agent } from "./projection.ts";
import type { DeckMessage } from "./serial.ts";

export interface ControlState {
  readonly pageIndex: number;
  readonly selectedPaneId: string | undefined;
  readonly workspaceId: string | undefined;
}

export type ControlEffect =
  | { readonly type: "focusAgent"; readonly paneId: string }
  | { readonly type: "sendKeys"; readonly paneId: string; readonly keys: readonly string[] }
  | { readonly type: "newAgent" }
  | { readonly type: "hid"; readonly key: string }
  | { readonly type: "selectWorkspace"; readonly delta: number }
  | { readonly type: "jumpToAttention"; readonly paneId: string };

export const initialControlState: ControlState = {
  pageIndex: 0,
  selectedPaneId: undefined,
  workspaceId: undefined,
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

export function reduceDeckMessage(
  state: ControlState,
  message: DeckMessage,
  fleet: ReadonlyArray<Agent>,
  commandKeys: CommandKeys,
): { readonly state: ControlState; readonly effects: ReadonlyArray<ControlEffect> } {
  if (message.t === "hello") return { state, effects: [] };
  if (message.t === "encoder") {
    return message.delta === 0
      ? { state, effects: [] }
      : { state, effects: [{ type: "selectWorkspace", delta: message.delta }] };
  }
  if (!message.down) return { state, effects: [] };
  if (message.k === 12) {
    const attention = [
      ...fleet.filter(({ state: agentState }) => agentState === "blocked"),
      ...fleet.filter(({ state: agentState }) => agentState === "done"),
    ];
    if (attention.length === 0) return { state, effects: [] };
    const selectedIndex = attention.findIndex(({ paneId }) => paneId === state.selectedPaneId);
    const target = attention[(selectedIndex + 1) % attention.length]!;
    return {
      state: {
        ...state,
        pageIndex: Math.floor(fleet.indexOf(target) / PAGE_SIZE),
        selectedPaneId: target.paneId,
      },
      effects: [{ type: "jumpToAttention", paneId: target.paneId }],
    };
  }

  const page = projectFleet(fleet, state.pageIndex);
  if (message.k < 6) {
    const selected = page.slots[message.k];
    if (!selected) return { state, effects: [] };
    return {
      state: { ...state, selectedPaneId: selected.paneId },
      effects: [{ type: "focusAgent", paneId: selected.paneId }],
    };
  }

  const action = commandKeys[String(message.k - 5) as keyof CommandKeys];
  switch (action.type) {
    case "none":
      return { state, effects: [] };
    case "nextPage": {
      const pageIndex = (page.pageIndex + 1) % page.pageCount;
      return {
        state: { ...state, pageIndex, selectedPaneId: undefined },
        effects: [],
      };
    }
    case "newAgent":
      return { state, effects: [{ type: "newAgent" }] };
    case "keyAlias":
      return { state, effects: [{ type: "hid", key: action.key }] };
    case "enter":
      return {
        state,
        effects: state.selectedPaneId
          ? [{ type: "sendKeys", paneId: state.selectedPaneId, keys: ["enter"] }]
          : [],
      };
    case "sendCtrlC":
      return {
        state,
        effects: state.selectedPaneId
          ? [{ type: "sendKeys", paneId: state.selectedPaneId, keys: ["ctrl+c"] }]
          : [],
      };
  }
}

export function cycleWorkspace(
  workspaces: ReadonlyArray<Workspace>,
  currentId: string | undefined,
  delta: number,
): Workspace | undefined {
  const ordered = [...workspaces].sort((left, right) => left.number - right.number);
  if (ordered.length === 0) return;
  const focusedIndex = ordered.findIndex((workspace) => workspace.focused);
  const current = ordered.findIndex(({ id }) => id === currentId);
  const start = current >= 0 ? current : focusedIndex >= 0 ? focusedIndex : 0;
  const index = (((start + delta) % ordered.length) + ordered.length) % ordered.length;
  return ordered[index];
}

export const shellCommand = (argv: readonly string[]): string =>
  argv
    .map((argument) =>
      /^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)
        ? argument
        : `'${argument.replaceAll("'", `'\\''`)}'`,
    )
    .join(" ");
