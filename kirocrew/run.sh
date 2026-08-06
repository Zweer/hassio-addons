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
    KIRO_API_KEY=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('kiro_api_key', ''))")
    EXTERNAL_URL=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('external_url', ''))")
else
    POOL_SIZE=1
    TELEMETRY=false
    LOG_LEVEL="info"
    KIRO_API_KEY=""
    EXTERNAL_URL=""
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
export HOME="${CREW_HOME}"

# Kiro API key — enables headless login (no browser auth needed)
if [ -n "$KIRO_API_KEY" ]; then
    export KIRO_API_KEY
    echo "[kirocrew-addon] KIRO_API_KEY set — headless authentication enabled"
else
    echo "[kirocrew-addon] No KIRO_API_KEY — run 'kiro-cli login' manually in the container"
fi

if [ "$TELEMETRY" = "false" ]; then
    export KIROCREW_TELEMETRY_DISABLED=1
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

echo "[kirocrew-addon] Configuration:"
echo "  KIROCREW_HOME=$KIROCREW_HOME"
echo "  HOME=$HOME"
echo "  Pool size: $POOL_SIZE"
echo "  Telemetry: $TELEMETRY"
echo "  Log level: $LOG_LEVEL"
echo "  External URL: ${DASHBOARD_URL:-not set}"
echo "  Sandbox: off (container-level isolation is sufficient)"

# ---------------------------------------------------------------------------
# Start Kiro Crew Gateway
# ---------------------------------------------------------------------------
echo "[kirocrew-addon] Starting Kiro Crew Gateway on port 5476..."

cd "${CREW_HOME}"
kirocrew gateway &
GATEWAY_PID=$!

# Wait for gateway to be ready
echo "[kirocrew-addon] Waiting for gateway to start..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:5476/api/health > /dev/null 2>&1; then
        echo "[kirocrew-addon] Gateway is ready!"
        break
    fi
    sleep 2
done

# ---------------------------------------------------------------------------
# Generate a long-lived dashboard token
# ---------------------------------------------------------------------------
echo "[kirocrew-addon] Generating dashboard access token..."
TOKEN_OUTPUT=$(kirocrew token --ttl 720h 2>&1) || true
if [ -n "$TOKEN_OUTPUT" ]; then
    echo "[kirocrew-addon] ============================================"
    echo "[kirocrew-addon] DASHBOARD ACCESS:"
    echo "[kirocrew-addon] $TOKEN_OUTPUT"
    echo "[kirocrew-addon] ============================================"
fi

# Keep the gateway running in foreground
wait $GATEWAY_PID
