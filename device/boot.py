import supervisor
import usb_cdc

# macOS writes metadata (._* AppleDouble, fsevents) to the mounted CIRCUITPY
# drive; each write auto-reloads code.py and visibly restarts the deck.
# Deploys already require a manual reset (deploy.sh), so auto-reload is unused.
supervisor.runtime.autoreload = False

# Console CDC for REPL/diagnostics, data CDC for the JSONL device protocol.
usb_cdc.enable(console=True, data=True)
