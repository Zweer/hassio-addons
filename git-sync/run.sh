#!/usr/bin/env bash
# shellcheck shell=bash
# ==============================================================================
# Git Sync - one-shot bidirectional Git sync for Home Assistant
#
# On start it does ONE reconcile of the HA /config with a Git remote, then
# EXITS (the container self-stops). Order per run: PULL first, then PUSH.
#   1. Read HA addon options from /data/options.json (opt() helper).
#   2. Mount the SSH deploy key from the `deploy_key` option.
#   3. PULL:  git fetch + git pull --ff-only  -> rsync into /config.
#   4. PUSH:  rsync /config -> checkout, git add/commit, git push (no force).
# FAIL-SAFE: on ANY conflict (ff-only fails, or push rejected) it stops,
# touches nothing, logs clearly, writes state=conflict and exits non-zero.
# NEVER merges, NEVER force-pushes.
#
# The Git checkout lives in /data/gitrepo, SEPARATE from /config, so we never
# create a nested /config/config checkout.
# ==============================================================================
set -euo pipefail

OPTIONS_FILE="/data/options.json"
LOCAL_ENV="/app/.env"
GITREPO_DIR="/data/gitrepo"
CONFIG_DIR="/config"
STATUS_FILE="/config/.gitsync_status.json"
SSH_DIR="/root/.ssh"
SSH_KEY="${SSH_DIR}/id_ed25519"

# --- Logging ------------------------------------------------------------------
# Every line: "<ISO-8601 local time> [git-sync] LEVEL  message"
# e.g.        "2026-09-28 20:11:32 CEST [git-sync] INFO   PULL: fetching origin/main"
# Levels are padded to a fixed width so messages line up in the addon log panel.
_LOG_TAG="git-sync"
_log() {
    local level="$1"; shift
    local ts
    ts="$(date '+%Y-%m-%d %H:%M:%S %Z')"
    printf '%s [%s] %-6s %s\n' "${ts}" "${_LOG_TAG}" "${level}" "$*"
}
log()      { _log "INFO" "$*"; }              # normal progress
log_warn() { _log "WARN" "$*"; }              # non-fatal issue
log_err()  { _log "ERROR" "$*" >&2; }         # fatal, goes to stderr
log_step() { _log "INFO" "──▶ $*"; }          # phase banner (PULL / PUSH / ...)
log_ok()   { _log "OK" "$*"; }                # success milestone

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

# --- Status file --------------------------------------------------------------
# Written at the end of EVERY run so HA file/command_line sensors can read it.
# write_status <state> <message> [last_commit] [ahead] [behind]
write_status() {
    local state="$1" message="$2" last_commit="${3:-}" ahead="${4:-0}" behind="${5:-0}"
    local now
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    jq -n \
        --arg state "${state}" \
        --arg action "sync" \
        --arg last_run "${now}" \
        --arg last_commit "${last_commit}" \
        --arg message "${message}" \
        --argjson ahead "${ahead:-0}" \
        --argjson behind "${behind:-0}" \
        '{state: $state, action: $action, last_run: $last_run, last_commit: $last_commit, message: $message, ahead: $ahead, behind: $behind}' \
        > "${STATUS_FILE}.tmp" 2>/dev/null || true
    if [ -f "${STATUS_FILE}.tmp" ]; then
        mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"
    else
        log_warn "could not write status file ${STATUS_FILE}"
    fi
}

# --- Fail-safe conflict exit --------------------------------------------------
# conflict <message>  -> log, record state=conflict, exit non-zero. No writes to
# /config, no merge, no push.
conflict() {
    local message="$1"
    _log "CONFL." "${message}" >&2
    write_status "conflict" "${message}" "" "${AHEAD:-0}" "${BEHIND:-0}"
    exit 2
}

# --- Generic error exit -------------------------------------------------------
fail() {
    local message="$1"
    log_err "${message}"
    write_status "error" "${message}"
    exit 1
}

# --- Read configuration -------------------------------------------------------
log "======================================================================"
log "Git Sync addon starting - one-shot bidirectional sync (pull then push)"
log "======================================================================"
if [ -f "${OPTIONS_FILE}" ]; then
    log "Environment: Home Assistant (reading ${OPTIONS_FILE})"
    REPOSITORY="$(opt '.repository' '')"
    BRANCH="$(opt '.branch' 'main')"
    AUTH_METHOD="$(opt '.auth_method' 'ssh')"
    DEPLOY_KEY="$(jq -r '.deploy_key // empty' "${OPTIONS_FILE}" 2>/dev/null || true)"
    PAT_TOKEN="$(jq -r '.pat_token // empty' "${OPTIONS_FILE}" 2>/dev/null || true)"
    DRY_RUN="$(opt '.dry_run' 'false')"
    # extra_excludes is an optional list of additional rsync/gitignore patterns.
    mapfile -t EXTRA_EXCLUDES < <(jq -r '.extra_excludes[]? // empty' "${OPTIONS_FILE}" 2>/dev/null || true)
