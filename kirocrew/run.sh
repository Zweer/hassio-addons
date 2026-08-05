#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Kiro Crew — Home Assistant Addon Entrypoint
# =============================================================================

CONFIG_PATH="/data/options.json"

# ---------------------------------------------------------------------------
# Fix permissions: Supervisor mounts options.json as root, but the base image
# may run as a non-root user. Ensure readability.
# ---------------------------------------------------------------------------
if [ -f "$CONFIG_PATH" ] && [ ! -r "$CONFIG_PATH" ]; then
    echo "[kirocrew-addon] Fixing permissions on $CONFIG_PATH..."
    chmod 644 "$CONFIG_PATH" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Parse addon options (using Python — always available in the base image)
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
# Environment setup
# ---------------------------------------------------------------------------
export KIROCREW_HOME="${KIROCREW_HOME:-/data}"
export KIROCREW_PORT="${KIROCREW_PORT:-5476}"

# Persist kiro-cli credentials across container restarts.
# kiro-cli uses ~/.kiro/ which is volatile in containers.
# Symlink it to /data/.kiro so credentials survive restarts.
if [ ! -d "/data/.kiro" ]; then
    mkdir -p /data/.kiro
fi
ln -sfn /data/.kiro /root/.kiro

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
    "port": ${KIROCREW_PORT},
    "allowed_hosts": ["*"],
    "open_browser": false
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

# Configuration is via env vars and config.json (no CLI flags for gateway)
export KIROCREW_BIND="0.0.0.0"
export KIRO_LOG_LEVEL="$LOG_LEVEL"

exec kirocrew gateway
