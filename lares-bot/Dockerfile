ARG BUILD_FROM=node:20-slim
FROM ${BUILD_FROM}

ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Lares Bot" \
    io.hass.description="Automated strategy bot for Lares"

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      jq \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chmod=755 run.sh /run.sh

CMD ["/run.sh"]
