<p align="center">
  <img src="docs/logo.svg" width="96" height="96" alt="Gree HVAC" />
</p>

<h1 align="center">node-red-contrib-gree-hvac</h1>

<p align="center">
  Node-RED nodes to control Gree air-conditioners over their UDP/AES protocol —
  with a full software simulator so you can build and test without the hardware.
</p>

<p align="center">
  <a href="https://github.com/apachler/node-red-contrib-gree-hvac/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/apachler/node-red-contrib-gree-hvac/ci.yml?branch=master&label=CI" alt="CI" /></a>
  <a href="https://github.com/apachler/node-red-contrib-gree-hvac/actions/workflows/ci.yml"><img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fapachler%2Fnode-red-contrib-gree-hvac%2Fbadges%2Fcoverage.json" alt="Coverage" /></a>
  <a href="https://github.com/apachler/node-red-contrib-gree-hvac/actions/workflows/codeql.yml"><img src="https://img.shields.io/github/actions/workflow/status/apachler/node-red-contrib-gree-hvac/codeql.yml?branch=master&label=CodeQL" alt="CodeQL" /></a>
  <a href="https://github.com/apachler/node-red-contrib-gree-hvac/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/apachler/node-red-contrib-gree-hvac/release.yml?label=release" alt="Release" /></a>
  <a href="https://securityscorecards.dev/viewer/?uri=github.com/apachler/node-red-contrib-gree-hvac"><img src="https://api.securityscorecards.dev/projects/github.com/apachler/node-red-contrib-gree-hvac/badge" alt="OpenSSF Scorecard" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
</p>

Provides nodes to control Gree HVAC (heating, ventilation, and air conditioning) units.

Designed for unattended 24/7 operation: the node owns the client lifecycle, drives reconnect with exponential backoff, and has two watchdogs (silence-while-connected and stuck-in-connecting) so a wedged Gree WiFi module recovers without a physical power cycle. See [CHANGELOG.md](CHANGELOG.md) for the full list of reliability features.

Nodes
-----

- `gree-hvac` — control and observe a single HVAC unit. Three outputs:
  1. **Changes** — `updated` (delta from the device) or `acknowledged` (delta from a write).
  2. **Snapshot** — full current property map.
  3. **Diagnostics** — structured events (`state`, `error`, `queue_overflow`, `heartbeat`, `update`, `write_ack`, `rehome`) with metrics for alerting and dashboards.
- `gree-hvac-discover` — broadcast-scans the subnet and returns the list of responding devices for populating config nodes.
- `gree-hvac-config` — host + UDP port of a single device, with optional **resolve-by-MAC** to follow the device across DHCP IP changes.

The node also publishes a live metrics snapshot under `context().get('gree')` (state, uptime, last contact, queue size, reset counters).

Install
-------

> **Heads-up:** this is a maintained fork. The `node-red-contrib-gree-hvac` package on the npm registry is still the original upstream **0.3.0** — this fork is **not published to npm yet**. Until it is, install from a GitHub Release tarball (below).

### From a GitHub Release tarball (recommended)

Each GitHub Release ships a packaged `.tgz` you can install directly. Run this in your Node-RED user directory — typically `~/.node-red`:

```
cd ~/.node-red
npm install https://github.com/apachler/node-red-contrib-gree-hvac/releases/download/v<version>/node-red-contrib-gree-hvac-<version>.tgz
```

