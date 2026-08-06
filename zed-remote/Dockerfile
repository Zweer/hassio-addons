ARG BUILD_FROM=ghcr.io/hassio-addons/debian-base:9.3.0
FROM ${BUILD_FROM}

# Labels required by Home Assistant Supervisor
ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Zed Remote" \
    io.hass.description="SSH workspace for Zed Remote Development"

# Install SSH server and development essentials
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       openssh-server \
       git \
       curl \
       ca-certificates \
       build-essential \
       procps \
       rsync \
       vim-tiny \
       less \
       htop \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd

# SSH configuration: secure defaults
RUN sed -i \
    -e 's/^#PermitRootLogin.*/PermitRootLogin no/' \
    -e 's/^#PasswordAuthentication.*/PasswordAuthentication no/' \
    -e 's/^#PubkeyAuthentication.*/PubkeyAuthentication yes/' \
    -e 's/^#AuthorizedKeysFile.*/AuthorizedKeysFile .ssh\/authorized_keys/' \
    -e 's/^#ClientAliveInterval.*/ClientAliveInterval 60/' \
    -e 's/^#ClientAliveCountMax.*/ClientAliveCountMax 3/' \
    /etc/ssh/sshd_config \
    && echo "AllowTcpForwarding yes" >> /etc/ssh/sshd_config \
    && echo "X11Forwarding no" >> /etc/ssh/sshd_config

# Copy our entrypoint
COPY --chmod=755 run.sh /run.sh

# HA maps /data as persistent storage
VOLUME ["/data"]

EXPOSE 22

ENTRYPOINT []
CMD ["/run.sh"]
