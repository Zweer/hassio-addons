#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Kiro Crew — Home Assistant Addon Entrypoint
#
# Architecture:
#   - Kiro Crew gateway on port 5476 (default)
#   - External access via Cloudflared HA addon (recommended) or any reverse proxy
#   - HA ingress provides local-network sidebar access
# =============================================================================

CONFIG_PATH="/data/options.json"

# ---------------------------------------------------------------------------
# Parse addon options
# ---------------------------------------------------------------------------
if [ -f "$CONFIG_PATH" ]; then
    POOL_SIZE=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('session_pool_size', 1))")
    TELEMETRY=$(python3 -c "import json; print(str(json.load(open('$CONFIG_PATH')).get('telemetry', False)).lower())")
    LOG_LEVEL=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('log_level', 'info'))")
    EXTERNAL_URL=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('external_url', ''))")
    TELEGRAM_TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('telegram_bot_token', ''))")
    TELEGRAM_IDS=$(python3 -c "import json; print(json.dumps(json.load(open('$CONFIG_PATH')).get('telegram_allowed_user_ids', [])))")
    DISCORD_TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('discord_bot_token', ''))")
    DISCORD_IDS=$(python3 -c "import json; print(json.dumps(json.load(open('$CONFIG_PATH')).get('discord_allowed_user_ids', [])))")
    SLACK_BOT_TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('slack_bot_token', ''))")
    SLACK_APP_TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('slack_app_token', ''))")
    SLACK_OWNER_ID=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('slack_owner_id', ''))")
else
    POOL_SIZE=1
    TELEMETRY=false
    LOG_LEVEL="info"
    EXTERNAL_URL=""
    TELEGRAM_TOKEN=""
    TELEGRAM_IDS="[]"
    DISCORD_TOKEN=""
    DISCORD_IDS="[]"
    SLACK_BOT_TOKEN=""
    SLACK_APP_TOKEN=""
    SLACK_OWNER_ID=""
fi

# ---------------------------------------------------------------------------
# Persistence: symlink the entire .kiro directory to /data
# ---------------------------------------------------------------------------
CREW_HOME="/home/kirocrew"

if [ ! -d "/data/dot-kiro" ]; then
    mkdir -p /data/dot-kiro
    if [ -d "${CREW_HOME}/.kiro" ]; then
        cp -a "${CREW_HOME}/.kiro/." /data/dot-kiro/ 2>/dev/null || true
    fi
fi
rm -rf "${CREW_HOME}/.kiro"
ln -sfn /data/dot-kiro "${CREW_HOME}/.kiro"
mkdir -p /data/dot-kiro/crew

CREW_DATA="${CREW_HOME}/.kiro/crew"

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
export KIROCREW_HOME="${CREW_DATA}"
export KIROCREW_BIND="0.0.0.0"
export KIRO_LOG_LEVEL="$LOG_LEVEL"

if [ "$TELEMETRY" = "false" ]; then
    export KIROCREW_TELEMETRY_DISABLED=1
fi

# Telegram bot token (env var is preferred over config.json per Crew docs)
if [ -n "$TELEGRAM_TOKEN" ]; then
    export TELEGRAM_BOT_TOKEN="$TELEGRAM_TOKEN"
    echo "[kirocrew-addon] Telegram bot token set"
fi

# Discord bot token
if [ -n "$DISCORD_TOKEN" ]; then
    export DISCORD_BOT_TOKEN="$DISCORD_TOKEN"
    echo "[kirocrew-addon] Discord bot token set"
fi

# Slack tokens
if [ -n "$SLACK_BOT_TOKEN" ]; then
    export SLACK_BOT_TOKEN
    export SLACK_APP_TOKEN
    export KIROCREW_OWNER_ID="$SLACK_OWNER_ID"
    echo "[kirocrew-addon] Slack tokens set (owner: ${SLACK_OWNER_ID})"
fi

