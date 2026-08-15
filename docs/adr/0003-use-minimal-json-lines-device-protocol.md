# Use a minimal JSON Lines Device Protocol

The Deck and Host exchange compact, newline-delimited JSON over CircuitPython's dedicated USB CDC data stream. The protocol is unversioned; instead, both hellos carry the shared app version (single source: package.json, stamped onto the device at deploy) and an exact mismatch fails closed with a redeploy-bundle screen (a version-less host `hello` is allowed as a port-identification probe and for hand serial-terminal demos: the Deck answers it with its own versioned hello, and answers only probes — replying to a versioned host hello would ping-pong) — the Host auto-updates while the Device Bundle only updates on re-copy, so drift is the named threat. It has bounded frames (1 KiB cap; oversized or malformed input is discarded to the next newline), complete last-write-wins Render Snapshots, fire-and-forget inputs and HID commands, and no acknowledgements, request IDs, sequence numbers, persistence, heartbeats, or capability negotiation. This keeps both implementations inspectable and lets malformed input resynchronize at the next newline.

A Render Snapshot contains:

- `led`: twelve solid RGB arrays (`[r,g,b]`) or RGB arrays with a device-side effect (`[r,g,b,"breathe"]` or `[r,g,b,"blink"]`). An unknown effect renders as solid RGB.
- `hdr`: the graphical Fleet header: `boxes` contains Host-derived state codes (`w`, `i`, `b`, `d`, `u`), `sel` is the selected box index or null, and one-based `page`/`pages` drive page dots. The Device draws white state shapes on the black OLED background and omits page dots for a single page.
- `text`: exactly three OLED text lines below the header.
- optional `sleep:true`: turn LEDs off and show the drifting OLED sleep mark until a later complete snapshot clears it.

Effects are presentation instructions only: the Host still owns Fleet interpretation and the Deck retains no durable or semantic state. Device-side slow burn-in shifting and sleep-mark drift are presentation details and do not change protocol state.
