import { createConnection, type Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";

import { Data, Effect, Schedule } from "effect";

import { AGENT_STATES, type Agent } from "./projection.ts";

const HERDR_TIMEOUT = "5 seconds";

const STRUCTURAL_SUBSCRIPTIONS = [
  "workspace.created",
  "workspace.closed",
  "workspace.focused",
  "workspace.moved",
  "workspace.reordered",
  "tab.created",
  "tab.closed",
  "tab.moved",
  "pane.created",
  "pane.closed",
  "pane.updated",
  "pane.moved",
  "pane.exited",
  "pane.agent_detected",
  "layout.updated",
].map((type) => ({ type }));

export class HerdrError extends Data.TaggedError("HerdrError")<{
  readonly message: string;
}> {}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function parseSnapshot(input: unknown): ReadonlyArray<Agent> {
  if (
    !isRecord(input) ||
    !isRecord(input.result) ||
    !isRecord(input.result.snapshot) ||
    !Array.isArray(input.result.snapshot.agents)
  ) {
    throw new HerdrError({ message: "Invalid session.snapshot response" });
  }

  return input.result.snapshot.agents.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.pane_id !== "string" ||
      typeof value.workspace_id !== "string" ||
      typeof value.tab_id !== "string" ||
      typeof value.agent_status !== "string"
    ) {
      throw new HerdrError({ message: "Invalid agent in session.snapshot response" });
    }
    const status = value.agent_status;
    const name =
      [value.display_agent, value.name, value.agent].find(
        (part): part is string => typeof part === "string",
      ) ?? value.pane_id;
    return {
      paneId: value.pane_id,
      workspaceId: value.workspace_id,
      tabId: value.tab_id,
      name,
      // A status Herdr adds later renders as "unknown" instead of turning
      // the retry loop into a permanent failure.
      state: AGENT_STATES.find((state) => state === status) ?? "unknown",
    };
  });
}

export function connect(path: string): Effect.Effect<Socket, HerdrError> {
  return Effect.callback<Socket, HerdrError>((resume) => {
    let socket: Socket;
    try {
      socket = createConnection(path);
    } catch (cause) {
      resume(
        Effect.fail(
          new HerdrError({
            message: `Cannot connect to Herdr at ${path}: ${String(cause)}`,
          }),
        ),
      );
      return;
    }

    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = () => {
      cleanup();
      // Persistent for the socket's lifetime: an 'error' emitted while no
      // readUntil is attached (e.g. mid-refreshOnce, between reads) must not
      // become an unhandled 'error' event → process crash. destroy() surfaces
      // it to readers via the 'close'/destroyed path instead.
      socket.on("error", () => socket.destroy());
      resume(Effect.succeed(socket));
    };
    const onError = (cause: Error) => {
      cleanup();
      resume(
        Effect.fail(
          new HerdrError({
            message: `Cannot connect to Herdr at ${path}: ${String(cause)}`,
          }),
        ),
      );
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);

    return Effect.sync(() => {
      cleanup();
      socket.destroy();
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: HERDR_TIMEOUT,
      orElse: () =>
        Effect.fail(
          new HerdrError({
            message: `Cannot connect to Herdr at ${path}: timed out after ${HERDR_TIMEOUT}`,
          }),
        ),
    }),
  );
}

// Exported for tests: this framing loop is the protocol codec.
export function readUntil(
  socket: Socket,
  accept: (message: unknown) => boolean,
): Effect.Effect<unknown, HerdrError> {
  return Effect.callback<unknown, HerdrError>((resume) => {
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("close", onEnd);
      socket.off("error", onError);
    };
    const succeed = (message: unknown) => {
      cleanup();
      resume(Effect.succeed(message));
    };
    const fail = (cause: unknown) => {
      cleanup();
      resume(
        Effect.fail(
          new HerdrError({
            message: `Herdr protocol error: ${String(cause)}`,
          }),
        ),
      );
    };
    const onEnd = () => fail(new Error("Herdr disconnected"));
    const onError = (error: Error) => fail(error);
    const onData = (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch (cause) {
          fail(cause);
          return;
        }
        const apiError = isRecord(message) ? message.error : undefined;
        if (isRecord(apiError)) {
          fail(new Error(String(apiError.message)));
          return;
        }
        if (accept(message)) {
          succeed(message);
          return;
        }
        newline = buffer.indexOf("\n");
      }
    };
    // 'error'/'close' may have fired before this reader attached (Herdr died
    // while refreshOnce was between reads); fail now instead of hanging.
    if (socket.destroyed || socket.readableEnded) {
      fail(new Error("Herdr disconnected"));
      return Effect.sync(cleanup);
    }

    socket.on("data", onData);
    socket.once("end", onEnd);
    socket.once("close", onEnd);
    socket.once("error", onError);

    return Effect.sync(cleanup);
  });
}