elif [ -f "${LOCAL_ENV}" ]; then
    log "Environment: local (reading ${LOCAL_ENV})"
    # shellcheck disable=SC1090
    . "${LOCAL_ENV}"
    REPOSITORY="${REPOSITORY:-}"
    BRANCH="${BRANCH:-main}"
    AUTH_METHOD="${AUTH_METHOD:-ssh}"
    DEPLOY_KEY="${DEPLOY_KEY:-}"
    PAT_TOKEN="${PAT_TOKEN:-}"
    DRY_RUN="${DRY_RUN:-false}"
    EXTRA_EXCLUDES=()
else
    fail "no config found - need ${OPTIONS_FILE} (Hassio) or ${LOCAL_ENV} (local)"
fi

[ -n "${REPOSITORY}" ] || fail "'repository' option is empty - set the remote URL"

# Normalise and validate the auth method (ssh | pat).
AUTH_METHOD="$(printf '%s' "${AUTH_METHOD}" | tr '[:upper:]' '[:lower:]')"
case "${AUTH_METHOD}" in
    ssh)
        [ -n "${DEPLOY_KEY}" ] || fail "'deploy_key' is empty - paste the private SSH deploy key (auth_method=ssh)"
        case "${REPOSITORY}" in
            git@*|ssh://*) : ;;
            https://*) fail "auth_method=ssh but 'repository' is an HTTPS URL (${REPOSITORY}). Use an SSH URL (git@github.com:user/repo.git) or set auth_method=pat." ;;
            *) log_warn "repository '${REPOSITORY}' does not look like an SSH URL (git@... / ssh://...)" ;;
        esac
        ;;
    pat)
        [ -n "${PAT_TOKEN}" ] || fail "'pat_token' is empty - paste a Personal Access Token with write access (auth_method=pat)"
        case "${REPOSITORY}" in
            https://*) : ;;
            git@*|ssh://*) fail "auth_method=pat but 'repository' is an SSH URL (${REPOSITORY}). Use an HTTPS URL (https://github.com/user/repo.git) or set auth_method=ssh." ;;
            *) fail "auth_method=pat requires an HTTPS repository URL (https://github.com/user/repo.git), got '${REPOSITORY}'" ;;
        esac
        ;;
    *)
        fail "invalid 'auth_method' '${AUTH_METHOD}' - must be 'ssh' or 'pat'"
        ;;
esac

log "Repository : ${REPOSITORY}"
log "Branch     : ${BRANCH}"
log "Auth       : ${AUTH_METHOD}"

# --- Dry-run mode -------------------------------------------------------------
# When enabled, rsync runs with --dry-run (shows what WOULD change without
# writing), and git commit/push are SKIPPED. The whole reconcile still runs
# (clone/fetch/pull-ff-check/ahead-behind/diff) so you can validate a real run
# against your real /config with zero risk, then flip the flag off.
RSYNC_DRY=()
case "${DRY_RUN,,}" in
    true|1|yes|on)
        DRY_RUN=true
        RSYNC_DRY=(--dry-run --itemize-changes)
        log "Mode       : DRY-RUN (simulate only - no writes to /config, no commit, no push)"
        ;;
    *)
        DRY_RUN=false
        log "Mode       : LIVE (changes will be written and pushed)"
        ;;
esac

# --- Excludes -----------------------------------------------------------------
# Applied both as the checkout's .gitignore AND as rsync --exclude patterns.
# secrets.yaml is special-cased: we sync an emptied placeholder, never the real
# file, so its presence/structure is tracked without leaking secrets.
EXCLUDES=(
    "secrets.yaml"
    ".storage/"
    "home-assistant_v2.db*"
    "*.log"
    ".cache/"
    "custom_components/"
    "deps/"
    "tts/"
    ".cloud/"
    "backups/"
    ".git/"
    ".gitrepo/"
    ".gitsync_status.json"
)
if [ "${#EXTRA_EXCLUDES[@]}" -gt 0 ]; then
    EXCLUDES+=("${EXTRA_EXCLUDES[@]}")
fi

# rsync exclude args
RSYNC_EXCLUDES=()
for e in "${EXCLUDES[@]}"; do
    RSYNC_EXCLUDES+=("--exclude=${e}")
done

