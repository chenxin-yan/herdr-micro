#!/usr/bin/env bun
import { homedir } from "node:os";

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Fiber, Schedule } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { version } from "../package.json";
import { configFileExists, initializeConfig, loadConfig, type Config } from "./config.ts";
import {
  cycleNumbered,
  initialControlState,
  isLayerHeld,
  reconcileControls,
  reduceControlMessage,
  shellCommand,
  type ControlEffect,
  type ControlState,
} from "./controls.ts";
import {
  createAgent,
  listTabs,
  listWorkspaces,
  readAgentVisible,
  sendRequest,
  watchFleet,
  type Tab,
  type Workspace,
} from "./herdr.ts";
import {
  initialScreensaverState,
  reconcileScreensaver,
  syncStateSince,
  type AgentStateSince,
} from "./presentation.ts";
import type { Agent } from "./projection.ts";
import {
  buildRender,
  LatestRenderQueue,
  parsePiStatus,
  type EncoderModeRender,
  type PiStatus,
} from "./render.ts";
import { watchDeck, type DeckMessage, type DeckWriter } from "./serial.ts";
import { setupHost, startService, stopService, uninstallService } from "./setup.ts";

const HERDR_SOCKET = `${homedir()}/.config/herdr/herdr.sock`;

const herdrVersion = Effect.try({
  try: () => {
    const result = Bun.spawnSync(["herdr", "--version"], { timeout: 5_000 });
    if (!result.success) {
      throw new Error(
        result.stderr.toString().trim() ||
          (result.exitedDueToTimeout ? "timed out after 5 seconds" : `exit ${result.exitCode}`),
      );
    }
    return result.stdout.toString().trim();
  },
  catch: (cause) => new Error(`Cannot run herdr --version: ${String(cause)}`),
});

interface ActiveDeck {
  readonly deck: DeckWriter;
  readonly renders: LatestRenderQueue;
  live: boolean;
}

interface AppState {
  fleet: ReadonlyArray<Agent>;
  controls: ControlState;
  workspaces: ReadonlyArray<Workspace>;
  tabs: ReadonlyArray<Tab>;
  selectedDetail: { readonly paneId: string; readonly value: PiStatus | undefined } | undefined;
  sleeping: boolean;
  active: ActiveDeck | undefined;
}

const logFailure = (cause: { readonly message: string }) =>
  Effect.sync(() => console.error(cause.message));

