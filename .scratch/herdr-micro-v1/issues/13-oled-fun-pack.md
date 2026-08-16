# 13 — OLED fun pack: splash, pop, contrast breathing, bouncer, marquee, mode blink

**What to build:** Six user-picked OLED behaviors on top of the committed 06–12 design. Everything is event-driven or refresh-free except where noted; the ~200ms blocking refresh rule still governs.

1. **Connect splash (OLED)** — alongside the existing LED sweep, the OLED types `herdr` letter-by-letter (~150ms/letter, one refresh each, ~1s total incl. version line). Plays once per entry to `live`, same lifecycle as the LED sweep (pending render applies after).

2. **State-change pop (device-derived)** — device diffs `hdr.boxes` between consecutive renders; each changed box renders one emphasis frame (box inverted or 1px oversized) in the render's own refresh plus exactly one settle refresh (~250ms later). Multiple changes in one render pop together in that single extra frame. No pop on the first render of a session.

3. **Contrast breathing (refresh-free)** — new render flag `calm: true`, set by Host when every agent is idle (no timer — instant). Device slowly modulates `macropad.display.brightness` (~6s period, floor ~0.3) while calm; restores full brightness the moment calm drops. Brightness commands don't redraw the framebuffer, so this costs zero refreshes. **Desk risk:** if the SH1106 driver ignores brightness, feature silently no-ops — wrap the capability probe once at boot, not per tick.

4. **Screensaver DVD bouncer** — replace the 15s teleport drift: the sleep mark moves diagonally ~2px per step at ~400ms cadence, reflecting off edges. Refresh cost is accepted during sleep (keys are hardware-queued and encoder rotation is hardware-counted, so wake inputs are not lost; the encoder-switch debouncer may miss clicks while asleep — acceptable).

5. **Selected-name marquee** — Host stops pre-truncating the selected line (`> name  state dur`); the Device relies on displayio's natural screen-edge clipping. When the line's pixel width exceeds the display and its text changed, the device scrolls the label left in ~3-char steps at ~300ms until the tail has been shown once, then snaps back to the head. Bounded: cap at 6 scroll steps. Other text lines stay Host-truncated.

6. **Encoder-mode blink** — render gains optional `fx: "modeblink"`, set by Host only on renders where `encoderMode` transitioned into `tabs` or `model`. Device flashes the context line inverted for one frame (one extra refresh), then settles. (fx values unknown to the device are ignored.)

Protocol notes (ADR-0003): add `calm?: true` and `fx?: "modeblink"`; document that `hdr.boxes` diffing and marquee are device-side presentation. Host keeps owning all semantics (calm = all-idle is Host-computed).

**Blocked by:** None (post-0041d0e tree).

**Status:** resolved

- [ ] Splash types `herdr` once per live entry; input events during splash are not lost; pending render applies after
- [ ] Box pop fires only for changed boxes, never on session-first render; single settle refresh
- [ ] `calm` emitted iff all agents idle; brightness breathes only while calm; graceful no-op if unsupported
- [ ] Sleep mark bounces and reflects; screensaver still wakes instantly on fleet activity
- [ ] Long selected names scroll once then settle; short names never move; other lines still truncated
- [ ] Mode blink fires once per tabs/model entry, never on exit or unrelated renders
- [x] Host tests: calm emission, fx emission on mode transitions, untruncated selected line; `bun test`, `bun run check`, `python3 -m py_compile device/code.py` pass; ADR-0003 updated

## Comments

- 2026-08-15: Implemented all six behaviors with named device cadence constants. Automated gates pass (62 tests, TypeScript checks, Python compile, protocol self-test). Device timing, SH1106 brightness support, and appearance remain desk-verification items.

## Comments

- 2026-08-15: Implemented via workflow (worker → 2 reviewers → fix). Also carried the issue-12 highlight removal (user reversal, steered mid-run). Parent-verified: 62 tests pass, check clean, py_compile + protocol self-test OK; calm/fx:"modeblink" in protocol; brightness probed once at boot. Desk items: splash typing feel, pop visibility, whether SH1106 honors brightness (contrast breathing no-ops otherwise), bounce cadence, marquee step feel, blink usefulness.
- 2026-08-15: Desk feedback: removed selected-name marquee (not working), encoder-mode blink, and state-change box pop — end to end (device engines + context_bitmap/invert_rect, host fx/encoderModeEffect emission, protocol fields, ADR-0003, tests). Host re-truncates the selected line. Remaining fun pack: typing splash, contrast breathing, DVD bouncer. Gates green (61 tests).
- 2026-08-16: Resolved after user desk verification.
