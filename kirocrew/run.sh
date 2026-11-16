#!/usr/bin/env bash
# Kiro Crew Home Assistant add-on entrypoint.
#
# Runs as root only to prepare /data, then execs the upstream entrypoint as
# the kirocrew user. The upstream entrypoint moves credentials from the
# environment into ~/.kiro/crew/.env (chmod 600) and execs tini as PID 1, so
# signals from Supervisor reach the gateway directly.
set -euo pipefail

CREW_USER=kirocrew
export HOME=/data/home
CREW_DIR="${HOME}/.kiro/crew"

log() { echo "[kirocrew-addon] $*"; }

mkdir -p "${HOME}"

# One-time migration from the 0.2.x layout (/data/dot-kiro symlinked as ~/.kiro).
if [ -d /data/dot-kiro ] && [ ! -e "${HOME}/.kiro" ]; then
    log "Migrating /data/dot-kiro to ${HOME}/.kiro"
    mv /data/dot-kiro "${HOME}/.kiro"
fi
mkdir -p "${CREW_DIR}"

# Single parse of /data/options.json: merges the managed keys into
# config.json atomically and prints shell-quoted exports for the secrets.
exports=$(python3 /usr/local/lib/kirocrew-addon/apply_options.py)
eval "${exports}"
unset exports

# Fix ownership only when something is wrong; a full chown -R on every boot
# rewrites the inode of every file, including the embedding model.
if [ -n "$(find "${HOME}" ! -user "${CREW_USER}" -print -quit)" ]; then
    log "Fixing ownership of ${HOME}"
    chown -R "${CREW_USER}:${CREW_USER}" "${HOME}"
fi

log "Starting Kiro Crew gateway on port 5476"
if [ "${ADDON_SIGNIN}" = "api-key" ]; then
    log "Kiro sign-in: API key"
elif setpriv --reuid="${CREW_USER}" --regid="${CREW_USER}" --init-groups -- \
        kiro-cli whoami >/dev/null 2>&1; then
    log "Kiro sign-in: kiro-cli login"
else
    log "WARNING: Kiro is not signed in, so agents cannot run. Set the" \
        "'Kiro API Key' option and restart, or run 'kiro-login' in the add-on container."
fi
unset ADDON_SIGNIN
log "Dashboard: run 'kiro-token' in the add-on container for a login link"

cd "${HOME}"
exec setpriv --reuid="${CREW_USER}" --regid="${CREW_USER}" --init-groups -- \
    kirocrew-entrypoint gateway