const hostProgram = (config: Config) =>
  Effect.gen(function* () {
    const state: AppState = {
      fleet: [],
      controls: initialControlState,
      workspaces: [],
      tabs: [],
      selectedDetail: undefined,
      sleeping: false,
      active: undefined,
    };
    const stateSince = new Map<string, AgentStateSince>();
    const enqueueRender = () => {
      if (!state.active?.live) return;
      const currentWorkspace = state.workspaces.find(({ id }) => id === state.controls.workspaceId);
      const orderedTabs = [...state.tabs].sort((left, right) => left.number - right.number);
      const currentTab =
        orderedTabs.find(({ id }) => id === state.controls.tabId) ??
        orderedTabs.find(({ focused }) => focused);
      const encoder: EncoderModeRender = {
        mode: state.controls.encoderMode,
        tab:
          state.controls.encoderMode === "tabs" && currentTab
            ? {
                label: currentTab.label,
                index: orderedTabs.indexOf(currentTab),
                count: orderedTabs.length,
              }
            : undefined,
      };
      const layerHeld = isLayerHeld(state.controls.pressedCommandActions);
      const selectedPaneId = state.controls.selectedPaneId;
      const selectedDetail = state.selectedDetail;
      state.active.renders.enqueue(
        buildRender(
          state.fleet,
          state.controls.pageIndex,
          selectedPaneId,
          currentWorkspace?.label,
          encoder,
          layerHeld,
          config,
          {
            selectedStateSince: selectedPaneId ? stateSince.get(selectedPaneId)?.since : undefined,
            detail:
              selectedDetail && selectedDetail.paneId === selectedPaneId
                ? selectedDetail.value
                : undefined,
            sleep: state.sleeping,
          },
        ),
      );
    };

    const refreshWorkspaces = listWorkspaces(HERDR_SOCKET).pipe(
      Effect.tap((workspaces) =>
        Effect.sync(() => {
          state.workspaces = workspaces;
          const currentWorkspace = workspaces.find((workspace) => workspace.focused);
          if (currentWorkspace) {
            state.controls = {
              ...state.controls,
              workspaceId: currentWorkspace.id,
              tabId:
                state.controls.encoderMode === "tabs"
                  ? currentWorkspace.activeTabId
                  : state.controls.tabId,
            };
          }
          enqueueRender();
        }),
      ),
    );

    let detailFiber: Fiber.Fiber<unknown, unknown> | undefined;
    const stopDetailPolling = () => {
      // Interrupting the fiber also cancels any in-flight read, so a stale
      // response can never write state for a previously selected pane.
      if (detailFiber) Effect.runFork(Fiber.interrupt(detailFiber));
      detailFiber = undefined;
    };
    const startDetailPolling = () => {
      stopDetailPolling();
      const paneId = state.controls.selectedPaneId;
      if (!paneId || !state.active?.live) return;
      let failureLogged = false;
      const poll = readAgentVisible(HERDR_SOCKET, paneId).pipe(
        Effect.map(parsePiStatus),
        // A wedged pane must blank the detail line, not freeze the last good
        // parse; log the failure once per selected pane and keep polling.
        Effect.catch((cause) =>
          Effect.sync(() => {
            if (!failureLogged) {
              failureLogged = true;
              console.error(`Cannot read selected agent detail: ${String(cause)}`);
            }
            return undefined;
          }),
        ),
        Effect.tap((value) =>
          Effect.sync(() => {
            state.selectedDetail = { paneId, value };
            enqueueRender(); // The same cadence keeps the selected state duration live.
          }),
        ),
      );
      detailFiber = Effect.runFork(poll.pipe(Effect.repeat(Schedule.spaced("3 seconds"))));
    };
    const restartDetailPolling = () => {
      state.selectedDetail = undefined;
      startDetailPolling();
    };
    // Sent keys usually change the footer (model, thinking, cost); re-read soon
    // instead of waiting out the 3s cadence. Keeps the current value: no flash.
    let detailNudgeTimer: ReturnType<typeof setTimeout> | undefined;
    const nudgeDetailPolling = () => {
      if (detailNudgeTimer) clearTimeout(detailNudgeTimer);
      detailNudgeTimer = setTimeout(startDetailPolling, 500);
    };
    const syncDetailPolling = (previousPaneId: string | undefined) => {
      if (state.controls.selectedPaneId === previousPaneId) return;
      restartDetailPolling();
    };

    let screensaverTimer: ReturnType<typeof setTimeout> | undefined;
    let screensaverState = initialScreensaverState;
    const screensaverTimeoutMs = config.screensaverMinutes * 60_000;
    const clearScreensaverTimer = () => {
      if (screensaverTimer) clearTimeout(screensaverTimer);
      screensaverTimer = undefined;
    };
    const syncScreensaver = (activity = false) => {
      clearScreensaverTimer();
      const wasSleeping = state.sleeping;
      const now = Date.now();
      screensaverState = reconcileScreensaver(
        screensaverState,
        state.fleet,
        now,
        screensaverTimeoutMs,
        activity,
      );
      state.sleeping = screensaverState.sleeping;
      if (screensaverState.idleSince !== undefined && !screensaverState.sleeping) {
        const remaining = screensaverTimeoutMs - (now - screensaverState.idleSince);
        screensaverTimer = setTimeout(syncScreensaver, Math.max(1, remaining));
      }
      if (wasSleeping !== state.sleeping) enqueueRender();
    };
    const noteActivity = () => syncScreensaver(true);
    const syncFleetPresentationState = (fleet: ReadonlyArray<Agent>) => {
      syncStateSince(stateSince, fleet, Date.now());
      syncScreensaver();
    };

    let encoderModeTimer: ReturnType<typeof setTimeout> | undefined;
    const clearEncoderModeTimer = () => {
      if (encoderModeTimer) clearTimeout(encoderModeTimer);
      encoderModeTimer = undefined;
    };
    const leaveEncoderMode = () => {
      clearEncoderModeTimer();
      state.controls = reduceControlMessage(
        state.controls,
        { t: "encoderTimeout" },
        state.fleet,
        config,
      ).state;
      state.tabs = [];
      enqueueRender();
    };
    const armEncoderModeTimer = () => {
      clearEncoderModeTimer();
      encoderModeTimer = setTimeout(leaveEncoderMode, config.encoderTimeoutSeconds * 1_000);
    };

    const execute = (effect: ControlEffect, deck: DeckWriter): Effect.Effect<void, never> => {
      const operation = (() => {
        switch (effect.type) {
          case "focusAgent":
            return sendRequest(HERDR_SOCKET, "agent.focus", { target: effect.paneId }).pipe(
              Effect.asVoid,
            );
          case "sendKeys":
            return sendRequest(HERDR_SOCKET, "agent.send_keys", {
              target: effect.paneId,
              keys: effect.keys,
            }).pipe(
              Effect.tap(() => Effect.sync(nudgeDetailPolling)),
              Effect.asVoid,
            );
          case "hid":
            return deck.write({ t: "hid", key: effect.key, down: effect.down });
          case "newAgent":
            return Effect.gen(function* () {
              const workspaces = yield* listWorkspaces(HERDR_SOCKET);
              const currentWorkspace = workspaces.find((workspace) => workspace.focused);
              if (!currentWorkspace) return;
              yield* createAgent(
                HERDR_SOCKET,
                currentWorkspace.id,
                shellCommand(config.defaultAgentCommand),
              );
            });
          case "closeTab":
            return Effect.gen(function* () {
              const workspaces = yield* listWorkspaces(HERDR_SOCKET);
              const tabId = workspaces.find((workspace) => workspace.focused)?.activeTabId;
              if (!tabId) return;
              yield* sendRequest(HERDR_SOCKET, "tab.close", { tab_id: tabId });
            });
          case "selectWorkspace":
            return Effect.gen(function* () {
              const workspaces = yield* listWorkspaces(HERDR_SOCKET);
              const target = cycleNumbered(workspaces, state.controls.workspaceId, effect.delta);
              if (!target) return;
              state.workspaces = workspaces;
              state.tabs = [];
              state.controls = { ...state.controls, workspaceId: target.id, tabId: undefined };
              enqueueRender();
              yield* sendRequest(HERDR_SOCKET, "workspace.focus", {
                workspace_id: target.id,
              });
            });
          case "enterTabMode":
            return Effect.gen(function* () {
              const workspaces = yield* listWorkspaces(HERDR_SOCKET);
              const workspace = workspaces.find((value) => value.focused);
              if (!workspace) return;
              const tabs = yield* listTabs(HERDR_SOCKET, workspace.id);
              const focused = tabs.find((tab) => tab.focused);
              state.workspaces = workspaces;
              state.tabs = tabs;
              state.controls = {
                ...state.controls,
                workspaceId: workspace.id,
                tabId: focused?.id ?? workspace.activeTabId,
              };
              enqueueRender();
            });
          case "selectTab":
            return Effect.gen(function* () {
              if (!state.controls.workspaceId) return;
              const tabs = yield* listTabs(HERDR_SOCKET, state.controls.workspaceId);
              const target = cycleNumbered(tabs, state.controls.tabId, effect.delta);
              if (!target) return;
              state.tabs = tabs;
              state.controls = { ...state.controls, tabId: target.id };
              enqueueRender();
              yield* sendRequest(HERDR_SOCKET, "tab.focus", { tab_id: target.id });
            });
          case "log":
            return Effect.sync(() => console.error(effect.message));
        }
      })();
      return operation.pipe(Effect.catch(logFailure));
    };

    const handleHello = (active: ActiveDeck, fw: string): Effect.Effect<void, never> => {
      const becameLive = !active.live && fw === version;
      active.live = fw === version;
      // A Deck auto-reload emits hello on the still-open port (no disconnect fires);
      // key-up events from before the reload are gone, so discard captured actions.
      state.controls = { ...state.controls, pressedCommandActions: {} };
      if (!active.live) {
        console.error(
          `Deck app version ${fw} does not match host ${version}; redeploy the Device Bundle`,
        );
      }
      return active.deck.write({ t: "hello", host: version }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (becameLive) restartDetailPolling();
            enqueueRender();
          }),
        ),
        Effect.catch(logFailure),
      );
    };

    const handlers = {
      connected: (deck: DeckWriter): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          const renders = new LatestRenderQueue(
            (snapshot) => Effect.runPromise(deck.write(snapshot)),
            (cause) => console.error(`Deck render failed: ${String(cause)}`),
          );
          const active: ActiveDeck = { deck, renders, live: false };
          state.active = active;
          console.error(`Deck connected at ${deck.path}`);
          yield* handleHello(active, deck.fw);
          yield* refreshWorkspaces.pipe(Effect.catch(logFailure));
        }),
      message: (deck: DeckWriter, message: DeckMessage): Effect.Effect<void, never> => {
        const active = state.active;
        if (!active || active.deck !== deck) return Effect.void;
        if (message.t === "hello") return handleHello(active, message.fw);
        if (!active.live) return Effect.void;

        // Desk debugging: deck events are low-rate, so tracing stays on.
        console.error(`deck ${JSON.stringify(message)}`);
        noteActivity();
        const previousMode = state.controls.encoderMode;
        const reduced = reduceControlMessage(state.controls, message, state.fleet, config);
        state.controls = reduced.state;
        for (const effect of reduced.effects) console.error(`  -> ${JSON.stringify(effect)}`);
        if (
          state.controls.encoderMode !== "workspaces" &&
          ((message.t === "encoder" && message.delta !== 0) ||
            (message.t === "key" && message.k === 12 && message.down))
        ) {
          armEncoderModeTimer();
        } else if (previousMode !== "workspaces" && state.controls.encoderMode === "workspaces") {
          clearEncoderModeTimer();
          state.tabs = [];
        }
        enqueueRender();
        return Effect.forEach(reduced.effects, (effect) => execute(effect, deck), {
          discard: true,
        });
      },
      disconnected: (deck: DeckWriter): Effect.Effect<void, never> =>
        Effect.sync(() => {
          if (state.active?.deck !== deck) return;
          state.active.renders.clear();
          state.active = undefined;
          stopDetailPolling();
          leaveEncoderMode();
          // Key-up events are not replayed after reconnect, so discard captured actions.
          state.controls = { ...state.controls, pressedCommandActions: {} };
          console.error("Deck disconnected");
        }),
    };

    yield* Effect.all(
      [
        watchFleet(
          HERDR_SOCKET,
          (snapshot) => {
            const previousPaneId = state.controls.selectedPaneId;
            state.fleet = snapshot.fleet;
            syncFleetPresentationState(snapshot.fleet);
            state.controls = reconcileControls(
              state.controls,
              snapshot.fleet,
              snapshot.focusedPaneId,
            );
            syncDetailPolling(previousPaneId);
            enqueueRender();
          },
          () => refreshWorkspaces,
        ),
        watchDeck(handlers),
      ],
      { concurrency: "unbounded", discard: true },
    );
  });

