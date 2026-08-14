import { PAGE_SIZE, projectFleet, type Agent } from "./projection.ts";

export function renderConsole(fleet: ReadonlyArray<Agent>, pageIndex = 0): string {
  const page = projectFleet(fleet, pageIndex);
  const slots = Array.from({ length: PAGE_SIZE }, (_, index) => {
    const agent = page.slots[index];
    return agent
      ? `${index + 1}. ${agent.name} [${agent.state}] (${agent.paneId})`
      : `${index + 1}. —`;
  });
  const overflow = page.overflow > 0 ? ` +${page.overflow}` : "";
  const offPage = page.offPageState === undefined ? "none" : page.offPageState;
  return [
    `Fleet — Page ${page.pageNumber}/${page.pageCount}${overflow}`,
    ...slots,
    `Off-page: ${offPage}`,
  ].join("\n");
}
