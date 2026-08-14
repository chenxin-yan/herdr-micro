import { describe, expect, test } from "bun:test";

import { projectFleet, type Agent } from "../src/projection.ts";

const agent = (index: number, state: Agent["state"] = "idle"): Agent => ({
  paneId: `pane-${index}`,
  name: `agent-${index}`,
  state,
  workspaceId: "workspace",
  tabId: `tab-${index}`,
});

describe("projectFleet", () => {
  test("projects an empty fleet as one empty page", () => {
    expect(projectFleet([], 0)).toEqual({
      pageIndex: 0,
      pageNumber: 1,
      pageCount: 1,
      slots: [],
      overflow: 0,
      offPageState: undefined,
    });
  });

  test("projects exactly six agents in Herdr order", () => {
    const fleet = Array.from({ length: 6 }, (_, index) => agent(index + 1));
    const projection = projectFleet(fleet, 0);
    expect(projection.slots.map(({ paneId }) => paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-3",
      "pane-4",
      "pane-5",
      "pane-6",
    ]);
    expect(projection.pageCount).toBe(1);
    expect(projection.overflow).toBe(0);
    expect(projection.offPageState).toBeUndefined();
  });

  test("pages seven agents and prioritizes off-page state", () => {
    const fleet = Array.from({ length: 7 }, (_, index) => agent(index + 1));
    fleet[6] = agent(7, "blocked");

    const first = projectFleet(fleet, 0);
    expect(first.slots).toHaveLength(6);
    expect(first.pageCount).toBe(2);
    expect(first.overflow).toBe(1);
    expect(first.offPageState).toBe("blocked");

    const second = projectFleet(fleet, 1);
    expect(second.slots.map(({ paneId }) => paneId)).toEqual(["pane-7"]);
    expect(second.offPageState).toBe("idle");
  });

  test("shifts following agents left when an agent exits mid-page", () => {
    const fleet = Array.from({ length: 7 }, (_, index) => agent(index + 1));
    const withoutThird = fleet.filter(({ paneId }) => paneId !== "pane-3");

    expect(projectFleet(withoutThird, 0).slots.map(({ paneId }) => paneId)).toEqual([
      "pane-1",
      "pane-2",
      "pane-4",
      "pane-5",
      "pane-6",
      "pane-7",
    ]);
  });

  test("clamps the current page after the last page disappears", () => {
    const fleet = Array.from({ length: 6 }, (_, index) => agent(index + 1));
    expect(projectFleet(fleet, 1).pageIndex).toBe(0);
  });
});
