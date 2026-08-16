import type { Agent } from "./projection.ts";

export type SoundName = "attn" | "done";

export function detectFleetSound(
  previous: ReadonlyArray<Agent> | undefined,
  next: ReadonlyArray<Agent>,
  enabled: boolean,
): SoundName | undefined {
  if (!enabled || previous === undefined) return;

  const previousByPane = new Map(previous.map((agent) => [agent.paneId, agent.state]));
  let done = false;
  for (const agent of next) {
    const prior = previousByPane.get(agent.paneId);
    if (prior !== undefined && prior !== "blocked" && agent.state === "blocked") return "attn";
    if (prior === "working" && agent.state === "idle") done = true;
  }
  return done ? "done" : undefined;
}
