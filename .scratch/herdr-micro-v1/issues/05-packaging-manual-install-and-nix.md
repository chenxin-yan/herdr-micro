# 05 — Packaging: manual install + Nix flake / Home Manager module

**What to build:** Both supported install paths produce the same working setup from the same source and config schema. Manual: an install script that sets up the LaunchAgent (gui domain, absolute paths) and a default config, plus an uninstall path. Nix: a flake exposing the aarch64-darwin package and a Home Manager module (`services.herdr-micro.{enable,package,settings}`) that installs the package, generates the identical JSON config, and manages the LaunchAgent — importable directly from a dotfiles flake. Copying the Device Bundle to the Deck stays one explicit command in both paths: it validates exactly one CIRCUITPY volume, copies libraries first and the entrypoint last, and never touches the UF2 Runtime Image.

**Blocked by:** 04 — End-to-end: mirroring + all controls.

**Status:** ready-for-agent

- [ ] Manual install script registers the LaunchAgent and the daemon survives logout/login; uninstall removes agent + binary without touching user config or the Deck
- [ ] `nix build`/`nix run` produce a working daemon on aarch64-darwin from a clean checkout
- [ ] Importing the Home Manager module in a dotfiles flake with `services.herdr-micro.enable = true` and `settings` yields a running daemon with the generated config after switch
- [ ] The device-bundle copy command refuses ambiguity (zero or multiple CIRCUITPY volumes), orders copies correctly, and results in a working Deck after replug
- [ ] Both install paths validated end to end on this machine
