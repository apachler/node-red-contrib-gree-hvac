---
name: bump-gree-hvac-client
description: Bump the gree-hvac-client dependency to a new release and bring everything that depends on it up to date — nodes, validation, connection manager, simulator, example flow, docs, README, tests. Use when the user asks to bump/update/upgrade gree-hvac-client, when a new gree-hvac-client release is announced (e.g. by the client session), or when asked to "adopt the client's new features".
argument-hint: '[version, e.g. 4.5.0 — default: latest release]'
---

# Bump gree-hvac-client

The client is pinned as a GitHub Release tarball, not an npm range, and this repo
mirrors much of it (property validation, simulator, docs). A bump is only done when
every surface below reflects the new release. Work through the steps in order;
skip a surface only after checking it is unaffected.

## 1. Find the target and what changed

```bash
gh release list -R apachler/gree-hvac-client --limit 5
node -p "require('gree-hvac-client/package.json').version"     # current
gh release view v<NEW> -R apachler/gree-hvac-client              # notes + assets
```

Use `$ARGUMENTS` as the version if given, else the latest release. Read the
actual changes, not just the notes, in the sibling checkout:

```bash
git -C ../gree-hvac-client fetch --tags -q
git -C ../gree-hvac-client diff v<OLD> v<NEW> --stat -- src index.d.ts docs README.md
git -C ../gree-hvac-client diff v<OLD> v<NEW> -- index.d.ts src/client-options.js src/property.js src/property-value.js src/errors.js
```

`index.d.ts` is the compact API summary. Then read the changed parts of
`src/client.js` and `src/property-transformer.js`. Write down every new or changed:
property / value, client option (+ default), public method, static method, event,
error class or throwing behaviour, wire-format detail, and anything the client now
does that this repo also does itself.

## 2. Bump the dependency

On a branch, never on `master`:

```bash
git checkout -b feat/client-<NEW>
sed -i 's#v<OLD>/gree-hvac-client-<OLD>.tgz#v<NEW>/gree-hvac-client-<NEW>.tgz#g' package.json
grep -c "gree-hvac-client-<NEW>.tgz" package.json   # must be 2: dependencies AND lint:lockfile --allowed-urls
npm install
npm run lint:lockfile && npm audit --omit=dev
npm test && npm run test:sim                         # catch breakage before adding anything
```

## 3. Map each change to its surfaces

| Client change                                                | Update here                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property or value                                            | `gree-hvac/lib/validation.js` (`READ_ONLY_PROPERTIES`; numeric = no named values), `sim/src/transformer.js` + `sim/src/state.js` defaults + dashboard (`sim/public/`), `docs/PROTOCOL.md` property table, property lists in `gree-hvac/gree-hvac.html` help and README ("all N properties", "Setting properties")                                                                                                                                 |
| Option                                                       | Unit/firmware-specific → `gree-hvac-config` (.js + .html); user preference → `gree-hvac` (.html defaults + form + help, read in `gree-hvac.js` `clientOptions`); owned by the node → set in `lib/connection-manager.js` `_createClient`. Add every new editor default to both example flows (`examples/basic-control.json`, `examples/dashboard-thermostat.json`). Add a row to the mapping table in `docs/PROTOCOL.md` ("In the Node-RED nodes") |
| Instance method                                              | `gree-hvac/lib/actions.js` (args validation + `reply`), the Actions list in `gree-hvac.html` help, the README "Requests (`msg.action`)" table, maybe an inject in the example flow                                                                                                                                                                                                                                                                |
| Static method (`Client.discover`, `Client.configureWifi`, …) | `gree-hvac/gree-hvac-discover.js` + its .html help                                                                                                                                                                                                                                                                                                                                                                                                |
| Event / lifecycle                                            | `lib/connection-manager.js` event mapping → `state` / `diagnostic`; status text in `gree-hvac.js`; README "Connection and recovery"                                                                                                                                                                                                                                                                                                               |
| Error class / throwing behaviour                             | `lib/connection-manager.js` (`isInvalidPropertyError`, `_setProperties`, requeue rules). A synchronous throw from a client method called in a timer becomes an uncaught exception: wrap it                                                                                                                                                                                                                                                        |
| Wire format / protocol detail                                | Simulator `sim/src/` (answer like a real unit: unknown or unsupported codes are left out of status answers) + `sim/test/` (`client-features.test.js` runs the real client against the sim); new `GREE_SIM_*` env var → `sim/bin/gree-sim.js`, README "Simulator configuration", `docker-compose.yml`                                                                                                                                              |
| Client now does something this repo does too                 | Delegate and delete ours; don't run both, since two recovery paths fight. Check `grep -rn "client\._" gree-hvac/`: private-field use is a smell to remove                                                                                                                                                                                                                                                                                         |
| Breaking change in a public API                              | Adapt the callers; note user-visible behaviour changes in the PR body                                                                                                                                                                                                                                                                                                                                                                             |

Mirror each change with tests: `test/validation.test.js`,
`test/connection-manager.test.js` (stubbed client — update `FakeClient` to the
new contract), `test/gree-hvac-node.test.js` (real UDP against the in-process sim),
`sim/test/*`.

## 4. Docs

- `docs/PROTOCOL.md`: port new or changed sections from
  `../gree-hvac-client/docs/PROTOCOL.md`, rewriting `../src/...` links to
  `https://github.com/apachler/gree-hvac-client/blob/master/src/...`. Keep the
  simulator notes and the "In the Node-RED nodes" table current.
- `README.md`: the "Built on gree-hvac-client X.Y" line, Nodes / outputs /
  diagnostics lists, the sections for the touched features, the test table, the
  simulator env table.
- Node help in `gree-hvac/*.html`, the example flow's comment node, `ROADMAP.md`
  ("Recently shipped"; drop items now done), `CLAUDE.md` if the architecture moved.
- Never edit `CHANGELOG.md` — semantic-release owns it.

## 5. Verify

```bash
npm run coverage:check && npm run lint && npm run format:check && npm run lint:lockfile
npm run test:e2e                      # docker stack; E2E_SKIP_BUILD=1 to reuse images
```

If the simulator dashboard changed, check it in a real browser and regenerate the
README screenshot:

```bash
npm i --no-save playwright && npx playwright install chromium
npm run sim:up
curl -X POST http://127.0.0.1:1880/inject/a1c0de0000000002   # flow-driven change for the shot
node docs/screenshot.mjs && npm run sim:down && npm prune
```

Look at `docs/sim-dashboard.png` yourself before keeping it, and confirm the bump
left `package.json` free of Playwright.

## 6. Pull request

Conventional-Commit title — it becomes the squash commit and drives the release:
`feat: …` when users get new features (minor), `fix: …` for a fix-only bump
(patch). The body lists the client release, what each surface gained, behaviour
changes, and the test results. Auto-merge is disabled: merge only when the user
asks and the required checks are green; semantic-release then tags and publishes.
