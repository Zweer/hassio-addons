#!/usr/bin/env bash
# shellcheck shell=bash
# ==============================================================================
# Suwayomi - Self-hosted manga reader for Home Assistant
#
# This image is the official Suwayomi-Server docker image, which ships its own
# startup_script.sh that reads a set of environment variables and writes them
# into server.conf. Our job here is:
#   1. Read HA addon options from /data/options.json
#   2. Persist Suwayomi's data dir under /data (HA persistent + backups)
#   3. Redirect manga downloads to /share/suwayomi
#   4. Export the matching env vars and hand off to the upstream startup script
# ==============================================================================
set -euo pipefail

OPTIONS_FILE="/data/options.json"
DATA_DIR="/data/suwayomi"
DOWNLOADS_DIR="/share/suwayomi"
SUWAYOMI_HOME="/home/suwayomi/.local/share/Tachidesk"
SUWAYOMI_UID=1000
SUWAYOMI_GID=1000

log() { echo "[suwayomi] $*"; }

# --- Helper: read an option from options.json --------------------------------
# opt <jq-path> <default>
opt() {
    local path="$1" default="${2:-}"
    local value
    value="$(jq -r "${path} // empty" "${OPTIONS_FILE}" 2>/dev/null || true)"
    if [ -z "${value}" ] || [ "${value}" = "null" ]; then
        echo "${default}"
    else
        echo "${value}"
    fi
}

log "Starting Suwayomi addon..."

if [ ! -f "${OPTIONS_FILE}" ]; then
    log "WARNING: ${OPTIONS_FILE} not found, using defaults."
    echo '{}' > /tmp/options.json
    OPTIONS_FILE="/tmp/options.json"
fi

# --- Persist data directory under /data --------------------------------------
# Suwayomi expects its data at $SUWAYOMI_HOME. We point that at /data/suwayomi
# via a symlink so state (library, DB, settings) survives restarts/updates and
# is included in HA backups.
mkdir -p "${DATA_DIR}"
mkdir -p "$(dirname "${SUWAYOMI_HOME}")"
# Remove the image's default dir/symlink and link to our persistent location.
if [ -e "${SUWAYOMI_HOME}" ] || [ -L "${SUWAYOMI_HOME}" ]; then
    rm -rf "${SUWAYOMI_HOME}"
fi
ln -sfn "${DATA_DIR}" "${SUWAYOMI_HOME}"

# --- Redirect downloads to /share --------------------------------------------
# Instead of relying on docker volume ordering, we symlink the "downloads"
# subfolder of the data dir to /share/suwayomi so downloaded chapters land in
# shared storage accessible from other addons / the file editor.
mkdir -p "${DOWNLOADS_DIR}"
if [ -e "${DATA_DIR}/downloads" ] && [ ! -L "${DATA_DIR}/downloads" ]; then
    # Migrate any pre-existing downloads into the shared folder once.
    log "Migrating existing downloads to ${DOWNLOADS_DIR}..."
    cp -an "${DATA_DIR}/downloads/." "${DOWNLOADS_DIR}/" 2>/dev/null || true
    rm -rf "${DATA_DIR}/downloads"
fi
ln -sfn "${DOWNLOADS_DIR}" "${DATA_DIR}/downloads"

# --- Ownership ----------------------------------------------------------------
# The upstream server runs as uid 1000 (suwayomi). Make sure it can write to the
# persistent + shared directories.
chown -h "${SUWAYOMI_UID}:${SUWAYOMI_GID}" "${SUWAYOMI_HOME}" 2>/dev/null || true
chown -R "${SUWAYOMI_UID}:${SUWAYOMI_GID}" "${DATA_DIR}" 2>/dev/null || true
chown -R "${SUWAYOMI_UID}:${SUWAYOMI_GID}" "${DOWNLOADS_DIR}" 2>/dev/null || true

# --- Translate HA options into upstream env vars ------------------------------
# Server binds on all interfaces / the ingress port.
export BIND_IP="0.0.0.0"
export BIND_PORT="4567"

