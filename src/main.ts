#!/usr/bin/env bun
import { homedir } from "node:os";

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { version } from "../package.json";
import { configFileExists, initializeConfig, loadConfig, type Config } from "./config.ts";
import {
  cycleTab,
  cycleWorkspace,
  initialControlState,
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
  sendRequest,
  watchFleet,
  type Tab,
  type Workspace,
} from "./herdr.ts";
import type { Agent } from "./projection.ts";
import { buildRender, LatestRenderQueue } from "./render.ts";
import { watchDeck, type DeckMessage, type DeckWriter } from "./serial.ts";

const HERDR_VERSION_TIMEOUT = "5 seconds";
const HERDR_SOCKET = `${homedir()}/.config/herdr/herdr.sock`;

const herdrVersion = Effect.tryPromise({
  try: async (signal) => {
    const child = Bun.spawn(["herdr", "--version"], { stdout: "pipe", stderr: "pipe", signal });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `exit ${exitCode}`);
    return stdout.trim();
  },
  catch: (cause) => new Error(`Cannot run herdr --version: ${String(cause)}`),
}).pipe(
  Effect.timeoutOrElse({
    duration: HERDR_VERSION_TIMEOUT,
    orElse: () =>
      Effect.fail(
        new Error(`Cannot run herdr --version: timed out after ${HERDR_VERSION_TIMEOUT}`),
      ),
  }),
);

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
      active: undefined,
    };

    const enqueueRender = () => {
      if (!state.active?.live) return;
      const currentWorkspace = state.workspaces.find(({ id }) => id === state.controls.workspaceId);
      const orderedTabs = [...state.tabs].sort((left, right) => left.number - right.number);
      const currentTab =
        orderedTabs.find(({ id }) => id === state.controls.tabId) ??
        orderedTabs.find(({ focused }) => focused);
      const tabMode =
        state.controls.encoderMode === "tabs" && currentTab
          ? {
              label: currentTab.label,
              index: orderedTabs.indexOf(currentTab),
              count: orderedTabs.length,
            }
          : undefined;
      state.active.renders.enqueue(
        buildRender(
          state.fleet,
          state.controls.pageIndex,
          state.controls.selectedPaneId,
          currentWorkspace?.label ?? currentWorkspace?.id,
          tabMode,
          config,
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

    let tabModeTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTabModeTimer = () => {
      if (tabModeTimer) clearTimeout(tabModeTimer);
      tabModeTimer = undefined;
    };
    const leaveTabMode = () => {
      clearTabModeTimer();
      state.controls = reduceControlMessage(
        state.controls,
        { t: "encoderTimeout" },
        state.fleet,
        config.commandKeys,
      ).state;
      state.tabs = [];
      enqueueRender();
    };
    const armTabModeTimer = () => {
      clearTabModeTimer();
      tabModeTimer = setTimeout(leaveTabMode, config.encoderTimeoutSeconds * 1_000);
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
            }).pipe(Effect.asVoid);
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
              const target = cycleWorkspace(workspaces, state.controls.workspaceId, effect.delta);
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
              const target = cycleTab(tabs, state.controls.tabId, effect.delta);
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
      active.live = fw === version;
      if (!active.live) {
        console.error(
          `Deck app version ${fw} does not match host ${version}; redeploy the Device Bundle`,
        );
      }
      return active.deck.write({ t: "hello", host: version }).pipe(
        Effect.tap(() => Effect.sync(enqueueRender)),
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
        const previousMode = state.controls.encoderMode;
        const reduced = reduceControlMessage(
          state.controls,
          message,
          state.fleet,
          config.commandKeys,
        );
        state.controls = reduced.state;
        for (const effect of reduced.effects) console.error(`  -> ${JSON.stringify(effect)}`);
        if (
          state.controls.encoderMode === "tabs" &&
          (message.t === "encoder" || (message.t === "key" && message.k === 12))
        ) {
          armTabModeTimer();
        } else if (previousMode === "tabs" && state.controls.encoderMode === "workspaces") {
          clearTabModeTimer();
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
          leaveTabMode();
          console.error("Deck disconnected");
        }),
    };

    yield* Effect.all(
      [
        watchFleet(
          HERDR_SOCKET,
          (snapshot) => {
            state.fleet = snapshot.fleet;
            state.controls = reconcileControls(
              state.controls,
              snapshot.fleet,
              snapshot.focusedPaneId,
            );
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

command.pipe(
  Command.withSubcommands([configCommand]),
  Command.run({ version }),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain,
);
