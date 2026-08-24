#!/usr/bin/env bash
set -euo pipefail

# ─── Read HA addon options ───────────────────────────────────────────────────
CONFIG_PATH="/data/options.json"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "[ERROR] Config file not found: $CONFIG_PATH" >&2
  exit 1
fi

GITHUB_PAT=$(jq -r '.github_pat' "$CONFIG_PATH")

export LARES_API_URL
LARES_API_URL=$(jq -r '.lares_api_url' "$CONFIG_PATH")

export LARES_TOKEN
LARES_TOKEN=$(jq -r '.lares_token' "$CONFIG_PATH")

export LARES_VILLAGE_ID
LARES_VILLAGE_ID=$(jq -r '.lares_village_id' "$CONFIG_PATH")

export LARES_POLL_INTERVAL
LARES_POLL_INTERVAL=$(jq -r '.lares_poll_interval' "$CONFIG_PATH")

DISCORD_WEBHOOK_URL=$(jq -r '.discord_webhook_url // empty' "$CONFIG_PATH")
if [ -n "$DISCORD_WEBHOOK_URL" ]; then
  export DISCORD_WEBHOOK_URL
fi

export MQTT_HOST
MQTT_HOST=$(jq -r '.mqtt_host' "$CONFIG_PATH")

export MQTT_PORT
MQTT_PORT=$(jq -r '.mqtt_port' "$CONFIG_PATH")

export MQTT_USER
MQTT_USER=$(jq -r '.mqtt_user' "$CONFIG_PATH")

export MQTT_PASSWORD
MQTT_PASSWORD=$(jq -r '.mqtt_password' "$CONFIG_PATH")

# ─── Build function ──────────────────────────────────────────────────────────
build_bot() {
  echo "[lares-bot] Cloning and building..."

  cd /data
  rm -rf lares-bot vanilla-studio

  git clone --depth 1 "https://x-access-token:${GITHUB_PAT}@github.com/vanilla-studio/lares.git" vanilla-studio/lares
  git clone --depth 1 "https://x-access-token:${GITHUB_PAT}@github.com/Zweer/lares-bot.git" lares-bot

  cd /data/lares-bot
  npm ci
  npx tsdown --no-dts

  # Cleanup to save space
  rm -rf node_modules .git /data/vanilla-studio/.git

  date > /data/.built
  echo "[lares-bot] Build complete!"
}

# ─── Build if needed ─────────────────────────────────────────────────────────
if [ ! -f /data/.built ]; then
  build_bot
fi

# ─── Listen for stdin commands (rebuild, etc.) ────────────────────────────────
listen_stdin() {
  while read -r line; do
    cmd=$(echo "$line" | jq -r '.command // empty' 2>/dev/null || echo "")
    case "$cmd" in
      rebuild)
        echo "[lares-bot] Rebuild requested via stdin..."
        rm -f /data/.built
        build_bot
        # Restart the bot
        kill "$BOT_PID" 2>/dev/null || true
        start_bot
        ;;
      *)
        echo "[lares-bot] Unknown command: $line"
        ;;
    esac
  done
}

# ─── Start the bot ───────────────────────────────────────────────────────────
start_bot() {
  echo "[lares-bot] Starting — village=${LARES_VILLAGE_ID} poll=${LARES_POLL_INTERVAL}s"
  node /data/lares-bot/dist/index.mjs &
  BOT_PID=$!
}

start_bot
listen_stdin &

# Wait for bot process; restart if it crashes
while true; do
  wait "$BOT_PID" || true
  echo "[lares-bot] Bot exited, restarting in 5s..."
  sleep 5
  start_bot
done
