# RomM — Home Assistant addon
#
# Built FROM the official upstream image rather than a Home Assistant base:
# reproducing it would mean rebuilding nginx+mod_zip, gunicorn, valkey,
# EmulatorJS, RuffleRS, js-dos and RAHasher. Upstream publishes linux/arm64, so
# the Raspberry Pi 4 (aarch64) is covered. The plain tag (not -slim) is required:
# it is the one carrying the in-browser players.
#
# BUILD_FROM is pinned to a specific upstream tag by the CI build args so that a
# rebuild never silently pulls a new major. Dependabot bumps it via PRs.
ARG BUILD_FROM=ghcr.io/rommapp/romm:5.3.1
FROM ${BUILD_FROM}

# Labels required by the Home Assistant Supervisor.
ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="RomM" \
    io.hass.description="Self-hosted ROM library manager and in-browser player (RomM)"

# The upstream image is nginx:alpine based (not a HA base image), so bashio is
# not available: we read /data/options.json with jq instead. Install it with apk.
USER root
# hadolint ignore=DL3018
RUN apk add --no-cache jq

# Replace the entrypoint, not the command: run.sh translates addon options into
# the environment upstream expects and then execs the original entrypoint, which
# ends in `exec "$@"` and hands control to the s6 tree declared in CMD.
COPY --chmod=755 run.sh /run.sh

EXPOSE 8080

ENTRYPOINT ["/run.sh"]
CMD ["/init"]
