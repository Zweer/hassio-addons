#!/usr/bin/env bash
# shellcheck shell=bash
# ==============================================================================
# RomM - Self-hosted ROM manager & player for Home Assistant
#
# The upstream RomM image ships its own s6-overlay supervision tree (nginx +
# gunicorn + worker + valkey) started by /docker-entrypoint.sh (which ends in
# `exec "$@"`, i.e. CMD /init). Our job here is:
#   1. Read HA addon options from /data/options.json (with jq)
#   2. Validate the required database settings
#   3. Generate & persist ROMM_AUTH_SECRET_KEY under /data (survives restarts)
#   4. Lay out the library under /share (single filesystem -> hardlinks work)
#   5. Export the matching env vars and hand off to the upstream entrypoint
# ==============================================================================
set -euo pipefail

OPTIONS_FILE="/data/options.json"
# RomM runs as uid/gid 1000 inside the upstream image.
ROMM_UID=1000
ROMM_GID=1000
# Everything RomM needs lives under one directory in shared storage, so the
# whole setup is a single tidy folder and the hardlinks RomM makes between
# library/resources/assets never cross a filesystem (EXDEV). RomM's default
# "Structure A" layout applies: games go in library/roms/{platform}, firmware
# in library/bios/{platform}.
BASE_PATH="/share/romm"

log() { echo "[romm] $*"; }

# opt <jq-path> <default> — read an option, falling back to default when unset.
opt() {
    local path="$1" default="${2:-}" value
    value="$(jq -r "${path} // empty" "${OPTIONS_FILE}" 2>/dev/null || true)"
    if [ -z "${value}" ] || [ "${value}" = "null" ]; then
        echo "${default}"
    else
        echo "${value}"
    fi
}

# bool <jq-path> <default> — normalise a boolean to the "true"/"false" strings
# RomM expects.
boolopt() {
    local v
    v="$(opt "$1" "$2")"
    case "${v,,}" in
        true|1|yes|on) echo "true" ;;
        *) echo "false" ;;
    esac
}

log "Starting RomM addon..."

if [ ! -f "${OPTIONS_FILE}" ]; then
    log "WARNING: ${OPTIONS_FILE} not found, using defaults."
    echo '{}' > /tmp/options.json
    OPTIONS_FILE="/tmp/options.json"
fi

# --- Database (required) -----------------------------------------------------
DB_HOST="$(opt '.db_host' 'core-mariadb')"
DB_PORT="$(opt '.db_port' '3306')"
DB_NAME="$(opt '.db_name' 'romm')"
DB_USER="$(opt '.db_user' 'romm')"
DB_PASSWD="$(opt '.db_password' '')"

for required in DB_HOST DB_USER DB_PASSWD; do
    if [ -z "${!required}" ]; then
        log "FATAL: '${required,,}' is empty — set it in the addon Configuration tab."
        log "       Create a database and user in the MariaDB addon first (see DOCS.md)."
        exit 1
    fi
done

export ROMM_DB_DRIVER="mariadb"
export DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWD

# --- Networking --------------------------------------------------------------
export ROMM_PORT="8080"
export ROMM_BASE_PATH="${BASE_PATH}"

# --- Auth secret -------------------------------------------------------------
# Generated once and kept in /data so sessions survive restarts/updates.
# Upstream wants 32 hex bytes; /dev/urandom avoids depending on openssl.
SECRET_FILE="/data/.auth_secret"
if [ ! -s "${SECRET_FILE}" ]; then
    log "Generating ROMM_AUTH_SECRET_KEY (first run)..."
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "${SECRET_FILE}"
    chmod 600 "${SECRET_FILE}"
fi
export ROMM_AUTH_SECRET_KEY="$(cat "${SECRET_FILE}")"

# --- Access ------------------------------------------------------------------
export KIOSK_MODE="$(boolopt '.kiosk_mode' 'false')"
export ROMM_SESSION_SECURE_COOKIE="$(boolopt '.https_cookies' 'false')"

