# herdr-micro

A physical control deck for orchestrating a fleet of coding agents in [Herdr](https://herdr.dev). The Deck mirrors agent status on its key LEDs and OLED, and routes physical presses to the right agent through a Host daemon on your machine with support for custom command actions.

## Prerequisites

- Adafruit MacroPad RP2040
- [Bun](https://bun.sh)
- [Herdr](https://herdr.dev/docs)

> Note: herdr-micro is only tested on macOS, might not work on linux or windows

## Herdr Targets

The built-in configuration connects to the local `~/.config/herdr/herdr.sock`. A complete custom configuration may name local and remote Targets:

```json
{
  "targets": {
    "local": { "socket": "~/.config/herdr/herdr.sock" },
    "minipc": { "ssh": "cyan-minipc" }
  },
  "defaultTarget": "local"
}
```

Remote Targets use the named SSH host and default to the same Herdr socket path on that host. They require non-interactive SSH authentication (keys or an agent); tunnels run with BatchMode and never prompt. These fields are part of the complete configuration written by `herdr-micro config init`; provided configuration files are not merged with defaults.

## Getting Started

There are two ways of setting up herdr-micro with your machine and deck:

### 1. Nix Flake (Home Manager)

```nix
{
  inputs.herdr-micro.url = "github:chenxin-yan/herdr-micro";

  # In your Home Manager configuration:
  imports = [ inputs.herdr-micro.homeManagerModules.default ];
  services.herdr-micro = {
    enable = true;
    # settings = { ... }; # When set, this must contain every schema field.
  };
}
```

After activation, run the Nix-installed `herdr-micro setup` to initialize configuration when absent and provision the Deck. It leaves the Nix-managed Host binary and Home Manager-managed LaunchAgent unchanged.

### 2. Manual Setup

#### Setup

Connect the Deck, then run:

```bash
bunx herdr-micro setup
```

Setup installs a standalone Host, initializes the default configuration when absent, and registers the `dev.herdr.herdr-micro` LaunchAgent. It then guides first-time CircuitPython installation and deploys the Device Bundle:

- CircuitPython 10.2.1, with confirmation before flashing the UF2 Runtime Image
- required libraries from the pinned Adafruit bundle 20260803
- `boot.py`, `protocol.py`, and `code.py`, copied with the entrypoint last

Entering the RP2040 bootloader requires physically holding the Deck's rotary encoder (BOOTSEL) while resetting it.

Manage the Host with:

```bash
herdr-micro up
herdr-micro down
herdr-micro uninstall
```

`uninstall` removes the CLI-managed LaunchAgent, the installed Host binary and build workspace, the CLI shim, and the download cache. It leaves configuration, logs, and the Deck unchanged.

#### Configuration

With no file at `~/.config/herdr-micro/config.json`, the Host uses its built-in defaults. Generate a complete, editable file with:

```bash
herdr-micro config init
```

A provided file must contain every field; configuration is not merged with the defaults. Inspect the active path and whether it exists with `herdr-micro config`. All commands accept `--config PATH`. `config init` refuses to overwrite an existing file.

### Default Mapping

```
   ┌──────────────────────────────┐
   │  OLED: workspace / agents /  │     ┌────────┐
   │        selected agent info   │     │ ENCODER│
   └──────────────────────────────┘     └────────┘
   rotate ······ cycle Workspaces
   press  ······ toggle Workspaces ⇄ Tabs mode (4s timeout back)
   rotate in Tabs mode ····· cycle Tabs
   LAYER + rotate ·········· pi model cycle (ctrl+p / shift+ctrl+p)
   LAYER + press ··········· preview next Target (release LAYER to switch)

   ┌───────────┬───────────┬───────────┐
   │ Agent 1   │ Agent 2   │ Agent 3   │  AGENT SLOTS (page of 5)
   │           │           │           │  press = focus that agent
   ├───────────┼───────────┼───────────┤  LED = Agent State color
   │ Agent 4   │ Agent 5   │ PAGE KEY  │← cycles Agent Pages
   ├───────────┼───────────┼───────────┤
   │ CMD1      │ CMD2      │ CMD3      │  COMMAND KEYS
   │ ctrl+c 🟠 │ esc    🟠 │ LAYER  🔵 │← hold to shift CMD keys
   ├───────────┼───────────┼───────────┤
   │ CMD4      │ CMD5      │ CMD6      │
   │ ⌘R HID 🟡 │ enter  🟠 │ alt+enter │
   │ (hold =   │           │        🟠 │
   │ dictation)│           │           │
   └───────────┴───────────┴───────────┘

   While LAYER (CMD3) is held:
   ┌───────────┬───────────┬───────────┐
   │ CMD1      │ CMD2      │ CMD3      │
   │ new agent │ close tab │ (held     │
   │ 🔵        │ 🟠        │  layer)   │
   ├───────────┼───────────┼───────────┤
   │ CMD4      │ CMD5      │ CMD6      │
   │ ↓ down 🟡 │ ↑ up   🟡 │ shift+tab │
   │           │           │        🟠 │
   └───────────┴───────────┴───────────┘
```

Agent Slot LED colors follow Agent State: 🔴 blocked · 🟢 done · 🔵 working · ⚪ idle · 🟣 unknown.

## Development

```bash
bun install
bun dev
bun test
bun run check
```

For Device Bundle iteration, `device/deploy.sh` remains a development-only shortcut. After `herdr-micro setup` has installed the pinned libraries, code-only changes need no library path:

```bash
./device/deploy.sh
```

To refresh libraries explicitly, pass the extracted bundle's `lib/` directory:

```bash
./device/deploy.sh --libs ~/Library/Caches/herdr-micro/adafruit-circuitpython-bundle-10.x-mpy-20260803/lib
```
