#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Kiro Crew — Home Assistant Addon Entrypoint
# =============================================================================

CONFIG_PATH="/data/options.json"

# ---------------------------------------------------------------------------
# Parse addon options
# ---------------------------------------------------------------------------
if [ -f "$CONFIG_PATH" ]; then
    POOL_SIZE=$(jq -r '.session_pool_size // 1' "$CONFIG_PATH")
    TELEMETRY=$(jq -r '.telemetry // false' "$CONFIG_PATH")
    LOG_LEVEL=$(jq -r '.log_level // "info"' "$CONFIG_PATH")
else
    POOL_SIZE=1
    TELEMETRY=false
    LOG_LEVEL="info"
fi

# ---------------------------------------------------------------------------
# Environment setup
# ---------------------------------------------------------------------------
export KIROCREW_HOME="${KIROCREW_HOME:-/data}"
export KIROCREW_PORT="${KIROCREW_PORT:-5476}"

# Disable telemetry if user opted out
if [ "$TELEMETRY" = "false" ]; then
    export KIROCREW_TELEMETRY_DISABLED=1
fi

# ---------------------------------------------------------------------------
# First-run initialization
# ---------------------------------------------------------------------------
if [ ! -d "$KIROCREW_HOME/config" ]; then
    echo "[kirocrew-addon] First run detected. Initializing data directory..."
    mkdir -p "$KIROCREW_HOME/config"
    mkdir -p "$KIROCREW_HOME/sessions"
    mkdir -p "$KIROCREW_HOME/models"
fi

# Write/update Kiro Crew config optimized for RPi4 4GB
CONFIG_FILE="$KIROCREW_HOME/config/config.json"
cat > "$CONFIG_FILE" <<EOF
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
    "port": ${KIROCREW_PORT}
  }
}
EOF

echo "[kirocrew-addon] Configuration:"
echo "  KIROCREW_HOME=$KIROCREW_HOME"
echo "  KIROCREW_PORT=$KIROCREW_PORT"
echo "  Pool size: $POOL_SIZE"
echo "  Telemetry: $TELEMETRY"
echo "  Log level: $LOG_LEVEL"
echo "  Sandbox: off (container-level isolation is sufficient)"

# ---------------------------------------------------------------------------
# Start the Kiro Crew Gateway
# ---------------------------------------------------------------------------
echo "[kirocrew-addon] Starting Kiro Crew Gateway..."
echo "[kirocrew-addon] Dashboard will be available via HA ingress"

exec kirocrew gateway \
    --port "$KIROCREW_PORT" \
    --host 0.0.0.0 \
    --log-level "$LOG_LEVEL"