const reportCliError = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A | void, never, R> =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      }),
    ),
  );

const command = Command.make("herdr-micro").pipe(
  Command.withSharedFlags({
    config: Flag.file("config").pipe(
      Flag.withDescription("Path to the configuration file"),
      Flag.withDefault(`${homedir()}/.config/herdr-micro/config.json`),
    ),
  }),
  Command.withHandler(({ config }) =>
    reportCliError(
      Effect.gen(function* () {
        const loaded = yield* loadConfig(config);
        const herdr = yield* herdrVersion;
        yield* Effect.sync(() => console.error(`herdr-micro: ${herdr}`));
        yield* hostProgram(loaded);
      }),
    ),
  ),
);

const configInitCommand = Command.make("init", {}, () =>
  reportCliError(
    Effect.gen(function* () {
      const { config } = yield* command;
      yield* initializeConfig(config);
      console.log(config);
    }),
  ),
);

const configCommand = Command.make("config", {}, () =>
  reportCliError(
    Effect.gen(function* () {
      const { config } = yield* command;
      const exists = yield* configFileExists(config);
      console.log(`${config}: ${exists ? "configured" : "none (built-in defaults)"}`);
    }),
  ),
).pipe(Command.withSubcommands([configInitCommand]));

const setupCommand = Command.make("setup", {}, () =>
  reportCliError(
    Effect.gen(function* () {
      const { config } = yield* command;
      yield* setupHost(config);
    }),
  ),
);
const upCommand = Command.make("up", {}, () => reportCliError(startService));
const downCommand = Command.make("down", {}, () => reportCliError(stopService));
const uninstallCommand = Command.make("uninstall", {}, () => reportCliError(uninstallService));

command.pipe(
  Command.withSubcommands([configCommand, setupCommand, upCommand, downCommand, uninstallCommand]),
  Command.run({ version }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
