#!/usr/bin/env bash
# Headless end-to-end UI test against a fake keyboard (no hardware needed).
# Runs three scenarios: normal (V30), legacy firmware (V22) and a browser without WebHID.
# Usage: tests/run-ui-test.sh        (needs a Chromium-based browser; set BROWSER=... to choose)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BROWSER="${BROWSER:-$(command -v chromium || command -v chromium-browser || command -v google-chrome || command -v google-chrome-stable || command -v brave-browser || command -v microsoft-edge || true)}"
[ -n "$BROWSER" ] || { echo "No Chromium-based browser found (set BROWSER=...)"; exit 2; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/boog75-ui.XXXXXX")"
PID=""
cleanup() { [ -n "$PID" ] && kill "$PID" 2>/dev/null; sleep 0.3; [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

# Same page as index.html, minus the CSP, with the fake device injected first.
sed -e '/Content-Security-Policy/d' \
    -e "s#href=\"css/#href=\"file://$ROOT/css/#" \
    -e "s#href=\"favicon#href=\"file://$ROOT/favicon#" \
    -e "s#src=\"favicon#src=\"file://$ROOT/favicon#" \
    -e "s#src=\"js/#src=\"file://$ROOT/js/#" \
    -e "s#<script src=\"file://$ROOT/js/keycodes.js\"></script>#<script src=\"file://$ROOT/tests/ui-mock.js\"></script>\n  &#" \
    -e "s#</body>#  <script src=\"file://$ROOT/tests/ui-scenario.js\"></script>\n</body>#" \
    "$ROOT/index.html" > "$WORK/harness.html"

FAILED=0
for QUERY in "" "?fw=22" "?nohid"; do
  LOG="$WORK/log$RANDOM.txt"
  echo "== scenario ${QUERY:-main}"
  "$BROWSER" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$WORK/profile$RANDOM" --allow-file-access-from-files --window-size=1600,1200 \
    --enable-logging=stderr --v=0 "file://$WORK/harness.html$QUERY" >"$LOG" 2>&1 &
  PID=$!
  for _ in $(seq 1 200); do            # up to 100 s
    grep -q 'UI-TEST-RESULT' "$LOG" 2>/dev/null && break
    kill -0 "$PID" 2>/dev/null || break
    sleep 0.5
  done
  kill "$PID" 2>/dev/null; sleep 0.3; kill -9 "$PID" 2>/dev/null; PID=""
  python3 -I - "$LOG" <<'EOF' || FAILED=1
import json, sys
log = open(sys.argv[1], errors="replace").read()
i = log.find("UI-TEST-RESULT ")
if i < 0:
    print("No result from the browser. Last log lines:\n" + "\n".join(log.splitlines()[-25:]))
    sys.exit(1)
line = log[i + len("UI-TEST-RESULT "):].split("\n")[0]
j = line.rfind('", source:')
data = json.loads(line[:j] if j >= 0 else line)
res = data["results"]
bad = [r for r in res if not r["ok"]]
for r in res:
    print(("  PASS " if r["ok"] else "  FAIL ") + r["name"] + ("" if r["ok"] else f"\n       -> {r.get('extra')}"))
print(f"  {len(res) - len(bad)}/{len(res)} passed\n")
sys.exit(1 if bad else 0)
EOF
done
[ "$FAILED" = 0 ] && echo "All UI scenarios passed." || echo "Some UI checks FAILED."
exit $FAILED
