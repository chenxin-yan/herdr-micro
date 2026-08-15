#!/usr/bin/env bun
import { homedir } from "node:os";

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { version } from "../package.json";
import { loadConfig, type Config } from "./config.ts";
import {
  initialControlState,
  reconcileControls,
  reduceControlMessage,
  shellCommand,
  type ControlEffect,
  type ControlState,
} from "./controls.ts";
import { createAgent, listWorkspaces, sendRequest, watchFleet, type Workspace } from "./herdr.ts";
import type { Agent } from "./projection.ts";
import { buildRender, LatestRenderQueue } from "./render.ts";
import { watchDeck, type DeckMessage, type DeckWriter } from "./serial.ts";

const HERDR_VERSION_TIMEOUT = "5 seconds";
// ponytail: fixed desk-calibrated timeout; make configurable only if real use needs tuning.
const MODEL_MODE_TIMEOUT_MS = 4_000;
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
      active: undefined,
    };

    const enqueueRender = () => {
      if (!state.active?.live) return;
      const currentWorkspace = state.workspaces.find(({ focused }) => focused);
      state.active.renders.enqueue(
        buildRender(
          state.fleet,
          state.controls.pageIndex,
          state.controls.selectedPaneId,
          currentWorkspace?.label ?? currentWorkspace?.id,
          state.controls.encoderMode,
          config,
        ),
      );
    };

    const refreshWorkspaces = listWorkspaces(HERDR_SOCKET).pipe(
      Effect.tap((workspaces) =>
        Effect.sync(() => {
          state.workspaces = workspaces;
          enqueueRender();
        }),
      ),
    );

    let modelModeTimer: ReturnType<typeof setTimeout> | undefined;
    const clearModelModeTimer = () => {
      if (modelModeTimer) clearTimeout(modelModeTimer);
      modelModeTimer = undefined;
    };
    const leaveModelMode = () => {
      clearModelModeTimer();
      state.controls = reduceControlMessage(
        state.controls,
        { t: "encoderTimeout" },
        state.fleet,
        config.commandKeys,
      ).state;
      enqueueRender();
    };
    const armModelModeTimer = () => {
      clearModelModeTimer();
      modelModeTimer = setTimeout(leaveModelMode, MODEL_MODE_TIMEOUT_MS);
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

        const previousMode = state.controls.encoderMode;
        const reduced = reduceControlMessage(
          state.controls,
          message,
          state.fleet,
          config.commandKeys,
        );
        state.controls = reduced.state;
        if (
          state.controls.encoderMode === "model" &&
          (message.t === "encoder" || (message.t === "key" && message.k === 12 && message.down))
        ) {
          armModelModeTimer();
        } else if (previousMode === "model" && state.controls.encoderMode === "thinking") {
          clearModelModeTimer();
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
          leaveModelMode();
          console.error("Deck disconnected");
        }),
    };

    yield* Effect.all(
      [
        watchFleet(
          HERDR_SOCKET,
          (fleet) => {
            state.fleet = fleet;
            state.controls = reconcileControls(state.controls, fleet);
            enqueueRender();
          },
          () => refreshWorkspaces,
        ),
        watchDeck(handlers),
      ],
      { concurrency: "unbounded", discard: true },
    );
  });

const command = Command.make(
  "herdr-micro",
  {
    config: Flag.file("config").pipe(
      Flag.withDescription("Path to the configuration file"),
      Flag.withDefault(`${homedir()}/.config/herdr-micro/config.json`),
    ),
  },
  ({ config }) =>
    Effect.gen(function* () {
      const loaded = yield* loadConfig(config);
      const herdr = yield* herdrVersion;
      yield* Effect.sync(() => console.error(`herdr-micro: ${herdr}`));
      yield* hostProgram(loaded);
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          console.error(error.message);
          process.exitCode = 1;
        }),
      ),
    ),
);

command.pipe(Command.run({ version }), Effect.provide(BunServices.layer), BunRuntime.runMain);
