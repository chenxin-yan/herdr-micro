import { initialControlState, type ControlState } from "./controls.ts";
import type { Tab, Workspace } from "./herdr.ts";
import {
  initialScreensaverState,
  type AgentStateSince,
  type ScreensaverState,
} from "./presentation.ts";
import type { Agent } from "./projection.ts";
import type { PiStatus } from "./render.ts";

export interface TargetSessionState {
  fleet: ReadonlyArray<Agent>;
  controls: ControlState;
  workspaces: ReadonlyArray<Workspace>;
  tabs: ReadonlyArray<Tab>;
  selectedDetail: { readonly paneId: string; readonly value: PiStatus | undefined } | undefined;
  sleeping: boolean;
  stateSince: Map<string, AgentStateSince>;
  screensaverState: ScreensaverState;
}

export function resetTargetSessionState(state: TargetSessionState): void {
  state.fleet = [];
  state.controls = initialControlState;
  state.workspaces = [];
  state.tabs = [];
  state.selectedDetail = undefined;
  state.sleeping = false;
  state.stateSince.clear();
  state.screensaverState = initialScreensaverState;
}
