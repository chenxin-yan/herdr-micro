import { closeSync, constants, openSync, readdirSync, readSync, writeSync } from "node:fs";

import { Cause, Data, Effect, Queue, Stream } from "effect";

import { isRecord, retryForever } from "./herdr.ts";

const MAX_FRAME = 1024;
const POLL_MS = 20;

export type DeckMessage =
  | { readonly t: "hello"; readonly fw: string }
  | { readonly t: "key"; readonly k: number; readonly down: boolean }
  | { readonly t: "encoder"; readonly delta: number };

export type LedEffect = "breathe" | "blink";
export type DeviceLed =
  | readonly [red: number, green: number, blue: number]
  | readonly [red: number, green: number, blue: number, effect: LedEffect];

export type HeaderState = "w" | "i" | "b" | "d" | "u";

export type HostMessage =
  | { readonly t: "hello"; readonly host: string }
  | {
      readonly t: "render";
      readonly led: ReadonlyArray<DeviceLed>;
      readonly text: readonly string[];
      readonly hdr: {
        readonly boxes: ReadonlyArray<HeaderState>;
        readonly sel: number | null;
        readonly page: number;
        readonly pages: number;
      };
      readonly calm?: true;
      readonly sleep?: true;
    }
  | { readonly t: "hid"; readonly key: string; readonly down: boolean };

export class SerialError extends Data.TaggedError("SerialError")<{
  readonly message: string;
}> {}

const decodeMessage = (line: readonly number[]): DeckMessage | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(line).toString("utf8"));
  } catch {
    return;
  }
  if (!isRecord(value)) return;
  if (value.t === "hello" && typeof value.fw === "string") {
    return { t: "hello", fw: value.fw };
  }
  if (
    value.t === "key" &&
    Number.isInteger(value.k) &&
    (value.k as number) >= 0 &&
    (value.k as number) <= 12 &&
    typeof value.down === "boolean"
  ) {
    return { t: "key", k: value.k as number, down: value.down };
  }
  if (value.t === "encoder" && Number.isInteger(value.delta)) {
    return { t: "encoder", delta: value.delta as number };
  }
};

export class DeviceLineReader {
  readonly #buffer: number[] = [];
  #discarding = false;

  feed(data: Uint8Array): DeckMessage[] {
    const messages: DeckMessage[] = [];
    for (const byte of data) {
      if (byte === 10) {
        if (!this.#discarding && this.#buffer.length > 0) {
          const message = decodeMessage(this.#buffer);
          if (message) messages.push(message);
        }
        this.#buffer.length = 0;
        this.#discarding = false;
      } else if (this.#discarding) {
        continue;
      } else if (this.#buffer.length >= MAX_FRAME) {
        this.#buffer.length = 0;
        this.#discarding = true;
      } else {
        this.#buffer.push(byte);
      }
    }
    return messages;
  }
}

const serialFailure = (operation: string, cause: unknown) =>
  new SerialError({ message: `${operation}: ${String(cause)}` });

const tryRead = (fd: number, buffer: Buffer): number => {
  try {
    return readSync(fd, buffer);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "EAGAIN") return 0;
    throw serialFailure("Deck read failed", cause);
  }
};

const writeAll = async (fd: number, data: Uint8Array): Promise<void> => {
  let remaining = Buffer.from(data);
  while (remaining.length > 0) {
    try {
      const written = writeSync(fd, remaining);
      remaining = remaining.subarray(written);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EAGAIN") {
        throw serialFailure("Deck write failed", cause);
      }
    }
    if (remaining.length > 0) await Bun.sleep(POLL_MS);
  }
};

const writeJson = (fd: number, message: HostMessage | { readonly t: "hello" }) =>
  writeAll(fd, Buffer.from(`${JSON.stringify(message)}\n`));

interface OpenDeck {
  readonly fd: number;
  readonly path: string;
  readonly fw: string;
}

const openPort = (path: string): number => {
  const stty = Bun.spawnSync(["/bin/stty", "-f", path, "raw", "-echo"]);
  if (stty.exitCode !== 0) {
    throw serialFailure(`Cannot configure ${path}`, stty.stderr.toString().trim());
  }
  try {
    return openSync(path, constants.O_RDWR | constants.O_NOCTTY | constants.O_NONBLOCK);
  } catch (cause) {
    throw serialFailure(`Cannot open ${path}`, cause);
  }
};