# --- Metadata providers ------------------------------------------------------
export IGDB_CLIENT_ID="$(opt '.igdb_client_id' '')"
export IGDB_CLIENT_SECRET="$(opt '.igdb_client_secret' '')"
export MOBYGAMES_API_KEY="$(opt '.mobygames_api_key' '')"
export SCREENSCRAPER_USER="$(opt '.screenscraper_user' '')"
export SCREENSCRAPER_PASSWORD="$(opt '.screenscraper_password' '')"
export STEAMGRIDDB_API_KEY="$(opt '.steamgriddb_api_key' '')"
export RETROACHIEVEMENTS_API_KEY="$(opt '.retroachievements_api_key' '')"
export HASHEOUS_API_ENABLED="$(boolopt '.hasheous_api_enabled' 'true')"

# --- Emulation toggles -------------------------------------------------------
# Options are expressed positively (enabled=true); upstream env vars are the
# negated DISABLE_* form, so invert here.
invert() { [ "$1" = "true" ] && echo "false" || echo "true"; }
export DISABLE_EMULATOR_JS="$(invert "$(boolopt '.emulatorjs_enabled' 'true')")"
export DISABLE_RUFFLE_RS="$(invert "$(boolopt '.ruffle_enabled' 'true')")"
export DISABLE_JSDOS="$(invert "$(boolopt '.jsdos_enabled' 'true')")"
export DISABLE_PICO8="$(invert "$(boolopt '.pico8_enabled' 'true')")"

# --- Scheduled maintenance ---------------------------------------------------
export ENABLE_SCHEDULED_RESCAN="$(boolopt '.scheduled_rescan' 'false')"
export SCHEDULED_RESCAN_CRON="$(opt '.scheduled_rescan_cron' '0 3 * * *')"
export ENABLE_RESCAN_ON_FILESYSTEM_CHANGE="$(boolopt '.rescan_on_filesystem_change' 'false')"

# --- Performance -------------------------------------------------------------
export SCAN_WORKERS="$(opt '.scan_workers' '3')"
export WEB_SERVER_CONCURRENCY="$(opt '.web_server_concurrency' '2')"
export SCAN_TIMEOUT="$(opt '.scan_timeout' '86400')"
export LOGLEVEL="$(opt '.log_level' 'INFO')"

# --- Library layout ----------------------------------------------------------
# Create RomM's expected directories under BASE_PATH (Structure A). No symlinks:
# the whole thing lives under /share/romm, so it is one filesystem and stays
# tidy. Games go in library/roms/{platform}; firmware in library/bios/{platform}.
mkdir -p "${BASE_PATH}/library/roms"
mkdir -p "${BASE_PATH}/library/bios"
for dir in resources assets config; do
    mkdir -p "${BASE_PATH}/${dir}"
done

# --- Ownership ---------------------------------------------------------------
chown -R "${ROMM_UID}:${ROMM_GID}" "${BASE_PATH}" 2>/dev/null || \
    log "WARN: could not chown ${BASE_PATH} — uploads may fail if permissions are wrong."
# /redis-data is a declared VOLUME upstream; only chown it so Valkey can write.
chown -R "${ROMM_UID}:${ROMM_GID}" /redis-data 2>/dev/null || true

log "Configuration:"
log "  database   = ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
log "  library    = ${BASE_PATH}/library/roms/{platform}"
log "  firmware   = ${BASE_PATH}/library/bios/{platform}"
log "  base path  = ${BASE_PATH}"
log "  scan       = ${SCAN_WORKERS} workers, timeout ${SCAN_TIMEOUT}s"
log "  web        = ${WEB_SERVER_CONCURRENCY} workers, kiosk=${KIOSK_MODE}"
log "  emulation  = ejs:$(boolopt '.emulatorjs_enabled' 'true') ruffle:$(boolopt '.ruffle_enabled' 'true') jsdos:$(boolopt '.jsdos_enabled' 'true') pico8:$(boolopt '.pico8_enabled' 'true')"
log "  web UI     = http://<home-assistant>:8080"
log "Handing over to the upstream entrypoint..."

exec /docker-entrypoint.sh "$@"