const withSocket = <A>(
  path: string,
  use: (socket: Socket) => Effect.Effect<A, HerdrError>,
): Effect.Effect<A, HerdrError> =>
  Effect.scoped(
    Effect.acquireRelease(connect(path), (socket) => Effect.sync(() => socket.destroy())).pipe(
      Effect.flatMap(use),
    ),
  );

const writeRequest = (socket: Socket, request: unknown) =>
  Effect.sync(() => {
    socket.write(`${JSON.stringify(request)}\n`);
  });

export function sendRequest(
  path: string,
  method: string,
  params: Readonly<Record<string, unknown>>,
): Effect.Effect<unknown, HerdrError> {
  const id = crypto.randomUUID();
  return withSocket(path, (socket) =>
    Effect.gen(function* () {
      yield* writeRequest(socket, { id, method, params });
      return yield* readUntil(socket, (message) => isRecord(message) && message.id === id).pipe(
        Effect.timeoutOrElse({
          duration: HERDR_TIMEOUT,
          orElse: () =>
            Effect.fail(
              new HerdrError({
                message: `Herdr protocol error: timed out after ${HERDR_TIMEOUT} waiting for ${method}`,
              }),
            ),
        }),
      );
    }),
  );
}

const requestParsed = <A>(
  path: string,
  method: string,
  parse: (response: unknown) => A,
  params: Readonly<Record<string, unknown>> = {},
): Effect.Effect<A, HerdrError> =>
  sendRequest(path, method, params).pipe(
    Effect.flatMap((response) =>
      Effect.try({
        try: () => parse(response),
        catch: (cause) =>
          cause instanceof HerdrError ? cause : new HerdrError({ message: String(cause) }),
      }),
    ),
  );

export interface Workspace {
  readonly id: string;
  readonly number: number;
  readonly label: string;
  readonly focused: boolean;
  readonly activeTabId: string | undefined;
}

export interface Tab {
  readonly id: string;
  readonly number: number;
  readonly label: string;
  readonly focused: boolean;
}

function parseWorkspaceList(input: unknown): ReadonlyArray<Workspace> {
  if (!isRecord(input) || !isRecord(input.result) || !Array.isArray(input.result.workspaces)) {
    throw new HerdrError({ message: "Invalid workspace.list response" });
  }
  return input.result.workspaces.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.workspace_id !== "string" ||
      typeof value.number !== "number"
    ) {
      throw new HerdrError({ message: "Invalid workspace in workspace.list response" });
    }
    return {
      id: value.workspace_id,
      number: value.number,
      label: typeof value.label === "string" ? value.label : value.workspace_id,
      focused: value.focused === true,
      activeTabId: typeof value.active_tab_id === "string" ? value.active_tab_id : undefined,
    };
  });
}

function parseTabList(input: unknown): ReadonlyArray<Tab> {
  if (!isRecord(input) || !isRecord(input.result) || !Array.isArray(input.result.tabs)) {
    throw new HerdrError({ message: "Invalid tab.list response" });
  }
  return input.result.tabs.map((value) => {
    if (!isRecord(value) || typeof value.tab_id !== "string" || typeof value.number !== "number") {
      throw new HerdrError({ message: "Invalid tab in tab.list response" });
    }
    return {
      id: value.tab_id,
      number: value.number,
      label: typeof value.label === "string" ? value.label : value.tab_id,
      focused: value.focused === true,
    };
  });
}

