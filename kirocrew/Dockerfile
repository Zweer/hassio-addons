# Node.js comes from the official image instead of nvm: per-arch, pinned and
# reproducible, with no network fetch at build time. Dependabot bumps both
# FROM lines (docker ecosystem on /kirocrew).
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS node

FROM ghcr.io/kirodotdev/kirocrew:0.13.1@sha256:080c81417fd67d03ca28fdd983cb309efbcea8ee618adaeeb75a2ed96bcf58d1

# Labels required by Home Assistant Supervisor
ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="addon" \
    io.hass.arch="${BUILD_ARCH}" \
    io.hass.name="Kiro Crew" \
    io.hass.description="Persistent AI development workspace"

# run.sh starts as root only to fix /data ownership, then drops to kirocrew.
USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       gh \
       vim-tiny \
       libatomic1 \
    && ln -sf /usr/bin/vim.tiny /usr/bin/vi \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version && npm --version

# One HOME for everybody: the gateway, `docker exec` shells and the helpers
# all resolve ~/.kiro (Crew data) and ~/.local/share/kiro-cli (login) under
# /data, so a login survives container recreation and lands in backups.
ENV HOME=/data/home \
    KIROCREW_ALLOW_UNSANDBOXED=1
RUN usermod -d /data/home kirocrew

COPY --chmod=755 run.sh /run.sh
COPY --chmod=755 rootfs/usr/local/bin/ /usr/local/bin/
COPY --chmod=644 apply_options.py /usr/local/lib/kirocrew-addon/apply_options.py

ENTRYPOINT []
CMD ["/run.sh"]
