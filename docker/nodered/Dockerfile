# Pinned to an immutable digest for reproducible builds (Dependabot docker
# ecosystem keeps it current). Sim/dev image only — never shipped to users.
FROM nodered/node-red:5.0.9-24@sha256:2ccd38b4066648bd5e17430c50a2f8102c566a82fd4f2fc5c342e61664d6896f

# Node-RED 5.0.9 pins exact versions with fixed HIGH CVEs in its own tree
# (/usr/src/node-red): body-parser 1.20.8 (CVE-2026-111181), multer 2.4.0
# (CVE-2026-113872), follow-redirects 1.16.1 (CVE-2026-116689) and npm
# 11.21.1, whose bundled undici 6.29.0 has CVE-2026-109383/-109869/-87018.
# Override them until a nodered/node-red release picks the fixes up, then
# drop this step. Runs as the base image's node-red user so the tree keeps
# its ownership.
WORKDIR /usr/src/node-red
RUN npm pkg set overrides.body-parser='~1.20.9' overrides.multer='^2.5.0' \
        overrides.follow-redirects='^1.16.2' overrides.npm='^11.21.2' \
    && npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force \
    && rm -rf "$(npm config get cache)/_logs"

USER root

# Pick up Alpine security patches (zlib, musl, ...) released after the base
# image was built.
RUN apk upgrade --no-cache

# Working dir for the local contrib package (built into the image so the
# Node-RED node loader picks it up without needing a host bind mount).
WORKDIR /opt/contrib

# Copy the local package source. Excludes node_modules / test artefacts
# via the .dockerignore at the repo root. The Node-RED node entry points
# are referenced from package.json's "node-red.nodes" map — there is no
# index.js in this package.
COPY --chown=node-red:node-red package.json package-lock.json* ./
COPY --chown=node-red:node-red gree-hvac ./gree-hvac

# npm's debug logs record the signed (JWT-bearing) redirect URL of the
# gree-hvac-client GitHub Release tarball; `cache clean` leaves _logs, so drop
# them explicitly or every image carries a secret-scanner hit.
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force \
    && rm -rf "$(npm config get cache)/_logs"

# nodemon is used by the dev override (docker-compose.dev.yml) to restart
# Node-RED when files in the bind-mounted contrib package change. Harmless
# in non-dev mode — it sits unused.
# npm itself is upgraded too: the base image's global npm bundles
# vulnerable undici/brace-expansion that Trivy flags. Range, not a pin:
# Dependabot does not track RUN lines, so each rebuild takes the latest 11.x.
RUN npm install -g --no-audit --no-fund npm@11 nodemon@3 && npm cache clean --force \
    && rm -rf "$(npm config get cache)/_logs"

WORKDIR /data

# Install the local node-red-contrib-gree-hvac package by path, plus the
# dependencies listed in docker/nodered/package.json: Dashboard 2.0
# (@flowfuse/node-red-dashboard, pinned) for the dashboard-thermostat example.
COPY --chown=node-red:node-red docker/nodered/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock /opt/contrib \
    && npm cache clean --force \
    && rm -rf "$(npm config get cache)/_logs"

COPY --chown=node-red:node-red docker/nodered/settings.js ./settings.js

# The dev flows are the shipped examples, one tab each, pointed at the
# simulator.
COPY --chown=node-red:node-red examples/basic-control.json examples/dashboard-thermostat.json /opt/build/
COPY --chown=node-red:node-red docker/nodered/build-flows.js /opt/build/build-flows.js

RUN node /opt/build/build-flows.js /data/flows.json /opt/build/basic-control.json /opt/build/dashboard-thermostat.json \
    && chown node-red:node-red /data/flows.json

# Reset WORKDIR back to the base image's dir. The official node-red image's
# ENTRYPOINT is the relative path ./entrypoint.sh, resolved against
# /usr/src/node-red — leaving WORKDIR at /data breaks it with
# "stat ./entrypoint.sh: no such file or directory". The userDir stays
# /data (the entrypoint defaults to it); only the launch CWD matters here.
WORKDIR /usr/src/node-red

USER node-red

EXPOSE 1880

HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
    CMD wget -q -O - http://127.0.0.1:1880/ >/dev/null || exit 1