# --- Configure authentication -------------------------------------------------
if [ "${AUTH_METHOD}" = "ssh" ]; then
    log "Configuring SSH deploy key and pinning github.com host keys..."
    mkdir -p "${SSH_DIR}"
    chmod 700 "${SSH_DIR}"
    # Write the private key; never echo its contents.
    printf '%s\n' "${DEPLOY_KEY}" > "${SSH_KEY}"
    chmod 600 "${SSH_KEY}"
    # Pin GitHub host keys (extend here if using another forge).
    ssh-keyscan -t rsa,ecdsa,ed25519 github.com > "${SSH_DIR}/known_hosts" 2>/dev/null \
        || fail "ssh-keyscan failed - no network access to github.com?"
    chmod 644 "${SSH_DIR}/known_hosts"
    export GIT_SSH_COMMAND="ssh -i ${SSH_KEY} -o UserKnownHostsFile=${SSH_DIR}/known_hosts -o IdentitiesOnly=yes"
else
    # PAT over HTTPS. The token is fed to git via GIT_ASKPASS so it never lands
    # in the remote URL, .git/config, or the process/argument list. git prompts
    # for a username first (any non-empty value works for a PAT on GitHub) then
    # a password (the token) - the askpass script answers both.
    log "Configuring HTTPS Personal Access Token auth..."
    ASKPASS="/tmp/git-askpass.sh"
    # x-access-token is GitHub's conventional username for token auth; GitLab
    # and others accept any username with the token as the password.
    export GIT_ASKPASS_USER="x-access-token"
    export GIT_ASKPASS_TOKEN="${PAT_TOKEN}"
    cat > "${ASKPASS}" <<'ASKPASS_EOF'
#!/usr/bin/env bash
# Answer git's credential prompts from env. Never prints the token elsewhere.
case "$1" in
    *Username*|*username*) printf '%s\n' "${GIT_ASKPASS_USER}" ;;
    *) printf '%s\n' "${GIT_ASKPASS_TOKEN}" ;;
esac
ASKPASS_EOF
    chmod 700 "${ASKPASS}"
    export GIT_ASKPASS="${ASKPASS}"
    # Non-interactive: fail fast instead of blocking on a terminal prompt.
    export GIT_TERMINAL_PROMPT=0
fi

# --- Clone on first run, otherwise fetch --------------------------------------
AHEAD=0
BEHIND=0
if [ ! -d "${GITREPO_DIR}/.git" ]; then
    log "First run - cloning ${REPOSITORY} (${BRANCH}) into ${GITREPO_DIR}..."
    rm -rf "${GITREPO_DIR}"
    git clone --branch "${BRANCH}" "${REPOSITORY}" "${GITREPO_DIR}" \
        || fail "clone failed - check repository URL, branch, and deploy key access"
    log "Clone complete."
else
    log "Existing checkout found in ${GITREPO_DIR}, reusing it."
fi

cd "${GITREPO_DIR}"
git config user.email "git-sync@homeassistant.local"
git config user.name "HA Git Sync"

# Ensure we are on the requested branch.
git checkout "${BRANCH}" 2>/dev/null || git checkout -b "${BRANCH}"

# Keep the checkout's .gitignore in sync with the exclude list so files that
# should never be committed are ignored inside the checkout too.
{
    echo "# Managed by the git-sync addon - do not edit by hand."
    for e in "${EXCLUDES[@]}"; do
        echo "${e}"
    done
} > "${GITREPO_DIR}/.gitignore"

# ==============================================================================
# STEP 1 - PULL (--ff-only). On divergence: FAIL-SAFE, no writes to /config.
# ==============================================================================
log_step "STEP 1/2  PULL  (origin/${BRANCH} -> ${CONFIG_DIR})"
log "Fetching origin/${BRANCH}..."
git fetch origin "${BRANCH}" || fail "git fetch failed"

# Compute ahead/behind for the status file (best-effort).
if git rev-parse --verify --quiet "origin/${BRANCH}" >/dev/null; then
    set +e
    read -r BEHIND AHEAD < <(git rev-list --left-right --count "origin/${BRANCH}...HEAD" 2>/dev/null)
    set -e
    BEHIND="${BEHIND:-0}"
    AHEAD="${AHEAD:-0}"
    log "Local checkout is ${AHEAD} commit(s) ahead, ${BEHIND} behind origin/${BRANCH}"
fi

