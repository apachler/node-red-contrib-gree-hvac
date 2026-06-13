# Governance

This document describes how **node-red-contrib-gree-hvac** is run. It is
deliberately lightweight to match the project's current scale — a single
maintainer working on a best-effort basis. It will grow if and when the project
gains additional maintainers.

## Scope

The project provides Node-RED nodes that control Gree air-conditioners over their
LAN UDP/AES protocol, plus a software simulator and docker stack for developing
and testing without hardware. Changes are evaluated against that scope; see
[ROADMAP.md](ROADMAP.md) for what's in and out.

## Roles

- **Maintainer** — currently [@apachler](https://github.com/apachler). Reviews
  and merges pull requests, triages issues, cuts releases, and has the final say
  on technical direction and scope.
- **Contributors** — anyone who opens an issue or pull request. No special status
  is required to contribute.

## How decisions are made

- Discussion happens in the open, on GitHub issues and pull requests.
- The maintainer makes the final call when there's no clear consensus, weighing
  scope, maintenance cost, supply-chain/audit surface, and risk to existing
  users' 24/7 deployments.
- Significant or risky changes (new device capabilities, protocol changes) are
  preferred behind tests and, where possible, validated against the bundled
  simulator before merge.

## Contributions & releases

- See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, the git hooks, tests, and
  coding standards.
- Pull requests are **squash-merged**, so the **PR title must be a valid
  [Conventional Commit](https://www.conventionalcommits.org/)** — semantic-release
  derives the next version and changelog from it (`fix:` → patch, `feat:` →
  minor). Releases are automated on merge to `master`; the maintainer does not
  hand-pick versions or push tags.

## Becoming a maintainer

There is no formal process today. A sustained track record of high-quality,
in-scope contributions and good judgement in review is the practical path. If the
project reaches a point where additional maintainers are warranted, this section
(and a more formal decision model) will be expanded.

## Code of conduct & security

- All participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security vulnerabilities privately per the [security policy](SECURITY.md)
  — do not open a public issue.
