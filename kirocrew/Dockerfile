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

# Install jq for parsing HA options.json (bash/curl likely already present)
RUN if ! command -v jq >/dev/null 2>&1; then \
        if command -v apk >/dev/null 2>&1; then \
            apk add --no-cache jq; \
        elif command -v apt-get >/dev/null 2>&1; then \
            apt-get update && apt-get install -y --no-install-recommends jq && \
            rm -rf /var/lib/apt/lists/*; \
        elif command -v pip >/dev/null 2>&1; then \
            pip install --no-cache-dir jq; \
        fi; \
    fi

# Copy our run script
COPY run.sh /
RUN chmod a+x /run.sh

# Persistent data lives in /data (HA convention)
VOLUME ["/data"]

ENTRYPOINT []
CMD ["/run.sh"]
