import type { Agent } from "./projection.ts";

export interface AgentStateSince {
  readonly state: Agent["state"];
  readonly since: number;
}

export const syncStateSince = (
  stateSince: Map<string, AgentStateSince>,
  fleet: ReadonlyArray<Agent>,
  now: number,
): void => {
  const paneIds = new Set(fleet.map(({ paneId }) => paneId));
  for (const agent of fleet) {
    const previous = stateSince.get(agent.paneId);
    if (!previous || previous.state !== agent.state) {
      stateSince.set(agent.paneId, { state: agent.state, since: now });
    }
  }
  for (const paneId of stateSince.keys()) {
    if (!paneIds.has(paneId)) stateSince.delete(paneId);
  }
};

export interface ScreensaverState {
  readonly fleetSignature: string | undefined;
  readonly idleSince: number | undefined;
  readonly sleeping: boolean;
}

export const initialScreensaverState: ScreensaverState = {
  fleetSignature: undefined,
  idleSince: undefined,
  sleeping: false,
};

export const reconcileScreensaver = (
  previous: ScreensaverState,
  fleet: ReadonlyArray<Agent>,
  now: number,
  timeoutMs: number,
  activity = false,
): ScreensaverState => {
  const fleetSignature = fleet.map(({ paneId, state }) => `${paneId}:${state}`).join("|");
  if (fleet.some(({ state }) => state !== "idle")) {
    return { fleetSignature, idleSince: undefined, sleeping: false };
  }
  if (activity || fleetSignature !== previous.fleetSignature) {
    return { fleetSignature, idleSince: now, sleeping: false };
  }
  const idleSince = previous.idleSince ?? now;
  return {
    fleetSignature,
    idleSince,
    sleeping: now - idleSince >= timeoutMs,
  };
};
