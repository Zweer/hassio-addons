ARG BUILD_FROM=ghcr.io/suwayomi/suwayomi-server:stable
FROM ${BUILD_FROM}

# Labels required by Home Assistant Supervisor
ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Suwayomi" \
    io.hass.description="Self-hosted manga reader server (Suwayomi/Tachidesk)"

# The upstream image runs as the non-root "suwayomi" user (uid 1000) with a
# tini entrypoint. Home Assistant addons run as root so the Supervisor can
# manage /data and /share permissions; we switch back to root, drop in our
# entrypoint (run.sh), and hand off to the upstream startup script.
USER root

# The upstream image is Ubuntu-based (eclipse-temurin), not a HA base image, so
# bashio is not available. We read /data/options.json with jq instead. jq is
# already present when KCEF is bundled, but install it explicitly to be safe.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq util-linux \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy our entrypoint (translates HA options -> env vars for the upstream script)
COPY --chmod=755 run.sh /run.sh

# HA maps /data as persistent storage (Suwayomi data dir is symlinked here at runtime)
VOLUME ["/data"]

EXPOSE 4567

# Reuse the upstream tini init; our run.sh execs the upstream startup script.
ENTRYPOINT ["tini", "--"]
CMD ["/run.sh"]
