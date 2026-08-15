import type { Config } from "./config.ts";
import { PAGE_SIZE, projectFleet, type Agent, type AgentState } from "./projection.ts";
import type { DeviceLed, HeaderState, HostMessage, LedEffect } from "./serial.ts";

export type RenderSnapshot = Extract<HostMessage, { readonly t: "render" }>;

const OLED_WIDTH = 21;
const HEADER_CAPACITY = 16;
const line = (value: string) => value.slice(0, OLED_WIDTH);

const color = (hex: string, brightness: number): readonly [number, number, number] => {
  const scale = (offset: number) =>
    Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * brightness);
  return [scale(1), scale(3), scale(5)];
};

const STATE_EFFECTS: Partial<Record<AgentState, LedEffect>> = {
  working: "breathe",
  blocked: "blink",
};
const HEADER_STATES: Record<AgentState, HeaderState> = {
  working: "w",
  idle: "i",
  blocked: "b",
  done: "d",
  unknown: "u",
};

const stateLed = (config: Config, state: AgentState): DeviceLed => {
  const base = color(config.appearance.states[state], config.appearance.brightness);
  const effect = STATE_EFFECTS[state];
  return effect ? [...base, effect] : base;
};

const selectedLed = (config: Config, state: AgentState): DeviceLed => {
  const base = color(config.appearance.states[state], config.appearance.brightness);
  const white = Math.round(255 * config.appearance.brightness);
  const highlighted = base.map((channel) => Math.round(channel + (white - channel) * 0.35)) as [
    number,
    number,
    number,
  ];
  return [...highlighted, "breathe"];
};

const OFF = [0, 0, 0] as const;

export interface EncoderModeRender {
  readonly mode: "workspaces" | "tabs" | "model";
  readonly tab?: { readonly label: string; readonly index: number; readonly count: number };
}

export interface PiStatus {
  readonly model: string;
  readonly thinking: string;
  readonly cost: number;
  readonly contextPercent: number;
}

export interface RenderOptions {
  readonly selectedStateSince?: number;
  readonly detail?: PiStatus;
  readonly now?: number;
  readonly sleep?: boolean;
}

const COMMAND_SLOTS = ["1", "2", "3", "4", "5", "6"] as const;

export function parsePiStatus(text: string): PiStatus | undefined {
  for (const value of text.split("\n")) {
    const match = value.match(
      /\$(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\/\S+.*?\s(\S+)\s+•\s+(\S+)\s*$/,
    );
    if (!match) continue;
    return {
      cost: Number(match[1]),
      contextPercent: Number(match[2]),
      model: match[3]!,
      thinking: match[4]!,
    };
  }
}

export const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
};

const detailLine = (detail: PiStatus | undefined): string => {
  if (!detail) return "";
  const suffix = `·${detail.thinking} $${Math.floor(detail.cost)} ${Math.floor(detail.contextPercent)}%`;
  let model = detail.model;
  if (model.length + suffix.length > OLED_WIDTH) model = model.replace(/^claude-/, "");
  return line(`${model.slice(0, Math.max(0, OLED_WIDTH - suffix.length))}${suffix}`);
};

export function buildRender(
  fleet: ReadonlyArray<Agent>,
  pageIndex: number,
  selectedPaneId: string | undefined,
  workspaceLabel: string | undefined,
  encoder: EncoderModeRender,
  layerHeld: boolean,
  config: Config,
  options: RenderOptions = {},
): RenderSnapshot {
  const page = projectFleet(fleet, pageIndex);
  const selectedFleetIndex = fleet.findIndex(({ paneId }) => paneId === selectedPaneId);
  const selected = selectedFleetIndex < 0 ? undefined : fleet[selectedFleetIndex];
  const led: ReadonlyArray<DeviceLed> = [
    ...Array.from({ length: PAGE_SIZE }, (_, index) => {
      const agent = page.slots[index];
      if (!agent) return OFF;
      return agent.paneId === selectedPaneId
        ? selectedLed(config, agent.state)
        : stateLed(config, agent.state);
    }),
    page.offPageState === undefined ? OFF : stateLed(config, page.offPageState),
    ...COMMAND_SLOTS.map((slot) => {
      const baseAction = config.commandKeys[slot];
      const layerAction = config.layerKeys[slot];
      const action = layerHeld && baseAction.type !== "layer" ? layerAction : baseAction;
      return action.type === "none" ? OFF : color(action.color, config.appearance.brightness);
    }),
  ];
  const context =
    encoder.mode === "model"
      ? "model"
      : encoder.mode === "tabs"
        ? encoder.tab
          ? `tabs ${encoder.tab.index + 1}/${encoder.tab.count} ${encoder.tab.label}`
          : "tabs"
        : (workspaceLabel ?? "");
  const duration =
    selected && options.selectedStateSince !== undefined
      ? formatDuration((options.now ?? Date.now()) - options.selectedStateSince)
      : undefined;
  const stateSuffix = selected
    ? `  ${selected.state}${duration === undefined ? "" : ` ${duration}`}`
    : "";
  const selectedLine = selected
    ? `> ${selected.name.slice(0, Math.max(0, OLED_WIDTH - stateSuffix.length - 2))}${stateSuffix}`
    : "no agent selected";
  const boxes = fleet.slice(0, HEADER_CAPACITY).map(({ state }) => HEADER_STATES[state]);
  const snapshot: RenderSnapshot = {
    t: "render",
    led,
    hdr: {
      boxes,
      sel: selectedFleetIndex >= 0 && selectedFleetIndex < boxes.length ? selectedFleetIndex : null,
      page: page.pageIndex + 1,
      pages: page.pageCount,
    },
    text: [line(context), line(selectedLine), detailLine(options.detail)],
    ...(options.sleep ? { sleep: true } : {}),
  };
  return snapshot;
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
