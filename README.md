# herdr-micro

A physical control deck for a fleet of [Herdr](https://herdr.dev) coding agents. An Adafruit MacroPad RP2040 (the **Deck**) mirrors agent status on its key LEDs and OLED, and routes physical presses to the right agent through a Host daemon on your Mac.

## Board setup (fresh board)

1. **Install CircuitPython** — hold the rotary encoder (BOOTSEL), tap
   reset, and keep holding until the `RPI-RP2` drive appears; drop the
   [UF2](https://circuitpython.org/board/adafruit_macropad_rp2040/) onto it.
   `CIRCUITPY` mounts when done.
2. **Add libraries** — copy the needed `.mpy` libs from the **10.x**
   [library bundle](https://circuitpython.org/libraries) into `CIRCUITPY/lib/`
   (bundle major version must match the firmware major version).
3. **Deploy** — `code.py` at the drive root runs on boot; `boot.py` changes
   need a press of the reset button.
