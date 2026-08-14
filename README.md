# herdr-micro

A physical control deck for a fleet of [Herdr](https://herdr.dev) coding agents. An Adafruit MacroPad RP2040 (the **Deck**) mirrors agent status on its key LEDs and OLED, and routes physical presses to the right agent through a Host daemon on your Mac.

## Setup

### 1. Flash CircuitPython (fresh board only)

Hold the rotary encoder (BOOTSEL), tap reset, keep holding until the
`RPI-RP2` drive appears; drop the
[10.x UF2](https://circuitpython.org/board/adafruit_macropad_rp2040/) onto it.
`CIRCUITPY` mounts when done.

### 2. Download the library bundle

Bundle major version must match the firmware major version (10.x).

```bash
TAG=$(curl -s https://api.github.com/repos/adafruit/Adafruit_CircuitPython_Bundle/releases/latest | sed -n 's/.*"tag_name": "\(.*\)".*/\1/p')
curl -sLo /tmp/bundle.zip "https://github.com/adafruit/Adafruit_CircuitPython_Bundle/releases/download/$TAG/adafruit-circuitpython-bundle-10.x-mpy-$TAG.zip"
unzip -qo /tmp/bundle.zip -d /tmp
```

### 3. Deploy the Device Bundle

Copies libs (before `code.py`), byte-verifies, then waits for you to press
reset and for both serial ports to enumerate:

```bash
./spikes/deploy.sh --libs /tmp/adafruit-circuitpython-bundle-10.x-mpy-$TAG/lib
```

Redeploying code-only changes needs no `--libs` and no reset:
`./spikes/deploy.sh`.

### 4. Run the Host

```bash
bun install
bun dev                        # fleet console against the local Herdr session
bun spikes/serial-fs-spike.ts  # hardware spike: render, HID tap, key/encoder echo
```
