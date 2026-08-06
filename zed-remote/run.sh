#!/usr/bin/with-contenv bashio
# shellcheck shell=bash
# ==============================================================================
# Zed Remote - SSH Workspace for Home Assistant
# ==============================================================================

declare USERNAME
declare WORKSPACE_PATH

# --- Read configuration -------------------------------------------------------
USERNAME=$(bashio::config 'username')
WORKSPACE_PATH=$(bashio::config 'workspace_path')

bashio::log.info "Starting Zed Remote SSH Workspace..."
bashio::log.info "Username: ${USERNAME}"
bashio::log.info "Workspace: ${WORKSPACE_PATH}"

# --- Create user if it doesn't exist -----------------------------------------
if ! id "${USERNAME}" &>/dev/null; then
    bashio::log.info "Creating user '${USERNAME}'..."
    useradd -m -s /bin/bash -d "/home/${USERNAME}" "${USERNAME}"
fi

# --- Set up workspace directory -----------------------------------------------
# Use /data for persistence across addon restarts
PERSISTENT_WORKSPACE="/data/workspace"
mkdir -p "${PERSISTENT_WORKSPACE}"
chown "${USERNAME}:${USERNAME}" "${PERSISTENT_WORKSPACE}"

# Create symlink from configured workspace path
if [ "${WORKSPACE_PATH}" != "${PERSISTENT_WORKSPACE}" ]; then
    mkdir -p "$(dirname "${WORKSPACE_PATH}")"
    ln -sfn "${PERSISTENT_WORKSPACE}" "${WORKSPACE_PATH}"
fi

# --- Set up SSH authorized keys -----------------------------------------------
SSH_DIR="/home/${USERNAME}/.ssh"
mkdir -p "${SSH_DIR}"

# Write authorized keys from config
KEYS_FILE="${SSH_DIR}/authorized_keys"
: > "${KEYS_FILE}"

for key in $(bashio::config 'authorized_keys'); do
    echo "${key}" >> "${KEYS_FILE}"
done

# Set permissions
chmod 700 "${SSH_DIR}"
chmod 600 "${KEYS_FILE}"
chown -R "${USERNAME}:${USERNAME}" "${SSH_DIR}"

KEY_COUNT=$(wc -l < "${KEYS_FILE}")
bashio::log.info "Configured ${KEY_COUNT} authorized key(s)"

if [ "${KEY_COUNT}" -eq 0 ]; then
    bashio::log.warning "No SSH keys configured! You won't be able to connect."
    bashio::log.warning "Add your public key in the addon configuration."
fi

# --- Generate host keys if missing (persist in /data) -------------------------
SSH_HOST_KEY_DIR="/data/ssh_host_keys"
mkdir -p "${SSH_HOST_KEY_DIR}"

if [ ! -f "${SSH_HOST_KEY_DIR}/ssh_host_ed25519_key" ]; then
    bashio::log.info "Generating SSH host keys (first run)..."
    ssh-keygen -t ed25519 -f "${SSH_HOST_KEY_DIR}/ssh_host_ed25519_key" -N ""
    ssh-keygen -t rsa -b 4096 -f "${SSH_HOST_KEY_DIR}/ssh_host_rsa_key" -N ""
fi

# Symlink host keys to standard location
ln -sf "${SSH_HOST_KEY_DIR}/ssh_host_ed25519_key" /etc/ssh/ssh_host_ed25519_key
ln -sf "${SSH_HOST_KEY_DIR}/ssh_host_ed25519_key.pub" /etc/ssh/ssh_host_ed25519_key.pub
ln -sf "${SSH_HOST_KEY_DIR}/ssh_host_rsa_key" /etc/ssh/ssh_host_rsa_key
ln -sf "${SSH_HOST_KEY_DIR}/ssh_host_rsa_key.pub" /etc/ssh/ssh_host_rsa_key.pub

# --- Zed server persistence ---------------------------------------------------
# Zed installs its remote server in ~/.local/share/zed — persist it
ZED_DATA_DIR="/data/zed-server"
USER_ZED_DIR="/home/${USERNAME}/.local/share/zed"
mkdir -p "${ZED_DATA_DIR}"
mkdir -p "$(dirname "${USER_ZED_DIR}")"
ln -sfn "${ZED_DATA_DIR}" "${USER_ZED_DIR}"
chown -R "${USERNAME}:${USERNAME}" "${ZED_DATA_DIR}" "/home/${USERNAME}/.local"

# --- Give user access to HA config and share ----------------------------------
# /config is HA config, /share is shared storage
if [ -d /config ]; then
    ln -sfn /config "/home/${USERNAME}/ha-config"
fi
if [ -d /share ]; then
    ln -sfn /share "/home/${USERNAME}/ha-share"
fi

# --- Start SSH server ---------------------------------------------------------
bashio::log.info "Starting SSH server on port 22..."
exec /usr/sbin/sshd -D -e
