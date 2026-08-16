# 06 — OLED fleet dashboard

**What to build:** Redesign the 4-line × 21-char OLED layout in `buildRender` (`src/render.ts`) into a fleet dashboard (user-approved layout):

```
W2 B1 D3 I1     P1/2
> auth-refactor
  working  ws1/tab2
enc:ws  dev
```

- Line 1: per-state fleet counts (letters `W`orking `B`locked `D`one `I`dle `U`nknown, only nonzero states shown) + `P<page>/<count>` right-aligned. Include overflow indicator if present (e.g. `P1/2 +3`) only if it fits; page indicator wins.
- Lines 2–3: selected agent as `> <name>` / `  <state>  <ws>/<tab>`. No selection: `no agent selected` / `  ws: <focusedWorkspace ?? "—">`.
- Line 4: encoder mode + context. Base: `enc:ws  <workspace>`. Tab mode: `enc:tab <i>/<n> <label>` (replaces old line-3 tabLine). Model mode (issue 08): `enc:model`.
- All lines clipped to 21 chars as today.

**Blocked by:** None (line-4 model mode text lands with 08; render just switches on the mode).

**Status:** resolved

- [ ] Layout above renders for: selection present, no selection, tab mode, model mode, multi-page with overflow
- [ ] `test/render.test.ts` updated to the new layout; `bun test` and `bun run check` pass

## Comments

- 2026-08-15: Implemented via subagent workflow (scout → worker → 2 parallel reviewers → fix pass). Parent-verified diff: dashboardLine with nonzero state counts + right-aligned P<n>/<m> (+overflow when it fits), `> name` / `  state ws/tab` selected rows, `no agent selected` fallback, `enc:ws|tab|model` line 4. bun test 53 pass, bun run check clean. Awaiting desk verification.
- 2026-08-16: Resolved after user desk verification.
