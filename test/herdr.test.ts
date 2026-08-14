import { expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { createServer, Socket } from "node:net";

import { Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  connect,
  listWorkspaces,
  parseSnapshot,
  readUntil,
  sendRequest,
  watchFleet,
} from "../src/herdr.ts";

test("maps a session snapshot into the Fleet in Herdr order", () => {
  const fleet = parseSnapshot({
    result: {
      snapshot: {
        agents: [
          {
            pane_id: "p2",
            workspace_id: "w",
            tab_id: "t2",
            display_agent: "Claude",
            agent_status: "blocked",
          },
          { pane_id: "p1", workspace_id: "w", tab_id: "t1", agent: "pi", agent_status: "working" },
        ],
      },
    },
  });

  expect(fleet.map(({ paneId, name, state }) => ({ paneId, name, state }))).toEqual([
    { paneId: "p2", name: "Claude", state: "blocked" },
    { paneId: "p1", name: "pi", state: "working" },
  ]);
});

test("maps an unrecognized agent_status to unknown and falls back to pane_id for the name", () => {
  const fleet = parseSnapshot({
    result: {
      snapshot: {
        agents: [{ pane_id: "p1", workspace_id: "w", tab_id: "t", agent_status: "compacting" }],
      },
    },
  });

  expect(fleet).toEqual([
    { paneId: "p1", workspaceId: "w", tabId: "t", name: "p1", state: "unknown" },
  ]);
});

test("rejects malformed snapshots", () => {
  expect(() => parseSnapshot({ result: {} })).toThrow("Invalid session.snapshot response");
  expect(() =>
    parseSnapshot({ result: { snapshot: { agents: [{ workspace_id: "w" }] } } }),
  ).toThrow("Invalid agent in session.snapshot response");
});

// Drives readUntil with synthetic socket events: run the effect, let the
// fiber attach its listeners, then emit.
const readWith = async (
  socket: Socket,
  accept: (message: unknown) => boolean,
  drive: (socket: Socket) => void,
) => {
  const exit = Effect.runPromiseExit(readUntil(socket, accept));
  await new Promise((resolve) => setTimeout(resolve, 1));
  drive(socket);
  return exit;
};

const isEvent = (message: unknown) =>
  typeof message === "object" && message !== null && "event" in message;

test("readUntil assembles frames across chunks and skips non-accepted lines", async () => {
  const exit = await readWith(new Socket(), isEvent, (socket) => {
    socket.emit("data", Buffer.from('{"id":"ack"}\n{"eve'));
    socket.emit("data", Buffer.from('nt":"pane.exited"}\n'));
  });
  expect(exit).toEqual(Exit.succeed({ event: "pane.exited" }));
});

test("readUntil preserves UTF-8 characters split across chunks", async () => {
  const frame = Buffer.from('{"event":"pane.updated","name":"Claude 🧵"}\n');
  const split = frame.indexOf(Buffer.from("🧵")) + 1;
  const exit = await readWith(new Socket(), isEvent, (socket) => {
    socket.emit("data", frame.subarray(0, split));
    socket.emit("data", frame.subarray(split));
  });
  expect(exit).toEqual(Exit.succeed({ event: "pane.updated", name: "Claude 🧵" }));
});

test("readUntil fails on a protocol error frame", async () => {
  const exit = await readWith(new Socket(), isEvent, (socket) => {
    socket.emit("data", Buffer.from('{"error":{"message":"boom"}}\n'));
  });
  expect(Exit.isFailure(exit)).toBe(true);
});

test("readUntil fails immediately on an already-destroyed socket instead of hanging", async () => {
  const socket = new Socket();
  socket.destroy();
  const exit = await Effect.runPromiseExit(readUntil(socket, isEvent));
  expect(Exit.isFailure(exit)).toBe(true);
});

test("readUntil fails when the socket closes mid-read", async () => {
  const exit = await readWith(new Socket(), isEvent, (socket) => {
    socket.emit("close", false);
  });
  expect(Exit.isFailure(exit)).toBe(true);
});

test("connect installs a lifetime error listener after connecting", async () => {
  const path = `/tmp/herdr-micro-connect-${process.pid}-${Date.now()}.sock`;
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  const socket = await Effect.runPromise(connect(path));
  try {
    expect(socket.listenerCount("error")).toBeGreaterThan(0);
    socket.emit("error", new Error("between reads"));
    expect(socket.destroyed).toBe(true);
  } finally {
    socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(path, { force: true });
  }
});

test("sendRequest and listWorkspaces use one-shot Socket API requests", async () => {
  const path = `/tmp/herdr-micro-request-${process.pid}-${Date.now()}.sock`;
  const methods: string[] = [];
  const server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline));
      methods.push(request.method);
      socket.write(
        `${JSON.stringify(
          request.method === "workspace.list"
            ? {
                id: request.id,
                result: {
                  workspaces: [{ workspace_id: "w1", number: 1, label: "project", focused: true }],
                },
              }
            : { id: request.id, result: { type: "ok" } },
        )}\n`,
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  try {
    await Effect.runPromise(sendRequest(path, "agent.focus", { target: "p1" }));
    expect(await Effect.runPromise(listWorkspaces(path))).toEqual([
      { id: "w1", number: 1, label: "project", focused: true },
    ]);
    expect(methods).toEqual(["agent.focus", "workspace.list"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(path, { force: true });
  }
});

test("watchFleet retries when Herdr stops answering snapshots", async () => {
  const path = `/tmp/herdr-micro-timeout-${process.pid}-${Date.now()}.sock`;
  const sockets = new Set<Socket>();
  let connections = 0;
  let resolveFirst!: () => void;
  let resolveSecond!: () => void;
  const firstConnection = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  const secondConnection = new Promise<void>((resolve) => {
    resolveSecond = resolve;
  });
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    connections += 1;
    if (connections === 1) resolveFirst();
    if (connections === 2) resolveSecond();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });

  const program = Effect.gen(function* () {
    yield* watchFleet(path, () => {}).pipe(Effect.forkChild);
    yield* Effect.promise(() => firstConnection);
    yield* TestClock.adjust("5 seconds");
    yield* Effect.yieldNow;
    yield* TestClock.adjust("250 millis");
    yield* TestClock.withLive(
      Effect.promise(() => secondConnection).pipe(Effect.timeout("500 millis")),
    );
  }).pipe(Effect.provide(TestClock.layer()));

  try {
    await Effect.runPromise(program);
  } finally {
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(path, { force: true });
  }
});

