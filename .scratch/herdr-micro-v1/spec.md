# herdr-micro v1 spec

Status: approved (grilling session 2026-08-13/14)

A physical control deck for a fleet of Herdr coding agents. Two components:

- **Deck** — Adafruit MacroPad RP2040 running the herdr-micro Device Bundle (CircuitPython). Pure peripheral: reports raw key/encoder input, executes explicit output commands (Render Snapshots, HID key taps). No fleet logic or durable config (ADR-0001).
- **Host** — Bun + TypeScript + Effect v4 prerelease daemon on the Mac (ADR-0002). Owns Herdr integration, fleet projection, configuration, and all decisions.

Terminology: see `CONTEXT.md`. Decisions: see `docs/adr/`.

## Scope (v1)

- Target: hard-coded local default Herdr Session (`~/.config/herdr/herdr.sock`). Multi-Target (named sessions, `--remote` hosts via SSH) is the planned next milestone; identity model is `(host, session, pane_id)`.
- Platform: Apple Silicon macOS only.
- Trust: physical USB access is trusted. No pairing/auth; identity = correct `hello` handshake on a VID/PID-filtered port.
- Herdr pin: stable channel, currently 0.8.0 (protocol 19). On startup record `herdr --version`; use `session.snapshot` + `events.subscribe` over the socket (newline-delimited JSON), CLI as fallback for one-shot commands.

## Fleet projection

- Fleet = agents reported by Herdr, in Herdr's order. Herdr is the sole source of truth; no state duplicated on Deck or Host beyond the current projection.
- Six **Agent Slots** (physical keys 1–6), paged. **Agent Pages** of six; agents shift left when one exits.
- **Page Key** cycles pages (wraps). Its LED shows highest-priority state among *off-page* agents.
- **Selected Agent** = last Agent Slot pressed. Cleared on page change. Agent commands (Enter, Send Ctrl-C) target it; ignored when none selected.
- State priority: `blocked > done > working > unknown > idle` (Herdr's five semantic states; presentation only).

## Controls

Physical keys 7–12 are **Command Keys**, configured as logical 1–6:

| Action | Behavior |
|---|---|
| `newAgent` | Create tab in focused Workspace, `pane run` the configured `defaultAgentCommand` (argv array) in its root pane; Herdr detection picks up the agent |
| `nextPage` | Cycle Agent Pages |
| `keyAlias` | Host commands Deck to tap one configured HID key (e.g. `RIGHT_GUI` for dictation). Single key only — no chords/sequences |
| `enter` | `agent send-keys <selected> enter` |
| `sendCtrlC` | `agent send-keys <selected> ctrl+c` — plain tap, no hold |
| `none` | Inert |

Encoder: rotate = cycle Workspaces; press = focus selected Workspace.
Agent Slot press: `agent focus` (changes Herdr shared focus; does not raise the macOS window — accepted for v1).

Dropped from v1: close tab, dictation-as-host-emitted-chord (rejected: macOS Accessibility churn), overflow beyond paging, transcript on OLED.

## OLED

Selected agent: name, state, workspace/tab, `Page N/M`. No selection: Target, focused Workspace, page, fleet count (`+N` overflow indicator).

## Device Protocol (ADR-0003)

JSON Lines over dedicated `usb_cdc.data` (enabled in `boot.py` alongside console + HID keyboard). Six messages:

```jsonc
// Deck → Host
{"t":"hello","v":1,"fw":"0.1.0"}
{"t":"key","k":3,"down":true}        // k 0–11, 12 = encoder switch
{"t":"encoder","delta":1}
// Host → Deck
{"t":"hello","v":1}
{"t":"render","led":[[r,g,b]×12],"text":["l1","l2","l3","l4"]}
{"t":"hid","key":"RIGHT_GUI"}
```

Rules: exact version match (mismatch → fail closed, Deck shows update screen); complete last-write-wins renders, host queues at most one pending; inputs and HID fire-and-forget, dropped while disconnected, never replayed; 1 KiB frame cap, discard-to-newline resync; any unsolicited Deck `hello` (boot/reconnect) → Host pushes fresh render. Reconnect: VID/PID-filtered scan, bounded backoff (250 ms → 5 s), `hello`-probe distinguishes data port from console.

## Configuration

`~/.config/herdr-micro/config.json`, overridable via `--config PATH`. Missing file = defaults; invalid file = exact schema error, exit nonzero. One versioned JSON schema shared by manual and Nix installs.

```json
{
  "schemaVersion": 1,
  "defaultAgentCommand": ["pi"],
  "commandKeys": {
    "1": { "type": "newAgent" },
    "2": { "type": "nextPage" },
    "3": { "type": "keyAlias", "key": "RIGHT_GUI" },
    "4": { "type": "enter" },
    "5": { "type": "sendCtrlC" },
    "6": { "type": "none" }
  },
  "appearance": {
    "brightness": 0.2,
    "states": {
      "blocked": "#ff0000", "done": "#00ff00", "working": "#0000ff",
      "idle": "#ffffff", "unknown": "#8000ff"
    }
  }
}
```

Missing/partial `commandKeys` → unbound keys are `none` (no implicit functional bindings; `nextPage` not required). Duplicates allowed. Key Alias keys come from a closed enum mapped to Adafruit `Keycode` names.

## Distribution

- **Manual**: Bun source + frozen lockfile; installer script writes LaunchAgent plist (`gui` domain, absolute paths) + default config.
- **Nix**: flake with `packages.aarch64-darwin.{herdr-micro,default}` (Bun FOD/compile pattern per nixpkgs `hunk` precedent) and `homeManagerModules.default` exposing `services.herdr-micro.{enable,package,settings}`; module installs package + LaunchAgent, generates the JSON config. No nix-darwin requirement.
- **Device Bundle**: separate artifact (`code.py` + `lib/` + manifest) installed by one explicit script (`herdr-micro-copy-device-bundle`): validates exactly one CIRCUITPY volume, copies libs first, `code.py` last, never touches the UF2 Runtime Image.

## Milestones

1. **Spike A (hardware gate)**: `boot.py` with `usb_cdc.enable(console=True, data=True)` + HID keyboard on the MacroPad — confirm two `/dev/cu.usbmodem*` ports and HID coexistence; measure render frame parse/refresh cost.
2. **Spike B (runtime gate)**: Bun + `serialport` (trustedDependencies) on pinned Bun/aarch64 — list/open/read/write/close + unplug/replug events. Fallback if it fails: Node runtime, same source.
3. **Host core**: config schema, Herdr socket client (snapshot + subscribe), fleet projection, protocol codec — plain functions with tests; Effect layers for serial/socket/lifecycle.
4. **Device Bundle**: input scan (keypad events), JSONL parse with bounded buffer, render, HID tap, waiting-for-host screen.
5. **End-to-end**: reconnect matrix (Deck unplug, Host restart, Herdr restart), then LaunchAgent + Nix packaging.

Tunables left as calibration knobs (hardware truths, not spec): frame cap, backoff ceiling, LED animation timing, OLED refresh cadence.
