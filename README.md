# herdr-micro

A physical control deck for orchestrating a fleet of coding agents in [Herdr](https://herdr.dev). The Deck mirrors agent status on its key LEDs and OLED, and routes physical presses to the right agent through a Host daemon on your machine with support for custom command actions.

## Prerequisites

- Adafruit MacroPad RP2040
- [Bun](https://bun.sh)
- [Herdr](https://herdr.dev/docs)

> Note: herdr-micro is only tested on macOS, might not work on linux or windows

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
