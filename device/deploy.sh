#!/usr/bin/env bash
# Development-only Device Bundle deploy; end users run `herdr-micro setup`.
# Deploy the Device Bundle to CIRCUITPY and verify.
# Usage: device/deploy.sh [--libs <bundle-lib-dir>]
#   --libs  path to an extracted Adafruit 10.x bundle's lib/ (skips lib copy if omitted
#           and libs are already on the board)
# After copy: press the Deck's reset button; the script waits for two data ports.
set -euo pipefail

cd "$(dirname "$0")"

LIB_SRC=""
if [[ "${1:-}" == "--libs" ]]; then
  LIB_SRC="${2:?--libs needs a path}"
fi

# Exactly one CIRCUITPY volume (ticket-05 rule: reject zero or multiple).
mapfile -t vols < <(ls -d /Volumes/CIRCUITPY* 2>/dev/null || true)
if [[ ${#vols[@]} -eq 0 ]]; then
  echo "error: no CIRCUITPY volume mounted" >&2
  exit 1
elif [[ ${#vols[@]} -gt 1 ]]; then
  echo "error: multiple CIRCUITPY volumes: ${vols[*]}" >&2
  exit 1
fi
DEST="${vols[0]}"
echo "deploying to $DEST"

LIBS=(adafruit_macropad.mpy adafruit_debouncer.mpy adafruit_ticks.mpy
  adafruit_simple_text_display.mpy neopixel.mpy
  adafruit_display_text adafruit_hid adafruit_midi)

# Libs before code.py so a mid-copy reset never runs code.py against missing imports.
if [[ -n "$LIB_SRC" ]]; then
  echo "copying libs from $LIB_SRC (slow: FAT over USB)…"
  mkdir -p "$DEST/lib"
  for lib in "${LIBS[@]}"; do
    rsync -r --exclude '._*' "$LIB_SRC/$lib" "$DEST/lib/"
    echo "  $lib"
  done
fi

# Single source of truth for the app version: package.json, stamped onto the device.
VERSION=$(sed -n 's/.*"version": "\(.*\)".*/\1/p' ../package.json | head -1)
[[ -n "$VERSION" ]] || { echo "error: no version in package.json" >&2; exit 1; }
printf 'VERSION = "%s"\n' "$VERSION" > "$DEST/version.py"

cp boot.py "$DEST/boot.py"
cp protocol.py "$DEST/protocol.py"
cp code.py "$DEST/code.py"
sync
echo "copied boot.py + protocol.py + code.py (version $VERSION)"

# Verify: files present, libs present.
fail=0
for f in boot.py protocol.py code.py; do
  cmp -s "$f" "$DEST/$f" || { echo "verify FAIL: $f differs on device" >&2; fail=1; }
done
grep -q "\"$VERSION\"" "$DEST/version.py" || { echo "verify FAIL: version.py" >&2; fail=1; }
for lib in "${LIBS[@]}"; do
  [[ -e "$DEST/lib/$lib" ]] || { echo "verify FAIL: lib/$lib missing" >&2; fail=1; }
done
[[ $fail -eq 0 ]] || exit 1
echo "verify OK: files on device"

echo
echo ">>> Press the Deck's reset button now (boot.py needs it). Waiting for two ports…"
for _ in $(seq 60); do
  n=$(ls /dev/cu.usbmodem* 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$n" -ge 2 ]]; then
    echo "verify OK: $n ports:"
    ls /dev/cu.usbmodem*
    exit 0
  fi
  sleep 1
done
echo "verify FAIL: two /dev/cu.usbmodem* ports did not appear within 60s" >&2
exit 1
