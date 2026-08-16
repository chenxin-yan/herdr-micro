# Multi-Target spec: navigate between local and remote Herdr instances

Status: draft (validated 2026-08-16; see § Validation evidence)

Extend the Host so the Deck can mirror and control more than one Herdr Target — the local machine plus remote machines — and let the user switch the active Target from the Deck. Fulfils the v1 spec's planned next milestone (`.scratch/herdr-micro-v1/spec.md` § Scope).

## Background: why not `herdr --remote`

`herdr --remote <machine>` is a thin UI client: it runs `ssh -T <machine> exec herdr remote-client-bridge` and bridges the interactive client over SSH stdio. It exposes **no local socket or API** — the Socket API (`~/.config/herdr/herdr.sock`) exists only on the server's own filesystem, automation commands accept no host flag, and one client attaches to exactly one server ([persistence-remote](https://herdr.dev/docs/persistence-remote/), [socket-api](https://herdr.dev/docs/socket-api/), [discussion #515](https://github.com/herdrdev/herdr/discussions/515); bridge command observed live on this machine).

**Chosen transport: SSH Unix-socket forwarding.** `ssh -N -L <local-path>:~/.config/herdr/herdr.sock <host>` yields a local socket path that the existing `createConnection(path)` transport (`src/herdr.ts`) consumes unchanged. Validated end-to-end (§ Validation evidence). This is standard SSH, not a Herdr feature; if Herdr ships first-class multi-server support later (#515), the transport layer is the only thing that changes.

## Architecture: runtime Target switcher, one active connection

Exactly one Target is active at a time. The Deck mirrors the active Target's Fleet; switching Targets tears down and rebuilds the mirrored state. Merged multi-target fleets are out of scope — CONTEXT.md: Targets do not share identifiers or focus, and the use case is navigating _between_ machines.

### Config

Extend the schema (`src/config.ts`) with named Targets:

```jsonc
"targets": {
  "local":  { "socket": "~/.config/herdr/herdr.sock" },
  "minipc": { "ssh": "cyan-minipc" }  // remote socket path defaults to ~/.config/herdr/herdr.sock, overridable
},
"defaultTarget": "local"
```

- Config stays strict (no merging); `DEFAULT_CONFIG`, `initializeConfig`, docs, Nix module schema, and complete-config fixtures update together.
- `defaultAgentCommand` stays global for now; the command runs on the Target's machine via `pane.send_input`. Revisit per-target override only when a real need appears.

### Tunnel lifecycle (Host-owned)

- On switch to (or startup with) an SSH Target, Host spawns `ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o StreamLocalBindUnlink=yes -L <runtime-dir>/herdr-<target>.sock:<remote-sock> <host>`.
- Requires non-interactive auth (keys/agent). BatchMode failure surfaces as a Target-unavailable state, not a hang.
- Teardown must be explicit: with user `ControlMaster auto` + `ControlPersist`, forwards outlive the child ssh process (observed). Use a Host-owned `ControlPath` (`-o ControlPath=<runtime-dir>/cm-%C`) so tunnel lifetime is deterministic, or `ssh -O cancel` on teardown.
- Dead tunnel → `ECONNREFUSED` in ~1 ms on the stale socket file (validated); the existing `retryForever` loop recovers without modification. Tunnel process exit also triggers respawn with the same backoff discipline.

### Switch effect

Route all Herdr calls through an active-Target resolver instead of the `HERDR_SOCKET` constant (`src/main.ts:47`); centralize at `execute` (`src/main.ts:258-337`) and the watcher startup. On switch:

1. Interrupt the `watchFleet` fiber and any in-flight detail fiber.
2. Reset every pane-ID-keyed state — `fleet`, `workspaces`, `tabs`, `controls` (incl. `pageIndex`, `selectedPaneId`, encoder mode/timer, `pressedCommandActions`), `selectedDetail`, `stateSince`, screensaver state/timers. Pane IDs collide across Targets (`w5:p1D` exists on both machines today).
3. (Remote) ensure tunnel up; start `watchFleet` on the new socket path.
4. Render the new Target's full snapshot (ADR-0001 full-state resync applies unchanged).

`Agent` (`src/projection.ts`) gets **no** target field — safe while exactly one Fleet is active.

### No Device Protocol changes

Target identity is presentation: label on OLED, hue on LEDs. Render Snapshots already carry arbitrary text/colors (ADR-0003 holds).

## UX

**Layer + encoder press cycles Targets. OLED always shows the active Target name. Full-LED flash in a per-target hue on switch.**

> Correction (2026-08-16): the original draft put Target cycling on Layer+rotation based on a misread — that gesture is pi model cycling (v1 issue 08). The genuinely reserved gesture is Layer + encoder _press_.

- Layer+encoder is currently reserved/no-op (`src/controls.ts:94-102`) — free gesture, no key burned, no conflict with Workspace/Tab encoder modes.
- Flow: hold Layer, press encoder → OLED shows candidate Target name (each press advances, wraps) → release Layer commits → LEDs flash target hue during reconnect → new Fleet renders. Layer+rotation stays pi model cycling.
- Target label renders alongside `workspaceLabel` in `buildRender` (`src/render.ts:98-150`). This also fixes the existing gap that a single-target Deck never shows which namespace it mirrors.
- If the committed Target's tunnel cannot connect, OLED shows the Target name with an error marker and `retryForever` keeps trying; user can switch back the same way.

Rejected: dedicated Command Key (burns 1 of 6 for a rare action), Page Key overload (must stay distinct from page cycling), encoder long-press (needs Device Protocol change).

## Validation evidence (2026-08-16, herdr 0.8.0 / protocol 19 both ends)

Against live `cyan-minipc` over `ssh -L /tmp/herdr-remote.sock:/home/cyan/.config/herdr/herdr.sock`:

1. **One-shot requests**: `session.snapshot`, `agent.list` round-trip in ~120–135 ms; response shape matches what `parseSnapshot` expects.
2. **Event streaming**: `events.subscribe` (same subscription shape as `watchFleet`) delivered `tab_focused`/`workspace_focused` events in real time (~100 ms) over the forwarded socket, including events triggered by `tab.focus` requests sent through the same tunnel. This was the go/no-go test — PASS.
3. **Socket path**: neither machine has `~/.config/herdr/sessions/`; the main `herdr.sock` is the endpoint at 0.8.0.
4. **Stale socket**: connect after tunnel death fails with `ECONNREFUSED` in ~1 ms — `retryForever` compatible.
5. **ControlMaster caveat**: with the user's `ControlPersist 10m`, killing the ssh child did _not_ kill the forward — hence the Host-owned ControlPath requirement above.
6. **`--remote` internals**: live process list shows `herdr remote-client-bridge` over ssh stdio; confirms no local API surface to reuse.

## Open items

- Per-target LED hue: config field or auto-assigned palette (lean: auto-assign, YAGNI on config).
- Remote herdr version skew policy: startup `session.snapshot` already fails loud on shape mismatch; document "keep local and remote herdr on the same minor" rather than building negotiation.
- Tunnel keepalive: add `ServerAliveInterval` to the spawned ssh (herdr's own remote does this) so half-dead tunnels fail within seconds instead of TCP default.

## Issues

- `issues/01-target-config-and-connection-resolver.md`
- `issues/02-ssh-tunnel-lifecycle.md`
- `issues/03-target-switch-effect-and-state-reset.md`
- `issues/04-switcher-ux-encoder-oled-led.md`
