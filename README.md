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

- `gree-hvac` — control and observe a single HVAC unit. Four outputs:
  1. **Changes** — `updated` (delta from the device) or `acknowledged` (delta from a write).
  2. **Snapshot** — full current property map.
  3. **Diagnostics** — structured events (`state`, `error`, `queue_overflow`, `heartbeat`, `update`, `write_ack`, `rehome`, `device_info`) with metrics for alerting and dashboards.
  4. **Responses** — answers to `msg.action` requests (device info, raw vendor codes, clock, name, multi-split indoor units, poll now).
- `gree-hvac-discover` — broadcast-scans the subnet and returns the responding devices (MAC, IP, name, firmware, number of multi-split indoor units) for populating config nodes; it also joins a unit in setup mode to your WiFi (`msg.action = "configureWifi"`).
- `gree-hvac-config` — host + UDP port of a single device, with optional **resolve-by-MAC** to follow the device across DHCP IP changes, the **indoor unit** of a multi-split system, and the unit's firmware options (half-degree setpoints, encoded target humidity, status batch size).

The node also publishes a live metrics snapshot under `context().get('gree')` (state, uptime, last contact, queue size, reset counters, device info).

Built on [`gree-hvac-client`](https://github.com/apachler/gree-hvac-client) 4.3, so it covers everything the client does: all 26 properties (incl. outdoor temperature, humidity, fault code, target humidity / humidity mode, anti-direct-blow, light sensor and the dehumidifier tank/filter flags on units that have them), Fahrenheit and half-degree setpoints, silent (no-beep) commands, multi-split systems, firmware info with a warning for cloud-only firmwares, raw vendor codes, the unit's clock and name, discovery and WiFi setup.

Install
-------

> **Heads-up:** this is a maintained fork. The `node-red-contrib-gree-hvac` package on the npm registry is still the original upstream **0.3.0** — this fork is **not published to npm yet**. Until it is, install from a GitHub Release tarball (below).

### From a GitHub Release tarball (recommended)

Each GitHub Release ships a packaged `.tgz` you can install directly. Run this in your Node-RED user directory — typically `~/.node-red`:

```
cd ~/.node-red
npm install https://github.com/apachler/node-red-contrib-gree-hvac/releases/download/v<version>/node-red-contrib-gree-hvac-<version>.tgz
```

Or download the `.tgz` from the [Releases page](https://github.com/apachler/node-red-contrib-gree-hvac/releases) and run `npm install ./node-red-contrib-gree-hvac-<version>.tgz` from your `~/.node-red` directory. Restart Node-RED after installation. This also pins a specific release.

Installing needs network access: the package pulls its dependency [`gree-hvac-client`](https://github.com/apachler/gree-hvac-client) from that project's GitHub Release, and the client's own dependencies from the npm registry. For an offline instance, install on a connected machine with the same Node.js major version and copy the resulting `node_modules` over.

Each release also carries a signed build-provenance attestation for the `.tgz` and a CycloneDX SBOM (`*.cdx.json`) of its runtime dependencies. To check that a downloaded tarball was built by this repo's release workflow:

```
gh attestation verify node-red-contrib-gree-hvac-<version>.tgz -R apachler/node-red-contrib-gree-hvac
```

### From the Node-RED editor (no shell)

1. Download `node-red-contrib-gree-hvac-<version>.tgz` from the [Releases page](https://github.com/apachler/node-red-contrib-gree-hvac/releases).
2. In the editor open **☰ Menu → Manage palette → Install**, click the **upload** button next to the search box, and pick the `.tgz`.
3. Confirm; Node-RED installs it and adds the nodes without a restart.

The upload button is missing when the instance disables it (`editorTheme.palette.upload: false` in `settings.js`); use the command line then. The install also needs network access, see above.

### Node-RED in Docker

With the official `nodered/node-red` image the user directory is `/data` (keep it on a volume, or the install is lost when the container is recreated):

```
docker exec -it <container> bash -c "cd /data && npm install https://github.com/apachler/node-red-contrib-gree-hvac/releases/download/v<version>/node-red-contrib-gree-hvac-<version>.tgz"
docker restart <container>
```

Or upload the `.tgz` in the editor as above. The UDP traffic to the AC must reach your LAN: on a bridge network, connecting by IP works; discovery and **Resolve by MAC** use broadcasts, which need `--network host` (or a macvlan network).

### Check, update, remove

- **Check:** the palette shows `gree-hvac` and `gree-hvac-discover` under _devices_, and **Import → Examples → node-red-contrib-gree-hvac** has the `basic-control` flow. **☰ Menu → Manage palette → Nodes** shows the installed version.
- **Update:** install the newer release's `.tgz` the same way (it replaces the old one), then restart Node-RED.
- **Remove:** **Manage palette → Nodes → remove**, or `npm uninstall node-red-contrib-gree-hvac` in the user directory and restart. Remove the nodes from your flows first.

Requires Node-RED 3.0 or newer on Node.js 18 or newer.

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

### Setting properties

Send `msg.payload` as a property object — `{"power":"on","mode":"cool","temperature":24}` — or `msg.topic` = property name with `msg.payload` = value. Unknown properties, read-only ones (`currentTemperature`, `outdoorTemperature`, `humidity`, `errorCode`, `waterFull`, `cleanFilter`) and invalid values are dropped with a warning before anything is sent. `temperature` is in the unit's `temperatureUnit`: whole °F when the unit is in Fahrenheit, whole °C — or half °C (`23.5`) with **Half-degree °C setpoints** on the config node, for firmwares that take them.

Optional properties (`antiDirectBlow`, `outdoorTemperature`, `humidity`, `errorCode`, `targetHumidity`, `humidityMode`, `lightSensor`, `waterFull`, `cleanFilter`) exist only on some units: the client asks the unit once after each connect and polls them only when it answers, so they appear in the outputs only on units that have them.

Turn on **Silent** on the `gree-hvac` node to ask the unit not to beep on each command.

### Requests (`msg.action`)

Besides setting properties, `gree-hvac` takes requests in `msg.action`; the answer is the same `msg` with `topic` = the action and `payload` = the answer, on output 4. Failures go to `done(err)` (catch nodes); requests are not queued, so they fail at once while the device is offline.

| `msg.action`          | `msg.payload`                                      | Answer                                                                                       |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `getProperties`       | —                                                  | all current properties, polled now                                                           |
| `getDeviceInfo`       | —                                                  | `{mac, name, version, model, brand, hid, firmwareVersion, moduleType, ..., upgradeWarning?}` |
| `getSubUnits`         | — (optional `msg.timeout` ms)                      | multi-split: `[{mac, mid}]` of the indoor units, `[]` for a single unit                      |
| `getVendorProperties` | vendor code or array, e.g. `["UvcControl","time"]` | `{code: raw value}`; codes the unit does not know are missing                                |
| `setVendorProperties` | `{code: value}`, sent raw                          | what was sent                                                                                |
| `getClock`            | —                                                  | the unit's clock, `YYYY-MM-DD HH:MM:SS`                                                      |
| `setClock`            | Date, timestamp or date string; empty = now        | the time set, in this host's local time                                                      |
| `setName`             | new name                                           | the name                                                                                     |

### Firmware updates can end local control

Some Gree WiFi-module firmwares were switched to cloud-only in later builds: once upgraded, the unit no longer answers on the LAN at all. After each connect the node reads the unit's firmware id, publishes it as a `device_info` diagnostic (and as `deviceInfo` in the runtime context), and — for a firmware known to have such builds — logs a warning once. Don't upgrade that unit's WiFi-module firmware in the vendor app. The list of firmwares is maintained in [`gree-hvac-client`](https://github.com/apachler/gree-hvac-client#firmware-updates-can-end-local-control).

### Multi-split systems

On a multi-split system only the outdoor unit's WiFi module is on the network. `gree-hvac-discover` reports it with `subUnits` > 0. Point a `gree-hvac` node at it and send `msg.action = "getSubUnits"` to list the indoor units, then create one `gree-hvac-config` per indoor unit — same IP (or MAC), with that unit's MAC as **Indoor unit** — and one `gree-hvac` node per config. The multi-split support follows community reverse-engineering and has not been verified on hardware by this project.

### WiFi setup

A unit whose WiFi was reset (MODE + WIFI, or MODE + TURBO, on the remote for 5 s) opens its own access point. With the Node-RED host joined to it, send `gree-hvac-discover` a message with `msg.action = "configureWifi"` and `msg.payload = {"ssid": "...", "password": "..."}`: the unit joins your network (answer `{confirmed, mac}` with topic `gree-wifi-setup`; some firmwares never confirm, so check with a scan). The password is not passed on in the output message.

### Example flow

A flow ships with the package: in the Node-RED editor, open **Import → Examples → node-red-contrib-gree-hvac → basic-control**. It uses only core nodes — inject buttons for properties (on + cool to 24 °C, fan speed, off, display dimming with the room light) and for requests (refresh now, device info / firmware, indoor units, clock sync, raw vendor codes) into a `gree-hvac` node with a debug node on each of its four outputs, plus a **Scan network** button on a `gree-hvac-discover` node. Set the `Gree AC` config node's host to your AC's IP (or turn on resolve by MAC) and deploy.

Protocol
--------

The Gree UDP/AES wire protocol and every device property (vendor code, values, and what each feature actually does — `air`, `blow`/X-Fan, `health`, `sleep`, `quiet`, `turbo`, `powerSave`, `safetyHeating`, …), plus Fahrenheit / half-degree setpoints, multi-split, firmware id, clock, beeper and WiFi setup, are documented in [**docs/PROTOCOL.md**](docs/PROTOCOL.md). The simulator implements it byte-for-byte, so it doubles as an executable spec.

Development setup
-----------------

After cloning, run `npm install` once — the `prepare` script wires up `core.hooksPath` to `./.githooks/` so two git hooks run: **commit-msg** rejects commit subjects that aren't [Conventional Commits](https://www.conventionalcommits.org/), and **pre-push** runs `eslint --fix` against the whole repo before every push. Pushes are refused if eslint reports errors it couldn't auto-fix, or if `--fix` produced changes that haven't been staged + committed (so the fix lands in a reviewable commit, not silently on the remote).

Skip the hooks in an emergency with `GREE_SKIP_LINT=1 git commit ...` / `GREE_SKIP_LINT=1 git push ...`. CI sets `CI=true` so the hooks are a no-op in workflows (CI runs `npm run lint` itself anyway).

Development with the simulator
------------------------------

The repo ships a software simulator of a Gree HVAC device, so you can develop and test the nodes without owning hardware. The simulator implements the same UDP protocol (AES-ECB / AES-GCM) the real device speaks, and exposes a small HTTP dashboard that visualizes the AC state in real time.

<p align="center">
  <img src="docs/sim-dashboard.png" width="900" alt="The simulator dashboard at :8080 — live AC state with outdoor temperature and humidity, change-source, direct controls for every property, device panel (firmware id, clock, name, optional features), fault injection and protocol stats" />
</p>

The dashboard shows live AC state and the **source** of each change ("Gree UDP protocol" when a client sets a value over the wire, "HTTP API" for a direct dashboard/REST action), plus controls to drive the AC directly (every protocol property, the unit's own room and outdoor temperature readings, its optional features, clock and name), inject faults (packet drop / latency / jitter), and watch live UDP protocol stats.

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

### Simulator configuration

The simulator is configured by environment variables (`docker-compose.yml`, or the shell for `node sim/bin/gree-sim.js`):

| Variable                                                                                 | Default                               | What it does                                                                                                                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GREE_SIM_UDP_PORT` / `GREE_SIM_HTTP_PORT`                                               | `7000` / `8080`                       | Gree protocol port / dashboard port                                                                                                                |
| `GREE_SIM_CIPHER`                                                                        | `ecb`                                 | `ecb` (older firmwares) or `gcm` (newer)                                                                                                           |
| `GREE_SIM_NAME` / `GREE_SIM_CID`                                                         | random                                | device name and MAC (`cid`)                                                                                                                        |
| `GREE_SIM_VERSION`                                                                       | `V1.0.0`                              | WiFi module version in the scan answer                                                                                                             |
| `GREE_SIM_HID`                                                                           | `362001000762+U-CS532AE(LT)V3.31.bin` | firmware id answered for the `hid` status column; set a code from the cloud-only list to see the firmware warning, or empty for a unit without one |
| `GREE_SIM_FEATURES`                                                                      | `all`                                 | optional features the unit has: `all`, `none`, or a comma-separated list such as `outdoorTemperature,humidity`                                     |
| `GREE_SIM_SUB_UNITS`                                                                     | unset                                 | multi-split gateway: a count of indoor units (MACs `<cid>01`, `<cid>02`, …) or a comma-separated list of MACs                                      |
| `GREE_SIM_DROP_PROB`, `GREE_SIM_DROP_EVERY`, `GREE_SIM_LATENCY_MS`, `GREE_SIM_JITTER_MS` | `0`                                   | fault injection from the start (also on the dashboard)                                                                                             |
| `GREE_SIM_VERBOSE`                                                                       | off                                   | log every protocol event                                                                                                                           |

Like a real unit, the simulator answers a status request only for the codes it knows: a feature it lacks is missing from the answer, so the client never polls it. The dashboard's **Device** panel toggles the features at runtime (clients re-probe them on their next connect), shows the firmware id, the clock (with a sync button), the name and the SSID of the last WiFi setup, and — in gateway mode — selects which indoor unit the dashboard shows and controls.

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

| Test file                             | What it covers                                                                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/connection-manager.test.js`     | Reconnect/backoff, watchdogs, write queue, refused-property handling, client options and `call()` of the 24/7 connection manager (stubbed client)                                                                     |
| `test/mac-resolver.test.js`           | Resolve-by-MAC: MAC normalisation, discovery sweep, `resolved` on first find / IP change, `miss`, scan-failure handling                                                                                               |
| `test/validation.test.js`             | Unknown, read-only and invalid properties are dropped before a write                                                                                                                                                  |
| `test/examples.test.js`               | The shipped `examples/` flows: core node types only, wires resolve, every editor default set, inject payloads pass validation, inject actions exist                                                                   |
| `test/gree-hvac-node.test.js`         | The three nodes on a fake Node-RED runtime, over real UDP to the in-process sim: outputs, input forms, validation, `msg.action` requests, device info, offline rejection, heartbeat, resolve-by-MAC, discovery        |
| `sim/test/simulator.test.js`          | Wire-level: discovery, bind, status, cmd, fault injection — without involving the contrib nodes                                                                                                                       |
| `sim/test/client-roundtrip.test.js`   | Real `gree-hvac-client` connecting to the in-process simulator over loopback                                                                                                                                          |
| `sim/test/client-features.test.js`    | Real `gree-hvac-client` 4.3 against the sim: feature probing, every optional property, °F / half-degree setpoints, device info + firmware warning, clock, name, raw codes, silent, multi-split, discovery, WiFi setup |
| `sim/test/dashboard.test.js`          | The sim's HTTP API and SSE stream: state, set, temperature, faults, stats, body limits                                                                                                                                |
| `sim/test/cipher-faults.test.js`      | ECB/GCM ciphers, fault injector, and a real client binding over AES-GCM                                                                                                                                               |
| `test/e2e/sim.e2e.test.js`            | Dashboard HTTP API + client round-trip against the dockerized sim                                                                                                                                                     |
| `test/e2e/nodered.e2e.test.js`        | Node-RED admin API: the example flow is deployed with `gree-hvac-config` on `gree.lan`; firing its inject nodes drives the simulated AC on and off                                                                    |
| `test/e2e/fault-recovery.e2e.test.js` | Sets `dropEvery: 3` on the sim and verifies a real state change still gets through                                                                                                                                    |

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
