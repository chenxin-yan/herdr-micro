# 09 — Animations: LED effects + OLED motion (device-side)

**What to build:** Device-side animation effects (user-approved mechanism — small ADR-0003 protocol extension; device stays a pure peripheral that animates only what it's told, no fleet logic).

Protocol extension (document in ADR-0003):

- `render.led` entries stay `[r,g,b]` for solid, or `[r,g,b, fx]` with `fx` ∈ `"breathe" | "blink"`. Unknown fx → render solid (forward-compat not needed beyond that; Host and Bundle ship in lockstep).
- `render` gains optional `"spin": true` — while set, the Device overlays a rotating spinner char (`|/-\`) at the end of OLED line 1, ticking at a desk-tunable 1Hz. This deliberately differs from the original 2–4Hz target: each OLED refresh blocks ~200ms, so 1Hz bounds the extra polling exposure of the encoder-switch debouncer. Key events use the keypad's native queue and encoder rotation uses a hardware counter, so those inputs are not lost during refresh.

Host (`src/render.ts`):

- Agent-slot LEDs: `working` → `breathe`, `blocked` → `blink`. Other states solid. Off-page priority key (key 5) follows the same mapping.
- `spin: true` whenever any agent in the fleet is `working`.

Device (`device/code.py`):

- Effect engine in the main loop using `time.monotonic()`, never blocking the input scan. Breathe: smooth brightness modulation of the base color, ~2s period, floor ~30% so the color stays readable. Blink: on/off ~1Hz. Only animated pixels rewritten per tick.
- Spinner: replace the last char of shown line 1 on a named, hardware-calibrated 1s tick while `spin` is active; skip entirely when inactive (no refresh cost). The Host's ordinary Render Snapshots already incur the same ~200ms OLED refresh; this adds only a bounded periodic refresh while working.
- Connect splash on entering `live`: brief LED sweep across keys 0–11 (~400ms total) then first render applies. Must not drop key/encoder events — non-blocking or tick-based.
- All animation stops in `waiting`/`mismatch` states (existing screens unchanged).

Stretch (only if trivial): device-side marquee for OLED lines the Host marks as clipped — otherwise skip, file later.

**Blocked by:** None (renders on top of 06–08's uncommitted work; same writer lane).

**Status:** ready-for-human

- [ ] `working` keys breathe, `blocked` keys blink, all others solid; off-page key animates per its priority state
- [ ] OLED spinner ticks while any agent works; disappears when fleet is quiet
- [ ] Connect splash plays once per session entry to `live`; input events during splash are not lost
- [ ] Host tests cover the fx mapping and `spin` flag; `bun test` and `bun run check` pass (firmware is desk-verified)

## Comments

- 2026-08-15: Implemented the Host effect mapping, Device Protocol extension, and non-blocking Device Bundle animation loop. Automated gates pass; LED breathing/blinking, OLED spinner, and connect sweep await desk verification.
- 2026-08-15: Review fix pass changed the spinner from 2–4Hz to a named 1Hz hardware calibration knob. The OLED refresh blocks ~200ms; 1Hz bounds the additional encoder-switch-debouncer polling exposure while preserving the spinner. Keypad events and encoder rotation are hardware-buffered/counted. The loop samples input before every animation tick.

## Comments

- 2026-08-15: Implemented via worker → 2 reviewers → fix pass. Supervisor-approved deviation: OLED spinner runs at 1Hz (not 2–4Hz) — each refresh blocks ~200ms and the encoder-switch debouncer is the one poll-sensitive input; cadence is a named constant (SPIN_INTERVAL_MS) for desk tuning. Fix pass also: spinner phase reset, stale-effect reset on reconnect, batched pixels.show(), wrap-safe supervisor.ticks_ms(). ADR-0003 updated with [r,g,b,fx] + spin. bun test 53 pass, check clean. Firmware needs desk verification (redeploy bundle).
- 2026-08-15: Desk feedback: breathe felt frantic → period slowed 2s→4s (BREATHE_PERIOD_MS knob in code.py). OLED spinner removed entirely (host `spin` flag, device spinner engine, ADR-0003 mention) — the spinner acceptance item is void. OLED simplified: dropped ws/tab ids, `ws:` line, and `enc:` prefixes; last line is empty outside tab/model modes. buildRender lost the focusedWorkspace param. bun test 53 pass, check clean.
