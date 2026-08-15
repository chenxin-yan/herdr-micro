# 02 — Host core: config + fleet projection

**What to build:** The Host daemon runs against the local default Herdr Session and continuously projects the Fleet into Agent Pages — demoable entirely without a Deck by rendering the six-slot projection to the console. Configuration follows the approved schema: defaults when the file is absent, exact schema errors and nonzero exit when invalid, `commandKeys` defaulting to `none` per key. Bun + TypeScript with the Effect v4 prerelease cohort pinned per ADR-0002; Effect owns socket/lifecycle resources, projection and codec stay plain tested functions.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `herdr-micro --config PATH` (default `~/.config/herdr-micro/config.json`) resolves the full v1 schema from the spec; missing file → defaults, invalid file → exact error + nonzero exit
- [ ] Host bootstraps from `session.snapshot` and stays current via `events.subscribe` on the local default Session socket; Herdr restart is survived via reconnect + fresh snapshot
- [ ] Fleet is projected in Herdr order into Agent Pages of six with states `idle/working/blocked/done/unknown`; agents shift left when one exits; off-page priority (`blocked > done > working > unknown > idle`) computed for the Page Key
- [ ] Console demo renders the live projection (slots, states, page N/M, `+N` overflow) as agents start, work, block, and exit
- [ ] Tests cover config defaults/rejection and projection edge cases (empty fleet, exactly six, seven agents, agent exit mid-page)

## Comments

- 2026-08-14: User replaced provided-file field merging with two-tier semantics: a missing file uses built-in defaults; a provided file must be complete and explicit. Added `config` path/status inspection and no-clobber `config init` so users can bootstrap the complete defaults instead of hand-writing them.