# WebUI: served on stable channel by default; keep it enabled for ingress.
export WEB_UI_ENABLED="true"
export WEB_UI_CHANNEL="$(opt '.web_ui_channel' 'STABLE')"

# Downloads.
export DOWNLOAD_AS_CBZ="$(opt '.download_as_cbz' 'true')"

# WebView (KCEF) — heavy; off by default (recommended on low-RAM devices).
export KCEF_ENABLED="$(opt '.kcef_enabled' 'false')"

# Authentication.
AUTH_MODE_VAL="$(opt '.auth_mode' 'basic_auth')"
export AUTH_MODE="${AUTH_MODE_VAL}"
AUTH_USERNAME_VAL="$(opt '.auth_username' '')"
AUTH_PASSWORD_VAL="$(opt '.auth_password' '')"
if [ -n "${AUTH_USERNAME_VAL}" ]; then export AUTH_USERNAME="${AUTH_USERNAME_VAL}"; fi
if [ -n "${AUTH_PASSWORD_VAL}" ]; then export AUTH_PASSWORD="${AUTH_PASSWORD_VAL}"; fi

if [ "${AUTH_MODE_VAL}" != "none" ] && { [ -z "${AUTH_USERNAME_VAL}" ] || [ -z "${AUTH_PASSWORD_VAL}" ]; }; then
    log "WARNING: auth_mode='${AUTH_MODE_VAL}' but username/password not fully set."
    log "         Set auth_username and auth_password in the addon config,"
    log "         or set auth_mode='none' if you only access via HA ingress."
fi

# Extension repos (list of URLs) -> JSON array string expected by upstream.
EXT_REPOS_JSON="$(jq -c '[.extension_repos[]?]' "${OPTIONS_FILE}" 2>/dev/null || echo '[]')"
if [ "${EXT_REPOS_JSON}" != "[]" ] && [ -n "${EXT_REPOS_JSON}" ]; then
    export EXTENSION_STORES="${EXT_REPOS_JSON}"
fi

# Optional SOCKS5 proxy.
SOCKS_HOST="$(opt '.socks_proxy_host' '')"
SOCKS_PORT="$(opt '.socks_proxy_port' '')"
if [ -n "${SOCKS_HOST}" ] && [ -n "${SOCKS_PORT}" ]; then
    export SOCKS_PROXY_ENABLED="true"
    export SOCKS_PROXY_HOST="${SOCKS_HOST}"
    export SOCKS_PROXY_PORT="${SOCKS_PORT}"
fi

log "Configuration:"
log "  auth_mode      = ${AUTH_MODE_VAL}"
log "  web_ui_channel = ${WEB_UI_CHANNEL}"
log "  kcef_enabled   = ${KCEF_ENABLED}"
log "  download_cbz   = ${DOWNLOAD_AS_CBZ}"
log "  data dir       = ${DATA_DIR} (-> ${SUWAYOMI_HOME})"
log "  downloads      = ${DOWNLOADS_DIR}"

# --- Hand off to the upstream startup script as the suwayomi user -------------
# The upstream startup_script.sh generates server.conf from the env vars above
# and then execs the JVM. We drop privileges to uid 1000 to match the image.
log "Handing off to upstream Suwayomi startup script..."

if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid="${SUWAYOMI_UID}" --regid="${SUWAYOMI_GID}" --init-groups \
        env HOME=/home/suwayomi /home/suwayomi/startup_script.sh
elif command -v gosu >/dev/null 2>&1; then
    exec gosu "${SUWAYOMI_UID}:${SUWAYOMI_GID}" /home/suwayomi/startup_script.sh
elif command -v su-exec >/dev/null 2>&1; then
    exec su-exec "${SUWAYOMI_UID}:${SUWAYOMI_GID}" /home/suwayomi/startup_script.sh
else
    log "WARNING: no privilege-drop tool found; running startup script as root."
    exec env HOME=/home/suwayomi /home/suwayomi/startup_script.sh
fi
