# 02 — Host-owned SSH tunnel lifecycle for remote Targets

**What to build:** For `ssh` Targets, the Host spawns and supervises `ssh -N -L <runtime>/herdr-<target>.sock:<remote-sock> <host>` with deterministic teardown, and exposes tunnel health to the switch/watch layers.

**Blocked by:** 01

**Status:** resolved

- [x] Tunnel spawn uses `-o BatchMode=yes -o ExitOnForwardFailure=yes -o StreamLocalBindUnlink=yes -o ServerAliveInterval=5 -o ServerAliveCountMax=2` and a **Host-owned ControlPath** so user `ControlPersist` cannot keep forwards alive past teardown (validated caveat: shared mux masters outlive the child ssh)
- [x] Local forward sockets live in a Host runtime dir, one per target name; stale files unlinked before spawn
- [x] Tunnel is spawned lazily on first switch to the Target (or at startup when `defaultTarget` is remote) and torn down on switch-away; Effect scope owns the child process
- [x] Tunnel process exit or `ECONNREFUSED` on the forwarded socket feeds the existing `retryForever` discipline (`src/herdr.ts:424-438`) — no separate retry mechanism
- [x] BatchMode auth failure surfaces as a Target-unavailable error carrying the target name (rendered by issue 04), never an interactive prompt or hang
- [ ] Manual validation against cyan-minipc recorded: snapshot + event streaming through Host-spawned tunnel, tunnel kill → auto-recovery

## Comments

- 2026-08-16 (deviation): `resolveRemoteSocket` (`src/targets.ts`) runs one extra `ssh <host> 'printf %s "$HOME"'` round-trip per tunnel attempt to expand the remote `~` default — OpenSSH does not expand `~` in streamlocal `-L` forwards. Not in the original spec; accepted.

- 2026-08-16: Live validation could not be rerun because the local macOS directory service stopped resolving uid 501 (`id -un` prints `501`; OpenSSH exits `No user exists for uid 501`) before network connection. The approved spec retains the earlier successful snapshot/event validation. Automated command-shape, scope, retry, and stale-socket behavior remain covered; rerun the full Host-spawn/kill check when uid resolution recovers.