const waitForHello = async (
  fd: number,
  milliseconds: number,
  signal: AbortSignal,
): Promise<string | undefined> => {
  const reader = new DeviceLineReader();
  const buffer = Buffer.alloc(4096);
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    const size = tryRead(fd, buffer);
    if (size > 0) {
      const hello = reader
        .feed(buffer.subarray(0, size))
        .find((message): message is Extract<DeckMessage, { t: "hello" }> => message.t === "hello");
      if (hello) return hello.fw;
    }
    await Bun.sleep(POLL_MS);
  }
};

const probe = async (path: string, signal: AbortSignal): Promise<OpenDeck | undefined> => {
  let fd: number;
  try {
    signal.throwIfAborted();
    fd = openPort(path);
  } catch {
    signal.throwIfAborted();
    return;
  }
  try {
    const unsolicited = await waitForHello(fd, 2000, signal);
    if (unsolicited !== undefined) return { fd, path, fw: unsolicited };
    await writeJson(fd, { t: "hello" });
    const reply = await waitForHello(fd, 1500, signal);
    if (reply !== undefined) return { fd, path, fw: reply };
  } catch {
    // A candidate disappearing mid-probe is expected during USB discovery.
  }
  try {
    closeSync(fd);
  } catch {
    // USB unplug may invalidate the candidate descriptor mid-probe.
  }
  signal.throwIfAborted();
};

const discover = Effect.tryPromise({
  try: async (signal) => {
    const candidates = readdirSync("/dev")
      .filter((name) => name.startsWith("cu.usbmodem"))
      .map((name) => `/dev/${name}`);
    for (const path of candidates) {
      signal.throwIfAborted();
      const deck = await probe(path, signal);
      if (deck) return deck;
    }
    throw new Error("Deck data port not found");
  },
  catch: (cause) => serialFailure("Cannot discover Deck", cause),
});

export interface DeckWriter {
  readonly path: string;
  readonly fw: string;
  readonly write: (message: HostMessage) => Effect.Effect<void, SerialError>;
}

const makeSerialPort = ({ fd, path, fw }: OpenDeck) => {
  let writes = Promise.resolve();
  const write = (message: HostMessage) =>
    Effect.tryPromise({
      try: () => {
        const next = writes.then(() => writeJson(fd, message));
        writes = next.catch(() => {});
        return next;
      },
      catch: (cause) =>
        cause instanceof SerialError ? cause : serialFailure("Deck write failed", cause),
    });
  const messages = Stream.callback<DeckMessage, SerialError>((queue) =>
    Effect.gen(function* () {
      const reader = new DeviceLineReader();
      const buffer = Buffer.alloc(4096);
      const timer = setInterval(() => {
        try {
          const size = tryRead(fd, buffer);
          if (size > 0) {
            for (const message of reader.feed(buffer.subarray(0, size))) {
              Queue.offerUnsafe(queue, message);
            }
          }
        } catch (cause) {
          Queue.failCauseUnsafe(queue, Cause.fail(cause as SerialError));
        }
      }, POLL_MS);
      yield* Effect.addFinalizer(() => Effect.sync(() => clearInterval(timer)));
    }),
  );
  return { path, fw, write, messages };
};

const acquireSerialPort = Effect.acquireRelease(discover, ({ fd }) =>
  Effect.sync(() => {
    try {
      closeSync(fd);
    } catch {
      // USB unplug may invalidate the descriptor before scoped release.
    }
  }),
).pipe(Effect.map(makeSerialPort));

interface DeckHandlers {
  readonly connected: (deck: DeckWriter) => Effect.Effect<void, never>;
  readonly message: (deck: DeckWriter, message: DeckMessage) => Effect.Effect<void, never>;
  readonly disconnected: (deck: DeckWriter) => Effect.Effect<void, never>;
}

const deckSession = (handlers: DeckHandlers) =>
  Effect.scoped(
    Effect.gen(function* () {
      const serial = yield* acquireSerialPort;
      yield* handlers.connected(serial);
      yield* Stream.runForEach(serial.messages, (message) =>
        handlers.message(serial, message),
      ).pipe(
        Effect.catchTag("SerialError", (error) =>
          Effect.sync(() => console.error(`${error.message}; rescanning`)),
        ),
        Effect.ensuring(handlers.disconnected(serial)),
      );
    }),
  );

export const watchDeck = (handlers: DeckHandlers): Effect.Effect<never, SerialError> =>
  retryForever(deckSession(handlers));
