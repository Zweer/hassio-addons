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
# The upstream image's user home is /home/kirocrew. kiro-cli and kirocrew
# both store credentials and state there. We symlink it to /data so
# everything persists across container restarts.
# Also set HOME=/data so any root-context lookups go to persistent storage.
if [ ! -L "/home/kirocrew" ]; then
    # Move any existing data from the image's home to /data
    if [ -d "/home/kirocrew" ]; then
        cp -a /home/kirocrew/. /data/ 2>/dev/null || true
        rm -rf /home/kirocrew
    fi
    ln -sfn /data /home/kirocrew
fi
# Ensure root's home also points to /data for kiro-cli invoked as root
ln -sfn /data/.kiro /root/.kiro 2>/dev/null || true
mkdir -p /data/.kiro
export HOME="/data"
# Set CWD to persistent storage (original WORKDIR may have been removed)
cd /data

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

# Write/update Kiro Crew config
mkdir -p /data/.kiro/crew
CONFIG_FILE="/data/.kiro/crew/config.json"
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
# Allow any Host/Origin header — HA ingress proxies requests through its own
# authenticated endpoint, so the dashboard's host check is redundant here.
export KIROCREW_CORS_ORIGINS="*"

exec kirocrew gateway
