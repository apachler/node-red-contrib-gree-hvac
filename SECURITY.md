# Security Policy

## Supported versions

Security fixes are applied to the latest released `1.x` line. Older versions are
not maintained — please upgrade to the latest release before reporting an issue.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, report them privately through GitHub's
[**Private Vulnerability Reporting**](https://github.com/apachler/node-red-contrib-gree-hvac/security/advisories/new):

1. Go to the **Security** tab of the repository.
2. Click **Report a vulnerability**.
3. Provide a clear description, affected versions, and reproduction steps.

> Maintainer setup: enable *Settings → Code security → Private vulnerability
> reporting* so the link above is active.

You can expect an initial acknowledgement within **5 business days**. Once the
issue is confirmed and a fix is prepared, we will coordinate a release and credit
you in the advisory (unless you prefer to remain anonymous).

## Scope & threat model

This package speaks Gree's UDP/AES LAN protocol to air-conditioner units, and
ships a simulator + docker stack used **only for development and testing**.
Things worth keeping in mind when assessing reports:

- The Gree protocol uses **vendor-fixed generic keys** (`a3K8Bx%2r8Y7#xDh` for
  AES-ECB, `{yxAHAY_Lm6pbC/<` for AES-GCM) for discovery/bind. These are part of
  the documented protocol, **not** secrets — see [`docs/PROTOCOL.md`](docs/PROTOCOL.md).
- The simulator dashboard (`:8080`) and the docker-compose stack are **not**
  hardened for production exposure. Do not deploy them to untrusted networks.
- Run the nodes on a trusted LAN segment; the Gree protocol has no transport
  authentication beyond the bind key exchange.

Reports about the fixed generic keys, or about the unauthenticated simulator
dashboard intended for local development, are considered **out of scope**.
