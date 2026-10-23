# Contributing

Thanks for your interest in improving **node-red-contrib-gree-hvac**! This
project controls Gree air-conditioners over their UDP/AES protocol and ships a
full software simulator so you can develop and test without hardware.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

## Getting started

Requirements:

- **Node.js 22 LTS** for development (`.nvmrc`; the lint toolchain needs 22+).
  The published package still runs on Node 18+, and CI tests 18/20/22/24.
- **Docker + Docker Compose v2** (only for the e2e / simulator stack)

```bash
git clone https://github.com/apachler/node-red-contrib-gree-hvac.git
cd node-red-contrib-gree-hvac
npm install
```

`npm install` runs the `prepare` script, which points `core.hooksPath` at
`./.githooks/`. Two hooks are installed:

- **commit-msg** — checks the commit subject is a [Conventional
  Commit](https://www.conventionalcommits.org/) (`<type>[scope][!]: subject`).
  Zero-dependency (a small shell script, no commitlint). Merge/revert/fixup
  subjects pass through.
- **pre-push** — runs `eslint --fix` over the repo and refuses the push if
  ESLint reports unfixable errors, or if `--fix` produced changes you haven't
  committed (so the fix lands in a reviewable commit).

Skip either with `GREE_SKIP_LINT=1` (e.g. `GREE_SKIP_LINT=1 git commit ...` or
`GREE_SKIP_LINT=1 git push ...`) for an emergency / WIP commit.

## Development workflow

```bash
npm run lint          # ESLint + Prettier
npm run lint:fix      # auto-fix
npm test              # unit tests for the contrib nodes (node:test)
npm run test:sim      # unit tests for the simulator (in-process)
npm run test:e2e      # full docker-compose stack e2e suite
npm run coverage      # unit + sim tests with a c8 coverage summary
```

While iterating on e2e tests, reuse images and leave the stack up:

```bash
E2E_SKIP_BUILD=1 E2E_KEEP_UP=1 npm run test:e2e
```

To run the simulator stack interactively, see the **Development with the
simulator** section of the [README](README.md).

### Project layout

| Path                      | What it is                                            |
| ------------------------- | ----------------------------------------------------- |
| `gree-hvac/`              | the published Node-RED nodes                          |
| `gree-hvac/lib/`          | connection manager (24/7 reconnect) + validation      |
| `sim/`                    | standalone Gree simulator (UDP server + dashboard)    |
| `test/`, `sim/test/`      | unit tests (live next to what they cover)             |
| `test/e2e/`               | end-to-end tests driving the docker-compose stack     |
| `docker/`                 | Node-RED service image + sample/mocks flows           |
| `docs/PROTOCOL.md`        | the full Gree UDP/AES protocol & property reference   |

> **Note:** `docker/nodered/flows.user.json` is the production flow. Mock
> sensor data belongs in `flows.mocks.json` (merged at image build time), **not**
> in the user flow.

## Coding standards

- **Style:** ESLint + Prettier (single quotes, 4-space indent in JS, 2-space in
  JSON/YAML). Run `npm run lint` before pushing — the hook does this for you.
- **Tests:** use the native `node --test` runner. Add tests next to the code
  they cover. New behaviour should come with a test; the simulator is your
  friend for protocol-level coverage.
- **Node version:** keep changes compatible with Node 18+.

## Commit & PR conventions

PR titles **must** follow [Conventional Commits](https://www.conventionalcommits.org/),
e.g. `feat: add quiet mode toggle` or `fix(connection): clear stuck watchdog`.
PRs are squash-merged, and semantic-release derives the next version and the
release notes from that title (`fix:` → patch, `feat:` → minor). The `labeler`
workflow also maps the prefix to a label for triage. Recognised prefixes:

`feat:` `fix:` `docs:` `test:` `chore:` `refactor:` `perf:` `ci:` `build:` `style:`

Before opening a PR:

1. `npm run lint && npm test && npm run test:flow && npm run test:sim` all pass
   (`npm run coverage:check` enforces the coverage thresholds CI uses).
2. For protocol/connection changes, run `npm run test:e2e` locally.
3. Update docs (`README.md` / `docs/PROTOCOL.md`) when behaviour changes.

## Releasing

Fully automated by semantic-release: merging a PR to `master` with a `fix:` or
`feat:` title bumps `package.json` + `CHANGELOG.md`, tags the release, and
publishes a GitHub Release with the `.tgz`, its signed build provenance and a
CycloneDX SBOM. Don't bump versions, edit the changelog or push tags by hand.
`master` is ruleset-protected (PR, squash only, required checks).

## Reporting bugs & asking questions

- **Bugs / feature requests:** open an [issue](https://github.com/apachler/node-red-contrib-gree-hvac/issues).
- **Questions / help:** see [SUPPORT.md](SUPPORT.md).
- **Security vulnerabilities:** see [SECURITY.md](SECURITY.md) — please do
  **not** open a public issue.
