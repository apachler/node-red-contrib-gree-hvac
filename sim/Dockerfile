# Pinned to a patch line for reproducible builds (digest-pin is a backlog item).
FROM node:18.20-alpine

WORKDIR /app

COPY package.json ./

# Sim has no third-party deps yet; this keeps the layer cacheable if we add some.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev && npm cache clean --force; fi

COPY src ./src
COPY public ./public
COPY bin ./bin

ENV GREE_SIM_UDP_PORT=7000 \
    GREE_SIM_HTTP_PORT=8080 \
    GREE_SIM_CIPHER=ecb

EXPOSE 7000/udp 8080/tcp

HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
    CMD wget -q -O - http://127.0.0.1:8080/api/state >/dev/null || exit 1

# Drop privileges: run as the unprivileged `node` user shipped with the image.
# The app only reads its files and binds ports >1024, so no chown is needed.
USER node

CMD ["node", "bin/gree-sim.js"]
