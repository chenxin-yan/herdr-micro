# 08 — New layer map defaults + layer+encoder model mode

**What to build:** User-approved layer redesign. The physical Layer key is base slot 3, so slots 1, 2, 4, 5, 6 are usable while held.

New `layerKeys` defaults:

| Slot | Action                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------ |
| 1    | `newAgent`                                                                                                         |
| 2    | `closeTab`                                                                                                         |
| 3    | `none` (physical layer key)                                                                                        |
| 4    | `sendKeys ["left"]`                                                                                                |
| 5    | `sendKeys ["right"]`                                                                                               |
| 6    | `sendKeys ["shift+tab"]` (cycle thinking level — pi has no reverse action, verified in pi 0.84.1 keybindings docs) |

Model encoder mode (`src/controls.ts` + `src/config.ts`):

- While Layer is held, pressing the encoder switch (key 12) enters `encoderMode: "model"` instead of toggling tab mode.
- In model mode, encoder rotation sends configurable keys to the Selected Agent: new config field `layerEncoder: { cw: NonEmptyArray<string>, ccw: NonEmptyArray<string> }`, defaults `cw: ["ctrl+p"]` (next model), `ccw: ["shift+ctrl+p"]` (previous model) — pi's bidirectional model cycle.
- No selected agent → same log no-op pattern as other sendKeys (`sendSelected`).
- Mode exits on the existing `encoderTimeoutSeconds` inactivity timer (same mechanism as tab mode) or on encoder press (back to `workspaces`).
- OLED line 4 shows `enc:model` while active (hooks into issue 06's layout).

**Blocked by:** 06 — OLED fleet dashboard (line-4 mode display); 07 only overlaps in files, not behavior.

**Status:** ready-for-human

- [ ] Layer + encoder press enters model mode; rotation sends cw/ccw keys to the selected agent; timeout and re-press exit
- [ ] Plain encoder press still toggles workspaces/tabs exactly as before
- [ ] New layerKeys defaults ship in `DEFAULT_CONFIG`; `layerEncoder` validated by schema with exact errors
- [ ] Tests updated (`test/controls.test.ts`, `test/config.test.ts`); `bun test` and `bun run check` pass

## Comments

- 2026-08-15: Implemented. layerKeys defaults: 1 newAgent, 2 closeTab, 4 left, 5 right, 6 shift+tab (thinking). `layerEncoder` {cw:["ctrl+p"], ccw:["shift+ctrl+p"]}. Layer+encoder-press enters model mode; rotation repeats the binding per detent to the selected agent (no-op+log without selection); press or encoderTimeoutSeconds exits; plain press still toggles ws/tabs. Fix pass added Layer-release-during-model-mode and Tabs→Model transition regression tests. Awaiting desk verification.
- 2026-08-15: Desk bugs investigated (scout subagent). Stale-binary theory ruled out: the user ran `bun run dev` (runs src directly). Real findings: (1) layer-held + rotate was never a designed gesture (model mode required layer + encoder-press); the reducer now also sends layerEncoder keys while Layer is held, regression test added. (2) `shift+tab` flows unmodified to agent.send_keys and herdr parses it as BackTab (ESC[Z) per its own source/tests, yet the pane behaves as plain tab — still open, investigating pi-side ESC[Z handling next. `dist/herdr-micro` rebuilt; start script unchanged.
- 2026-08-15: Thinking-cycle root cause found empirically (cat -v byte dump in a scratch pane + live pi tests): herdr 0.8.0's send_keys downgrades shift+tab to plain Tab — parse_key_combo strips SHIFT into KeyCode::BackTab (keybinds.rs:1227), then the ghostty encoder maps Tab|BackTab to GHOSTTY_KEY_TAB with the now-empty modifiers (pane/input.rs:208), shadowing the correct ESC[Z arm in input/encode.rs. Synthesizing esc [ Z also fails (pi runs the kitty keyboard protocol). Verified ctrl+p and shift+ctrl+p DO deliver. Fix: pi app.thinking.cycle now also bound to shift+ctrl+h (dotfiles pi/default.nix, needs home-manager rebuild + /reload in live pi sessions); deck layer slot 6 default changed to shift+ctrl+h. Upstream herdr bug worth reporting. Also removed the sticky model-mode latch per user: layer+rotate is momentary model cycling, layer+encoder-press is a reserved no-op, encoderMode is workspaces|tabs again.
- 2026-08-15: Cleanup per user: shift+ctrl+h workaround reverted everywhere (deck slot 6 back to shift+tab, dotfiles pi keybinding change removed) — waiting on upstream herdrdev/herdr#1561 (fixed on master, pending release); a config comment marks the blockage. layerEncoder config knob deleted: layer-held rotation now hardcodes ctrl+p/shift+ctrl+p, symmetric with the built-in config-free base rotation. Thinking cycle stays broken until the next herdr release; everything else works.
