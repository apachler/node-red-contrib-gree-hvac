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
