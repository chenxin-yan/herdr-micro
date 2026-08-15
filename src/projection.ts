export const AGENT_STATES = ["idle", "working", "blocked", "done", "unknown"] as const;
export type AgentState = (typeof AGENT_STATES)[number];

export interface Agent {
  readonly paneId: string;
  readonly name: string;
  readonly state: AgentState;
  readonly workspaceId: string;
  readonly tabId: string;
}

interface FleetProjection {
  readonly pageIndex: number;
  readonly pageNumber: number;
  readonly pageCount: number;
  readonly slots: ReadonlyArray<Agent>;
  readonly overflow: number;
  readonly offPageState: AgentState | undefined;
}

export const PAGE_SIZE = 5;
const PRIORITY: Record<AgentState, number> = {
  idle: 0,
  unknown: 1,
  working: 2,
  done: 3,
  blocked: 4,
};

export function projectFleet(
  fleet: ReadonlyArray<Agent>,
  requestedPageIndex: number,
): FleetProjection {
  const pageCount = Math.max(1, Math.ceil(fleet.length / PAGE_SIZE));
  const pageIndex = Math.max(0, Math.min(Math.trunc(requestedPageIndex), pageCount - 1));
  const start = pageIndex * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const offPage = fleet.filter((_, index) => index < start || index >= end);

  return {
    pageIndex,
    pageNumber: pageIndex + 1,
    pageCount,
    slots: fleet.slice(start, end),
    overflow: Math.max(0, fleet.length - end),
    offPageState: offPage.reduce<AgentState | undefined>(
      (highest, { state }) =>
        highest === undefined || PRIORITY[state] > PRIORITY[highest] ? state : highest,
      undefined,
    ),
  };
}
