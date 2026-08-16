# 03 — Target switch effect and cross-Target state reset

**What to build:** A `switchTarget(name)` effect that atomically retargets the daemon: stop watching the old Target, reset all pane-ID-keyed state, connect to the new Target, render its full snapshot.

**Blocked by:** 01, 02

**Status:** resolved

- [x] Interrupts the active `watchFleet` fiber and any in-flight `selectedDetail` fiber before touching state
- [x] Resets in one step: `fleet`, `workspaces`, `tabs`, `controls` (pageIndex, selectedPaneId, encoder mode + timer, pressedCommandActions), `selectedDetail`, `stateSince`, screensaver state/timers — pane IDs collide across Targets (`w5:p1D` exists on both validated machines)
- [x] Starts `watchFleet` on the new Target's socket; first snapshot renders complete Deck state (ADR-0001 full resync)
- [x] All command execution (`execute` in `src/main.ts:258-337`) reads the active Target at dispatch time; a command issued mid-switch either targets the old Target fully or the new one — never a mix
- [x] `Agent`/projection stay target-free (one active Fleet at a time); no Device Protocol changes
- [x] Tests: switch resets every listed state key (`test/target-state.test.ts`)
- [ ] Tests: commands after switch hit the new socket path; switch to unreachable Target leaves daemon in retrying-not-crashed state

## Comments

- 2026-08-16 (review): the last two test clauses have no automated coverage — `switchTarget`/`watchTarget`/`activeSocket` are closures inside `src/main.ts` (no test file) and `withTargetSocket` is untested. Code was verified by review; adding these tests requires extracting the wiring or stubbing ssh, deferred as follow-up.
