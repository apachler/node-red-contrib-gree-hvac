# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`node-red-contrib-gree-hvac` — Node-RED nodes that control Gree air-conditioners over their UDP/AES protocol, built on the [`gree-hvac-client`](https://github.com/apachler/gree-hvac-client) fork (sibling checkout `../gree-hvac-client`). Ships a software simulator of a Gree AC plus a docker-compose stack so the nodes can be developed and tested without hardware.

## Layout

```
gree-hvac/                     published nodes
  gree-hvac.js                   control/observe node: 4 outputs (changes, snapshot, diagnostics, msg.action responses)
  lib/connection-manager.js      thin adapter around ONE long-lived client: state/diagnostics from its events + write queue
  lib/actions.js                 msg.action requests (getDeviceInfo, setClock, ...) → client methods
  lib/validation.js              drops unknown / read-only / invalid properties before send
  gree-hvac-config.js            device host+port, resolve-by-MAC, multi-split subUnit, firmware options (halfDegree, ...)
  gree-hvac-discover.js          Client.discover() scan + configureWifi (AP-mode setup)
sim/                           standalone Gree simulator (cipher, transformer, state, UDP server,
                               HTTP+SSE dashboard, fault injection); configured by GREE_SIM_* env vars
docker/nodered/                Node-RED dev image; build-flows.js bakes examples/basic-control.json in (host gree.lan)
examples/                      shipped example flows (Import → Examples): basic-control (core nodes only),
                               dashboard-thermostat (Dashboard 2.0, @flowfuse/node-red-dashboard)
test/  test/e2e/  sim/test/    node:test unit + e2e suites
docs/PROTOCOL.md               full protocol + property/value spec + client-option → node-setting map
```

## Commands

```
npm test                 # unit tests for the contrib nodes (test/*.test.js)
npm run test:sim         # simulator tests, incl. the real client against the sim
npm run coverage:check   # both suites under c8 with the coverage gate CI enforces
npm run lint             # ESLint (Node 22+ required for the lint toolchain)
npm run format:check     # Prettier on md/yml/json (CI-enforced); `npm run format` fixes
npm run lint:lockfile    # lockfile-lint: npm registry over HTTPS + the pinned client tarball URL
npm run sim:up / sim:down / sim:logs   # docker stack: sim (:8080 dashboard, udp :7000) + node-red (:1880)
npm run sim:dev          # same, with gree-hvac/ bind-mounted and Node-RED under nodemon
npm run test:e2e         # build + start the stack, run test/e2e, tear down
```

Single test: `node --test --test-name-pattern="<regex>" test/gree-hvac-node.test.js`. Iterating on e2e: `E2E_SKIP_BUILD=1 E2E_KEEP_UP=1 npm run test:e2e` reuses images and leaves the stack up. `node docs/screenshot.mjs` regenerates `docs/sim-dashboard.png` against a running stack (needs Playwright, not a devDependency: `npm i --no-save playwright`).

## Architecture

- **The client owns the connection.** Since `gree-hvac-client` 4.4, connect retries with back-off, the re-bind after `maxNoResponse` missed polls (with a `recoveryDelay` pause), a new UDP socket per attempt, and resolve-by-MAC (`host` = broadcast address + `mac`) all live in the client. Client `'error'` events are informational: never tear the client down on them. After `disconnect()` the client fires no timer and no event but `'disconnect'`.
- **`ConnectionManager`** creates exactly one client on `start()` and disconnects it on `stop()`. It maps the node's settings onto client options (`noResponseThreshold` → `maxNoResponse`, `recoveryDelay`, `maxBackoff` → `reconnectMaxDelay`, `reopenSocket: true`), turns the client's `connect` / `no_response` / `reconnecting` / `update` / `success` / `error` events into `state` + `diagnostic` events, and owns the **write queue**. The queue is app policy that stays out of the client: it coalesces writes per property, caps the queue with oldest eviction, holds writes while unbound (the client would send them and lose them) and drains after `connect`. A value the client refuses (`ClientInvalidPropertyError`, thrown _synchronously_ by `setProperties`) is dropped from the batch without requeue. `call()` forwards `msg.action` requests only while connected.
- **`gree-hvac.js`** is Node-RED glue: status text, outputs, heartbeat, metrics in `context().get('gree')`, and a `getDeviceInfo` after each bind (`state` meta `bound: true`) that emits a `device_info` diagnostic and warns once for cloud-only firmwares.
- **Simulator answers like a real unit**: status requests leave out codes it doesn't know and optional features it lacks (`GREE_SIM_FEATURES`), which is what the client's feature probing relies on. It also does multi-split (`GREE_SIM_SUB_UNITS`), `hid` / `time` / `name` columns, beeper flags and the AP-mode `wlan` packet. The README's "Simulator configuration" section lists every env var.
- **Node tests run over real UDP**: `test/gree-hvac-node.test.js` builds the nodes on a fake Node-RED runtime (`test/helpers/fake-red.js`) against the in-process sim on an ephemeral port. No client mocks; only `test/connection-manager.test.js` stubs the client.

