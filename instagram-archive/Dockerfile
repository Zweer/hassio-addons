ARG BUILD_FROM=node:24-slim
FROM ${BUILD_FROM}

ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Instagram Archive" \
    io.hass.description="Daily Instagram feed archiver with headful browser + noVNC"

ENV DEBIAN_FRONTEND=noninteractive \
    CHROMIUM_PATH=/usr/bin/chromium \
    DISPLAY=:99

# System Chromium (works on arm64/amd64 via Debian repos — Playwright does not
# ship a prebuilt Chromium for arm64 Linux, so we use the OS one), plus the
# virtual display stack for noVNC challenge solving.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      xvfb \
      x11vnc \
      x11-utils \
      novnc \
      websockify \
      jq \
      ca-certificates \
      fonts-liberation \
      fonts-noto-color-emoji \
      dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node dependencies first (better layer caching).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# App sources.
COPY tsconfig.json ./
COPY src/ ./src/

# Entrypoint.
COPY --chmod=755 run.sh /run.sh

# HA maps /data as persistent storage (browser profile + cookies live here).
VOLUME ["/data"]

# Ingress serves the noVNC page.
EXPOSE 6080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/run.sh"]
