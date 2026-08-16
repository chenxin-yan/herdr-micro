# herdr-micro Device Bundle — Device Protocol (ADR-0003).
# Pure peripheral (ADR-0001): raw hello/key/encoder up, render/hid/sound down.
import json
import math

import displayio
import supervisor
import terminalio
import usb_cdc
import usb_hid
from adafruit_display_text import bitmap_label
from adafruit_ticks import ticks_diff
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
macropad.pixels.auto_write = False
macropad.display.auto_refresh = False

# 128x64 display: 12px graphical header plus three terminal-font text rows.
root = displayio.Group()
normal_group = displayio.Group()
header_bitmap = displayio.Bitmap(126, 12, 2)
header_palette = displayio.Palette(2)
header_palette[0] = 0x000000
header_palette[1] = 0xFFFFFF
header_grid = displayio.TileGrid(header_bitmap, pixel_shader=header_palette)
normal_group.append(header_grid)
text_lines = []
for y in (22, 39, 55):
    text_line = bitmap_label.Label(terminalio.FONT, text="", color=0xFFFFFF, x=0, y=y)
    text_lines.append(text_line)
    normal_group.append(text_line)
sleep_label = bitmap_label.Label(terminalio.FONT, text="herdr", color=0xFFFFFF, x=8, y=16)
sleep_label.hidden = True
root.append(normal_group)
root.append(sleep_label)
macropad.display.root_group = root
macropad.display.refresh()

# SH1106 brightness support varies by CircuitPython/display driver. Probe once;
# unsupported contrast breathing is intentionally a silent no-op.
try:
    FULL_DISPLAY_BRIGHTNESS = float(macropad.display.brightness)
    macropad.display.brightness = max(0.3, FULL_DISPLAY_BRIGHTNESS * 0.9)
    macropad.display.brightness = FULL_DISPLAY_BRIGHTNESS
    DISPLAY_BRIGHTNESS_SUPPORTED = True
except Exception:
    FULL_DISPLAY_BRIGHTNESS = 1.0
    DISPLAY_BRIGHTNESS_SUPPORTED = False

kbd = Keyboard(usb_hid.devices)
serial = usb_cdc.data
serial.timeout = 0
serial.write_timeout = 0  # never block the input scan on a slow/absent host

# Session state, reset on every DTR rising edge:
#   "waiting"   connected (or not), no host hello yet
#   "live"      host hello received; render/hid/sound accepted
#   "mismatch"  host app version differs; fail closed until reconnect
state = "waiting"
shown_display = None
base_led = [(0, 0, 0)] * 12
led_fx = [None] * 12
last_led_tick = supervisor.ticks_ms()
led_phase_ms = 0
last_blink_on = None
splash_active = False
splash_index = 0
splash_text_index = 0
last_splash_tick = 0
last_splash_text_tick = 0
pending_render = None
calm = False
last_contrast_tick = supervisor.ticks_ms()
contrast_phase_ms = 0
asleep = False
sleep_x = 8
sleep_y = 16
sleep_dx = 2
sleep_dy = 2
last_sleep_tick = 0
burn_position = 0
last_burn_tick = supervisor.ticks_ms()

# Hardware calibration knobs. OLED refreshes block ~200ms, so motion is sparse.
BREATHE_PERIOD_MS = 4000
# Blink phase rides the breathe wrap: keep BREATHE_PERIOD_MS a multiple of
# 2 * BLINK_HALF_PERIOD_MS or blink glitches when led_phase_ms wraps.
BLINK_HALF_PERIOD_MS = 500
LED_TICK_INTERVAL_MS = 50
SPLASH_LED_INTERVAL_MS = 400 // 12
SPLASH_TEXT_INTERVAL_MS = 150
CONTRAST_PERIOD_MS = 6000
CONTRAST_TICK_INTERVAL_MS = 100
SLEEP_BOUNCE_INTERVAL_MS = 400
SLEEP_MIN_X = 4
SLEEP_MAX_X = 94
SLEEP_MIN_Y = 10
SLEEP_MAX_Y = 55
BURN_SHIFT_INTERVAL_MS = 300000
BURN_POSITIONS = ((0, 0), (1, 0), (1, 1), (0, 1))
ATTN_LOW_HZ = 659
ATTN_HIGH_HZ = 880
ATTN_NOTE_SECONDS = 0.06
DONE_HZ = 523
DONE_NOTE_SECONDS = 0.12


