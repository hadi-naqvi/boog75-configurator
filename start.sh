#!/usr/bin/env bash
# Serve the configurator on http://127.0.0.1:8075 (local only) and open it in
# the default browser. WebHID needs a Chromium-based browser (Chrome,
# Chromium, Edge, Brave); Firefox and Safari can't talk to the keyboard.
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-8075}"
URL="http://127.0.0.1:$PORT/"

if ! grep -qs '36b5' /etc/udev/rules.d/*.rules /lib/udev/rules.d/*.rules /usr/lib/udev/rules.d/*.rules 2>/dev/null; then
  echo "Note: no udev rule for the BOOG75 found. If the browser can't connect, run:"
  echo "  sudo cp udev/70-boog75.rules /etc/udev/rules.d/ && sudo udevadm control --reload-rules && sudo udevadm trigger"
  echo
fi

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT INT TERM

# Wait until the server answers (up to ~3 s).
for _ in $(seq 1 30); do
  python3 -c "import urllib.request,sys; urllib.request.urlopen(sys.argv[1], timeout=0.2)" "$URL" 2>/dev/null && break
  kill -0 "$SERVER" 2>/dev/null || { echo "Could not start the web server (is port $PORT in use? try PORT=8076 $0)"; exit 1; }
  sleep 0.1
done

if command -v xdg-open >/dev/null; then xdg-open "$URL" >/dev/null 2>&1 &
elif command -v open >/dev/null; then open "$URL"
fi

echo "BOOG75 Configurator running at $URL  (Ctrl+C to stop)"
echo "If your default browser isn't Chromium-based, open that address in Chrome/Chromium/Edge/Brave."
wait $SERVER