if [ "${DRY_RUN}" = true ]; then
    # Do NOT mutate the checkout. Check whether a fast-forward WOULD be possible:
    # HEAD must be an ancestor of origin/BRANCH (behind or equal). If we are
    # ahead-and-behind (diverged), --ff-only would fail -> report conflict.
    if git merge-base --is-ancestor HEAD "origin/${BRANCH}" 2>/dev/null; then
        log "[dry-run] fast-forward possible - ${BEHIND} commit(s) would be applied to ${CONFIG_DIR}"
    else
        conflict "local checkout diverged from origin/${BRANCH}, manual intervention needed (no merge performed)"
    fi
    # rsync --dry-run: show what pulling WOULD write into /config, change nothing.
    log "[dry-run] files that would change in ${CONFIG_DIR} (nothing is written):"
    rsync -a --delete "${RSYNC_DRY[@]}" "${RSYNC_EXCLUDES[@]}" "${GITREPO_DIR}/" "${CONFIG_DIR}/" \
        || fail "rsync (checkout -> /config) dry-run failed"
else
    log "Running git pull --ff-only origin ${BRANCH}..."
    if ! git pull --ff-only origin "${BRANCH}"; then
        conflict "local checkout diverged from origin/${BRANCH}, manual intervention needed (no merge performed)"
    fi

    # Mirror the pulled checkout state INTO /config (honouring excludes). --delete
    # makes /config match the checkout for tracked files, while excludes protect
    # runtime-only paths (.storage, db, custom_components, ...) from removal.
    log "Syncing checkout -> ${CONFIG_DIR}..."
    rsync -a --delete "${RSYNC_EXCLUDES[@]}" "${GITREPO_DIR}/" "${CONFIG_DIR}/" \
        || fail "rsync (checkout -> /config) failed"
    log "Pull applied to ${CONFIG_DIR}."
fi

# ==============================================================================
# STEP 2 - PUSH (no force). On rejection: FAIL-SAFE.
# ==============================================================================
log_step "STEP 2/2  PUSH  (${CONFIG_DIR} -> origin/${BRANCH})"
# Mirror /config INTO the checkout (honouring excludes). --delete keeps the
# checkout matching /config for tracked files.
if [ "${DRY_RUN}" = true ]; then
    log "[dry-run] files that would be staged from ${CONFIG_DIR} (nothing is written):"
    rsync -a --delete "${RSYNC_DRY[@]}" "${RSYNC_EXCLUDES[@]}" --exclude='.git/' "${CONFIG_DIR}/" "${GITREPO_DIR}/" \
        || fail "rsync (/config -> checkout) dry-run failed"
    log "[dry-run] git add / commit / push skipped."
    log_ok "[dry-run] reconcile simulated - review the itemized changes above, then set dry_run=false for a real sync."
    write_status "dry-run" "dry-run complete - review log, nothing was written" \
        "$(git rev-parse HEAD 2>/dev/null || echo '')" "${AHEAD}" "${BEHIND}"
    exit 0
fi

log "Syncing ${CONFIG_DIR} -> checkout..."
rsync -a --delete "${RSYNC_EXCLUDES[@]}" --exclude='.git/' "${CONFIG_DIR}/" "${GITREPO_DIR}/" \
    || fail "rsync (/config -> checkout) failed"

# Restore the managed .gitignore (rsync --delete may have removed it since it is
# not present in /config).
{
    echo "# Managed by the git-sync addon - do not edit by hand."
    for e in "${EXCLUDES[@]}"; do
        echo "${e}"
    done
} > "${GITREPO_DIR}/.gitignore"

# Sync an EMPTIED placeholder for secrets.yaml so its existence is tracked
# without ever committing real secret values.
if [ -f "${CONFIG_DIR}/secrets.yaml" ]; then
    printf '%s\n' "# Placeholder synced by git-sync - real secrets live only on the HA host." \
        > "${GITREPO_DIR}/secrets.yaml"
fi

cd "${GITREPO_DIR}"
git add -A

TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
if git diff --cached --quiet; then
    log "No changes to commit - ${CONFIG_DIR} already matches the checkout."
else
    git commit -m "sync: HA export ${TIMESTAMP}" || fail "git commit failed"
    log "Committed changes."
fi

# Push WITHOUT force. A rejection means the remote advanced under us -> fail-safe.
log "Pushing to origin/${BRANCH} (no force)..."
if ! git push origin "${BRANCH}"; then
    conflict "remote ahead of local, pull needed (push rejected, NOT force-pushed)"
fi

# --- Success ------------------------------------------------------------------
LAST_COMMIT="$(git rev-parse HEAD 2>/dev/null || echo '')"
# Recompute behind after the push (should be 0).
set +e
read -r BEHIND AHEAD < <(git rev-list --left-right --count "origin/${BRANCH}...HEAD" 2>/dev/null)
set -e
BEHIND="${BEHIND:-0}"
AHEAD="${AHEAD:-0}"

log_ok "Sync complete - HEAD=${LAST_COMMIT:0:8} (ahead=${AHEAD}, behind=${BEHIND})"
write_status "ok" "sync complete" "${LAST_COMMIT}" "${AHEAD}" "${BEHIND}"
exit 0
