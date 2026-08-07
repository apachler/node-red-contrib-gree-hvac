## [1.6.1](https://github.com/apachler/node-red-contrib-gree-hvac/compare/v1.6.0...v1.6.1) (2026-08-07)


### Bug Fixes

* adopt gree-hvac-client v3.0.6 (GCM auto-detect, status-timeout and child-logger fixes) ([#36](https://github.com/apachler/node-red-contrib-gree-hvac/issues/36)) ([7c21e9f](https://github.com/apachler/node-red-contrib-gree-hvac/commit/7c21e9f2e4e12d67ce5421cd33cba8f4089dc5f5))

# [1.6.0](https://github.com/apachler/node-red-contrib-gree-hvac/compare/v1.5.2...v1.6.0) (2026-06-06)


### Features

* resolve device by MAC to follow DHCP IP changes ([#25](https://github.com/apachler/node-red-contrib-gree-hvac/issues/25)) ([fd31daf](https://github.com/apachler/node-red-contrib-gree-hvac/commit/fd31daf015d7863c14a219633b4fa199249d8423))

## [1.5.2](https://github.com/apachler/node-red-contrib-gree-hvac/compare/v1.5.1...v1.5.2) (2026-06-06)


### Bug Fixes

* adopt gree-hvac-client v3.0.3 (TemSen offset guard for non-offset firmwares) ([#24](https://github.com/apachler/node-red-contrib-gree-hvac/issues/24)) ([ddbc5a9](https://github.com/apachler/node-red-contrib-gree-hvac/commit/ddbc5a9a4ee6d00fa96cd0007bfb0026030da139)), closes [inwaar/node-red-contrib-gree-hvac#10](https://github.com/inwaar/node-red-contrib-gree-hvac/issues/10)

## [1.5.1](https://github.com/apachler/node-red-contrib-gree-hvac/compare/v1.5.0...v1.5.1) (2026-06-06)


### Bug Fixes

* adopt gree-hvac-client v3.0.2 (sleep on/off + parser hardening) ([#23](https://github.com/apachler/node-red-contrib-gree-hvac/issues/23)) ([9f0b6f5](https://github.com/apachler/node-red-contrib-gree-hvac/commit/9f0b6f5c3b7b1cacd7fa52151a0cbc225240f73c)), closes [inwaar/node-red-contrib-gree-hvac#7](https://github.com/inwaar/node-red-contrib-gree-hvac/issues/7) [inwaar/node-red-contrib-gree-hvac#11](https://github.com/inwaar/node-red-contrib-gree-hvac/issues/11) [#12](https://github.com/apachler/node-red-contrib-gree-hvac/issues/12)

# [1.5.0](https://github.com/apachler/node-red-contrib-gree-hvac/compare/v1.4.0...v1.5.0) (2026-06-05)


### Bug Fixes

* **deps:** clear dev-toolchain audit advisories (npm audit fix) ([6e0d113](https://github.com/apachler/node-red-contrib-gree-hvac/commit/6e0d113e4a8782dc865bff398aac6781a3af6202))
* **e2e:** drop Node-20-only --test-timeout flag; cap e2e job runtime ([5240efc](https://github.com/apachler/node-red-contrib-gree-hvac/commit/5240efc2dfcc1cac1983d9d2a915f3f1a0037cfe))
* **e2e:** make the docker-compose suite pass end-to-end ([8e1f1ab](https://github.com/apachler/node-red-contrib-gree-hvac/commit/8e1f1abab5b6238c05139711d97b4788afb42294))
* **e2e:** pass explicit test files (node --test glob is Node 21+) ([dc0be0b](https://github.com/apachler/node-red-contrib-gree-hvac/commit/dc0be0ba42e1c70d9e8c3ce819cdeb1efc72d304))
* **flow:** restore mock sensor pump + harden cross-tab link; dark-mode polish ([b22d5d2](https://github.com/apachler/node-red-contrib-gree-hvac/commit/b22d5d2421b41de4af8cb5485d9feac22c66f883))
* **security:** resolve CodeQL alerts in sim + flow tooling ([c9c4b57](https://github.com/apachler/node-red-contrib-gree-hvac/commit/c9c4b573b6e541bf10ea188602c6ed6c4ef196db))
* **sim:** Sim Sensors 'Stored in sim' showed [object Object] ([f6543f5](https://github.com/apachler/node-red-contrib-gree-hvac/commit/f6543f528443c0eb2f5682d2c67daf54f8b24fd1))


### Features

* docker-compose stack with simulator and Node-RED ([3069d60](https://github.com/apachler/node-red-contrib-gree-hvac/commit/3069d60ff0e59dda1fd977b76815ea6245e206d4))
* **flow:** add flow:push to deploy source flows live without rebuild ([e161efa](https://github.com/apachler/node-red-contrib-gree-hvac/commit/e161efa0d85b309373e59392f8ea1c4b233e6b55))
* **flow:** deactivate-temp shutoff, segmented mode control, dashboard polish ([96df204](https://github.com/apachler/node-red-contrib-gree-hvac/commit/96df204c05355962ae1db7c777d98954548900ff))
* **flow:** thematic config groups + X-Fan as dropdown ([59281a9](https://github.com/apachler/node-red-contrib-gree-hvac/commit/59281a938415f41ce0dc0e16e9c096ba4f738c0b))
* full AC control + per-field hints + trends + complete param sets ([9f52500](https://github.com/apachler/node-red-contrib-gree-hvac/commit/9f52500368f5fb85c40d7c0358a17291633e5917))
* hot-reload dev mode for the Node-RED container ([1851d1f](https://github.com/apachler/node-red-contrib-gree-hvac/commit/1851d1fba57ccfee89eda02b3ac66554d7eae2d6))
* redesign control logic + split Config dashboard page ([ee91879](https://github.com/apachler/node-red-contrib-gree-hvac/commit/ee918791d55a81be80bce3dc0b98c12c6b219c04))
* remove flow watchdog, full AC control on sim, dark theme, consistent config inputs + hints ([2f7167d](https://github.com/apachler/node-red-contrib-gree-hvac/commit/2f7167d52c5824a3a0664c5278ad3af9f2331c7c))
* **sim:** clock override, prefillable sensor form, change-source display ([b7a25f6](https://github.com/apachler/node-red-contrib-gree-hvac/commit/b7a25f6416edbbfdd0cb9712eae2b9b813299046))
* **sim:** direct AC controls on the dashboard + Node-RED sensor form ([3de548b](https://github.com/apachler/node-red-contrib-gree-hvac/commit/3de548b5a82ac1f256dfbfb59ded6a0f72ccbfa0))
* **sim:** Gree HVAC software simulator with HTTP dashboard ([c16872e](https://github.com/apachler/node-red-contrib-gree-hvac/commit/c16872ee35980fd4a919efe53316757ab052246b))
* **sim:** verbose protocol logging (GREE_SIM_VERBOSE) ([fa7df2e](https://github.com/apachler/node-red-contrib-gree-hvac/commit/fa7df2e98c727fc563734bc79c3c558c3d7ee8e5))

# Changelog

All notable changes to this project are tracked here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases on `master` are produced by `semantic-release` from commit
messages, so individual published versions also live in the GitHub
releases page.

## [Unreleased]

### Added

- **Production-grade connection manager**: the node now owns the client
  lifecycle (the upstream library's auto-connect is disabled) and drives
  reconnect with exponential backoff, a long initial recovery delay, and
  two watchdogs (silence-while-connected and stuck-in-connecting). This
  recovers a wedged Gree WiFi module without a physical power cycle.
- **Third "diagnostics" output**: emits structured events
  (`state`, `error`, `queue_overflow`, `heartbeat`, `update`, `write_ack`)
  with full metrics so absence-of-message and state transitions can drive
  alerts in downstream flows.
- **Heartbeat** on the diagnostics output (default 60 s, configurable,
  set to 0 to disable).
- **Runtime context metrics**: live snapshot under
  `context().get('gree')` with state, uptime, last contact, queue size
  and reset counters.
- **Outbound queue** that throttles writes (default 500 ms spacing) and
  coalesces bursts (last-write-wins per property), with a hard cap and
  oldest-eviction so an offline device cannot cause unbounded memory
  growth.
- **Catch-node integration**: invalid input messages and rejected writes
  call `node.error(err, msg)` so they can be handled by a downstream
  catch node.
- **Reject-if-offline** option: optionally fail writes immediately when
  disconnected instead of queueing them.
- **Property/value validation** against the upstream `PROPERTY` /
  `VALUE` schema; unknown keys are dropped with a warning rather than
  sent to the device (unknown keys are a known wedge trigger).
- **`gree-hvac-discover` utility node**: broadcast-scans the subnet and
  returns the list of responding devices, for populating config nodes.
- **UDP port** is configurable on the config node.
- **Tests**: unit tests for the connection manager and validation
  module, runnable with `npm test` (no new dependencies — uses the
  built-in `node:test` runner).
- **CI**: tests now run alongside lint on Node 18 and 20.
- **`.npmignore`** so dev files (sandbox, test, devcontainer, github
  config) stay out of the published package.
- **`engines.node`** and `node-red.version` declared in `package.json`.
- **Dependabot** config for weekly npm updates (with a grouped PR for
  devDependencies) and monthly GitHub Actions updates.
- **GitHub Release tarballs**: every release now also publishes the
  packaged `.tgz` as a GitHub Release asset, so it can be installed
  directly into Node-RED without going through the npm registry —
  useful for air-gapped Node-RED instances. See the README for the
  install command.

### Changed

- `gree-hvac-client` dependency pinned to `~2.2.0` to avoid silent
  behavioural changes in 2.x minors that could re-introduce the wedge.
- Status text now includes a timestamp of last contact while connected.
- All timers use `unref()` so a misconfigured node cannot keep the
  Node-RED process alive on shutdown.

### Fixed

- The upstream library's internal reconnect loop kept re-arming
  `setTimeout`s after `disconnect()` and could fire `_initialize` on a
  closed socket, producing uncaught `'error'` events; this is now
  neutralised during teardown.
- An orphaned `_bindTimeoutRef` survived `disconnect()` and could send
  stale bind packets at the device after we had moved on; now cleared
  explicitly.
- No `'error'` handler was attached to the underlying `dgram` socket; a
  kernel socket error could crash Node-RED. A handler is now installed
  as soon as the socket exists.
- Close-race where setting `client = null` synchronously while
  `disconnect()` was in-flight caused throws on subsequent input.
