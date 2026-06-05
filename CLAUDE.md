# CLAUDE.md

Guidance for Claude Code sessions in this repo.

## What this repo is

`node-red-contrib-gree-hvac` — Node-RED nodes that control Gree air-conditioner units over their UDP/AES protocol. The repo also ships a software simulator of a Gree AC plus a docker-compose stack so the nodes can be developed and tested without hardware.

## Layout

```
gree-hvac/                 # the published Node-RED nodes
  gree-hvac.js             #   main control + observe node (wraps gree-hvac-client + ConnectionManager)
  gree-hvac-config.js      #   device config node (host + port)
  gree-hvac-discover.js    #   UDP broadcast discovery node
  lib/connection-manager.js#   24/7 reconnect, backoff, watchdogs
  lib/validation.js
test/                      # unit tests for the nodes (node:test)
test/e2e/                  # end-to-end tests that drive the full docker-compose stack
sim/                       # standalone Gree simulator
  src/cipher.js            #   AES-ECB + AES-GCM (mirrors gree-hvac-client/src/encryption-service)
  src/transformer.js       #   vendor <-> friendly property/value maps
  src/state.js             #   mutable device state (Pow, Mod, SetTem, TemSen, ...)
  src/simulator.js         #   UDP server: discover / bind / status / cmd handlers
  src/dashboard.js         #   HTTP + SSE dashboard (state, faults, sensors)
  src/sensors.js           #   mock Victron/Ruuvi sensor values for the example flow
  src/fault-injection.js   #   dropEvery / dropProbability / latency / jitter
  bin/gree-sim.js          #   CLI entrypoint (env-driven config)
  public/                  #   dashboard HTML/CSS/JS
  test/                    #   unit tests for the sim itself
docker/nodered/            # Node-RED service image: contrib package + sample flow + mocks tab
docker-compose.yml         # gree-sim + node-red on a user-defined bridge; sim aliased as gree.lan
.github/workflows/
  ci.yml                   #   lint + unit tests (Node 18 + 20 matrix)
  e2e.yml                  #   sim unit tests + docker-compose e2e
  release.yml              #   tag-driven (push v*) — sets package version from tag, npm publish, GH release with .tgz
```

## Daily commands

```bash
npm test           # unit tests for the contrib nodes
npm run test:sim   # unit tests for the simulator (in-process)
npm run sim:up     # docker compose up -d --build (sim + node-red)
npm run sim:down   # tear down + remove volumes
npm run sim:logs   # tail container logs
npm run test:e2e   # bring stack up, run e2e suite, tear down
npm run flow:push  # deploy host flow sources to the running editor (no rebuild)
npm run flow:pull  # capture the editor's deployed flow back into the source files
```

While iterating on e2e tests: `E2E_SKIP_BUILD=1 E2E_KEEP_UP=1 npm run test:e2e` to reuse images and leave the stack running.

## Conventions

- **Node version**: 18+ (matches `engines.node` and the dockerfiles).
- **Tests**: `node --test` (no jest/mocha). Tests live next to what they cover (`test/`, `sim/test/`, `test/e2e/`).
- **Logging**: each node accepts a `logLevel` config; the contrib node forwards it into the client.
- **Style**: ESLint + Prettier enforced via `npm run lint`. Single quotes, 4-space indent in JS, 2-space in JSON/YAML.

## Gree protocol cheat-sheet

Full human-readable spec (transport, encryption, message flow, every property + value, the TemSen +40 quirk): **`docs/PROTOCOL.md`**. Quick reference below.

The wire format lives in `node_modules/gree-hvac-client/src/`. The simulator mirrors it.

| Step       | Client → Device                                       | Device → Client                              |
| ---------- | ----------------------------------------------------- | -------------------------------------------- |
| Discover   | `{"t":"scan"}` (unencrypted, UDP broadcast or unicast) | `{t:"pack", pack:<ECB(generic_key) {t:"dev", cid, mac, name, ...}>}` |
| Bind       | `{t:"pack", pack:<ECB(generic_key) {t:"bind", mac, uid:0}>}` | `{t:"pack", pack:<ECB(generic_key) {t:"bindok", key:<16-char device key>}>}` |
| Status     | `{t:"pack", pack:<ECB(device_key) {t:"status", mac, cols:[...]}>}` | `{t:"pack", pack:<ECB(device_key) {t:"dat", cols, dat}>}` |
| Set        | `{t:"pack", pack:<ECB(device_key) {t:"cmd", opt:[...], p:[...]}>}` | `{t:"pack", pack:<ECB(device_key) {t:"res", opt, val}>}` |

