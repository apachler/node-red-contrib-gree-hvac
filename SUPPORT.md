# Support

Thanks for using **node-red-contrib-gree-hvac**! Here's where to get help.

## Questions & how-to

- **General questions, setup help, "how do I…"** — open a
  [GitHub Discussion](https://github.com/apachler/node-red-contrib-gree-hvac/discussions)
  if Discussions are enabled, otherwise a
  [question issue](https://github.com/apachler/node-red-contrib-gree-hvac/issues/new/choose).
- **Protocol / property questions** ("what does `blow` do?", the `TemSen +40`
  quirk, value maps) — the full reference is in
  [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
- **Node-RED usage** — the [README](README.md) has an importable example flow
  and a simulator you can run locally without hardware.

## Reporting bugs & requesting features

Use the [issue templates](https://github.com/apachler/node-red-contrib-gree-hvac/issues/new/choose).
A good bug report includes:

- the package version (`npm ls node-red-contrib-gree-hvac`) and Node.js version,
- your Gree model / firmware if known,
- the relevant **Diagnostics** output (third node output: `state`, `error`,
  `heartbeat`, …),
- steps to reproduce — ideally against the bundled simulator.

## Security issues

Do **not** open a public issue for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## Commercial / unattended deployments

This project is maintained on a best-effort basis by volunteers. There is no
paid support tier. If you depend on it for unattended 24/7 operation, pin a
specific version and test upgrades against the simulator first.
