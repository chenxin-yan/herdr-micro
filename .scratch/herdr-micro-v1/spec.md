# herdr-micro v1 spec

Status: approved (grilling session 2026-08-13/14)

A physical control deck for a fleet of Herdr coding agents. Two components:

- **Deck** — Adafruit MacroPad RP2040 running the herdr-micro Device Bundle (CircuitPython). Pure peripheral: reports raw key/encoder input, executes explicit output commands (Render Snapshots, HID key down/up). No fleet logic or durable config (ADR-0001).
- **Host** — Bun + TypeScript + Effect v4 prerelease daemon on the Mac (ADR-0002). Owns Herdr integration, fleet projection, configuration, and all decisions.

Terminology: see `CONTEXT.md`. Decisions: see `docs/adr/`.

## Scope (v1)

- Target: hard-coded local default Herdr Session (`~/.config/herdr/herdr.sock`). Multi-Target (named sessions, `--remote` hosts via SSH) is the planned next milestone; identity model is `(host, session, pane_id)`.
- Platform: Apple Silicon macOS only.
- Trust: physical USB access is trusted. No pairing/auth; identity = correct `hello` handshake on a VID/PID-filtered port.
- Herdr pin: stable channel, currently 0.8.0 (protocol 19). On startup record `herdr --version`; use `session.snapshot` + `events.subscribe` over the socket (newline-delimited JSON), CLI as fallback for one-shot commands.

## Fleet projection

