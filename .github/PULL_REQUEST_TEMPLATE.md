<!--
  Thanks for contributing! Please keep the PR title in Conventional Commit form,
  e.g. "feat: add quiet mode toggle" or "fix(connection): clear stuck watchdog".
  The release-notes automation derives the changelog category from the prefix.
-->

## What & why

<!-- What does this PR change, and why? Link any related issue: "Closes #123". -->

## Type of change

- [ ] `fix` — bug fix (non-breaking)
- [ ] `feat` — new feature (non-breaking)
- [ ] `docs` — documentation only
- [ ] `refactor` / `perf` / `style` — no functional change
- [ ] `test` / `ci` / `build` / `chore` — tooling & maintenance
- [ ] Breaking change (describe migration below)

## Checklist

- [ ] PR title follows [Conventional Commits](https://www.conventionalcommits.org/)
- [ ] `npm run lint` passes
- [ ] `npm test` and `npm run test:sim` pass
- [ ] `npm run test:e2e` run locally (for protocol / connection-manager changes)
- [ ] `CHANGELOG.md` updated under **Unreleased**
- [ ] Docs updated (`README.md` / `docs/PROTOCOL.md`) if behaviour changed
- [ ] Mock/sim data goes in `flows.mocks.json`, **not** `flows.user.json`

## Notes for reviewers

<!-- Anything reviewers should focus on, manual test steps, screenshots, etc. -->
