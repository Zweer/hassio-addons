ARG BUILD_FROM=node:24-alpine

# ─── Build stage: install deps + bundle everything into one file ─────────────
FROM ${BUILD_FROM} AS builder

WORKDIR /build

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json tsdown.config.ts ./
COPY src ./src
RUN npm run build     # → dist/index.mjs (all deps inlined, minified)

# ─── Runtime stage: only node + the bundle. No node_modules, no tsx. ─────────
FROM ${BUILD_FROM}

ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Instagram Archiver" \
    io.hass.description="Archives public Instagram profiles to /share via StoryNavigation"

# Alpine uses apk. jq → parse options.json in run.sh; ca-certificates → HTTPS.
# bash → run.sh uses bash-isms; Alpine ships only ash by default.
RUN apk add --no-cache \
      bash \
      jq \
      ca-certificates

WORKDIR /app

# Ship only the pre-built, self-contained bundle.
COPY --from=builder /build/dist ./dist

COPY --chmod=755 run.sh /run.sh

CMD ["/run.sh"]
