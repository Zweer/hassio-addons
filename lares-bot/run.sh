#!/usr/bin/env bash
set -euo pipefail

# ─── Read HA addon options ───────────────────────────────────────────────────
CONFIG_PATH="/data/options.json"

if [ ! -f "$CONFIG_PATH" ]; then
  echo "[ERROR] Config file not found: $CONFIG_PATH" >&2
  exit 1
fi

GITHUB_PAT=$(jq -r '.github_pat // empty' "$CONFIG_PATH")

export LARES_API_URL
LARES_API_URL=$(jq -r '.lares_api_url // empty' "$CONFIG_PATH")

export LARES_TOKEN
LARES_TOKEN=$(jq -r '.lares_token // empty' "$CONFIG_PATH")

export LARES_VILLAGE_ID
LARES_VILLAGE_ID=$(jq -r '.lares_village_id // empty' "$CONFIG_PATH")

export LARES_POLL_INTERVAL
LARES_POLL_INTERVAL=$(jq -r '.lares_poll_interval' "$CONFIG_PATH")

DISCORD_WEBHOOK_URL=$(jq -r '.discord_webhook_url // empty' "$CONFIG_PATH")
if [ -n "$DISCORD_WEBHOOK_URL" ]; then
  export DISCORD_WEBHOOK_URL
fi

export MQTT_HOST
MQTT_HOST=$(jq -r '.mqtt_host // empty' "$CONFIG_PATH")

export MQTT_PORT
MQTT_PORT=$(jq -r '.mqtt_port' "$CONFIG_PATH")

export MQTT_USER
MQTT_USER=$(jq -r '.mqtt_user // empty' "$CONFIG_PATH")

export MQTT_PASSWORD
MQTT_PASSWORD=$(jq -r '.mqtt_password // empty' "$CONFIG_PATH")

# ─── Clone & build (every start — always fresh) ──────────────────────────────
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

npx tsdown --no-dts
echo "[lares-bot] ✓ Bundle created"

# Cleanup to save space
rm -rf node_modules .git /data/vanilla-studio/.git
echo "[lares-bot] Build complete!"

# ─── Start the bot ───────────────────────────────────────────────────────────
echo "[lares-bot] Starting — village=${LARES_VILLAGE_ID} poll=${LARES_POLL_INTERVAL}s"
exec node /data/lares-bot/dist/index.mjs
