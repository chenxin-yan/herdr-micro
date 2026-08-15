# 04 — End-to-end: mirroring + all controls

**What to build:** The tracer bullet. The Host discovers the Deck (VID/PID filter + hello-probe), exchanges hellos, and streams Render Snapshots so LEDs and OLED mirror the real Fleet live. Every v1 control works from the Deck: five Agent Slot keys select and focus agents; fixed key 5 cycles pages and shows off-page priority; command keys create/close tabs, hold a Key Alias, and send Enter/Ctrl-C to the Selected Agent; encoder rotation eagerly focuses Workspaces by default, while its temporary Tab mode cycles tabs.

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
- 2026-08-14: User approved two hardware-acceptance corrections: Key Alias follows Command Key down/up so modifiers remain held (with Deck-side release on disconnect to prevent a stuck modifier), and `newAgent` focuses the newly created tab/root pane immediately.
- 2026-08-14: User replaced the control layout with five Agent Slots on keys 0–4, fixed Page Key 5, and defaults 6 `newAgent`, 7 `closeTab`, 8 `none`, 9 dictation, 10 Enter, 11 Ctrl-C. `closeTab` returns to v1. Encoder rotation direction is inverted; press replaces attention-jump with a four-second temporary Tab mode (press again also exits). Live protocol-19 diagnosis used a private scratch tab only and confirmed both `agent.send_keys {target:<pane_id>,keys:["enter"|"ctrl+c"]}` requests return `ok`; the apparent failure was the prior physical mapping (Enter was key 9, Ctrl-C key 10), not the Host→Herdr method or key spelling.
