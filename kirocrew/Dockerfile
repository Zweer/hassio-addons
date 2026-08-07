ARG BUILD_FROM=ghcr.io/kirodotdev/kirocrew:stable
FROM ${BUILD_FROM}

# Labels required by Home Assistant Supervisor
ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Kiro Crew" \
    io.hass.description="Persistent AI development workspace"

# HA addons run as root (Supervisor provides container-level isolation)
USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV HOME=/home/kirocrew

# Install runtime dependencies and tools
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       gh \
       vim-tiny \
       libatomic1 \
       curl \
       ca-certificates \
    && ln -sf /usr/bin/vim.tiny /usr/bin/vi \
    && rm -rf /var/lib/apt/lists/*

# Install nvm + Node.js LTS for the kirocrew user
ENV NVM_DIR=/home/kirocrew/.nvm
RUN mkdir -p "$NVM_DIR" \
    && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash \
    && . "$NVM_DIR/nvm.sh" \
    && nvm install --lts \
    && nvm alias default lts/* \
    && nvm cache clear \
    && chown -R kirocrew:kirocrew "$NVM_DIR"

# Make node/npm available in PATH for all users
ENV PATH="$NVM_DIR/versions/node/default/bin:$PATH"
RUN ln -sf "$(find $NVM_DIR/versions/node -maxdepth 1 -type d | sort -V | tail -1)/bin/node" /usr/local/bin/node \
    && ln -sf "$(find $NVM_DIR/versions/node -maxdepth 1 -type d | sort -V | tail -1)/bin/npm" /usr/local/bin/npm \
    && ln -sf "$(find $NVM_DIR/versions/node -maxdepth 1 -type d | sort -V | tail -1)/bin/npx" /usr/local/bin/npx

# Copy our entrypoint
COPY --chmod=755 run.sh /run.sh

# HA maps /data as persistent storage
VOLUME ["/data"]

ENTRYPOINT []
CMD ["/run.sh"]
