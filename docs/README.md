# Docs media

Generated assets used by the top-level `README.md`. Everything here is
reproducible — the committed `.svg` is hand-authored; the `.gif` and
`.png` are rendered by the tooling below (locally or in CI via
`.github/workflows/docs-media.yml`).

| Asset                      | How it's made                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `logo.svg`                 | Hand-authored vector (also the sim favicon).                                                                                      |
| `demo.gif`                 | `vhs docs/demo.tape` — terminal demo of the stack.                                                                                |
| `sim-dashboard.png`        | `node docs/screenshot.mjs` — Playwright shot of `:8080`.                                                                          |
| `example-flow.png`         | `node docs/screenshot.mjs` — the example flow in the Node-RED editor at `:1880`, after firing two of its injects.                 |
| `dashboard-thermostat.png` | `node docs/screenshot.mjs` — the dashboard example at `:1880/dashboard/gree`, after setting the simulated AC to cool a warm room. |

## Terminal demo GIF (VHS)

[VHS](https://github.com/charmbracelet/vhs) renders a small, crisp GIF from
a scripted terminal session.

```bash
# one-time: install vhs (brew install vhs / go install / see VHS docs)
docker compose build         # pre-build so the GIF isn't just image builds
vhs docs/demo.tape           # writes docs/demo.gif
```

## Screenshots (Playwright)

```bash
npm i --no-save playwright && npx playwright install chromium
npm run sim:up               # stack must be running
node docs/screenshot.mjs     # writes docs/example-flow.png, docs/dashboard-thermostat.png, docs/sim-dashboard.png
npm run sim:down
```

## CI

`.github/workflows/docs-media.yml` renders both on demand
(`workflow_dispatch`) and uploads them as build artifacts, so you can
regenerate without a local toolchain and download the results (artifact
`docs-media`). Commit any updated files through a normal PR — `master` is
ruleset-protected, so the workflow does not push.
