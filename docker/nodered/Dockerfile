FROM nodered/node-red:3.1-18

USER root

# Working dir for the local contrib package (built into the image so the
# Node-RED node loader picks it up without needing a host bind mount).
WORKDIR /opt/contrib

# Copy the local package source. Excludes node_modules / test artefacts
# via the .dockerignore at the repo root.
COPY --chown=node-red:node-red package.json package-lock.json* ./
COPY --chown=node-red:node-red gree-hvac ./gree-hvac
COPY --chown=node-red:node-red index.js ./index.js

RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

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

USER node-red

EXPOSE 1880

HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
    CMD wget -q -O - http://127.0.0.1:1880/ >/dev/null || exit 1
