#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Kiro Crew — Home Assistant Addon Entrypoint
#
# Strategy: Don't fight the upstream image. It expects /home/kirocrew as its
# working directory. We set KIROCREW_HOME to point there, and use /data only
# as the HA-persistent volume. On startup, we symlink the relevant persistent
# subdirectories FROM /home/kirocrew INTO /data, so Crew writes to /data
# through its normal paths.
# =============================================================================

CONFIG_PATH="/data/options.json"

# ---------------------------------------------------------------------------
# Parse addon options
# ---------------------------------------------------------------------------
if [ -f "$CONFIG_PATH" ]; then
    POOL_SIZE=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('session_pool_size', 1))")
    TELEMETRY=$(python3 -c "import json; print(str(json.load(open('$CONFIG_PATH')).get('telemetry', False)).lower())")
    LOG_LEVEL=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('log_level', 'info'))")
else
    POOL_SIZE=1
    TELEMETRY=false
    LOG_LEVEL="info"
fi

# ---------------------------------------------------------------------------
# Persistence: symlink Crew's data dirs into /data (HA persistent volume)
#
# The upstream image stores everything under /home/kirocrew/.kiro/crew/.
# We keep that structure but make it point to /data so state survives restarts.
# ---------------------------------------------------------------------------
CREW_HOME="/home/kirocrew"

# ---------------------------------------------------------------------------
# Persistence: symlink the entire .kiro directory to /data
#
# The upstream image stores everything under /home/kirocrew/.kiro/:
#   - .kiro/crew/         → Crew state (config, memory, sessions, skills)
#   - .kiro/credentials.json, state.json → kiro-cli auth
#   - .kiro/agents/, settings/, crew-auth-staging/ → various state
#
# Instead of symlinking individual files, we persist the entire .kiro/ dir.
# ---------------------------------------------------------------------------
if [ ! -d "/data/dot-kiro" ]; then
    mkdir -p /data/dot-kiro
    # First run: seed from the image's defaults
    if [ -d "${CREW_HOME}/.kiro" ]; then
        cp -a "${CREW_HOME}/.kiro/." /data/dot-kiro/ 2>/dev/null || true
    fi
fi
# Replace .kiro with symlink to persistent storage
rm -rf "${CREW_HOME}/.kiro"
ln -sfn /data/dot-kiro "${CREW_HOME}/.kiro"

# Ensure crew subdirectory exists
mkdir -p /data/dot-kiro/crew

CREW_DATA="${CREW_HOME}/.kiro/crew"

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
export KIROCREW_HOME="${CREW_DATA}"
export KIROCREW_BIND="0.0.0.0"
export KIRO_LOG_LEVEL="$LOG_LEVEL"
export KIROCREW_CORS_ORIGINS="*"
export HOME="${CREW_HOME}"

if [ "$TELEMETRY" = "false" ]; then
    export KIROCREW_TELEMETRY_DISABLED=1
fi

# ---------------------------------------------------------------------------
# Write Kiro Crew config (only on first run — preserve user changes)
# ---------------------------------------------------------------------------
if [ ! -f "${CREW_DATA}/config.json" ]; then
    # Discover HA external URL from Supervisor API for ingress host validation
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

echo "[kirocrew-addon] Configuration:"
echo "  KIROCREW_HOME=$KIROCREW_HOME"
echo "  HOME=$HOME"
echo "  Pool size: $POOL_SIZE"
echo "  Telemetry: $TELEMETRY"
echo "  Log level: $LOG_LEVEL"
echo "  Sandbox: off (container-level isolation is sufficient)"
echo "  Nginx: 5477 → Crew: 5476"

# ---------------------------------------------------------------------------
# Ensure dashboard.url is always up-to-date (HA external URL may change)
# ---------------------------------------------------------------------------
if [ -n "${SUPERVISOR_TOKEN:-}" ]; then
    CURRENT_URL=$(curl -sSf -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" \
        http://supervisor/core/api/config 2>/dev/null \
        | python3 -c "import json,sys; c=json.load(sys.stdin); print(c.get('external_url',''))" 2>/dev/null) || true
    if [ -n "${CURRENT_URL}" ]; then
        python3 -c "
import json
f='${CREW_DATA}/config.json'
try:
    cfg=json.load(open(f))
except: cfg={}
cfg.setdefault('dashboard',{})['url']='${CURRENT_URL}'
json.dump(cfg,open(f,'w'),indent=2)
"
        echo "[kirocrew-addon] dashboard.url set to: ${CURRENT_URL}"
    fi
fi

# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------
echo "[kirocrew-addon] Starting nginx ingress proxy on port 5477..."
nginx

echo "[kirocrew-addon] Starting Kiro Crew Gateway on port 5476..."
echo "[kirocrew-addon] Dashboard will be available via HA ingress"

cd "${CREW_HOME}"
exec kirocrew gateway
