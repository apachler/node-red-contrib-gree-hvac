# CLAUDE.md

Guidance for Claude Code sessions in this repo.

## What this repo is

`node-red-contrib-gree-hvac` — Node-RED nodes that control Gree air-conditioners over their UDP/AES protocol. Ships a software simulator of a Gree AC plus a docker-compose stack so the nodes can be developed and tested without hardware.

## Layout

```
gree-hvac/                     published nodes
  gree-hvac.js                   control/observe node (wraps gree-hvac-client + ConnectionManager)
  lib/connection-manager.js      24/7 reconnect, backoff, watchdogs; swallows client 'error' events
  lib/validation.js              drops unknown/invalid properties before send
  gree-hvac-config.js            device host+port      gree-hvac-discover.js  UDP broadcast discovery
sim/                           standalone Gree simulator (cipher, transformer, state,
                               UDP server, HTTP+SSE dashboard, fault injection)
docker/nodered/                Node-RED image: contrib pkg + flow sources + merge/push/pull scripts
test/  test/e2e/  sim/test/    node:test unit + e2e suites
docs/PROTOCOL.md               full protocol + property/value spec
```

## Daily commands

```
npm test           # unit tests for the contrib nodes
npm run test:sim   # simulator unit tests (in-process)
npm run sim:up     # docker compose up -d --build (sim + node-red)
npm run sim:down   # tear down + remove volumes
npm run sim:logs   # tail container logs
npm run test:e2e   # bring stack up, run e2e, tear down
npm run flow:push  # deploy flow sources to the running editor (no rebuild)
npm run flow:pull  # capture the editor's deployed flow back into the source files
```

Iterating on e2e: `E2E_SKIP_BUILD=1 E2E_KEEP_UP=1 npm run test:e2e` reuses images and leaves the stack up.

## Conventions

- Node 22 LTS for development (`.nvmrc`, CI, docker images); the lint toolchain (ESLint 10) requires Node 22+. Published runtime still supports Node 18+ (`engines.node`), and CI runs the tests on 18/20/22.
- Tests: `node --test` (no jest/mocha), beside what they cover.
- Style: ESLint + Prettier (`npm run lint`). Single quotes, 4-space JS, 2-space JSON/YAML. The pre-push hook runs `eslint --fix`; `GREE_SKIP_LINT=1 git push` to skip.
- Each node takes a `logLevel`; the contrib node forwards it into the client.

## Editing the flow (the non-obvious part)

Flow source is split: `docker/nodered/flows.user.json` = **production** (control logic + dashboards; deploy to real hardware), `flows.mocks.json` = **sim-only** (mock Victron/Ruuvi sensors + Sim Sensors/Clock pages). `merge-flows.js` concatenates them into `flows.json` at image build time. **Don't add mock data to the production file — edit `flows.mocks.json`.**

- `npm run flow:push` — merge both sources → full-deploy to the running editor (instant, no rebuild); then refresh the browser.
- `npm run flow:pull` — capture the deployed flow → split back into the two source files (order-preserving, so a small edit is a small diff; adds harmless Node-RED normalisation).
- Both target `http://127.0.0.1:1880` (override `NR_URL`); optional target arg (`:user`/`:mocks`). A rebuild (`sim:dev`) is only needed when contrib node code or the image changes — not for flow edits.

Dashboard is **Dashboard 2.0** (`@flowfuse/node-red-dashboard`):
- `ui-button` ignores the legacy `bgcolor`/`color`; use `buttonColor`/`textColor` (settable at runtime via `msg.ui_update`). There is no dynamic `enabled` — "disable" a button by recolouring it grey.
- Inspect a widget's exact schema: `docker exec gree-nodered sh -c 'grep -n "defaults:" -A40 /data/node_modules/@flowfuse/node-red-dashboard/nodes/widgets/ui_<widget>.html'`.

## Gree protocol

Full spec (transport, encryption, every property + value, the TemSen +40 quirk): **`docs/PROTOCOL.md`**. The simulator mirrors `node_modules/gree-hvac-client/src/`. Generic keys: ECB `a3K8Bx%2r8Y7#xDh`, GCM `{yxAHAY_Lm6pbC/<`; after `bindok` both sides switch to the device key.

## Releasing

Automated via **semantic-release** (`release.yml` on `push` to `master`). Merging a PR to master with a Conventional-Commit title computes the next version, bumps `package.json` + `CHANGELOG.md` (commit carries `[skip ci]`), tags, and creates a GitHub Release with the `.tgz`. `fix:` → patch, `feat:` → minor. PRs are **squash-merged**, so the PR title must be a valid Conventional Commit. Don't hand-pick versions or push tags — semantic-release owns them. `npm publish` is still gated/disabled (GitHub Release + tarball only). The client dependency is a GitHub Release tarball URL — to ship a `gree-hvac-client` fix, release it there first, then bump the URL + `npm install` here.

## Gotchas

- **`gree.lan`** is hard-coded in the example flow's config node; docker-compose aliases the sim container as `gree.lan` so it resolves without editing the flow.
- The **sim dashboard at :8080** is a standalone Gree-device simulator (drives the simulated AC + fault injection) with no dependency on the example flow. Mock Victron/Ruuvi values come from the Node-RED "Sim Sensors" page (POST `/api/sensors`).
- **Workflow triggers**: only tag pushes (release.yml) and PR/push-to-master (ci.yml + e2e.yml) run Actions; pushes to feature branches don't.
- Config persists via the `persistent`/`default` localfilesystem context store (`settings.js`), so it survives restarts where `/data` persists. The docker `node-red` service has **no `/data` volume**, so a rebuild/recreate wipes it (a plain `docker restart` keeps it).
