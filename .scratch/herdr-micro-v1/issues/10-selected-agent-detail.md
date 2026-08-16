# 10 — Selected-agent detail: state duration + pi status-bar parse

**What to build:** Host-side data enrichment for the selected agent (no firmware changes).

State duration:

- Host records `Date.now()` whenever an agent's `state` changes (track per `paneId`; seed on first sight — bootstrap counts from when the Host first saw the agent).
- Compact format: `<1m` shows nothing extra needed — use `Ns` under a minute, `4m`, `1h2m`.

pi status-bar parse (`agent.read`):

- While an agent is selected, poll `agent.read { target: paneId, source: "visible", strip_ansi: true }` on a fixed cadence (constant, ~3s; no config knob). Stop polling when no selection. Selected-agent change fetches immediately.
- Parse the pi status bar out of the visible text. Live sample line (herdr 0.8.0, pi 0.84):
  `↑460k ↓65k R21M W1.3M $34.879 15.5%/1.0M (auto)                    (anthropic) claude-fable-5 • high`
  Extract: model (`claude-fable-5`), thinking level (`high`, follows `•`), cost (`$34.879`), context percent (`15.5%`).
- Contained brittleness: any parse miss → the detail line renders empty. Never throw, never log-spam (log once per selection at most). Non-pi agents simply won't match.

OLED text (buildRender):

- Line 3: `> <name>  <state> <duration>` (truncate name so state+duration always fit).
- Line 4: detail line, e.g. `fable-5·high $34 15%` — drop the model's redundant vendor prefix only if needed to fit 21 chars (prefer full model name when it fits). Empty when no selection or no parse.
- Workspace label stays on line 2; tabs/model encoder modes still take line 2 over.

**Blocked by:** None.

**Status:** resolved

- [ ] Selected line shows live state duration that survives re-renders (not reset by unrelated fleet events)
- [ ] Detail line shows model/thinking/cost/context for a pi agent; blank for parse misses; poll stops with no selection
- [ ] Parser has direct unit tests using the sample line above (and a non-matching sample)
- [ ] `bun test` and `bun run check` pass

## Comments

- 2026-08-15: Review fix pass extracted and tested state-duration reconciliation, stopped detail polling on Deck disconnect, restarted it on a live handshake, and serialized same-selection `agent.read` requests so a slow response cannot overwrite a newer one. Automated gates pass; desk verification remains.

## Comments

- 2026-08-15: Implemented via workflow (scout → worker → 2 reviewers → fix). Parent-verified against the live daemon: parsePiStatus on real `herdr agent read` output returns {model: claude-fable-5, thinking: high, cost: 34.879, contextPercent: 15.5}. Gates green (62 tests). Awaiting desk verification.
- 2026-08-15: Two desk bugs root-caused against pi 0.84.1 footer source. (1) "fable-5high": detail line used "·" (U+00B7) which terminalio.FONT can't render — separator is now an ASCII space; protocol text must stay ASCII. (2) gpt-5.6-sol blank: pi appends " (sub)" after cost for subscription-backed providers and renders "• thinking off" as two words; the parse regex accepted neither. Regex now tolerates both (tests added). Known transient: "?/272k" context right after a model switch still parses as blank until pi knows the percent.
- 2026-08-16: Resolved after user desk verification.
