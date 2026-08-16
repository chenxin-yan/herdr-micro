export const DEVICE_MANIFEST = {
  circuitPython: {
    version: "10.2.1",
    boardId: "adafruit_macropad_rp2040",
    url: "https://downloads.circuitpython.org/bin/adafruit_macropad_rp2040/en_US/adafruit-circuitpython-adafruit_macropad_rp2040-en_US-10.2.1.uf2",
    sha256: "96a757c2e1c7c4718565bf2eb9cd76394a509f32c46621e669a5e5ac26887a78",
  },
  bundle: {
    tag: "20260803",
    url: "https://github.com/adafruit/Adafruit_CircuitPython_Bundle/releases/download/20260803/adafruit-circuitpython-bundle-10.x-mpy-20260803.zip",
    sha256: "020c5069d1fde70ad18ca31e70b859b21df69967d45786275f0d99c6eb81140e",
    root: "adafruit-circuitpython-bundle-10.x-mpy-20260803",
  },
  libraries: [
    "adafruit_macropad.mpy",
    "adafruit_debouncer.mpy",
    "adafruit_ticks.mpy",
    "adafruit_simple_text_display.mpy",
    "neopixel.mpy",
    "adafruit_display_text",
    "adafruit_hid",
    "adafruit_midi",
  ],
  deviceFiles: ["version.py", "boot.py", "protocol.py", "code.py"],
} as const;

export type DeviceLibrary = (typeof DEVICE_MANIFEST.libraries)[number];
