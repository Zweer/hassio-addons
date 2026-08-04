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

# Install bashio for HA integration
RUN if command -v apk >/dev/null 2>&1; then \
        apk add --no-cache bash curl jq; \
    elif command -v apt-get >/dev/null 2>&1; then \
        apt-get update && apt-get install -y --no-install-recommends \
            bash curl jq && \
        rm -rf /var/lib/apt/lists/*; \
    fi

# Copy our run script
COPY run.sh /
RUN chmod a+x /run.sh

# Persistent data lives in /data (HA convention)
VOLUME ["/data"]

ENTRYPOINT []
CMD ["/run.sh"]
