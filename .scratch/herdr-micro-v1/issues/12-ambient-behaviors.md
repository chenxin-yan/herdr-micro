# 12 — Ambient behaviors: selection wipe, screensaver + burn-in shift, selected-LED highlight

**What to build:** Event-driven motion and idle behavior. Continuous OLED animation stays banned (~200ms refresh); everything here is transient or slow-cadence.

Selection-change wipe (device, host-hinted):

- `render` gains optional `fx: "wipe"`; Host sets it only on renders caused by a selection change (Deck key 0–4 press or focus-follow change).
- Device plays a brief horizontal wipe transition into the new frame — 2–3 frames max (~2 refreshes), then settles. Input scan never starves; a second render arriving mid-wipe cancels the wipe and applies directly.

Screensaver + burn-in shift (host semantics, device presentation):

- Config: `screensaverMinutes` (positive finite, default 10).
- Host sends `render` with `sleep: true` when every agent is `idle` (or fleet empty) continuously for the window; any state change/input resumes normal renders.
- Device on `sleep`: LEDs all off; OLED shows a single small element (e.g. `herdr` glyph/text) that drifts to a new position every ~15s refresh.
- Burn-in shift, always-on (not just screensaver): device shifts the entire root group by 0/1px in x/y on a slow cycle (~5min). At most 1px — layout already fits with 1px slack, verify.

Selected-agent LED highlight (host only):

- The selected agent's key LED renders its state color blended toward white (~35%) with the `breathe` fx, so the physical key visibly tracks selection. No firmware change; pure `buildRender` color math.
- No selection → no highlight (slots render plain state colors).

**Blocked by:** 11 — device display group structure.

**Status:** ready-for-human

- [ ] Screensaver engages after the configured idle window, disengages on any fleet/input activity; LEDs off while asleep
- [ ] Burn-in shift verified not to clip any layout element at 1px offset
- [ ] Selected key visibly highlighted; host tests cover highlight color math and sleep-flag emission
- [ ] `bun test`, `bun run check`, `python3 -m py_compile device/code.py` pass; ADR-0003 documents `fx` and `sleep`

## Comments

- 2026-08-15: Review fix pass cleared stale wipe hints while no live Deck, extracted/tested the screensaver state policy (idle window, Fleet/Deck wake, empty Fleet), moved burn-in shifting ahead of the live-state guard so waiting/mismatch screens also shift, and lowered the bottom text row by 1px for shift slack. Automated gates pass; OLED clipping and motion still need desk verification.

## Comments

- 2026-08-15: Implemented. fx:"wipe" on selection-change renders (cancellable, 2-3 frames); sleep:true after screensaverMinutes (default 10, new config field) all-idle → LEDs off + drifting mark; always-on 1px burn-in shift ~5min; selected key = state color blended 35% toward white + breathe (host math only). Gates green. Awaiting desk verification.
