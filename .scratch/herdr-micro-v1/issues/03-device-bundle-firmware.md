# 03 — Device Bundle firmware

**What to build:** The complete CircuitPython Device Bundle speaking the Device Protocol (ADR-0003): raw `hello`/`key`/`encoder` messages up; `render` and `hid` commands down; nothing else. Pure peripheral per ADR-0001 — no fleet logic, no durable state. Demoable by hand from a serial terminal: type a render line, see LEDs and OLED update; press keys, see events emitted.

**Blocked by:** 01 — Spikes: Deck USB (CDC data + HID) and Bun serialport.

**Status:** resolved

- [x] On boot and on DTR rising edge the Deck emits `hello` with firmware version; a Host `hello` gets a `hello` reply (versioning dropped — Host and Device Bundle assumed in sync, ADR-0003)
- [x] Key press/release (keys 0–11, encoder switch as 12) and encoder detent deltas are emitted as protocol messages; dropped cleanly on write timeout, never blocking the input scan
- [x] A `render` message replaces the complete LED + OLED presentation (last-write-wins); a `hid` message taps exactly the named key
- [x] Bounded line buffer with discard-to-newline recovery: malformed or oversized input never crashes or wedges the loop
- [x] No-Host state shows a waiting-for-host screen (version-mismatch screen dropped with versioning)
- [x] Manual serial-terminal session demonstrates all of the above end to end
