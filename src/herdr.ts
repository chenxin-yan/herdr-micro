import { createConnection, type Socket } from "node:net";
import { StringDecoder } from "node:string_decoder";

import { Data, Effect, Result, Schedule, Schema, SchemaIssue } from "effect";

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
  "tab.focused",
  "tab.moved",
  "pane.created",
  "pane.closed",
  "pane.focused",
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

const formatIssue = SchemaIssue.makeFormatterDefault();

const decode =
  <S extends Schema.ConstraintDecoder<unknown>>(schema: S, label: string) =>
  (input: unknown): S["Type"] => {
    const result = Schema.decodeUnknownResult(schema)(input);
    if (Result.isFailure(result)) {
      throw new HerdrError({
        message: `Invalid ${label} response: ${formatIssue(result.failure.issue)}`,
      });
    }
    return result.success;
  };

const OptionalString = Schema.optional(Schema.NullOr(Schema.String));

export interface FleetSnapshot {
  readonly fleet: ReadonlyArray<Agent>;
  readonly focusedPaneId: string | undefined;
}

const SnapshotResponse = Schema.Struct({
  result: Schema.Struct({
    snapshot: Schema.Struct({
      focused_pane_id: OptionalString,
      agents: Schema.Array(
        Schema.Struct({
          pane_id: Schema.String,
          workspace_id: Schema.String,
          tab_id: Schema.String,
          agent_status: Schema.String,
          display_agent: OptionalString,
          name: OptionalString,
          agent: OptionalString,
        }),
      ),
    }),
  }),
});

export function parseSnapshot(input: unknown): FleetSnapshot {
  const { snapshot } = decode(SnapshotResponse, "session.snapshot")(input).result;
  const fleet = snapshot.agents.map((value) => ({
    paneId: value.pane_id,
    workspaceId: value.workspace_id,
    tabId: value.tab_id,
    name: value.display_agent ?? value.name ?? value.agent ?? value.pane_id,
    // A status Herdr adds later renders as "unknown" instead of turning
    // the retry loop into a permanent failure.
    state: AGENT_STATES.find((state) => state === value.agent_status) ?? "unknown",
  }));
  return { fleet, focusedPaneId: snapshot.focused_pane_id ?? undefined };
}

export function connect(path: string): Effect.Effect<Socket, HerdrError> {
  return Effect.callback<Socket, HerdrError>((resume) => {
    const socket = createConnection(path);
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

const WorkspaceListResponse = Schema.Struct({
  result: Schema.Struct({
    workspaces: Schema.Array(
      Schema.Struct({
        workspace_id: Schema.String,
        number: Schema.Number,
        label: OptionalString,
        focused: Schema.optional(Schema.NullOr(Schema.Boolean)),
        active_tab_id: OptionalString,
      }),
    ),
  }),
});

const parseWorkspaceList = (input: unknown): ReadonlyArray<Workspace> =>
  decode(
    WorkspaceListResponse,
    "workspace.list",
  )(input).result.workspaces.map((value) => ({
    id: value.workspace_id,
    number: value.number,
    label: value.label ?? value.workspace_id,
    focused: value.focused ?? false,
    activeTabId: value.active_tab_id ?? undefined,
  }));

const TabListResponse = Schema.Struct({
  result: Schema.Struct({
    tabs: Schema.Array(
      Schema.Struct({
        tab_id: Schema.String,
        number: Schema.Number,
        label: OptionalString,
        focused: Schema.optional(Schema.NullOr(Schema.Boolean)),
      }),
    ),
  }),
});

const parseTabList = (input: unknown): ReadonlyArray<Tab> =>
  decode(
    TabListResponse,
    "tab.list",
  )(input).result.tabs.map((value) => ({
    id: value.tab_id,
    number: value.number,
    label: value.label ?? value.tab_id,
    focused: value.focused ?? false,
  }));

export const listWorkspaces = (path: string): Effect.Effect<ReadonlyArray<Workspace>, HerdrError> =>
  requestParsed(path, "workspace.list", parseWorkspaceList);

export const listTabs = (
  path: string,
  workspaceId: string,
): Effect.Effect<ReadonlyArray<Tab>, HerdrError> =>
  requestParsed(path, "tab.list", parseTabList, { workspace_id: workspaceId });

const AgentReadResponse = Schema.Struct({
  result: Schema.Struct({
    type: Schema.Literal("pane_read"),
    read: Schema.Struct({ text: Schema.String }),
  }),
});

export const readAgentVisible = (path: string, paneId: string): Effect.Effect<string, HerdrError> =>
  requestParsed(
    path,
    "agent.read",
    (response) => decode(AgentReadResponse, "agent.read")(response).result.read.text,
    { target: paneId, source: "visible", strip_ansi: true },
  );

const TabCreateResponse = Schema.Struct({
  result: Schema.Struct({ root_pane: Schema.Struct({ pane_id: Schema.String }) }),
});

export const createAgent = (
  path: string,
  workspaceId: string,
  command: string,
): Effect.Effect<void, HerdrError> =>
  Effect.gen(function* () {
    const created = yield* requestParsed(
      path,
      "tab.create",
      decode(TabCreateResponse, "tab.create"),
      { workspace_id: workspaceId, focus: true },
    );
    yield* sendRequest(path, "pane.send_input", {
      pane_id: created.result.root_pane.pane_id,
      text: command,
      keys: ["enter"],
    });
  });

const requestSnapshot = (path: string): Effect.Effect<FleetSnapshot, HerdrError> =>
  requestParsed(path, "session.snapshot", parseSnapshot);

function refreshOnce(
  path: string,
  onSnapshot: (snapshot: FleetSnapshot) => void,
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
          ...initial.fleet.map(({ paneId }) => ({
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
        yield* Effect.sync(() => onSnapshot(current));
        yield* onRefresh();
        // Panes created between the two snapshots have no agent_status
        // subscription yet; resubscribe immediately instead of waiting on a
        // socket that may never report them.
        const known = new Set(initial.fleet.map(({ paneId }) => paneId));
        if (
          current.fleet.length !== known.size ||
          current.fleet.some(({ paneId }) => !known.has(paneId))
        ) {
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

// Retry inside forever so each successful cycle restarts the backoff at
// 250 ms instead of accumulating toward the 5 s cap over the daemon's lifetime.
const logReconnect = (error: { readonly message: string }) =>
  console.error(`${error.message}; reconnecting`);

export const retryForever = <A, E extends { readonly message: string }, R>(
  effect: Effect.Effect<A, E, R>,
  onError: (error: E) => void = logReconnect,
): Effect.Effect<never, E, R> =>
  Effect.forever(
    effect.pipe(
      Effect.tapError((error) => Effect.sync(() => onError(error))),
      Effect.retry(
        Schedule.min([Schedule.exponential("250 millis"), Schedule.spaced("5 seconds")]),
      ),
    ),
  );

export const watchFleet = (
  path: string,
  onSnapshot: (snapshot: FleetSnapshot) => void,
  onRefresh: () => Effect.Effect<void, HerdrError> = () => Effect.void,
  onError: (error: HerdrError) => void = logReconnect,
): Effect.Effect<never, HerdrError> => {
  let previous = "";
  const emitChange = (snapshot: FleetSnapshot) => {
    const current = JSON.stringify(snapshot);
    if (current === previous) return;
    previous = current;
    onSnapshot(snapshot);
  };
  return retryForever(refreshOnce(path, emitChange, onRefresh), (error) => {
    // Recovery can deliver a snapshot identical to the last pre-error one;
    // reset the dedupe so consumers always observe the reconnect.
    previous = "";
    onError(error);
  });
};