export const listWorkspaces = (path: string): Effect.Effect<ReadonlyArray<Workspace>, HerdrError> =>
  requestParsed(path, "workspace.list", parseWorkspaceList);

export const listTabs = (
  path: string,
  workspaceId: string,
): Effect.Effect<ReadonlyArray<Tab>, HerdrError> =>
  requestParsed(path, "tab.list", parseTabList, { workspace_id: workspaceId });

export const createAgent = (
  path: string,
  workspaceId: string,
  command: string,
): Effect.Effect<void, HerdrError> =>
  Effect.gen(function* () {
    const created = yield* sendRequest(path, "tab.create", {
      workspace_id: workspaceId,
      focus: true,
    });
    if (
      !isRecord(created) ||
      !isRecord(created.result) ||
      !isRecord(created.result.root_pane) ||
      typeof created.result.root_pane.pane_id !== "string"
    ) {
      return yield* Effect.fail(new HerdrError({ message: "Invalid tab.create response" }));
    }
    yield* sendRequest(path, "pane.send_input", {
      pane_id: created.result.root_pane.pane_id,
      text: command,
      keys: ["enter"],
    });
  });

const requestSnapshot = (path: string): Effect.Effect<ReadonlyArray<Agent>, HerdrError> =>
  requestParsed(path, "session.snapshot", parseSnapshot);

function refreshOnce(
  path: string,
  onFleet: (fleet: ReadonlyArray<Agent>) => void,
  onRefresh: () => Effect.Effect<void, HerdrError>,
): Effect.Effect<void, HerdrError> {
  return Effect.gen(function* () {
    // Full teardown + resubscribe per event so panes created since the last
    // subscription get their own agent_status subscriptions. O(4 round-trips
    // per event) — fine at v1 fleet sizes.
    const initial = yield* requestSnapshot(path);
    yield* withSocket(path, (subscription) =>
      Effect.gen(function* () {
        const subscriptions = [
          ...STRUCTURAL_SUBSCRIPTIONS,
          ...initial.map(({ paneId }) => ({
            type: "pane.agent_status_changed",
            pane_id: paneId,
          })),
        ];
        yield* writeRequest(subscription, {
          id: "events",
          method: "events.subscribe",
          params: { subscriptions },
        });
        const current = yield* requestSnapshot(path);
        yield* Effect.sync(() => onFleet(current));
        yield* onRefresh();
        // Panes created between the two snapshots have no agent_status
        // subscription yet; resubscribe immediately instead of waiting on a
        // socket that may never report them.
        const known = new Set(initial.map(({ paneId }) => paneId));
        if (current.length !== known.size || current.some(({ paneId }) => !known.has(paneId))) {
          return;
        }
        yield* readUntil(
          subscription,
          (message) => isRecord(message) && typeof message.event === "string",
        );
      }),
    );
  });
}

export const watchFleet = (
  path: string,
  onFleet: (fleet: ReadonlyArray<Agent>) => void,
  onRefresh: () => Effect.Effect<void, HerdrError> = () => Effect.void,
): Effect.Effect<never, HerdrError> => {
  let previous = "";
  const emitChange = (fleet: ReadonlyArray<Agent>) => {
    const current = JSON.stringify(fleet);
    if (current === previous) return;
    previous = current;
    onFleet(fleet);
  };
  // Retry inside forever so each successful cycle (= a subscription event
  // arrived) restarts the backoff at 250 ms instead of accumulating toward
  // the 5 s cap over the daemon's lifetime.
  return Effect.forever(
    refreshOnce(path, emitChange, onRefresh).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => console.error(`${error.message}; reconnecting`)),
      ),
      Effect.retry(
        Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("5 seconds")]),
      ),
    ),
  );
};
