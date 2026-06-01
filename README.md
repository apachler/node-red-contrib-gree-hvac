node-red-contrib-gree-hvac
========================

![NPM status](https://img.shields.io/npm/v/node-red-contrib-gree-hvac)
![Node-RED status](https://img.shields.io/badge/dynamic/xml?label=Node-RED%20catalog&query=%2F%2Fdiv%5B%40class%3D%27flowmeta%27%5D%5B1%5D%2Fdiv%5B%40class%3D%27flowinfo%27%5D%5B1%5D%2Ftext%28%29%5B1%5D&url=https%3A%2F%2Fflows.nodered.org%2Fnode%2Fnode-red-contrib-gree-hvac)
![Github Actions status](https://img.shields.io/github/actions/workflow/status/inwaar/node-red-contrib-gree-hvac/release.yml?label=release)

Provides a node for control Gree HVAC (Heating, ventilation, and air conditioning).

Designed for unattended 24/7 operation: the node owns the client lifecycle, drives reconnect with exponential backoff, and has two watchdogs (silence-while-connected and stuck-in-connecting) so a wedged Gree WiFi module recovers without a physical power cycle. See [CHANGELOG.md](CHANGELOG.md) for the full list of reliability features.

Nodes
-----

- `gree-hvac` — control and observe a single HVAC unit. Three outputs:
  1. **Changes** — `updated` (delta from the device) or `acknowledged` (delta from a write).
  2. **Snapshot** — full current property map.
  3. **Diagnostics** — structured events (`state`, `error`, `queue_overflow`, `heartbeat`, `update`, `write_ack`) with metrics for alerting and dashboards.
- `gree-hvac-discover` — broadcast-scans the subnet and returns the list of responding devices for populating config nodes.
- `gree-hvac-config` — host + UDP port of a single device.

The node also publishes a live metrics snapshot under `context().get('gree')` (state, uptime, last contact, queue size, reset counters).

Install
-------

### From npm (recommended)

Run the following command in your Node-RED user directory — typically `~/.node-red`:

```
npm install node-red-contrib-gree-hvac
```

### From a GitHub Release tarball

Each GitHub Release ships a packaged `.tgz` you can install directly without going through npm. This is useful for air-gapped Node-RED instances or for pinning to a specific commit before it appears in the npm registry.

```
cd ~/.node-red
npm install https://github.com/inwaar/node-red-contrib-gree-hvac/releases/download/v<version>/node-red-contrib-gree-hvac-<version>.tgz
```

Or download the `.tgz` from the [Releases page](https://github.com/inwaar/node-red-contrib-gree-hvac/releases) and run `npm install ./node-red-contrib-gree-hvac-<version>.tgz` from your `~/.node-red` directory. Restart Node-RED after installation.

Usage
-----

![dashboard](https://raw.githubusercontent.com/inwaar/node-red-contrib-gree-hvac/master/images/dashboard.png)

```json
[{"id":"ff9fe48d.da79d8","type":"debug","z":"fcc6883.6f01278","name":"","active":true,"tosidebar":true,"console":false,"tostatus":false,"complete":"true","targetType":"full","x":550,"y":700,"wires":[]},{"id":"3cfb9d5c.2adfc2","type":"gree-hvac","z":"fcc6883.6f01278","name":"AC","device":"","interval":"1","x":280,"y":640,"wires":[["ff9fe48d.da79d8"],["417b67b1.9d77d8","ff9fe48d.da79d8"]]},{"id":"fab8d073.bed76","type":"switch","z":"fcc6883.6f01278","name":"","property":"topic","propertyType":"msg","rules":[{"t":"eq","v":"power","vt":"str"},{"t":"eq","v":"mode","vt":"str"},{"t":"eq","v":"temperature","vt":"str"},{"t":"eq","v":"fanSpeed","vt":"str"},{"t":"eq","v":"swingVert","vt":"str"},{"t":"eq","v":"swingHor","vt":"str"},{"t":"eq","v":"health","vt":"str"},{"t":"eq","v":"blow","vt":"str"},{"t":"eq","v":"lights","vt":"str"},{"t":"eq","v":"powerSave","vt":"str"}],"checkall":"true","repair":false,"outputs":10,"x":430,"y":460,"wires":[["f36ddc6a.6a76d"],["ed7a4d0b.d3c85"],["7f2711eb.f70ff"],["b0f5ed20.f0dc4"],["bb2fd30d.6faed"],["426d8937.d2e9a8"],["58310de9.08b1c4"],["5be9ffdd.e9e11"],["429db373.92628c"],["29e1bfb7.c963c"]]},{"id":"f36ddc6a.6a76d","type":"ui_switch","z":"fcc6883.6f01278","name":"","label":"Power","tooltip":"","group":"5c569ec8.d608f","order":1,"width":"0","height":"0","passthru":false,"decouple":"true","topic":"power","style":"","onvalue":"on","onvalueType":"str","onicon":"","oncolor":"","offvalue":"off","offvalueType":"str","officon":"","offcolor":"","x":610,"y":80,"wires":[["62c89d4e.1db264"]]},{"id":"429db373.92628c","type":"ui_switch","z":"fcc6883.6f01278","name":"","label":"Lights","tooltip":"","group":"5c569ec8.d608f","order":9,"width":"3","height":"1","passthru":false,"decouple":"true","topic":"lights","style":"","onvalue":"on","onvalueType":"str","onicon":"","oncolor":"","offvalue":"off","offvalueType":"str","officon":"","offcolor":"","x":610,"y":560,"wires":[["62c89d4e.1db264"]]},{"id":"7f2711eb.f70ff","type":"ui_numeric","z":"fcc6883.6f01278","name":"","label":"Temperature","tooltip":"","group":"5c569ec8.d608f","order":2,"width":0,"height":0,"passthru":false,"topic":"temperature","format":"{{value}}","min":"23","max":"25","step":1,"x":630,"y":200,"wires":[["62c89d4e.1db264"]]},{"id":"bb2fd30d.6faed","type":"ui_dropdown","z":"fcc6883.6f01278","name":"","label":"Vertical swing ","tooltip":"","place":"Select option","group":"5c569ec8.d608f","order":6,"width":0,"height":0,"passthru":false,"options":[{"label":"Default","value":"default","type":"str"},{"label":"Swing in full range","value":"full","type":"str"},{"label":"Fixed top","value":"fixedTop","type":"str"},{"label":"Fixed mid-top","value":"fixedMidTop","type":"str"},{"label":"Fixed mid","value":"fixedMid","type":"str"},{"label":"Fixed mid-bottom","value":"fixedMidBottom","type":"str"},{"label":"Fixed bottom","value":"fixedBottom","type":"str"},{"label":"Swing bottom","value":"swingBottom","type":"str"},{"label":"Swing mid-bottom","value":"swingMidBottom","type":"str"},{"label":"Swing mid","value":"swingMid","type":"str"},{"label":"Swing mid top","value":"swingMidTop","type":"str"},{"label":"Swing top","value":"swingTop","type":"str"}],"payload":"","topic":"swingVert","x":640,"y":320,"wires":[["62c89d4e.1db264"]]},{"id":"62c89d4e.1db264","type":"rbe","z":"fcc6883.6f01278","name":"","func":"rbe","gap":"","start":"","inout":"out","property":"payload","x":830,"y":700,"wires":[["3cfb9d5c.2adfc2","ff9fe48d.da79d8"]]},{"id":"426d8937.d2e9a8","type":"ui_dropdown","z":"fcc6883.6f01278","name":"","label":"Horizontal swing ","tooltip":"","place":"Select option","group":"5c569ec8.d608f","order":5,"width":0,"height":0,"passthru":false,"options":[{"label":"Default","value":"default","type":"str"},{"label":"Full","value":"full","type":"str"},{"label":"Fixed left","value":"fixedLeft","type":"str"},{"label":"Fixed mid-left","value":"fixedMidLeft","type":"str"},{"label":"Fixed mid","value":"fixedMid","type":"str"},{"label":"Fixed mid-right","value":"fixedMidRight","type":"str"},{"label":"Fixed right","value":"fixedRight","type":"str"},{"label":"Full alt","value":"fullAlt","type":"str"}],"payload":"","topic":"swingHor","x":640,"y":380,"wires":[["62c89d4e.1db264"]],"info":"Controls the swing mode of the horizontal air blades (not available on all units)"},{"id":"b0f5ed20.f0dc4","type":"ui_dropdown","z":"fcc6883.6f01278","name":"","label":"Fan speed","tooltip":"","place":"Select option","group":"5c569ec8.d608f","order":4,"width":0,"height":0,"passthru":false,"options":[{"label":"Auto","value":"auto","type":"str"},{"label":"Low","value":"low","type":"str"},{"label":"Medium low","value":"mediumLow","type":"str"},{"label":"Medium","value":"medium","type":"str"},{"label":"Medium high","value":"mediumHigh","type":"str"},{"label":"High","value":"high","type":"str"}],"payload":"","topic":"fanSpeed","x":630,"y":260,"wires":[["62c89d4e.1db264"]]},{"id":"29e1bfb7.c963c","type":"ui_switch","z":"fcc6883.6f01278","name":"","label":"Power save","tooltip":"","group":"5c569ec8.d608f","order":10,"width":"3","height":"1","passthru":false,"decouple":"true","topic":"powerSave","style":"","onvalue":"on","onvalueType":"str","onicon":"","oncolor":"","offvalue":"off","offvalueType":"str","officon":"","offcolor":"","x":630,"y":620,"wires":[["62c89d4e.1db264"]]},{"id":"417b67b1.9d77d8","type":"split","z":"fcc6883.6f01278","name":"","splt":"\\n","spltType":"str","arraySplt":1,"arraySpltType":"len","stream":false,"addname":"topic","x":290,"y":460,"wires":[["fab8d073.bed76"]]},{"id":"ed7a4d0b.d3c85","type":"ui_dropdown","z":"fcc6883.6f01278","name":"","label":"Mode","tooltip":"","place":"Select option","group":"5c569ec8.d608f","order":3,"width":"0","height":"0","passthru":false,"options":[{"label":"Auto","value":"auto","type":"str"},{"label":"Cool","value":"cool","type":"str"},{"label":"Dry","value":"dry","type":"str"},{"label":"Fan only","value":"fan_only","type":"str"},{"label":"Heat","value":"heat","type":"str"}],"payload":"","topic":"mode","x":610,"y":140,"wires":[["62c89d4e.1db264"]]},{"id":"58310de9.08b1c4","type":"ui_switch","z":"fcc6883.6f01278","name":"","label":"Cold plasma","tooltip":"","group":"5c569ec8.d608f","order":7,"width":"3","height":"1","passthru":false,"decouple":"true","topic":"health","style":"","onvalue":"on","onvalueType":"str","onicon":"","oncolor":"","offvalue":"off","offvalueType":"str","officon":"","offcolor":"","x":630,"y":440,"wires":[["62c89d4e.1db264"]]},{"id":"5be9ffdd.e9e11","type":"ui_switch","z":"fcc6883.6f01278","name":"","label":"X-Fan","tooltip":"","group":"5c569ec8.d608f","order":8,"width":"3","height":"1","passthru":false,"decouple":"true","topic":"blow","style":"","onvalue":"on","onvalueType":"str","onicon":"","oncolor":"","offvalue":"off","offvalueType":"str","officon":"","offcolor":"","x":610,"y":500,"wires":[["62c89d4e.1db264"]]},{"id":"5c569ec8.d608f","type":"ui_group","z":"","name":"AC","tab":"168c092a.469d97","disp":true,"width":"6","collapse":false},{"id":"168c092a.469d97","type":"ui_tab","z":"","name":"Home","icon":"dashboard","disabled":false,"hidden":false}]
```

Example
-------
![example](https://raw.githubusercontent.com/inwaar/node-red-contrib-gree-hvac/master/images/example.png)

Development with the simulator
------------------------------

The repo ships a software simulator of a Gree HVAC device, so you can develop and test the nodes without owning hardware. The simulator implements the same UDP protocol (AES-ECB / AES-GCM) the real device speaks, exposes a small HTTP dashboard that visualizes the AC state in real time, and serves mock Victron / Ruuvi sensor values so the bundled example flow runs end-to-end.

### Requirements

- Docker + Docker Compose v2 (`docker compose` subcommand)
- Node.js 18+ on the host (only for running the e2e tests; the containers ship their own Node)

### Bring up the stack

```bash
npm run sim:up      # docker compose up -d --build
```

This starts two services:

| Service        | URL                                | What it is                                            |
| -------------- | ---------------------------------- | ----------------------------------------------------- |
| `gree-sim`     | http://localhost:8080              | Simulator dashboard (live AC state, fault injection, mock sensor knobs) |
| `gree-sim`     | udp://localhost:7000               | Gree protocol endpoint (also reachable in-cluster as `gree.lan`) |
| `node-red`     | http://localhost:1880              | Node-RED with the contrib nodes + the example flow pre-loaded |

The sim container is aliased as `gree.lan` on the docker network, so the example flow's `gree-hvac-config` (which targets `gree.lan`) works without modification.

Tail logs and tear down:

```bash
npm run sim:logs
npm run sim:down    # also removes the network and the Node-RED userdir volume
```

### Run the tests

**Unit tests of the simulator itself** (no docker required):

```bash
npm run test:sim
```

**End-to-end tests** against the live compose stack — boots the stack, exercises the simulator over UDP using the real `gree-hvac-client`, drives the deployed Node-RED flow via its admin API, injects packet drops to verify the connection-manager's recovery, and tears the stack down:

```bash
npm run test:e2e
```

Useful env vars while iterating:

- `E2E_SKIP_BUILD=1` — reuse the existing images (skip `docker compose build`)
- `E2E_KEEP_UP=1` — leave the stack running after the tests finish so you can poke at it

### What's actually being tested

| Test file                                  | What it covers                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `sim/test/simulator.test.js`               | Wire-level: discovery, bind, status, cmd, fault injection — without involving the contrib nodes                  |
| `sim/test/client-roundtrip.test.js`        | Real `gree-hvac-client` connecting to the in-process simulator over loopback                                     |
| `test/e2e/sim.e2e.test.js`                 | Dashboard HTTP API + client round-trip against the dockerized sim                                                |
| `test/e2e/nodered.e2e.test.js`             | Node-RED admin API: flow deployed, `gree-hvac-config` host wired to `gree.lan`, manual switch + button flow drives the sim's AC state |
| `test/e2e/fault-recovery.e2e.test.js`      | Sets `dropEvery: 2` on the sim, verifies the client still surfaces status updates                                |
