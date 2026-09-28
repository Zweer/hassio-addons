ARG BUILD_FROM=alpine:3.20
FROM ${BUILD_FROM}

ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Git Sync" \
    io.hass.description="One-shot bidirectional Git sync for Home Assistant config"

RUN apk add --no-cache \
      git \
      openssh \
      rsync \
      jq \
      bash \
      ca-certificates

WORKDIR /app

COPY --chmod=755 run.sh /run.sh

CMD ["/run.sh"]