- Fleet = agents reported by Herdr, in Herdr's order. Herdr is the sole source of truth; no state duplicated on Deck or Host beyond the current projection.
- Five **Agent Slots** (physical keys 0–4), paged. **Agent Pages** of five; agents shift left when one exits.
- Physical key 5 is the fixed **Page Key**. It cycles pages (wraps), clears selection, and its LED shows highest-priority state among _off-page_ agents.
- **Selected Agent** = last Agent Slot pressed. Cleared on page change. Agent commands (Enter, Send Ctrl-C) target it; ignored when none selected.
- State priority: `blocked > done > working > unknown > idle` (Herdr's five semantic states; presentation only).

## Controls

Physical keys 6–11 are **Command Keys**, configured as logical 1–6. The built-in layout is: 6 = `newAgent`, 7 = `closeTab`, 8 = `none`, 9 = right-Command `keyAlias`, 10 = `enter`, 11 = `sendCtrlC`.

| Action      | Behavior                                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `newAgent`  | Create and focus a tab in the focused Workspace, `pane run` the configured `defaultAgentCommand` (argv array) in its root pane; Herdr detection picks up the agent |
| `closeTab`  | Close the currently focused tab                                                                                                                                    |
| `keyAlias`  | Host commands Deck to hold one configured HID key (e.g. `RIGHT_GUI` for dictation) while the Command Key is held. Single key only — no chords/sequences            |
| `enter`     | `agent send-keys <selected> enter`                                                                                                                                 |
| `sendCtrlC` | `agent send-keys <selected> ctrl+c` — plain tap, no hold                                                                                                           |
| `none`      | Inert                                                                                                                                                              |

Encoder defaults to Workspace mode: rotation cycles and eagerly focuses Workspaces with the hardware delta direction inverted. Press enters Tab mode; rotation then cycles and eagerly focuses tabs within the current Workspace, with the same inverted direction. Press again or four seconds without rotation returns to Workspace mode. The OLED identifies Tab mode and the selected tab.
Agent Slot press: `agent focus` (changes Herdr shared focus; does not raise the macOS window — accepted for v1).

Dropped from v1: dictation-as-host-emitted-chord (rejected: macOS Accessibility churn), overflow beyond paging, transcript on OLED.

## OLED

Selected agent: name, state, workspace/tab, `Page N/M`. No selection: Target, focused Workspace, page, fleet count (`+N` overflow indicator). In Tab mode the workspace/tab line shows `Tabs N/M: label` so the temporary mode is visible.

## Device Protocol (ADR-0003)

JSON Lines over dedicated `usb_cdc.data` (enabled in `boot.py` alongside console + HID keyboard). Six messages:

```jsonc
// Deck → Host
{"t":"hello","fw":"0.0.2"}          // fw = Device Bundle app version
{"t":"key","k":3,"down":true}        // k 0–11, 12 = encoder switch
{"t":"encoder","delta":1}
// Host → Deck
{"t":"hello","host":"0.0.2"}        // host = Host app version
{"t":"render","led":[[r,g,b]×12],"text":["l1","l2","l3","l4"]}
{"t":"hid","key":"RIGHT_GUI","down":true}  // down=false releases the key
```

Rules: the protocol itself is unversioned; instead both hellos carry the app version (single source: package.json, stamped onto the device by deploy) and an exact mismatch fails closed — Deck shows a redeploy-bundle screen, Host logs the mismatch (ADR-0003). A host-less hello (hand serial-terminal demo) omits `host` and is allowed. Complete last-write-wins renders, host queues at most one pending; inputs and HID fire-and-forget, dropped while disconnected, never replayed; 1 KiB frame cap, discard-to-newline resync; any unsolicited Deck `hello` (boot/reconnect) → Host pushes fresh render. Reconnect: VID/PID-filtered scan, bounded backoff (250 ms → 5 s), `hello`-probe distinguishes data port from console.

## Configuration

`~/.config/herdr-micro/config.json`, overridable via `--config PATH`. Missing file = defaults; in a provided file every field is optional with field-level defaults (keys omitted from `commandKeys` default to `none`, not the built-in bindings); invalid values = exact schema error, exit nonzero. One JSON schema shared by manual and Nix installs.

```json
{
  "defaultAgentCommand": ["pi"],
  "commandKeys": {
    "1": { "type": "newAgent" },
    "2": { "type": "closeTab" },
    "3": { "type": "none" },
    "4": { "type": "keyAlias", "key": "RIGHT_GUI" },
    "5": { "type": "enter" },
    "6": { "type": "sendCtrlC" }
  },
  "appearance": {
    "brightness": 0.2,
    "states": {
      "blocked": "#ff0000",
      "done": "#00ff00",
      "working": "#0000ff",
      "idle": "#ffffff",
      "unknown": "#8000ff"
    }
  }
}
```

Missing/partial `commandKeys` → unbound keys are `none` (no implicit functional bindings). Duplicates allowed. Key Alias keys come from a closed enum mapped to Adafruit `Keycode` names.

## Distribution

- **Manual**: Bun source + frozen lockfile; installer script writes LaunchAgent plist (`gui` domain, absolute paths) + default config.
- **Nix**: flake with `packages.aarch64-darwin.{herdr-micro,default}` (Bun FOD/compile pattern per nixpkgs `hunk` precedent) and `homeManagerModules.default` exposing `services.herdr-micro.{enable,package,settings}`; module installs package + LaunchAgent, generates the JSON config. No nix-darwin requirement.
- **Device Bundle**: separate artifact (`code.py` + `lib/` + manifest) installed by one explicit script (`herdr-micro-copy-device-bundle`): validates exactly one CIRCUITPY volume, copies libs first, `code.py` last, never touches the UF2 Runtime Image.

## Milestones

1. **Spike A (hardware gate)**: `boot.py` with `usb_cdc.enable(console=True, data=True)` + HID keyboard on the MacroPad — confirm two `/dev/cu.usbmodem*` ports and HID coexistence; measure render frame parse/refresh cost.
2. **Spike B (runtime gate)**: Bun + `serialport` (trustedDependencies) on pinned Bun/aarch64 — list/open/read/write/close + unplug/replug events. Fallback if it fails: Node runtime, same source.
3. **Host core**: config schema, Herdr socket client (snapshot + subscribe), fleet projection, protocol codec — plain functions with tests; Effect layers for serial/socket/lifecycle.
4. **Device Bundle**: input scan (keypad events), JSONL parse with bounded buffer, render, HID key down/up, waiting-for-host screen.
5. **End-to-end**: reconnect matrix (Deck unplug, Host restart, Herdr restart), then LaunchAgent + Nix packaging.

Tunables left as calibration knobs (hardware truths, not spec): frame cap, backoff ceiling, LED animation timing, OLED refresh cadence.

## Spike outcomes (ticket 01, measured on hardware)

Board: MacroPad RP2040, CircuitPython 10.2.1, bundle 20260803. Host: macOS 14.7.1 arm64, Bun 1.3.10.

- **Dual CDC + HID coexist**: `boot.py` with `usb_cdc.enable(console=True, data=True)` enumerates two `/dev/cu.usbmodem*` ports; HID keyboard stays functional alongside (taps observed in macOS; `AppleUserHIDEventDriver` attached).
- **Protocol adjustment — no `serialport` addon**: `serialport@13` crashes Bun 1.3.10 on open (native addon calls `uv_default_loop`, unsupported — [bun#18546](https://github.com/oven-sh/bun/issues/18546); `list()` works, `open()` panics). Host transport is instead `stty -f <dev> raw -echo` + `node:fs` open (`O_RDWR|O_NOCTTY|O_NONBLOCK`) with a ~50Hz nonblocking `readSync` poll. Opening asserts DTR, so `usb_cdc.data.connected` sees the Host. Port discovery: glob `/dev/cu.usbmodem*` + hello-probe (no VID/PID metadata needed; probe alone distinguishes data from console port). Bun runtime retained; Node fallback not needed. Revisit `serialport` if bun#18546 lands.
- **Render frame cost**: max-size render (272 B: 12 RGB + 4 text lines) ≈ **211 ms on-device** (dominated by OLED `display.refresh()`), ≈ 235–245 ms host round-trip. Key scan stays responsive immediately after. Consequence: render cadence must stay well under ~4 Hz, or ticket 03 should refresh the OLED only when text changes (LED-only renders are cheap).
- **Unplug/replug**: host sees `ENXIO` on read → close, rescan, re-probe; recovery to fresh render in ~4 s. No zombie fds. Device soft-reboot (auto-reload) emits unsolicited `hello` on the still-open port, as the protocol expects.
- Spike artifacts: `spikes/` (boot.py, code.py, deploy.sh, serial-fs-spike.ts); deploy + verify flow documented in README.
