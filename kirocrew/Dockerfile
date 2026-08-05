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

# Base image already includes Python, bash, and kiro-cli
# HA Supervisor manages container-level isolation; run as root inside
USER root

# Install gh CLI for GitHub operations (PR creation, issue management, etc.)
RUN apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# Copy our run script (with exec permission set at copy time)
COPY --chmod=755 run.sh /run.sh

# Persistent data lives in /data (HA convention)
VOLUME ["/data"]

ENTRYPOINT []
CMD ["/run.sh"]