# ---------------------------------------------------------------------------
# Write Kiro Crew config (only on first run — preserve user changes)
# ---------------------------------------------------------------------------
if [ ! -f "${CREW_DATA}/config.json" ]; then
    cat > "${CREW_DATA}/config.json" <<EOF
{
  "agent": {
    "provider": "acp",
    "approval_mode": "interactive",
    "sandbox": "off"
  },
  "session": {
    "timeout_secs": 1800,
    "pool_size": ${POOL_SIZE}
  },
  "dashboard": {
    "bot_name": "Kiro Crew",
    "host": "0.0.0.0",
    "open_browser": false
  }
}
EOF
fi

# ---------------------------------------------------------------------------
# Ensure dashboard.url is always up-to-date
# Priority: external_url option > HA external_url from Supervisor API
# ---------------------------------------------------------------------------
DASHBOARD_URL="${EXTERNAL_URL}"
if [ -z "${DASHBOARD_URL}" ] && [ -n "${SUPERVISOR_TOKEN:-}" ]; then
    DASHBOARD_URL=$(curl -sSf -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" \
        http://supervisor/core/api/config 2>/dev/null \
        | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('external_url',''))" 2>/dev/null) || true
fi

if [ -n "${DASHBOARD_URL}" ]; then
    python3 -c "
import json
f='${CREW_DATA}/config.json'
try:
    cfg=json.load(open(f))
except: cfg={}
cfg.setdefault('dashboard',{})['url']='${DASHBOARD_URL}'
json.dump(cfg,open(f,'w'),indent=2)
"
    echo "[kirocrew-addon] dashboard.url set to: ${DASHBOARD_URL}"
fi

# ---------------------------------------------------------------------------
# Configure channel integrations (Telegram, Discord)
# ---------------------------------------------------------------------------
if [ -n "$TELEGRAM_TOKEN" ] || [ -n "$DISCORD_TOKEN" ]; then
    python3 -c "
import json
f='${CREW_DATA}/config.json'
try:
    cfg=json.load(open(f))
except: cfg={}

telegram_token = '${TELEGRAM_TOKEN}'
discord_token = '${DISCORD_TOKEN}'
telegram_ids = ${TELEGRAM_IDS}
discord_ids = ${DISCORD_IDS}

if telegram_token:
    cfg['telegram'] = {'enabled': True, 'allowed_user_ids': telegram_ids}
if discord_token:
    cfg['discord'] = {'enabled': True, 'allowed_users': discord_ids}

json.dump(cfg, open(f,'w'), indent=2)
"
    [ -n "$TELEGRAM_TOKEN" ] && echo "[kirocrew-addon] Telegram enabled for user IDs: ${TELEGRAM_IDS}"
    [ -n "$DISCORD_TOKEN" ] && echo "[kirocrew-addon] Discord enabled for user IDs: ${DISCORD_IDS}"
fi

echo "[kirocrew-addon] Configuration:"
echo "  KIROCREW_HOME=$KIROCREW_HOME"
echo "  Pool size: $POOL_SIZE"
echo "  Telemetry: $TELEMETRY"
echo "  Log level: $LOG_LEVEL"
echo "  External URL: ${DASHBOARD_URL:-not set}"
echo "  Sandbox: off (container-level isolation is sufficient)"

# ---------------------------------------------------------------------------
# Start Kiro Crew Gateway
# ---------------------------------------------------------------------------
echo "[kirocrew-addon] Starting Kiro Crew Gateway on port 5476..."

# Ensure kirocrew user owns all persistent data
chown -R kirocrew:kirocrew /data/dot-kiro

# Switch to kirocrew user (as the upstream image expects) and start gateway.
# --preserve-environment keeps our exports (KIROCREW_HOME, KIRO_LOG_LEVEL, etc.)
cd "${CREW_HOME}"
exec runuser --preserve-environment -u kirocrew -- kirocrew gateway
