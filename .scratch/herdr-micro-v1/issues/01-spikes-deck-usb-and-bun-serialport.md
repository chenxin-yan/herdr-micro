# 01 — Spikes: Deck USB (CDC data + HID) and Bun serialport

**What to build:** Prove the two load-bearing assumptions on real hardware before anything is built on them. The Deck presents both a second CDC data serial port and a HID keyboard simultaneously; a pinned Bun process on this Mac talks JSON Lines to that data port reliably across unplug/replug. Hardware-in-the-loop: the user must be present for flashing and replug steps.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `boot.py` enabling console + data CDC and HID keyboard is installed on the Deck; after reset, two `/dev/cu.usbmodem*` ports enumerate on macOS
- [ ] A HID key tap (right Command) sent from device code is observed by macOS (e.g. triggers dictation or is visible in a key viewer)
- [ ] Bun (pinned version, `serialport` via `trustedDependencies`) lists, opens, writes, and reads JSON Lines on the data port; the hello-probe distinguishes data port from console
- [ ] Unplug/replug produces clean `close`/`error` events and a successful re-open; no zombie handles
- [ ] Render-frame cost measured: max-size render (12 RGB + 4 text lines) parse + LED/OLED update time recorded, input scan stays responsive
- [ ] Outcome recorded in the spec's tunables section (or a fallback decision documented: Node runtime / protocol adjustment)
