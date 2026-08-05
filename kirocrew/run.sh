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
CREW_DATA="${CREW_HOME}/.kiro/crew"
KIRO_CLI_DATA="${CREW_HOME}/.kiro"

# Ensure /data directories exist
mkdir -p /data/crew
mkdir -p /data/kiro-cli

# Symlink ~/.kiro/crew -> /data/crew (Crew state: config, memory, sessions)
mkdir -p "${CREW_HOME}/.kiro"
if [ ! -L "${CREW_DATA}" ]; then
    # First run: move any existing data from the image to /data
    if [ -d "${CREW_DATA}" ]; then
        cp -a "${CREW_DATA}/." /data/crew/ 2>/dev/null || true
        rm -rf "${CREW_DATA}"
    fi
    ln -sfn /data/crew "${CREW_DATA}"
fi

# Symlink kiro-cli credentials -> /data/kiro-cli
# kiro-cli stores auth tokens in ~/.kiro/ (files like credentials.json, state.json)
for f in credentials.json state.json; do
    if [ -f "${KIRO_CLI_DATA}/${f}" ] && [ ! -L "${KIRO_CLI_DATA}/${f}" ]; then
        cp -a "${KIRO_CLI_DATA}/${f}" "/data/kiro-cli/${f}" 2>/dev/null || true
    fi
    ln -sfn "/data/kiro-cli/${f}" "${KIRO_CLI_DATA}/${f}"
done

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
export KIROCREW_HOME="${CREW_DATA}"
export KIROCREW_PORT="${KIROCREW_PORT:-5476}"
export KIROCREW_BIND="0.0.0.0"
export KIRO_LOG_LEVEL="$LOG_LEVEL"
export KIROCREW_CORS_ORIGINS="*"
export HOME="${CREW_HOME}"

if [ "$TELEMETRY" = "false" ]; then
    export KIROCREW_TELEMETRY_DISABLED=1
fi

# ---------------------------------------------------------------------------
# Write Kiro Crew config
# ---------------------------------------------------------------------------
mkdir -p /data/crew
cat > /data/crew/config.json <<EOF
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
    "port": ${KIROCREW_PORT},
    "open_browser": false
  }
}
EOF

echo "[kirocrew-addon] Configuration:"
echo "  KIROCREW_HOME=$KIROCREW_HOME"
echo "  KIROCREW_PORT=$KIROCREW_PORT"
echo "  HOME=$HOME"
echo "  Pool size: $POOL_SIZE"
echo "  Telemetry: $TELEMETRY"
echo "  Log level: $LOG_LEVEL"
echo "  Sandbox: off (container-level isolation is sufficient)"

# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------
echo "[kirocrew-addon] Starting Kiro Crew Gateway..."
echo "[kirocrew-addon] Dashboard will be available via HA ingress"

cd "${CREW_HOME}"
exec kirocrew gateway
