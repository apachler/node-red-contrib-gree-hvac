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
  lib/mac-resolver.js            resolve-by-MAC: re-discovers the device IP after DHCP changes
  lib/actions.js                 msg.action requests (getDeviceInfo, setClock, ...) → client methods, answered on output 4
  gree-hvac-config.js            device host+port, multi-split subUnit, firmware options (halfDegree, ...)
  gree-hvac-discover.js          Client.discover() scan + configureWifi (AP-mode setup)
sim/                           standalone Gree simulator (cipher, transformer, state,
                               UDP server, HTTP+SSE dashboard, fault injection)
docker/nodered/                Node-RED dev image; build-flows.js bakes examples/basic-control.json in (host gree.lan)
examples/                      shipped example flow (Import → Examples); core nodes only, checked by test/examples.test.js
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
npm run lint:lockfile  # lockfile-lint: npm registry over HTTPS + the pinned client tarball URL
```

Iterating on e2e: `E2E_SKIP_BUILD=1 E2E_KEEP_UP=1 npm run test:e2e` reuses images and leaves the stack up.

## Conventions

- Node 22 LTS for development (`.nvmrc`, CI, docker images); the lint toolchain (ESLint 10) requires Node 22+. Published runtime still supports Node 18+ (`engines.node`), and CI runs the tests on 18/20/22/24.
- Tests: `node --test` (no jest/mocha), beside what they cover.
- Style: ESLint + Prettier (`npm run lint`); Markdown/YAML/JSON via `npm run format:check` / `npm run format` (CI-enforced; `.prettierignore` skips CHANGELOG and the lockfile). Single quotes, 4-space JS, 2-space JSON/YAML. The pre-push hook runs `eslint --fix`; `GREE_SKIP_LINT=1 git push` to skip.
- Git hooks (`.githooks/`, installed by `prepare`): **commit-msg** enforces a Conventional-Commit subject (zero-dep shell regex, no commitlint; merge/revert/fixup pass through), **pre-push** runs `eslint --fix`. Both honor `GREE_SKIP_LINT=1`.
- Each node takes a `logLevel`; the contrib node forwards it into the client.

## Gree protocol

Full spec (transport, encryption, every property + value, the TemSen +40 quirk): **`docs/PROTOCOL.md`**. The simulator mirrors `node_modules/gree-hvac-client/src/`. Generic keys: ECB `a3K8Bx%2r8Y7#xDh`, GCM `{yxAHAY_Lm6pbC/<`; after `bindok` both sides switch to the device key.

## Releasing

Automated via **semantic-release** (`release.yml` on `push` to `master`). Merging a PR to master with a Conventional-Commit title computes the next version, bumps `package.json` + `CHANGELOG.md` (commit carries `[skip ci]`), tags, and creates a GitHub Release with the `.tgz`. `fix:` → patch, `feat:` → minor. PRs are **squash-merged**, so the PR title must be a valid Conventional Commit. Don't hand-pick versions or push tags — semantic-release owns them. `master` is protected by a ruleset (PR + squash only + required checks), so the release job pushes via the `RELEASE_TOKEN` fine-grained PAT in the `release` environment, not `GITHUB_TOKEN`. `npm publish` is still gated/disabled (GitHub Release + tarball only). The client dependency is a GitHub Release tarball URL — to ship a `gree-hvac-client` fix, release it there first, then bump the URL in `dependencies` **and** in the `lint:lockfile` script (its `--allowed-urls` pins the exact tarball, so CI fails on any other off-registry source) + `npm install` here.

## Gotchas

- **Ports bind to `127.0.0.1`** (`GREE_BIND` overrides) and both containers run with `cap_drop: [ALL]` + `no-new-privileges` (the sim also `read_only`); keep that when adding services.
- **`gree.lan`**: the dev image's flow (`examples/basic-control.json` via `build-flows.js`) targets it; docker-compose aliases the sim container as `gree.lan`. The shipped example itself keeps a placeholder IP.
- The **sim dashboard at :8080** is a standalone Gree-device simulator (drives the simulated AC + fault injection) with no dependency on Node-RED.
- **Workflow triggers**: only tag pushes (release.yml) and PR/push-to-master (ci.yml + e2e.yml) run Actions; pushes to feature branches don't.
- The docker `node-red` service has **no `/data` volume**: flow edits made in the editor are lost on rebuild/recreate (a plain `docker restart` keeps them). Change the example in `examples/basic-control.json` instead.
