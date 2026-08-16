import { describe, expect, test } from "bun:test";

import { DEVICE_MANIFEST } from "../src/device-manifest.ts";
import {
  classifyVolumes,
  findDeckSerialPorts,
  isCompatibleCircuitPython,
  parseBootOut,
  planLibrarySync,
  sha256Decision,
} from "../src/device-setup.ts";

describe("Deck provisioning decisions", () => {
  test("classifies exactly one Deck volume and rejects ambiguous sets", () => {
    expect(classifyVolumes([])).toEqual({ kind: "missing" });
    expect(classifyVolumes(["/Volumes/CIRCUITPY"])).toEqual({
      kind: "circuitpy",
      path: "/Volumes/CIRCUITPY",
    });
    expect(classifyVolumes(["/Volumes/RPI-RP2"])).toEqual({
      kind: "bootloader",
      path: "/Volumes/RPI-RP2",
    });
    expect(classifyVolumes(["/Volumes/CIRCUITPY", "/Volumes/RPI-RP2"])).toEqual({
      kind: "ambiguous",
      paths: ["/Volumes/CIRCUITPY", "/Volumes/RPI-RP2"],
    });
    expect(classifyVolumes(["/Volumes/CIRCUITPY", "/Volumes/CIRCUITPY 1"])).toEqual({
      kind: "ambiguous",
      paths: ["/Volumes/CIRCUITPY", "/Volumes/CIRCUITPY 1"],
    });
  });

  test("parses regenerated boot_out lines despite appended boot.py output", () => {
    const parsed =
      parseBootOut(`Adafruit CircuitPython 10.2.1 on 2026-07-30; Adafruit MacroPad RP2040 with rp2040\r
Board ID:adafruit_macropad_rp2040\r
UID:C3A...\r
boot.py output follows\r
`);
    expect(parsed).toEqual({
      version: "10.2.1",
      boardId: "adafruit_macropad_rp2040",
    });
    expect(isCompatibleCircuitPython(parsed.version)).toBe(true);
    expect(isCompatibleCircuitPython("9.2.8")).toBe(false);
    expect(isCompatibleCircuitPython(undefined)).toBe(false);
    expect(parseBootOut("boot.py crashed\n")).toEqual({
      version: undefined,
      boardId: undefined,
    });
  });

  test("plans only missing or byte-different library trees", () => {
    const libraries = ["adafruit_macropad.mpy", "adafruit_hid"] as const;
    const sources = {
      "adafruit_macropad.mpy": { ".": "same" },
      adafruit_hid: { "keyboard.mpy": "one", "keycode.mpy": "two" },
    };
    expect(
      planLibrarySync(libraries, sources, {
        "adafruit_macropad.mpy": { ".": "same" },
        adafruit_hid: { "keyboard.mpy": "one", "keycode.mpy": "changed" },
      }),
    ).toEqual(["adafruit_hid"]);
    expect(
      planLibrarySync(libraries, sources, {
        "adafruit_macropad.mpy": { ".": "same" },
      }),
    ).toEqual(["adafruit_hid"]);
    expect(
      planLibrarySync(libraries, sources, {
        "adafruit_macropad.mpy": { ".": "same" },
        adafruit_hid: {
          "keyboard.mpy": "one",
          "keycode.mpy": "two",
          "stale.mpy": "extra",
        },
      }),
    ).toEqual(["adafruit_hid"]);
  });

  test("requires both CDC endpoints from one Deck", () => {
    expect(findDeckSerialPorts(["/dev/cu.usbmodem1201", "/dev/cu.usbmodem1203"])).toEqual([
      "/dev/cu.usbmodem1201",
      "/dev/cu.usbmodem1203",
    ]);
    expect(findDeckSerialPorts(["/dev/cu.usbmodem1201", "/dev/cu.usbmodem3401"])).toBeUndefined();
    expect(
      findDeckSerialPorts(["/dev/cu.usbmodem9901", "/dev/cu.usbmodem1201", "/dev/cu.usbmodem1203"]),
    ).toEqual(["/dev/cu.usbmodem1201", "/dev/cu.usbmodem1203"]);
  });

  test("pins code.py last and verifies cached hashes exactly", () => {
    expect(DEVICE_MANIFEST.deviceFiles).toEqual([
      "version.py",
      "boot.py",
      "protocol.py",
      "code.py",
    ]);
    expect(sha256Decision("abc", "abc")).toBe("use-cache");
    expect(sha256Decision("ABC", "abc")).toBe("redownload");
    expect(sha256Decision(undefined, "abc")).toBe("redownload");
  });
});
