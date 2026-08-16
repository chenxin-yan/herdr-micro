# 01 — Target config schema and active-Target connection resolver

**What to build:** Named `targets` + `defaultTarget` in the config schema, and an active-Target resolver that replaces the `HERDR_SOCKET` constant so every Herdr call (watcher, execute, detail, refresh) routes through the currently selected Target's socket path.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] `ConfigSchema` gains `targets: { <name>: { socket } | { ssh, socket? } }` and `defaultTarget`; strict loading rejects unknown fields and a `defaultTarget` not present in `targets`
- [x] `DEFAULT_CONFIG` ships `targets: { local: { socket: "~/.config/herdr/herdr.sock" } }`, `defaultTarget: "local"`; `~` expansion handled at load
- [x] `initializeConfig`, README config docs, Nix module settings schema, and complete-config test fixtures updated together (strict config = no partial merge)
- [x] `src/main.ts:47` constant removed; all `sendRequest`/`watchFleet`/helper call sites take the resolved active socket path (helpers in `src/herdr.ts` already parameterize on `path` — no transport changes)
- [x] Local-only config behaves exactly as today (single target, no tunnel code invoked)
- [x] Tests: config parsing (valid, unknown target name, missing targets), resolver returns defaultTarget path at startup