The same envelope works for GCM-cipher devices; the inner payload is AES-128-GCM with a fixed nonce + AAD (`qualcomm-test`). Generic keys: ECB = `a3K8Bx%2r8Y7#xDh`, GCM = `{yxAHAY_Lm6pbC/<`. After `bindok`, both sides switch to the device key.

## Releasing

Releases are tag-driven (`release.yml` triggers on `push: tags: v*`). To cut a release:

```bash
git tag -s vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The workflow sets `package.json` version from the tag, runs `npm publish` (needs `NPM_TOKEN` secret + the `release` GitHub environment), and creates a GitHub Release with the `.tgz` attached. There is no auto-bump from commit messages — pick the version manually.

## Production vs simulator

- **`docker/nodered/flows.user.json` is the production flow** — the one to import into a real Node-RED (e.g. on Venus OS) driving real Gree hardware. It contains only the control logic + dashboards; no simulator/mock dependencies.
- **`docker/nodered/flows.mocks.json` is simulator-only.** `merge-flows.js` appends it to the user flow at image build time to produce the `flows.json` that runs *inside the docker stack* (mock Victron/Ruuvi sensors, the Sim Sensors + Sim Clock pages). It must **not** be deployed to real hardware.
- For real hardware: import `flows.user.json`, point the `gree-hvac-config` node at the AC's real host/IP (the sample uses `gree.lan`), and wire the real Victron/Ruuvi input nodes (named `Battery SOC`, `Battery State`, `Battery Voltage`, `Ruuvi Inside`, `Ruuvi Outside`) into `Collect Data`.

## Editing the flow (merge / push / pull)

The flow source is split across two files (`flows.user.json` = production, `flows.mocks.json` = sim-only mocks tab). Three scripts in `docker/nodered/` move between those sources and the runtime. They are inverses of each other:

| Script | npm | Direction | What it does |
| ------ | --- | --------- | ------------ |
| `merge-flows.js` | — (build step) | sources → image | Concatenates `flows.user.json` + `flows.mocks.json` into `flows.json`, baked into the node-red image at **build time**. Run automatically in the Dockerfile. |
| `push-flows.js` | `npm run flow:push` | sources → **running** editor | Merges the two sources and full-deploys them to the running Node-RED via `POST /flows`. Loads instantly, persists to `/data` — **no rebuild**. |
| `pull-flows.js` | `npm run flow:pull` | running editor → sources | Fetches the deployed flow from `GET /flows` and splits it back into `flows.user.json` + `flows.mocks.json`, classifying nodes by tab membership + config reachability (shared `ui-base`/`ui-theme` stay with the user flow so the files never collide on merge). Order-preserving, so a one-widget edit is a one-line diff. |

**Inner loop for editing flow source on the host** (no rebuild needed):

```bash
# edit flows.user.json / flows.mocks.json, then:
npm run flow:push        # deploy to the running stack
# …then refresh the editor in the browser
```

**Inner loop for editing in the browser editor**, then capturing it back to the repo:

```bash
# edit + Deploy in the editor at :1880, then:
npm run flow:pull        # writes both source files; review with git diff
```

`flow:pull[:user|:mocks]` and `flow:push[both|user]` accept a target arg to limit which side they touch. Both default to the full set and target `http://127.0.0.1:1880` (override with `NR_URL`). A rebuild (`npm run sim:dev`) is only needed when the **contrib node code** (`gree-hvac/*.js`) or the image changes — not for flow edits.

Caveats: `flow:push` overwrites whatever is deployed (warn dialog if you have unsaved editor edits). A `flow:pull` round-trip introduces harmless Node-RED normalisation (it reorders nodes — undone by the script — clamps long comment positions, drops redundant `outputs`, adds an empty trailing output array); none of it changes behaviour, so just skim the `git diff`.

## Things to know

- **Actions on this repo**: push events to branches do not trigger Actions; only tag pushes do (release.yml) and PR/push to master (ci.yml + e2e.yml). If a workflow seems to be missing, check repo Actions settings before assuming a config bug.
- **The example flow** at `docker/nodered/flows.user.json` is the user's real flow. The mocks tab in `flows.mocks.json` is merged in at image build time (`merge-flows.js`) — don't edit the user file to add mock data; edit the mocks file.
- **`gree.lan`** is hard-coded in the example flow's config node. Docker-compose aliases the sim container as `gree.lan` on `sim-net` so the flow resolves without modification.
- **The simulator dashboard at `:8080`** is a standalone Gree-device simulator — it controls the simulated AC unit and simulates its protocol link (fault injection). It has **no** dependency on the example flow. Mock Victron/Ruuvi sensor values are set from the Node-RED "Sim Sensors" page (which POSTs `/api/sensors`).
