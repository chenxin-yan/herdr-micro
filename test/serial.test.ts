import { describe, expect, test } from "bun:test";

import { DeviceLineReader } from "../src/serial.ts";

const bytes = (text: string) => Buffer.from(text);

describe("DeviceLineReader", () => {
  test("assembles partial JSONL frames and validates Deck messages", () => {
    const reader = new DeviceLineReader();
    expect(reader.feed(bytes('{"t":"key","k":2'))).toEqual([]);
    expect(
      reader.feed(bytes(',"down":true}\n{"t":"encoder","delta":-2}\n{"t":"hello","fw":"0.0.1"}\n')),
    ).toEqual([
      { t: "key", k: 2, down: true },
      { t: "encoder", delta: -2 },
      { t: "hello", fw: "0.0.1" },
    ]);
  });

  test("drops malformed messages", () => {
    const reader = new DeviceLineReader();
    expect(
      reader.feed(
        bytes('not json\n{"t":"key","k":13,"down":true}\n{"t":"key","k":2,"down":"yes"}\n'),
      ),
    ).toEqual([]);
  });

  test("bounds oversized frames and resynchronizes at the next newline", () => {
    const reader = new DeviceLineReader();
    expect(reader.feed(bytes(`{"x":"${"x".repeat(1100)}\n`))).toEqual([]);
    expect(reader.feed(bytes('{"t":"hello","fw":"0.0.1"}\n'))).toEqual([
      { t: "hello", fw: "0.0.1" },
    ]);
  });
});