test("watchFleet reconnects and reads a fresh snapshot", async () => {
  const path = `/tmp/herdr-micro-${process.pid}-${Date.now()}.sock`;
  const sockets = new Set<Socket>();
  const subscriptions = new Set<Socket>();
  let snapshotRequests = 0;
  let status = "working";
  let subscribed = false;
  let refreshes = 0;
  const subscriptionTypes = new Set<string>();
  const pendingSnapshots: Socket[] = [];
  const respondWithSnapshot = (socket: Socket) =>
    socket.write(
      `${JSON.stringify({
        id: "snapshot",
        result: {
          snapshot: {
            agents: [
              {
                pane_id: "p1",
                workspace_id: "w",
                tab_id: "t",
                display_agent: "pi",
                agent_status: status,
              },
            ],
          },
        },
      })}\n`,
    );
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
      subscriptions.delete(socket);
      subscribed = subscriptions.size > 0;
    });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const request = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (request.method === "session.snapshot") {
          snapshotRequests += 1;
          if (snapshotRequests % 2 === 1 || subscribed) respondWithSnapshot(socket);
          else pendingSnapshots.push(socket);
        } else if (request.method === "events.subscribe") {
          for (const subscription of request.params.subscriptions) {
            subscriptionTypes.add(subscription.type);
          }
          subscriptions.add(socket);
          subscribed = true;
          socket.write('{"id":"events","result":{}}\n');
          pendingSnapshots.splice(0).forEach(respondWithSnapshot);
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });

  const fleets: Array<ReadonlyArray<{ readonly state: string }>> = [];
  let resolveSecond!: () => void;
  const secondFleet = new Promise<void>((resolve) => {
    resolveSecond = resolve;
  });
  const fiber = Effect.runFork(
    watchFleet(
      path,
      (fleet) => {
        fleets.push(fleet);
        if (fleets.length === 1) {
          status = "done";
          subscriptions.forEach((socket) => socket.destroy());
        } else {
          resolveSecond();
        }
      },
      () =>
        Effect.sync(() => {
          refreshes += 1;
        }),
    ),
  );
  const timer = setTimeout(() => resolveSecond(), 3_000);

  try {
    await secondFleet;
    expect(fleets.map(([agent]) => agent?.state)).toEqual(["working", "done"]);
    expect(subscriptionTypes).toContain("workspace.focused");
    expect(refreshes).toBeGreaterThanOrEqual(2);
  } finally {
    clearTimeout(timer);
    await Effect.runPromise(Fiber.interrupt(fiber));
    sockets.forEach((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(path, { force: true });
  }
});
