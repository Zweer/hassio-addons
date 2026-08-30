#!/usr/bin/env bash
set -euo pipefail

# ─── Detect environment: Hassio or local Docker ──────────────────────────────
HASSIO_CONFIG="/data/options.json"
LOCAL_ENV="/app/.env"

if [ -f "$HASSIO_CONFIG" ]; then
  echo "[lares-bot] Running on Hassio — reading config from options.json"

  GITHUB_PAT=$(jq -r '.github_pat // empty' "$HASSIO_CONFIG")

  export LARES_API_URL
  LARES_API_URL=$(jq -r '.lares_api_url // empty' "$HASSIO_CONFIG")

  export LARES_TOKEN
  LARES_TOKEN=$(jq -r '.lares_token // empty' "$HASSIO_CONFIG")

  export LARES_VILLAGE_ID
  LARES_VILLAGE_ID=$(jq -r '.lares_village_id // empty' "$HASSIO_CONFIG")

  export LARES_POLL_INTERVAL
  LARES_POLL_INTERVAL=$(jq -r '.lares_poll_interval' "$HASSIO_CONFIG")

  DISCORD_WEBHOOK_URL=$(jq -r '.discord_webhook_url // empty' "$HASSIO_CONFIG")
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    export DISCORD_WEBHOOK_URL
  fi

  export MQTT_HOST
  MQTT_HOST=$(jq -r '.mqtt_host // empty' "$HASSIO_CONFIG")

  export MQTT_PORT
  MQTT_PORT=$(jq -r '.mqtt_port' "$HASSIO_CONFIG")

  export MQTT_USER
  MQTT_USER=$(jq -r '.mqtt_user // empty' "$HASSIO_CONFIG")

  export MQTT_PASSWORD
  MQTT_PASSWORD=$(jq -r '.mqtt_password // empty' "$HASSIO_CONFIG")

elif [ -f "$LOCAL_ENV" ]; then
  echo "[lares-bot] Running locally — reading config from .env"

  # Source .env (skip comments and empty lines)
  while IFS= read -r line; do
    line="${line%%#*}"          # strip comments
    line="${line#"${line%%[![:space:]]*}"}"  # trim leading whitespace
    [ -z "$line" ] && continue
    export "$line"
  done < "$LOCAL_ENV"

  GITHUB_PAT="${GITHUB_PAT:-}"
else
  echo "[ERROR] No config found — need /data/options.json (Hassio) or /app/.env (local)" >&2
  exit 1
fi

# ─── Clone & build (every start — always fresh) ──────────────────────────────
if [ -n "$GITHUB_PAT" ]; then
  echo "[lares-bot] Cloning and building..."

  cd /data
  rm -rf lares-bot vanilla-studio

  git clone --depth 1 "https://x-access-token:${GITHUB_PAT}@github.com/vanilla-studio/lares.git" vanilla-studio/lares
  echo "[lares-bot] ✓ Cloned vanilla-studio/lares"

  git clone --depth 1 "https://x-access-token:${GITHUB_PAT}@github.com/Zweer/lares-bot.git" lares-bot
  echo "[lares-bot] ✓ Cloned Zweer/lares-bot"

  cd /data/lares-bot
  npm ci
  echo "[lares-bot] ✓ Dependencies installed"

  rm -rf .git /data/vanilla-studio/.git
  echo "[lares-bot] Build complete!"

  ENTRY="/data/lares-bot/src/index.ts"
  RUNNER="npx tsx"
elif [ -f "/app/src/index.ts" ]; then
  echo "[lares-bot] Using local source from /app/src"
  ENTRY="/app/src/index.ts"
  RUNNER="npx tsx"
elif [ -f "/app/dist/index.mjs" ]; then
  echo "[lares-bot] Using pre-built bundle from /app/dist"
  ENTRY="/app/dist/index.mjs"
  RUNNER="node"
else
  echo "[ERROR] No GITHUB_PAT and no pre-built bundle found" >&2
  exit 1
fi

# ─── Start the bot ───────────────────────────────────────────────────────────
echo "[lares-bot] Starting — village=${LARES_VILLAGE_ID:-unknown} poll=${LARES_POLL_INTERVAL:-20}s"
exec $RUNNER "$ENTRY"
