# 07 — Per-binding LED colors + layer-aware rendering

**What to build:** Command-key LEDs (keys 6–11) currently render the _idle_ agent state color for any bound action — visually identical to idle agents. Replace with a per-binding configurable color, and make the LEDs switch to the layer map's colors while the Layer key is held.

- Config (`src/config.ts`): every `commandKeys`/`layerKeys` action object gets a required `color` (`#rrggbb`, reuse `HexColor`). For the `layer` action, `color` is its base color; add a distinct held color story: while held, the layer key itself renders its `color` at full configured brightness or a dedicated default that stands out (implementation may simply use its own `color` — pick one, document in the default config).
- Defaults: choose a palette clearly distinct from the agent state colors (states are red/green/blue/white/purple). E.g. amber/orange family for sendKeys, cyan for newAgent, etc. `none` actions stay off (no color field needed on `none`).
- Render (`src/render.ts`): `buildRender` gains a `layerHeld: boolean` input (derived in `src/main.ts` from `ControlState.pressedCommandActions` containing a `layer` action). Base: keys 6–11 show each `commandKeys` binding's color. Layer held: keys 6–11 show `layerKeys` colors (the held layer slot shows the layer action's color).
- A render must be pushed on layer press/release so the color switch is immediate.
- `DEFAULT_CONFIG` and schema updated together; config docs/sample stay single-source (schema is the source of truth).

**Blocked by:** None.

**Status:** ready-for-human

- [ ] Command keys are visually distinct from idle agents with default config
- [ ] Holding the Layer key immediately switches keys 6–11 to the layer map colors; release restores base
- [ ] Colors are configurable per binding; invalid hex rejected with exact schema error
- [ ] Tests updated (`test/config.test.ts`, `test/render.test.ts`); `bun test` and `bun run check` pass

## Comments

- 2026-08-15: Implemented. `color` (HexColor) required on every non-none action incl. layer. Defaults: orange sendKeys, cyan layer/newAgent, yellow keyAlias/arrows. Layer held → keys 6–11 render layerKeys colors; the held layer key keeps its own cyan (documented in DEFAULT_CONFIG comment). Render enqueued on every control message so the switch is immediate. BREAKING: existing config files must add `color` fields and `layerEncoder`. Awaiting desk verification.
