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

# Install nginx (ingress path rewrite) and gh CLI (GitHub operations)
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx gh \
    && rm -rf /var/lib/apt/lists/*

# Nginx config for ingress proxy
COPY nginx.conf /etc/nginx/sites-enabled/default

# Copy our entrypoint
COPY --chmod=755 run.sh /run.sh

# HA maps /data as persistent storage
VOLUME ["/data"]

ENTRYPOINT []
CMD ["/run.sh"]
