# 04 — End-to-end: mirroring + all controls

**What to build:** The tracer bullet. The Host discovers the Deck (VID/PID filter + hello-probe), exchanges hellos, and streams Render Snapshots so LEDs and OLED mirror the real Fleet live. Every v1 control works from the Deck: Agent Slot press selects and focuses the agent; Enter and Send Ctrl-C target the Selected Agent (ignored when none; selection cleared on page change); the Page Key cycles pages and shows off-page priority; `newAgent` opens a tab and runs `defaultAgentCommand` so Herdr detection adds it to the Fleet; a Key Alias press makes the Deck tap the configured key (right-Command dictation demo); the encoder rotates Workspaces and its press focuses one.

**Blocked by:** 02 — Host core: config + fleet projection; 03 — Device Bundle firmware.

**Status:** ready-for-agent

- [ ] Deck LEDs/OLED mirror real agents: state changes in Herdr appear on the Deck without restarting anything
- [ ] All six configured Command Key actions and the encoder behave per the spec, driven by real key presses
- [ ] Selected Agent rules hold: last slot pressed wins, page change clears, actions without selection are no-ops
- [ ] Reconnect matrix passes: Deck unplug/replug, Host restart, and Herdr restart each recover to a correct fresh render with no replayed inputs
- [ ] App-version mismatch (stale Device Bundle) fails closed: Deck shows the redeploy screen, Host logs the mismatch

## Comments

- From ticket 02 review: the subscription socket has a window where no `'error'` listener is attached — a rare race crashes the process instead of triggering reconnect. Fix alongside the reconnect-matrix work here. Also missing: unit tests for `connect`/`readUntil` in `src/herdr.ts`.
- 2026-08-14: User approved changing encoder press from re-focusing the current Workspace to jumping to the next attention agent: `blocked` agents first, then `done`, preserving Herdr order within each state. The jump selects and focuses the agent, flips to its Agent Page, wraps, and is a no-op when none need attention. Encoder rotation retains eager Workspace focus.