Or download the `.tgz` from the [Releases page](https://github.com/apachler/node-red-contrib-gree-hvac/releases) and run `npm install ./node-red-contrib-gree-hvac-<version>.tgz` from your `~/.node-red` directory. Restart Node-RED after installation. This also works for air-gapped instances and for pinning to a specific release.

Each release also carries a signed build-provenance attestation for the `.tgz` and a CycloneDX SBOM (`*.cdx.json`) of its runtime dependencies. To check that a downloaded tarball was built by this repo's release workflow:

```
gh attestation verify node-red-contrib-gree-hvac-<version>.tgz -R apachler/node-red-contrib-gree-hvac
```

### From npm

Once this fork is published to npm, you'll be able to install it the usual way from your `~/.node-red` directory:

```
npm install node-red-contrib-gree-hvac
```

Until then, check the installed version — the registry currently serves the unmaintained upstream 0.3.0, not this fork.

Usage
-----

The package gives you the three nodes above — wire `gree-hvac` into whatever dashboard or automation you like. To get started, import the bundled example (see [Example flow](#example-flow) below).

For what each property and value means, see the [**Gree protocol & property reference**](docs/PROTOCOL.md).

### Following a device across DHCP changes (resolve by MAC)

If your AC gets its address from DHCP, its IP can change and break a hard-coded
host. Enable **Resolve by MAC** on the `gree-hvac-config` node and enter the
device's **MAC/cid** (the `cid` field returned by `gree-hvac-discover`). The node
then periodically broadcast-discovers that MAC, maps it to the device's current
IP, and re-points the connection automatically when it moves — no flow edits, no
restart.

- The **IP Address** field is used as the last-known address; leave it blank to
  wait for the first discovery before connecting.
- **Broadcast** (default `255.255.255.255`) and **Rescan (s)** (default `60`)
  tune the discovery sweep — set Broadcast to your subnet's broadcast address if
  global broadcast is filtered.
- A re-point is surfaced as a `rehome` diagnostic event on output 3.

### Example flow

A minimal flow ships with the package: in the Node-RED editor, open **Import → Examples → node-red-contrib-gree-hvac → basic-control**. It uses only core nodes — three inject buttons (on + cool to 24 °C, fan speed, off) into a `gree-hvac` node, with a debug node on each of its three outputs. Set the `Gree AC` config node's host to your AC's IP (or turn on resolve by MAC) and deploy.

Protocol
--------

The Gree UDP/AES wire protocol and every device property (vendor code, values, and what each feature actually does — `air`, `blow`/X-Fan, `health`, `sleep`, `quiet`, `turbo`, `powerSave`, `safetyHeating`, …) are documented in [**docs/PROTOCOL.md**](docs/PROTOCOL.md). The simulator implements it byte-for-byte, so it doubles as an executable spec.

Development setup
-----------------

After cloning, run `npm install` once — the `prepare` script wires up `core.hooksPath` to `./.githooks/` so two git hooks run: **commit-msg** rejects commit subjects that aren't [Conventional Commits](https://www.conventionalcommits.org/), and **pre-push** runs `eslint --fix` against the whole repo before every push. Pushes are refused if eslint reports errors it couldn't auto-fix, or if `--fix` produced changes that haven't been staged + committed (so the fix lands in a reviewable commit, not silently on the remote).

Skip the hooks in an emergency with `GREE_SKIP_LINT=1 git commit ...` / `GREE_SKIP_LINT=1 git push ...`. CI sets `CI=true` so the hooks are a no-op in workflows (CI runs `npm run lint` itself anyway).

Development with the simulator
------------------------------

The repo ships a software simulator of a Gree HVAC device, so you can develop and test the nodes without owning hardware. The simulator implements the same UDP protocol (AES-ECB / AES-GCM) the real device speaks, and exposes a small HTTP dashboard that visualizes the AC state in real time.

<p align="center">
  <img src="docs/sim-dashboard.png" width="900" alt="The simulator dashboard at :8080 — live AC state, change-source, direct controls, fault injection and protocol stats" />
</p>

The dashboard shows live AC state and the **source** of each change ("Gree UDP protocol" when a client sets a value over the wire, "HTTP API" for a direct dashboard/REST action), plus controls to drive the AC directly (every protocol property, and the unit's own room-temperature reading), inject faults (packet drop / latency / jitter), and watch live UDP protocol stats.

> The dashboard screenshots in this README are generated, not hand-placed — regenerate them with `node docs/screenshot.mjs` against a running stack (see [`docs/`](docs/)). `docs/demo.tape` renders an optional terminal demo GIF via [`vhs`](https://github.com/charmbracelet/vhs); it's also wired into the manual **Docs media** workflow.

### Requirements

- Docker + Docker Compose v2 (`docker compose` subcommand)
- Node.js 22 LTS on the host (matches `.nvmrc`; needed for the dev toolchain and e2e tests — the containers ship their own Node)

### Bring up the stack

```bash
npm run sim:up      # docker compose up -d --build
```

This starts two services:

| Service    | URL                   | What it is                                                                            |
| ---------- | --------------------- | ------------------------------------------------------------------------------------- |
| `gree-sim` | http://localhost:8080 | Simulator dashboard (live AC state, direct controls, fault injection, protocol stats) |
| `gree-sim` | udp://localhost:7000  | Gree protocol endpoint (also reachable in-cluster as `gree.lan`)                      |
| `node-red` | http://localhost:1880 | Node-RED with the contrib nodes + the example flow pre-loaded, pointed at the sim     |

The pre-loaded flow is [`examples/basic-control.json`](examples/basic-control.json) with its `gree-hvac-config` host set to `gree.lan` (`docker/nodered/build-flows.js`, at image build time); the sim container is aliased as `gree.lan` on the docker network. Fire its inject buttons in the editor and watch the AC change on the sim dashboard.

The ports are published on `127.0.0.1` only, because neither the sim dashboard nor the Node-RED editor has authentication. To open them to other machines on a trusted network, start the stack with `GREE_BIND=0.0.0.0 npm run sim:up`.

Tail logs and tear down:

```bash
npm run sim:logs
npm run sim:down    # also removes the network
```

### Hot-reload while iterating on the nodes

`npm run sim:dev` brings the stack up with the host's `gree-hvac/` source bind-mounted over the image's installed copy and Node-RED wrapped in `nodemon`, so edits to `gree-hvac/*.js` or `gree-hvac/*.html` trigger a runtime restart within ~2 seconds:

```bash
npm run sim:dev          # foreground; Ctrl+C to stop
npm run sim:dev:down     # tear down the dev stack
```

What's mounted: `./gree-hvac/` → `/data/node_modules/node-red-contrib-gree-hvac/gree-hvac/` (read-only) and `./package.json` → the same package's package.json. Flow edits made in the editor live in the container's `/data` and are lost when it is recreated.

Node-RED does not hot-reload nodes in place — `nodemon` restarts the whole runtime on change, so the editor will briefly lose its WebSocket and reconnect. The browser tab survives the restart; just re-deploy if you were mid-edit. Use `npm run sim:up` (the production-like mode) when you want stable behavior for the e2e suite or for letting flows run unattended.

### Run the tests

**Unit tests** (no docker required):

```bash
npm test           # contrib nodes + their libs, against the in-process simulator
npm run test:sim   # the simulator itself
```

**End-to-end tests** against the live compose stack — boots the stack, exercises the simulator over UDP using the real `gree-hvac-client`, drives the deployed Node-RED flow via its admin API, injects packet drops to verify the connection-manager's recovery, and tears the stack down:

```bash
npm run test:e2e
```

Useful env vars while iterating:

- `E2E_SKIP_BUILD=1` — reuse the existing images (skip `docker compose build`)
- `E2E_KEEP_UP=1` — leave the stack running after the tests finish so you can poke at it

### What's actually being tested

| Test file                             | What it covers                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/connection-manager.test.js`     | Reconnect/backoff, watchdogs, write queue and diagnostics of the 24/7 connection manager (stubbed client)                                                                  |
| `test/mac-resolver.test.js`           | Resolve-by-MAC: MAC normalisation, discovery sweep, `resolved` on first find / IP change, `miss`, scan-failure handling                                                    |
| `test/validation.test.js`             | Unknown/invalid properties are dropped before a write                                                                                                                      |
| `test/examples.test.js`               | The shipped `examples/` flows: core node types only, wires resolve, every editor default set, inject payloads pass validation                                              |
| `test/gree-hvac-node.test.js`         | The three nodes on a fake Node-RED runtime, over real UDP to the in-process sim: outputs, input forms, validation, offline rejection, heartbeat, resolve-by-MAC, discovery |
| `sim/test/simulator.test.js`          | Wire-level: discovery, bind, status, cmd, fault injection — without involving the contrib nodes                                                                            |
| `sim/test/client-roundtrip.test.js`   | Real `gree-hvac-client` connecting to the in-process simulator over loopback                                                                                               |
| `sim/test/dashboard.test.js`          | The sim's HTTP API and SSE stream: state, set, temperature, faults, stats, body limits                                                                                     |
| `sim/test/cipher-faults.test.js`      | ECB/GCM ciphers, fault injector, and a real client binding over AES-GCM                                                                                                    |
| `test/e2e/sim.e2e.test.js`            | Dashboard HTTP API + client round-trip against the dockerized sim                                                                                                          |
| `test/e2e/nodered.e2e.test.js`        | Node-RED admin API: the example flow is deployed with `gree-hvac-config` on `gree.lan`; firing its inject nodes drives the simulated AC on and off                         |
| `test/e2e/fault-recovery.e2e.test.js` | Sets `dropEvery: 3` on the sim and verifies a real state change still gets through                                                                                         |

Contributing
------------

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev
setup, the git hooks, the testing commands, and the Conventional-Commit
PR-title convention that drives the release notes. Please also read the
[Code of Conduct](CODE_OF_CONDUCT.md). For where the project is headed see the
[Roadmap](ROADMAP.md), and for how it's run see [Governance](GOVERNANCE.md).

Support
-------

For usage questions and how-to help, see [SUPPORT.md](SUPPORT.md). For what each
Gree property and value means, see [docs/PROTOCOL.md](docs/PROTOCOL.md).

Security
--------

Please report security vulnerabilities privately — do **not** open a public
issue. See the [security policy](SECURITY.md).

License
-------

[MIT](LICENSE) © Igor Starovierov and contributors.

This package requires [`gree-hvac-client`](https://github.com/apachler/gree-hvac-client)
at runtime, which is licensed under **GPL-3.0**. It is installed as a separate
dependency, not bundled — but anything you distribute that ships both together
(a Node-RED installation, a container image, an appliance) must comply with
GPL-3.0 as a whole. See [NOTICE](NOTICE).

Acknowledgements
----------------

- Built on [`gree-hvac-client`](https://github.com/apachler/gree-hvac-client)
  (maintained fork of [inwaar/gree-hvac-client](https://github.com/inwaar/gree-hvac-client))
  for the UDP/AES wire protocol.
- Originally authored by [Igor Starovierov](https://github.com/inwaar); currently
  maintained by [Andreas Pachler](https://github.com/apachler).
