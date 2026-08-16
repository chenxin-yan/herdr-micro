# 05 — Packaging: CLI setup + Nix flake / Home Manager module

**What to build:** Both supported install paths produce the same working Host, configuration, launchd service, and Deck setup from the same source. Manual onboarding is `bunx herdr-micro setup`: it compiles and installs a stable Host binary, initializes the complete default config only when absent, registers the `dev.herdr.herdr-micro` agent in the `gui` launchd domain, and provisions the Deck. `herdr-micro up` and `down` enable/start and stop/disable that agent. `herdr-micro uninstall` removes a CLI-managed service registration plus the installed binary, build workspace, shim, and download cache; it preserves config, logs, and the Deck and refuses to alter a plist without the herdr-micro ownership marker.

The npm tarball contains every Host and Device Bundle source needed by setup. The Nix flake exposes `packages.aarch64-darwin.{herdr-micro,default}` and `homeManagerModules.default` with `services.herdr-micro.{enable,package,settings}`. Home Manager owns its files declaratively while using the same launchd label, so only one daemon can run. Device provisioning uses the pinned CircuitPython 10.2.1 and Adafruit bundle 20260803 manifest, rejects ambiguous volumes, copies libraries first and `code.py` last, and makes Runtime Image flashing a separate user-confirmed step.

**Blocked by:** 04 — End-to-end: mirroring + all controls.

**Status:** ready-for-agent

- [ ] `bunx herdr-micro setup` installs a stable Host, preserves existing config, registers and starts the marked `dev.herdr.herdr-micro` launchd agent, provisions the Deck, and is safe to rerun
- [ ] `herdr-micro up` and `down` control the shared launchd service; `uninstall` removes a CLI-managed registration, the installed binary/build workspace, shim, and cache, and preserves config, logs, and the Deck
- [ ] The published npm tarball contains the Host sources, frozen lockfile, manifest, and Device Bundle sources required by setup
- [ ] `nix build`/`nix run` produce a working daemon on aarch64-darwin from a clean checkout
- [ ] Importing the Home Manager module with complete `services.herdr-micro.settings` yields a running daemon and generated config after switch without creating a second agent
- [ ] Device setup rejects zero, multiple, or mixed volumes; verifies pinned downloads; confirms Runtime Image flashing; copies libraries before `code.py`; and yields a working Deck after reset/replug
- [ ] Manual and Nix paths pass end-to-end validation on this machine, including logout/login and Host/Deck reconnects

## Comments

- 2026-08-16: This CLI-owned setup contract supersedes the standalone manual install and Device Bundle copy scripts.
