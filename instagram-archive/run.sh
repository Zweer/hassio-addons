#!/usr/bin/env bash
set -euo pipefail

# ─── Config: Hassio (options.json) or local Docker (.env) ────────────────────
HASSIO_CONFIG="/data/options.json"
LOCAL_ENV="/app/.env"

read_hassio() {
  echo "[instagram-archive] Running on Hassio — reading options.json"

  # accounts is a list in HA schema — join into comma-separated string.
  export IG_ACCOUNTS
  IG_ACCOUNTS=$(jq -r '(.accounts // []) | join(",")' "$HASSIO_CONFIG")

  export IG_USERNAME
  IG_USERNAME=$(jq -r '.ig_username // empty' "$HASSIO_CONFIG")

  export IG_PASSWORD
  IG_PASSWORD=$(jq -r '.ig_password // empty' "$HASSIO_CONFIG")

  export DISCORD_WEBHOOK
  DISCORD_WEBHOOK=$(jq -r '.discord_webhook // empty' "$HASSIO_CONFIG")

  export CHALLENGE_TIMEOUT
  CHALLENGE_TIMEOUT=$(jq -r '.challenge_timeout // 180' "$HASSIO_CONFIG")

  export BACKFILL_BATCH_SIZE
  BACKFILL_BATCH_SIZE=$(jq -r '.backfill_batch_size // 30' "$HASSIO_CONFIG")

  export RANDOMIZE_DELAY
  RANDOMIZE_DELAY=$(jq -r '.randomize_delay // true' "$HASSIO_CONFIG")

  export NOVNC_PASSWORD
  NOVNC_PASSWORD=$(jq -r '.novnc_password // empty' "$HASSIO_CONFIG")
}

read_local() {
  echo "[instagram-archive] Running locally — reading .env"
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    export "$line"
  done < "$LOCAL_ENV"
}

if [ -f "$HASSIO_CONFIG" ]; then
  read_hassio
elif [ -f "$LOCAL_ENV" ]; then
  read_local
else
  echo "[ERROR] No config found — need /data/options.json (Hassio) or /app/.env (local)" >&2
  exit 1
fi

export OUTPUT_DIR="${OUTPUT_DIR:-/share/instagram}"
export DATA_DIR="${DATA_DIR:-/data}"
export DISPLAY="${DISPLAY:-:99}"

mkdir -p "$OUTPUT_DIR"

# ─── Virtual display + VNC + noVNC (for challenge solving) ────────────────────
VNC_PORT=5900
NOVNC_PORT=6080
SCREEN_GEOMETRY="1280x900x24"

cleanup() {
  echo "[instagram-archive] Cleaning up display stack..."
  [ -n "${WEBSOCKIFY_PID:-}" ] && kill "$WEBSOCKIFY_PID" 2>/dev/null || true
  [ -n "${X11VNC_PID:-}" ] && kill "$X11VNC_PID" 2>/dev/null || true
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[instagram-archive] Starting Xvfb on ${DISPLAY} (${SCREEN_GEOMETRY})..."
Xvfb "$DISPLAY" -screen 0 "$SCREEN_GEOMETRY" -ac +extension GLX +render -noreset &
XVFB_PID=$!

# Wait for the X server to be ready.
for _ in $(seq 1 30); do
  if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then break; fi
  sleep 0.3
done

echo "[instagram-archive] Starting x11vnc on :${VNC_PORT}..."
X11VNC_AUTH_ARGS=(-nopw)
if [ -n "${NOVNC_PASSWORD:-}" ]; then
  VNC_PASSWD_FILE="/data/.vncpasswd"
  x11vnc -storepasswd "$NOVNC_PASSWORD" "$VNC_PASSWD_FILE" >/dev/null 2>&1
  X11VNC_AUTH_ARGS=(-rfbauth "$VNC_PASSWD_FILE")
  echo "[instagram-archive] noVNC password protection enabled."
fi
x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -forever -shared "${X11VNC_AUTH_ARGS[@]}" -quiet &
X11VNC_PID=$!

# noVNC via websockify. HA ingress proxies to this port.
# novnc ships its web assets under /usr/share/novnc.
NOVNC_WEB="/usr/share/novnc"
echo "[instagram-archive] Starting noVNC (websockify) on :${NOVNC_PORT} → localhost:${VNC_PORT}..."
websockify --web "$NOVNC_WEB" "$NOVNC_PORT" "localhost:${VNC_PORT}" >/dev/null 2>&1 &
WEBSOCKIFY_PID=$!

echo "[instagram-archive] noVNC available via ingress. Solve challenges there if prompted."

# ─── Run the scraper (run-once) ──────────────────────────────────────────────
cd /app

if [ -f "/app/src/index.ts" ]; then
  RUNNER="npx tsx"
  ENTRY="/app/src/index.ts"
else
  echo "[ERROR] Scraper source not found at /app/src/index.ts" >&2
  exit 1
fi

echo "[instagram-archive] Starting scrape run..."
set +e
$RUNNER "$ENTRY"
SCRAPER_EXIT=$?
set -e

echo "[instagram-archive] Scrape run finished with exit code ${SCRAPER_EXIT}."
# cleanup() runs on EXIT.
exit "$SCRAPER_EXIT"
