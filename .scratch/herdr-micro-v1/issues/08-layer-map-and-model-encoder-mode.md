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
