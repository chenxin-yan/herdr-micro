# 04 — Switcher UX: Layer+encoder cycling, OLED target label, switch flash

**What to build:** The Deck-facing UX: Layer held + encoder press previews Targets on the OLED (each press advances, wraps), Layer release commits the switch, LEDs flash the target hue during reconnect, and the active Target name is always visible on the OLED. Layer+rotation remains pi model cycling (v1 issue 08).

**Blocked by:** 03

**Status:** resolved

- [x] Layer + encoder press (the reserved no-op gesture) cycles configured Target names with wraparound; single-target configs keep it a no-op; Layer+rotation model cycling is untouched
- [x] OLED shows candidate name while previewing; Layer release commits; release without a press changes nothing
- [x] Active Target name renders alongside `workspaceLabel` in `buildRender` (`src/render.ts:98-150`) at all times — also closes the existing "which namespace am I mirroring" gap for single-target setups
- [x] On commit: full-LED flash in the Target's hue (auto-assigned palette, no config field), then blank until the new snapshot renders
- [x] Unreachable Target: OLED shows target name + error marker while `retryForever` runs; switching away remains possible
- [x] Tests: control reduction for Layer+encoder-press in multi/single-target configs; model-cycling regression restored; render includes target label; preview/commit/cancel sequencing

## Comments

- 2026-08-16: First implementation put Target cycling on Layer+rotation, clobbering pi model cycling (v1 issue 08 — the "reserved" comment covered encoder _press_, not rotation). Reverted rotation to model cycling; Target preview moved to Layer + encoder press.