## Conventions

- Node 22 LTS for development (`.nvmrc`, CI, docker images). Published runtime supports Node 18+ (`engines.node`), Node-RED 3+; CI runs the tests on 18/20/22/24.
- Tests: `node --test` (no jest/mocha), beside what they cover.
- Style: ESLint + Prettier. Single quotes, 4-space JS, 2-space JSON/YAML; `.prettierignore` skips CHANGELOG and the lockfile.
- Git hooks (`.githooks/`, installed by `prepare`): **commit-msg** enforces a Conventional-Commit subject (merge/revert/fixup pass through), **pre-push** runs `eslint --fix`. Both honor `GREE_SKIP_LINT=1`.
- Each node takes a `logLevel`; the contrib node forwards it into the client.

## Gree protocol

Full spec (transport, encryption, every property + value, optional properties, °F `TemRec` / half-degree `Add0.5` setpoints, multi-split, `hid` / clock / name, the TemSen +40 quirk): **`docs/PROTOCOL.md`**. The simulator mirrors `node_modules/gree-hvac-client/src/`. Generic keys: ECB `a3K8Bx%2r8Y7#xDh`, GCM `{yxAHAY_Lm6pbC/<`; after `bindok` both sides switch to the device key.

## Releasing

Automated via **semantic-release** (`release.yml` on `push` to `master`). Merging a PR to master with a Conventional-Commit title computes the next version, bumps `package.json` + `CHANGELOG.md` (commit carries `[skip ci]`), tags, and creates a GitHub Release with the `.tgz`, its provenance bundle and a CycloneDX SBOM. `fix:` → patch, `feat:` → minor. PRs are **squash-merged**, so the PR title must be a valid Conventional Commit; auto-merge is disabled, so merge once the required checks are green. Don't hand-pick versions or push tags — semantic-release owns them. `master` is protected by a ruleset (PR + squash only + required checks), so the release job pushes via the `RELEASE_TOKEN` fine-grained PAT in the `release` environment, not `GITHUB_TOKEN`. `npm publish` is still gated/disabled (GitHub Release + tarball only).

The client dependency is a GitHub Release tarball URL. Bump it with the **`bump-gree-hvac-client`** skill (`.claude/skills/`): it bumps both pins and walks every surface that mirrors the client (validation, actions, manager, simulator, example flow, docs). To ship a `gree-hvac-client` change, release it there first, then bump the URL in `dependencies` **and** in the `lint:lockfile` script (its `--allowed-urls` pins the exact tarball, so CI fails on any other off-registry source), and run `npm install` here.

## Gotchas

- **Editor defaults are tested against the example**: `test/examples.test.js` parses the `defaults: {` block of each `gree-hvac/*.html` by indentation (8 spaces for the block, 12 for keys) and requires every key in `examples/basic-control.json`. Add a new editor setting to the example flow too, and keep that indentation. Inject nodes that set `msg.action` must name an action from `lib/actions.js`. Examples may use core nodes only, except a file listed in `EXTRA_PACKAGES` there (`dashboard-thermostat.json`: Dashboard 2.0 `ui-*` types, its comment must name the package); dashboard widgets wired into `gree-hvac` need a fixed topic, pass-through off and valid values. Widget `topic`s are property names.
- **Ports bind to `127.0.0.1`** (`GREE_BIND` overrides) and both containers run with `cap_drop: [ALL]` + `no-new-privileges` (the sim also `read_only`); keep that when adding services.
- **`gree.lan`**: the dev image's flow (`examples/basic-control.json` via `build-flows.js`) targets it; docker-compose aliases the sim container as `gree.lan`. The shipped example itself keeps a placeholder IP. The e2e suite fires the example's inject nodes by id (`a1c0de0000000002` on, `…04` off), so keep those ids. The dev image loads both examples (one tab each) and installs Dashboard 2.0 from `docker/nodered/package.json` (pinned; Dependabot updates it).
- The **sim dashboard at :8080** is a standalone Gree-device simulator (drives the simulated AC + fault injection) with no dependency on Node-RED. In the container its clock runs on UTC.
- **Workflow triggers**: only tag pushes (release.yml) and PR/push-to-master (ci.yml + e2e.yml) run Actions; pushes to feature branches don't.
- The docker `node-red` service has **no `/data` volume**: flow edits made in the editor are lost on rebuild/recreate (a plain `docker restart` keeps them). Change the example in `examples/basic-control.json` instead.
