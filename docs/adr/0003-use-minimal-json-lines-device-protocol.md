# Use a minimal JSON Lines Device Protocol

The Deck and Host exchange compact, newline-delimited JSON over CircuitPython's dedicated USB CDC data stream. Protocol v1 has exact version matching, bounded frames, complete last-write-wins Render Snapshots, fire-and-forget inputs and HID commands, and no acknowledgements, request IDs, sequence numbers, persistence, heartbeats, or capability negotiation. This keeps both implementations inspectable and lets malformed input resynchronize at the next newline.
