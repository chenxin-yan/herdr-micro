# 01 — Spikes: Deck USB (CDC data + HID) and Bun serialport

**What to build:** Prove the two load-bearing assumptions on real hardware before anything is built on them. The Deck presents both a second CDC data serial port and a HID keyboard simultaneously; a pinned Bun process on this Mac talks JSON Lines to that data port reliably across unplug/replug. Hardware-in-the-loop: the user must be present for flashing and replug steps.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `boot.py` enabling console + data CDC and HID keyboard is installed on the Deck; after reset, two `/dev/cu.usbmodem*` ports enumerate on macOS
- [x] A HID key tap (right Command) sent from device code is observed by macOS (e.g. triggers dictation or is visible in a key viewer) — verified by having the Deck type "a" into a focused text field (RIGHT_GUI alone has no visible effect)
- [x] Bun (pinned version, `serialport` via `trustedDependencies`) lists, opens, writes, and reads JSON Lines on the data port; the hello-probe distinguishes data port from console — **protocol adjustment**: `serialport` crashes Bun 1.3.10 on open (bun#18546); replaced with `stty` + `node:fs` (see spec § Spike outcomes)
- [x] Unplug/replug produces clean `close`/`error` events and a successful re-open; no zombie handles (`ENXIO` → rescan → re-probe, ~4 s)
- [x] Render-frame cost measured: max-size render (12 RGB + 4 text lines) parse + LED/OLED update time recorded (~211 ms device, ~240 ms round-trip), input scan stays responsive
- [x] Outcome recorded in the spec's tunables section (or a fallback decision documented: Node runtime / protocol adjustment)
