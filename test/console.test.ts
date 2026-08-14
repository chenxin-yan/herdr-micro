import { expect, test } from "bun:test";

import { renderConsole } from "../src/console.ts";

test("renders a six-slot Fleet page", () => {
  expect(
    renderConsole([
      {
        paneId: "p1",
        workspaceId: "w",
        tabId: "t",
        name: "pi",
        state: "working",
      },
    ]),
  ).toBe(`Fleet — Page 1/1
1. pi [working] (p1)
2. —
3. —
4. —
5. —
6. —
Off-page: none`);
});
