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

# Install cloudflared (tunnel) and gh CLI (GitHub operations)
ARG BUILD_ARCH=amd64
RUN apt-get update \
    && apt-get install -y --no-install-recommends gh curl \
    && ARCH=$([ "${BUILD_ARCH}" = "aarch64" ] && echo "arm64" || echo "amd64") \
    && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
       -o /usr/local/bin/cloudflared \
    && chmod +x /usr/local/bin/cloudflared \
    && rm -rf /var/lib/apt/lists/*

# Copy our entrypoint
COPY --chmod=755 run.sh /run.sh

# HA maps /data as persistent storage
VOLUME ["/data"]

ENTRYPOINT []
CMD ["/run.sh"]
