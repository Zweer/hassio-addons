#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Kiro Crew — Home Assistant Addon Entrypoint
#
# Architecture:
#   - Kiro Crew gateway on port 5476 (default)
#   - Cloudflare Tunnel (if token provided) exposes the dashboard externally
#   - HA ingress provides local-network access (limited — SPA sub-path issues)
# =============================================================================

CONFIG_PATH="/data/options.json"

# ---------------------------------------------------------------------------
# Parse addon options
# ---------------------------------------------------------------------------
if [ -f "$CONFIG_PATH" ]; then
    POOL_SIZE=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('session_pool_size', 1))")
    TELEMETRY=$(python3 -c "import json; print(str(json.load(open('$CONFIG_PATH')).get('telemetry', False)).lower())")
    LOG_LEVEL=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('log_level', 'info'))")
    CF_TOKEN=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('cloudflare_tunnel_token', ''))")
    CF_HOSTNAME=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('cloudflare_tunnel_hostname', ''))")
else
    POOL_SIZE=1
    TELEMETRY=false
    LOG_LEVEL="info"
    CF_TOKEN=""
    CF_HOSTNAME=""
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

if [ "$TELEMETRY" = "false" ]; then
    export KIROCREW_TELEMETRY_DISABLED=1
fi

# ---------------------------------------------------------------------------
# Write Kiro Crew config (only on first run — preserve user changes)
# ---------------------------------------------------------------------------
if [ ! -f "${CREW_DATA}/config.json" ]; then
    # Discover HA external URL from Supervisor API
    EXTERNAL_URL=""
    if [ -n "${SUPERVISOR_TOKEN:-}" ]; then
        EXTERNAL_URL=$(curl -sSf -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" \
            http://supervisor/core/api/config 2>/dev/null \
            | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('external_url',''))" 2>/dev/null) || true
    fi
    echo "[kirocrew-addon] External URL: ${EXTERNAL_URL:-not configured in HA}"

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
    "url": "${EXTERNAL_URL}",
    "open_browser": false
  }
}
EOF
fi

# ---------------------------------------------------------------------------
# Ensure dashboard.url is always up-to-date
# Priority: cloudflare_tunnel_hostname > HA external_url
# ---------------------------------------------------------------------------
DASHBOARD_URL=""
if [ -n "$CF_HOSTNAME" ]; then
    if [[ "$CF_HOSTNAME" != http* ]]; then
        DASHBOARD_URL="https://${CF_HOSTNAME}"
    else
        DASHBOARD_URL="$CF_HOSTNAME"
    fi
elif [ -n "${SUPERVISOR_TOKEN:-}" ]; then
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
echo "  Sandbox: off (container-level isolation is sufficient)"

# ---------------------------------------------------------------------------
# Start Cloudflare Tunnel (if token provided)
# ---------------------------------------------------------------------------
if [ -n "$CF_TOKEN" ]; then
    echo "[kirocrew-addon] Starting Cloudflare Tunnel..."
    cloudflared tunnel --no-autoupdate run --token "$CF_TOKEN" &
    echo "[kirocrew-addon] Tunnel started in background (PID $!)"
else
    echo "[kirocrew-addon] No Cloudflare tunnel token — external access via HA ingress only"
    echo "[kirocrew-addon] Note: HA ingress has limited SPA support (local network recommended)"
fi

# ---------------------------------------------------------------------------
# Start Kiro Crew Gateway
# ---------------------------------------------------------------------------
echo "[kirocrew-addon] Starting Kiro Crew Gateway on port 5476..."

cd "${CREW_HOME}"
exec kirocrew gateway