def clear_header():
    header_bitmap.fill(0)


def pixel(x, y, value=1):
    if 0 <= x < header_bitmap.width and 0 <= y < header_bitmap.height:
        header_bitmap[x, y] = value


def outline(x, y, width, height, value=1):
    for px in range(x, x + width):
        pixel(px, y, value)
        pixel(px, y + height - 1, value)
    for py in range(y, y + height):
        pixel(x, py, value)
        pixel(x + width - 1, py, value)


def fill_rect(x, y, width, height, value=1):
    for px in range(x, x + width):
        for py in range(y, y + height):
            pixel(px, py, value)


def draw_header(header):
    clear_header()
    boxes = header.get("boxes", [])[:16]
    selected = header.get("sel")
    for index, agent_state in enumerate(boxes):
        x = index * 6 + (index // 3) * 2
        if agent_state == "w":
            fill_rect(x, 1, 5, 7)
        elif agent_state == "i":
            outline(x, 1, 5, 7)
        elif agent_state == "b":
            fill_rect(x, 1, 5, 7)
            fill_rect(x + 1, 3, 3, 3, 0)
        elif agent_state == "d":
            outline(x, 1, 5, 7)
            pixel(x + 2, 4)
        else:
            pixel(x + 2, 4)
        if selected == index:
            fill_rect(x, 9, 5, 1)

    pages = max(1, int(header.get("pages", 1)))
    if pages > 1:
        current = max(1, min(pages, int(header.get("page", 1)))) - 1
        start = header_bitmap.width - pages * 4
        for page in range(pages):
            x = start + page * 4
            if page == current:
                fill_rect(x, 4, 3, 3)
            else:
                outline(x, 4, 3, 3)


def set_text(text):
    for index in range(3):
        text_lines[index].text = text[index] if index < len(text) else ""


def show_normal(text, header, force=False):
    global shown_display
    signature = json.dumps([text, header])
    normal_group.hidden = False
    sleep_label.hidden = True
    set_text(text)
    draw_header(header)
    if force or shown_display != signature:
        shown_display = signature
        macropad.display.refresh()


def set_calm(next_calm):
    global calm, last_contrast_tick, contrast_phase_ms
    if calm == next_calm:
        return
    calm = next_calm
    contrast_phase_ms = CONTRAST_PERIOD_MS // 4  # start at full brightness, then ease down
    last_contrast_tick = supervisor.ticks_ms()
    if DISPLAY_BRIGHTNESS_SUPPORTED:
        macropad.display.brightness = FULL_DISPLAY_BRIGHTNESS


def show_message(text):
    global asleep
    asleep = False
    macropad.pixels.fill((0, 0, 0))
    macropad.pixels.show()
    show_normal(text[:3], {}, force=True)


def show_waiting():
    show_message(["herdr-micro " + VERSION, "", "waiting for host"])


def enter_sleep(now):
    global asleep, sleep_x, sleep_y, sleep_dx, sleep_dy, last_sleep_tick, shown_display
    asleep = True
    macropad.pixels.fill((0, 0, 0))
    macropad.pixels.show()
    normal_group.hidden = True
    sleep_label.hidden = False
    sleep_x, sleep_y = 8, 16
    sleep_dx, sleep_dy = 2, 2
    sleep_label.x, sleep_label.y = sleep_x, sleep_y
    last_sleep_tick = now
    shown_display = None
    macropad.display.refresh()


def apply_render(msg):
    global last_blink_on, asleep
    now = supervisor.ticks_ms()

    led = msg.get("led", [])
    for index in range(min(12, len(led))):
        entry = led[index]
        # Coerce before committing: a malformed hand-typed frame (spec allows a bare
        # serial terminal) must raise here inside the guarded handle(), not poison
        # base_led/led_fx and crash a later animation tick outside it.
        color = (int(entry[0]), int(entry[1]), int(entry[2]))
        base_led[index] = color
        led_fx[index] = entry[3] if len(entry) > 3 and entry[3] in ("breathe", "blink") else None
        macropad.pixels[index] = color
    last_blink_on = None
    set_calm(msg.get("calm") is True)

    if msg.get("sleep") is True:
        if not asleep:
            enter_sleep(now)
        return

    asleep = False
    macropad.pixels.show()
    text = list(msg.get("text", []))[:3]
    while len(text) < 3:
        text.append("")
    show_normal(text, msg.get("hdr", {}))


def start_splash():
    global splash_active, splash_index, splash_text_index
    global last_splash_tick, last_splash_text_tick, pending_render
    now = supervisor.ticks_ms()
    splash_active = True
    splash_index = 0
    splash_text_index = 1
    last_splash_tick = now
    last_splash_text_tick = now
    pending_render = None
    set_calm(False)
    macropad.pixels.fill((0, 0, 0))
    macropad.pixels.show()
    show_normal(["h", "", ""], {}, force=True)


def tick_animations(now):
    global splash_active, splash_index, splash_text_index
    global last_splash_tick, last_splash_text_tick, pending_render
    global last_led_tick, led_phase_ms, last_blink_on
    global contrast_phase_ms, last_contrast_tick
    global sleep_x, sleep_y, sleep_dx, sleep_dy, last_sleep_tick
    global burn_position, last_burn_tick

    # Burn-in protection applies to waiting/mismatch too: they may be the
    # longest-lived static screens on an unattended Deck.
    if ticks_diff(now, last_burn_tick) >= BURN_SHIFT_INTERVAL_MS:
        burn_position = (burn_position + 1) % len(BURN_POSITIONS)
        root.x, root.y = BURN_POSITIONS[burn_position]
        last_burn_tick = now
        macropad.display.refresh()
        return

    if state != "live":
        return

    if splash_active:
        if splash_index < 12 and ticks_diff(now, last_splash_tick) >= SPLASH_LED_INTERVAL_MS:
            last_splash_tick = now
            macropad.pixels.fill((0, 0, 0))
            macropad.pixels[splash_index] = (0, 128, 128)
            macropad.pixels.show()
            splash_index += 1
        if ticks_diff(now, last_splash_text_tick) >= SPLASH_TEXT_INTERVAL_MS:
            last_splash_text_tick = now
            if splash_text_index < 5:
                splash_text_index += 1
                show_normal(["herdr"[:splash_text_index], "", ""], {}, force=True)
            elif splash_text_index == 5:
                splash_text_index = 6
                show_normal(["herdr", "v " + VERSION, ""], {}, force=True)
            else:
                splash_text_index = 7
        if splash_index >= 12 and splash_text_index >= 7:
            splash_active = False
            if pending_render is not None:
                render = pending_render
                pending_render = None
                apply_render(render)
            else:
                macropad.pixels.show()
        return

    if calm and DISPLAY_BRIGHTNESS_SUPPORTED:
        elapsed = ticks_diff(now, last_contrast_tick)
        if elapsed >= CONTRAST_TICK_INTERVAL_MS:
            last_contrast_tick = now
            contrast_phase_ms = (contrast_phase_ms + elapsed) % CONTRAST_PERIOD_MS
            contrast = 0.65 + 0.35 * math.sin(
                contrast_phase_ms * 2 * math.pi / CONTRAST_PERIOD_MS
            )
            macropad.display.brightness = FULL_DISPLAY_BRIGHTNESS * contrast

    if asleep:
        if ticks_diff(now, last_sleep_tick) >= SLEEP_BOUNCE_INTERVAL_MS:
            next_x = sleep_x + sleep_dx
            next_y = sleep_y + sleep_dy
            if next_x < SLEEP_MIN_X or next_x > SLEEP_MAX_X:
                sleep_dx = -sleep_dx
                next_x = sleep_x + sleep_dx
            if next_y < SLEEP_MIN_Y or next_y > SLEEP_MAX_Y:
                sleep_dy = -sleep_dy
                next_y = sleep_y + sleep_dy
            sleep_x, sleep_y = next_x, next_y
            sleep_label.x, sleep_label.y = sleep_x, sleep_y
            last_sleep_tick = now
            macropad.display.refresh()
        return

    elapsed = ticks_diff(now, last_led_tick)
    if elapsed >= LED_TICK_INTERVAL_MS:
        last_led_tick = now
        led_phase_ms = (led_phase_ms + elapsed) % BREATHE_PERIOD_MS
        breathe = 0.65 + 0.35 * math.sin(led_phase_ms * 2 * math.pi / BREATHE_PERIOD_MS)
        blink_on = (led_phase_ms // BLINK_HALF_PERIOD_MS) % 2 == 0
        pixels_changed = False
        for index in range(12):
            if led_fx[index] == "breathe":
                red, green, blue = base_led[index]
                macropad.pixels[index] = (
                    int(red * breathe),
                    int(green * breathe),
                    int(blue * breathe),
                )
                pixels_changed = True
            elif led_fx[index] == "blink" and blink_on != last_blink_on:
                macropad.pixels[index] = base_led[index] if blink_on else (0, 0, 0)
                pixels_changed = True
        if pixels_changed:
            macropad.pixels.show()
        last_blink_on = blink_on


def change_state(next_state):
    global state, splash_active, pending_render, last_blink_on, asleep, shown_display
    if state == "live" and next_state != "live":
        kbd.release_all()  # Host disconnect mid-hold must not leave a modifier stuck.
        splash_active = False
        pending_render = None
        base_led[:] = [(0, 0, 0)] * 12
        led_fx[:] = [None] * 12
        last_blink_on = None
        asleep = False
        shown_display = None
        set_calm(False)
    state = next_state


def send(obj):
    # Fire-and-forget: dropped while disconnected or on write timeout.
    try:
        serial.write((json.dumps(obj) + "\n").encode())
    except Exception:
        pass


def show_mismatch(host_ver):
    show_message(["version mismatch", "deck " + VERSION, "host " + str(host_ver)])


def hello():
    send({"t": "hello", "fw": VERSION})


def play_sound(name):
    if name == "attn":
        macropad.play_tone(ATTN_LOW_HZ, ATTN_NOTE_SECONDS)
        macropad.play_tone(ATTN_HIGH_HZ, ATTN_NOTE_SECONDS)
    elif name == "done":
        macropad.play_tone(DONE_HZ, DONE_NOTE_SECONDS)


def handle(msg):
    global pending_render
    t = msg.get("t")
    if t == "hello":
        host_ver = msg.get("host")
        if host_ver is None or host_ver == VERSION:
            entering_live = state != "live"
            change_state("live")
            if entering_live:
                start_splash()
            if host_ver is None:
                hello()  # identify to a probe only; a versioned hello answered would ping-pong
        else:
            change_state("mismatch")
            show_mismatch(host_ver)
    elif state != "live":
        pass  # fail closed: no commands before a matching hello
    elif t == "render":
        if splash_active:
            pending_render = msg  # Render Snapshots are last-write-wins during the sweep.
        else:
            apply_render(msg)
    elif t == "hid":
        code = getattr(Keycode, msg.get("key", ""), None)
        if code is not None:
            if msg.get("down"):
                kbd.press(code)
            else:
                kbd.release(code)
    elif t == "sound":
        play_sound(msg.get("name"))


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
        latest_render = None
        for raw in reader.feed(serial.read(n)):
            try:
                msg = json.loads(raw)
                if msg.get("t") == "render":
                    latest_render = msg  # Render Snapshots are last-write-wins per read batch.
                else:
                    handle(msg)
            except (AttributeError, ValueError, TypeError):
                pass  # malformed frame: drop line, framing already resynced
        if latest_render is not None:
            handle(latest_render)

    # Poll-sensitive encoder-switch sampling above always precedes OLED animation work.
    tick_animations(supervisor.ticks_ms())
