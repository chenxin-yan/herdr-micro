# herdr-micro

## 0.1.0

### Minor Changes

- 88537d1: Multi-Target support: mirror and control remote Herdr instances alongside the local one.

  - New required `targets` and `defaultTarget` config fields: name each Herdr instance as `{ "socket": "…" }` (local) or `{ "ssh": "host" }` (remote, tunneled automatically over SSH with a Host-owned ControlPath). Existing config files must add both fields — configuration is not merged with defaults. Remote Targets require non-interactive SSH auth (keys or an agent); tunnels run with BatchMode.
  - Switch from the Deck: hold Layer + press the encoder to preview the next Target on the OLED, release Layer to commit; single-target configs are unchanged
  - The active Target name is now always shown on the OLED, and switches flash the LEDs in a per-target hue
  - Layer + rotate keeps cycling pi models; the Device Protocol is unchanged, but redeploy the Device Bundle after updating — the Deck fails closed on a host/device version mismatch

## 0.0.1

### Patch Changes

- e336f0a: initial release
