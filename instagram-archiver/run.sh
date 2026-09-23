#!/usr/bin/env bash
set -euo pipefail

# ─── Detect environment: Hassio or local Docker ──────────────────────────────
HASSIO_CONFIG="/data/options.json"
LOCAL_ENV="/app/.env"

if [ -f "$HASSIO_CONFIG" ]; then
  echo "[instagram-archiver] Running on Hassio — reading config from options.json"

  # accounts[] and options → env vars consumed by src/config.ts
  export IA_ACCOUNTS
  IA_ACCOUNTS=$(jq -rc '.accounts // []' "$HASSIO_CONFIG")

  export IA_DISCORD_WEBHOOK_URL
  IA_DISCORD_WEBHOOK_URL=$(jq -r '.discord_webhook_url // empty' "$HASSIO_CONFIG")

  export IA_REQUEST_DELAY_MS
  IA_REQUEST_DELAY_MS=$(jq -r '.request_delay_ms // 1500' "$HASSIO_CONFIG")

  export IA_NOTIFY_EMPTY
  IA_NOTIFY_EMPTY=$(jq -r '.notify_empty // false' "$HASSIO_CONFIG")

  export IA_OUTPUT_DIR
  IA_OUTPUT_DIR=$(jq -r '.output_dir // "/share/instagram"' "$HASSIO_CONFIG")

  export IA_MAX_DOWNLOAD_MB
  IA_MAX_DOWNLOAD_MB=$(jq -r '.max_download_mb // empty' "$HASSIO_CONFIG")

elif [ -f "$LOCAL_ENV" ]; then
  echo "[instagram-archiver] Running locally — reading config from .env"
  while IFS= read -r line; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    [ -z "$line" ] && continue
    export "$line"
  done < "$LOCAL_ENV"
else
  echo "[ERROR] No config found — need /data/options.json (Hassio) or /app/.env (local)" >&2
  exit 1
fi

# ─── Runner selection ────────────────────────────────────────────────────────
# Prefer the pre-built, self-contained bundle (plain node — lowest memory).
# Fall back to tsx only for local source-tree development.
if [ -f "/app/dist/index.mjs" ]; then
  ENTRY="/app/dist/index.mjs"
  RUNNER="node"
elif [ -f "/app/src/index.ts" ]; then
  ENTRY="/app/src/index.ts"
  RUNNER="npx tsx"
else
  echo "[ERROR] No entrypoint found (dist/index.mjs or src/index.ts)" >&2
  exit 1
fi

echo "[instagram-archiver] Starting one archive pass…"
exec $RUNNER "$ENTRY"
