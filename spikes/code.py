# Spike A: dual CDC + HID + render-cost measurement (ticket 01).
# Speaks a subset of Device Protocol v1 on usb_cdc.data:
#   up:   hello, key, encoder, stat (spike-only, reports render_ms)
#   down: hello, render, hid
import json
import time

import usb_cdc
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode
from adafruit_macropad import MacroPad

FW = "spike-0.0.1"
MAX_LINE = 1024

macropad = MacroPad()
macropad.pixels.brightness = 0.2
macropad.display.auto_refresh = False
lines = macropad.display_text()
lines.show()
kbd = Keyboard(usb_hid.devices)
serial = usb_cdc.data


def send(obj):
    # Fire-and-forget: inputs are dropped while disconnected, never queued.
    try:
        serial.write((json.dumps(obj) + "\n").encode())
    except Exception:
        pass


def handle(msg):
    t = msg.get("t")
    if t == "hello":
        send({"t": "hello", "v": 1, "fw": FW})
    elif t == "render":
        t0 = time.monotonic_ns()
        led = msg.get("led", [])
        for i in range(min(12, len(led))):
            macropad.pixels[i] = tuple(led[i])
        text = msg.get("text", [])
        for i in range(4):
            lines[i].text = text[i] if i < len(text) else ""
        macropad.display.refresh()
        send({"t": "stat", "render_ms": (time.monotonic_ns() - t0) // 1_000_000})
    elif t == "hid":
        code = getattr(Keycode, msg.get("key", ""), None)
        if code is not None:
            kbd.press(code)
            kbd.release_all()


send({"t": "hello", "v": 1, "fw": FW})

buf = bytearray()
discarding = False
last_pos = macropad.encoder

while True:
    event = macropad.keys.events.get()
    if event:
        send({"t": "key", "k": event.key_number, "down": event.pressed})
    macropad.encoder_switch_debounced.update()
    if macropad.encoder_switch_debounced.pressed:
        send({"t": "key", "k": 12, "down": True})
    if macropad.encoder_switch_debounced.released:
        send({"t": "key", "k": 12, "down": False})
    pos = macropad.encoder
    if pos != last_pos:
        send({"t": "encoder", "delta": pos - last_pos})
        last_pos = pos

    # Bounded line buffer with discard-to-newline resync (ADR-0003).
    n = serial.in_waiting
    if n:
        for b in serial.read(n):
            if b == 10:  # \n
                if discarding:
                    discarding = False
                elif buf:
                    try:
                        handle(json.loads(bytes(buf)))
                    except ValueError:
                        pass  # malformed frame: drop, keep looping
                buf = bytearray()
            elif discarding:
                pass
            elif len(buf) >= MAX_LINE:
                buf = bytearray()
                discarding = True
            else:
                buf.append(b)
