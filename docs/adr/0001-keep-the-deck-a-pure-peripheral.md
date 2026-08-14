# Keep the Deck a pure peripheral

The Deck reports raw key and encoder input and performs explicit output commands supplied by the Host: Render Snapshots and USB HID key chords. It owns no fleet logic, agent mapping, Key Alias configuration, or other durable configuration; herdr-micro owns the entire Device Bundle. This keeps Herdr integration and user configuration on the Mac, prevents host/device configuration drift, avoids macOS Accessibility permissions for Key Aliases, and makes reconnect recovery a full-state resynchronization.
