import usb_cdc

# Console CDC for REPL/diagnostics, data CDC for the JSONL device protocol.
usb_cdc.enable(console=True, data=True)
