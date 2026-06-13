# Roadmap

A high-level view of where **node-red-contrib-gree-hvac** is headed. This is a
single-maintainer, best-effort project (see [GOVERNANCE.md](GOVERNANCE.md)), so
this roadmap reflects *intent and priorities*, not commitments or dates.

**The live source of truth is the issue tracker** —
[open issues](https://github.com/apachler/node-red-contrib-gree-hvac/issues) and
[feature requests](https://github.com/apachler/node-red-contrib-gree-hvac/issues/new/choose)
drive what actually gets worked on. This file is the curated summary.

## Recently shipped

- **Robust 24/7 operation** — a `ConnectionManager` with backoff reconnect and
  watchdogs that absorbs client errors, so a bad packet, wrong IP, or flaky
  second unit no longer crashes Node-RED.
- **Follow a device across DHCP changes** — optional "resolve by MAC" on the
  config node re-points the connection when the IP changes (v1.6.0).
- **Correct `currentTemperature` on non-offset firmwares** — guards the `TemSen`
  `+40` quirk so affected units stop reporting bogus sub-zero readings (v1.5.2).
- **`sleep` on/off actually works** — writes the paired `SwhSlp`/`SlpMod` codes.
- **GCM encryption** support for newer firmwares.
- **Project health** — bundled software simulator + docker e2e stack, coverage
  gate, CodeQL, container image scanning, Node 22 LTS standardization.

## Considering (near-term, no hardware needed)

- **Fahrenheit setpoints** — surface `{temperature, temperatureUnit:"fahrenheit"}`
  end-to-end (needs hardware to verify the round-trip — see *Help wanted*).
- **SBOM on release** — attach a CycloneDX/SPDX bill of materials to each
  GitHub Release for supply-chain transparency.
- **Stricter container scanning** — flip the Trivy image scan from report-only to
  failing CI on HIGH/CRITICAL once the baseline is clean.
- **Full SHA-pinning of GitHub Actions** — pin every `uses:` to a commit SHA.

## Help wanted / needs hardware

These need a real device + a `logLevel:"debug"` capture to make progress. If you
have the hardware, a debug trace on an issue is the most useful contribution.

- **Fahrenheit round-trip verification** on a unit that reports °F.
- **Firmware ≥ 1.21 GCM handshake quirk** — GCM is supported, but some commercial
  ceiling units still fail *after* a successful bind; needs a post-bind trace.
- **Gree RV air-conditioner** — reportedly emits no unsolicited status; needs a
  capture before anything is actionable.

## Out of scope / unlikely

- **iFeel external room-temperature feed** — iFeel is driven by the remote over
  IR (the sensor lives in the handset); most units expose no LAN write path for
  an external temperature, so there's no clean implementation over this transport.
- **AP-mode WiFi provisioning ("add WiFi")** — pushing SSID/password to a
  factory-reset unit is niche and carries real bricking risk; use the vendor app
  for onboarding. May revisit if there's clear demand.

## Process notes

- **Releases** are automated by semantic-release from Conventional-Commit PR
  titles (see [CONTRIBUTING.md](CONTRIBUTING.md) and CLAUDE.md → Releasing).
- **npm publishing is intentionally off** — the package ships as a GitHub Release
  `.tgz` tarball (same model as the `gree-hvac-client` fork it depends on). This
  may be re-enabled later.
