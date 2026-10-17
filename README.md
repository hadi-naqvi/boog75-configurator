# BOOG75 Configurator

An unofficial, self-hostable configurator for the **Meletrix BOOG75** hall-effect
keyboard. It replaces `boog75.meletrix.com`: it talks to the keyboard over
WebHID using the same USB protocol as the official tool. It works offline and
on Linux, and needs no Meletrix servers, account, build step or dependencies.
Nord-themed, with dark and light modes.

> Not affiliated with Meletrix. Configuration only; it never flashes firmware.
> Every frame it sends is byte-identical to what the official tool sends for the
> same settings (see [Tests](#tests)), but use it at your own risk.

## Quick start

**Locally, no Docker:**

```bash
./start.sh        # serves on http://127.0.0.1:8075 and opens your default browser
```

**With Docker Compose** (builds the image from this repo):

```bash
docker compose up -d --build     # http://localhost:8075
```

Open it in a **Chromium-based browser** (Chrome, Chromium, Edge, Brave), then
click **Connect**. Firefox and Safari have no WebHID.

### Linux: one-time permission

Browsers need access to the keyboard's configuration interface (normal typing is unaffected):

```bash
sudo cp udev/70-boog75.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules && sudo udevadm trigger   # then replug the keyboard
```

## Docker image

The `Dockerfile` produces a small static-site image:

| | |
|---|---|
| Base | `nginxinc/nginx-unprivileged` (Alpine) |
| Port | `8080` |
| User | `101` (non-root) |
| Health check | `GET /healthz` |
| Filesystem | runs with `read_only: true` plus a tmpfs on `/tmp` |
| Headers | strict CSP, `Permissions-Policy: hid=(self)`, no-cache so updates show up immediately |

Build and push it yourself to any registry:

```bash
docker build -t <registry>/<you>/boog75-config:1.1.0 -t <registry>/<you>/boog75-config:latest .
docker push --all-tags <registry>/<you>/boog75-config
```

Minimal service definition for a server:

```yaml
services:
  boog75-config:
    image: <registry>/<you>/boog75-config:latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:8075:8080"
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
```

### HTTPS is required for remote access

Browsers only allow WebHID on secure pages: `https://…` or `http://localhost`.
Opening `http://server-ip:8075` shows an error banner and can't connect. Use one of:

* **Reverse proxy with a certificate**, e.g. Caddy:
  ```
  boog75.example.com {
      reverse_proxy 127.0.0.1:8075
  }
  ```
  With Traefik or nginx-proxy, put the container on the proxy's network,
  route to port `8080`, and drop the `ports:` mapping.
* **Tailscale:** `tailscale serve --bg 8075`.
* **SSH tunnel:** `ssh -L 8075:127.0.0.1:8075 your-server`, then open `http://localhost:8075`.

The server only serves files. The keyboard talks to **your browser**, so plug
it into the computer you browse from. Profiles are stored in each browser's
local storage; use *Profile ⋯ → Export* for backups or to move them.

If the page loads forever while a VPN is active, the VPN may be capturing
Docker's network range. Allow LAN traffic in the VPN or give the compose
network a different subnet.

## Features

| Area | What you can do |
|---|---|
| Keymap | All 4 layers (Base, Fn, Fn+Shift, Fn+Shift+Alt), searchable keycode picker, macros on any key, copy one layer onto another, press a physical key to select it |
| Actuation | Per-key press/release stroke 0.1–4.0 mm (Rapid Trigger), presets, click/drag/keyboard selection, toggle (TGL) keys |
| Advanced keys | Dynamic Keystroke (4 bindings × 4 stages, start/end points), Mod-Tap (tap/hold, hold time), up to 20 |
| SOCD | Rappy Snappy or Snappy Tappy (priority modes, both-fully-pressed behaviour) |
| Macros | Up to 40, 60 steps each, recorder, per-step delays, run modes (N times / while held / toggle), duplicate, read back from the keyboard |
| Lighting | On/off, 9 effects (+7 extra firmware effects), brightness, speed, 7 colour slots, read back from the keyboard |
| Profiles | Unlimited local profiles, undo/redo, JSON export/import, **imports exports from the official site** |
| Safety | Only changed settings are written; one frame at a time with timeouts; strict range checks; dry-run mode; USB protocol log |

Shortcuts: `Ctrl+S` apply · `Ctrl+Z` undo · `Ctrl+Shift+Z` / `Ctrl+Y` redo · `Esc` cancel.

## Things to know

* **Keymap and actuation can't be read back from the keyboard.** The official
  tool has the same limitation: it only remembers what it wrote. This tool
  records what it last wrote and only sends differences. If you change settings
  elsewhere (official site, another computer), use *Device → Forget keyboard
  state* or *Write entire profile*. Lighting, macros and the firmware version
  **can** be read.
* To keep an existing setup, export it from the official site and import the JSON here.
* Firmware older than V28 uses an older frame format for advanced keys and
  macros, which the tool picks automatically. Per Meletrix's changelog, DKS,
  Snappy Tappy and Rappy Snappy arrived in V29, and V30 fixed macros and
  F13–F24 remapping, so those may not work on older firmware.
* Firmware updates need Meletrix's own updater. Check that the file really is
  BOOG75 / ZOOM75 HE firmware: Zoom75 Tiga firmware is offered nearby and is for
  a different keyboard.

## Development

No build step: edit the files and reload the page.

```
index.html          page shell
css/style.css       Nord theme (dark + light)
js/keycodes.js      keycodes (Windows VK numbers) and picker categories
js/layout.js        physical layout and factory keymaps
js/protocol.js      pure frame encoders/decoders
js/profile.js       profile model, validation, official-export import, sync diff
js/device.js        WebHID transport (serialized queue, timeouts)
js/app.js           UI
tests/              Node unit tests, recorded protocol fixtures, headless browser test
udev/               Linux permission rule
Dockerfile, nginx.conf, docker-compose.yml
```

Releases: bump `version` in `package.json`, `APP_VERSION` in `js/app.js` and the label in `Dockerfile`.

### Tests

```bash
npm test                  # node --test tests/   (protocol, profiles, transport, layout; Node ≥ 18)
tests/run-ui-test.sh      # headless end-to-end UI test against a fake keyboard (needs a Chromium-based browser)
```

`tests/fixtures/official-frames.json` holds 700+ test vectors: inputs and the
exact USB frames the official configurator produces for them, covering every
command type on current (≥ V28) and legacy firmware. The protocol tests require
byte-identical output. The fixtures are recorded data only; this repository
contains no code from the official tool. The UI test runs three
scenarios (V30, V22, browser without WebHID) against a fake keyboard,
including failed and stalled writes.

## Fixes over the official tool

* Writes are queued and awaited one frame at a time, with timeouts. The
  official tool fires every report at once, and rebuilds macro data in
  variables that React resets on every render.
* Deleting a Snappy Tappy pair clears the right slot. The official tool clears
  the Rappy Snappy slot instead, and vice versa.
* Switching between Rappy Snappy and Snappy Tappy clears the old pair first.
* Every byte is range-checked before it's sent.

## Protocol summary

The protocol was worked out, for interoperability, by observing what the
official web app sends and from the keyboard's HID descriptor. This
implementation was written from scratch. Vendor interface: usage page `0xFF01`, no report ID,
64-byte reports, USB IDs `36b5:2f8f`.

Frame: `[00, cmd, 00, len, sub, data…, checksum]`, zero-padded to 64 bytes.
The checksum sits right after the payload, and all bytes up to it sum to `0x55`.

| cmd | Direction | Purpose |
|---|---|---|
| `0x02` | → / ← | firmware version (`[4]\|[5]<<4` device, `[9]` protocol, `[10]\|[11]<<4` hall MCU) |
| `0x18` / `0x19` | → / ↔ | set / get lighting |
| `0x5A` | → | base-layer keymap, 3 chunks × 29 keys (`sub=0x30+n`, pairs `vk, ext`) |
| `0x1C` | → | single key on Fn layer 1–3 (`layer, idx, vk, ext`) |
| `0x70` | → | per-key `idx, mode (2 normal / 4 toggle), make, break` (0.1 mm), 6 chunks |
| `0x60` | → | macros (`sub=0x40+n`) and, on firmware ≥ V28, DKS/MT definitions |
| `0x34` | → | SOCD pairs (mode 1 = Snappy Tappy, 2 = Rappy Snappy); DKS/MT on firmware < V28 |
| `0x61` | ↔ | read macro (4 chunks) |
| `0x05` | ← | ack |

Keycodes are Windows virtual-key codes; `0x98` = macro (ext = macro id),
`0xDA` = advanced key (ext = id). See `js/protocol.js` for the full encoding.

## License

[MIT](LICENSE). "Meletrix", "BOOG75" and "Zoom75" are trademarks of their
respective owners and are used here only to describe compatibility.
