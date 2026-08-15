import type { Config } from "./config.ts";
import { PAGE_SIZE, projectFleet, type Agent, type AgentState } from "./projection.ts";
import type { HostMessage } from "./serial.ts";

export type RenderSnapshot = Extract<HostMessage, { readonly t: "render" }>;

const OLED_WIDTH = 21;
const line = (value: string) => value.slice(0, OLED_WIDTH);

const color = (hex: string, brightness: number): readonly number[] => {
  const scale = (offset: number) =>
    Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * brightness);
  return [scale(1), scale(3), scale(5)];
};

const stateColor = (config: Config, state: AgentState) =>
  color(config.appearance.states[state], config.appearance.brightness);

const OFF = [0, 0, 0] as const;

export function buildRender(
  fleet: ReadonlyArray<Agent>,
  pageIndex: number,
  selectedPaneId: string | undefined,
  focusedWorkspace: string | undefined,
  encoderMode: "thinking" | "model",
  config: Config,
): RenderSnapshot {
  const page = projectFleet(fleet, pageIndex);
  const selected =
    selectedPaneId === undefined
      ? undefined
      : fleet.find(({ paneId }) => paneId === selectedPaneId);
  const led: ReadonlyArray<readonly number[]> = [
    ...Array.from({ length: PAGE_SIZE }, (_, index) => {
      const agent = page.slots[index];
      return agent ? stateColor(config, agent.state) : OFF;
    }),
    page.offPageState === undefined ? OFF : stateColor(config, page.offPageState),
    ...Object.values(config.commandKeys).map((action) =>
      action.type === "none" ? OFF : stateColor(config, "idle"),
    ),
  ];
  const text = selected
    ? [
        line(selected.name),
        line(selected.state),
        `Enc: ${encoderMode}`,
        `Page ${page.pageNumber}/${page.pageCount}`,
      ]
    : [
        "Target: local",
        line(`Workspace: ${focusedWorkspace ?? "—"}`),
        `Page ${page.pageNumber}/${page.pageCount}`,
        line(`Fleet: ${fleet.length}${page.overflow > 0 ? ` +${page.overflow}` : ""}`),
      ];
  return { t: "render", led, text };
}

export class LatestRenderQueue {
  #writing = false;
  #pending: RenderSnapshot | undefined;

  constructor(
    private readonly write: (snapshot: RenderSnapshot) => Promise<void>,
    private readonly onError: (cause: unknown) => void,
  ) {}

  enqueue(snapshot: RenderSnapshot): void {
    this.#pending = snapshot;
    if (!this.#writing) void this.#drain();
  }

  clear(): void {
    this.#pending = undefined;
  }

  async #drain(): Promise<void> {
    this.#writing = true;
    try {
      while (this.#pending) {
        const snapshot = this.#pending;
        this.#pending = undefined;
        await this.write(snapshot);
      }
    } catch (cause) {
      this.#pending = undefined;
      this.onError(cause);
    } finally {
      this.#writing = false;
    }
  }
}
