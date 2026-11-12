#!/usr/bin/env bash
set -euo pipefail

# ─── Detect environment: Hassio or local Docker ──────────────────────────────
HASSIO_CONFIG="/data/options.json"
LOCAL_ENV="/app/.env"

if [ -f "$HASSIO_CONFIG" ]; then
  echo "[social-archiver] Running on Hassio — reading config from options.json"

  # instagram.accounts[] → SA_INSTAGRAM_ACCOUNTS (JSON array string)
  export SA_INSTAGRAM_ACCOUNTS
  SA_INSTAGRAM_ACCOUNTS=$(jq -rc '.instagram.accounts // []' "$HASSIO_CONFIG")

  # pinterest.* → SA_PINTEREST_*
  export SA_PINTEREST_QUERIES
  SA_PINTEREST_QUERIES=$(jq -rc '.pinterest.queries // []' "$HASSIO_CONFIG")

  export SA_PINTEREST_DEPTH
  SA_PINTEREST_DEPTH=$(jq -r '.pinterest.depth // 1' "$HASSIO_CONFIG")

  export SA_PINTEREST_MAX_IMAGES
  SA_PINTEREST_MAX_IMAGES=$(jq -r '.pinterest.max_images // 50' "$HASSIO_CONFIG")

  export SA_PINTEREST_MAX_QUERIES
  SA_PINTEREST_MAX_QUERIES=$(jq -r '.pinterest.max_queries // empty' "$HASSIO_CONFIG")

  # shared options
  export SA_DISCORD_WEBHOOK_URL
  SA_DISCORD_WEBHOOK_URL=$(jq -r '.discord_webhook_url // empty' "$HASSIO_CONFIG")

  export SA_REQUEST_DELAY_MS
  SA_REQUEST_DELAY_MS=$(jq -r '.request_delay_ms // 1500' "$HASSIO_CONFIG")

  export SA_NOTIFY_EMPTY
  SA_NOTIFY_EMPTY=$(jq -r '.notify_empty // false' "$HASSIO_CONFIG")

  export SA_OUTPUT_DIR
  SA_OUTPUT_DIR=$(jq -r '.output_dir // "/share/social-archiver"' "$HASSIO_CONFIG")

  export SA_MAX_DOWNLOAD_MB
  SA_MAX_DOWNLOAD_MB=$(jq -r '.max_download_mb // empty' "$HASSIO_CONFIG")

  export SA_BYPARR_URL
  SA_BYPARR_URL=$(jq -r '.byparr_url // empty' "$HASSIO_CONFIG")

  export SA_BYPARR_TIMEOUT_MS
  SA_BYPARR_TIMEOUT_MS=$(jq -r '.byparr_timeout_ms // empty' "$HASSIO_CONFIG")

elif [ -f "$LOCAL_ENV" ]; then
  echo "[social-archiver] Running locally — reading config from .env"
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

echo "[social-archiver] Starting one archive pass…"
exec $RUNNER "$ENTRY"
