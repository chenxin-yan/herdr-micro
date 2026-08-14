# herdr-micro Device Bundle — Device Protocol (ADR-0003).
# Pure peripheral (ADR-0001): raw hello/key/encoder up, render/hid down.
import json

import usb_cdc
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keycode import Keycode
from adafruit_macropad import MacroPad
from protocol import LineReader

try:
    from version import VERSION  # stamped by deploy.sh from package.json
except ImportError:
    VERSION = "unknown"  # hand-copied without version.py: host will flag mismatch

macropad = MacroPad()
macropad.pixels.brightness = 0.2
macropad.display.auto_refresh = False
lines = macropad.display_text()
lines.show()
kbd = Keyboard(usb_hid.devices)
serial = usb_cdc.data
serial.timeout = 0
serial.write_timeout = 0  # never block the input scan on a slow/absent host

# Session state, reset on every DTR rising edge:
#   "waiting"   connected (or not), no host hello yet
#   "live"      host hello received; render/hid accepted
#   "mismatch"  host app version differs; fail closed until reconnect
state = "waiting"
shown_text = None  # last 4 OLED lines, to skip ~200ms refreshes (spike outcome)


def change_state(next_state):
    global state
    if state == "live" and next_state != "live":
        kbd.release_all()  # Host disconnect mid-hold must not leave a modifier stuck.
    state = next_state


def send(obj):
    # Fire-and-forget: dropped while disconnected or on write timeout.
    try:
        serial.write((json.dumps(obj) + "\n").encode())
    except Exception:
        pass


def show(text):
    global shown_text
    if text == shown_text:
        return
    shown_text = text
    for i in range(4):
        lines[i].text = text[i] if i < len(text) else ""
    macropad.display.refresh()


def show_waiting():
    macropad.pixels.fill((0, 0, 0))
    show(["herdr-micro " + VERSION, "", "waiting for host", ""])


def show_mismatch(host_ver):
    macropad.pixels.fill((0, 0, 0))
    show(
        [
            "version mismatch",
            "deck " + VERSION,
            "host " + str(host_ver),
            "redeploy bundle",
        ]
    )


def hello():
    send({"t": "hello", "fw": VERSION})


def handle(msg):
    t = msg.get("t")
    if t == "hello":
        host_ver = msg.get("host")
        if host_ver is None or host_ver == VERSION:
            change_state("live")
            hello()
        else:
            change_state("mismatch")
            show_mismatch(host_ver)
    elif state != "live":
        pass  # fail closed: no commands before a matching hello
    elif t == "render":
        led = msg.get("led", [])
        for i in range(min(12, len(led))):
            macropad.pixels[i] = tuple(led[i])
        show(msg.get("text", []))
    elif t == "hid":
        code = getattr(Keycode, msg.get("key", ""), None)
        if code is not None:
            if msg.get("down"):
                kbd.press(code)
            else:
                kbd.release(code)


reader = LineReader()
was_connected = False
last_pos = macropad.encoder
show_waiting()
hello()  # boot hello; dropped if no host yet, DTR edge below covers that

while True:
    connected = serial.connected
    if connected and not was_connected:  # DTR rising edge: fresh session
        change_state("waiting")
        reader = LineReader()
        show_waiting()
        hello()
    elif was_connected and not connected:
        change_state("waiting")
        show_waiting()
    was_connected = connected

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

    n = serial.in_waiting
    if n:
        for raw in reader.feed(serial.read(n)):
            try:
                handle(json.loads(raw))
            except (ValueError, TypeError):
                pass  # malformed frame: drop line, framing already resynced
