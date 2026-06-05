# Pinned to an immutable digest for reproducible builds (Dependabot docker
# ecosystem keeps it current). Sim/dev image only — never shipped to users.
FROM nodered/node-red:3.1.15-18@sha256:81d444dbe761c8b0fff25dc3dc03e0f807476ae379ae728e779b557d8d189adf

USER root

# Working dir for the local contrib package (built into the image so the
# Node-RED node loader picks it up without needing a host bind mount).
WORKDIR /opt/contrib

# Copy the local package source. Excludes node_modules / test artefacts
# via the .dockerignore at the repo root. The Node-RED node entry points
# are referenced from package.json's "node-red.nodes" map — there is no
# index.js in this package.
COPY --chown=node-red:node-red package.json package-lock.json* ./
COPY --chown=node-red:node-red gree-hvac ./gree-hvac

RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

# nodemon is used by the dev override (docker-compose.dev.yml) to restart
# Node-RED when files in the bind-mounted contrib package change. Harmless
# in non-dev mode — it sits unused.
RUN npm install -g --no-audit --no-fund nodemon@3 && npm cache clean --force

WORKDIR /data

# Install the auxiliary Node-RED modules used by the sample flow.
# - @flowfuse/node-red-dashboard: dashboard widgets (ui-gauge, ui-text, ui-switch, ...)
# - @victronenergy/node-red-contrib-victron: nodes the original flow uses
#   for Battery SOC / State / Voltage / Ruuvi temperature. Marked optional —
#   if its native dbus dep fails to build on alpine the build still succeeds
#   and the nodes appear as "unknown" in the editor (the mocks tab provides
#   substitute data either way).
# - The local node-red-contrib-gree-hvac package installed by path.
COPY --chown=node-red:node-red docker/nodered/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund --no-package-lock /opt/contrib \
    && npm install --omit=dev --no-audit --no-fund --no-package-lock @flowfuse/node-red-dashboard@latest \
    && (npm install --omit=dev --no-audit --no-fund --no-package-lock @victronenergy/node-red-contrib-victron@latest || echo "[warn] @victronenergy install failed — Victron input nodes will be unknown, mocks tab covers it") \
    && npm cache clean --force

COPY --chown=node-red:node-red docker/nodered/settings.js ./settings.js
COPY --chown=node-red:node-red docker/nodered/flows.user.json /opt/build/flows.user.json
COPY --chown=node-red:node-red docker/nodered/flows.mocks.json /opt/build/flows.mocks.json
COPY --chown=node-red:node-red docker/nodered/merge-flows.js /opt/build/merge-flows.js

RUN node /opt/build/merge-flows.js \
        /opt/build/flows.user.json \
        /opt/build/flows.mocks.json \
        /data/flows.json \
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
