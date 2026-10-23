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

> Maintainer setup: enable _Settings → Code security → Private vulnerability
> reporting_ so the link above is active.

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
  hardened for production exposure. The compose file publishes their ports on
  `127.0.0.1` only; widen that with `GREE_BIND=0.0.0.0` only on a trusted
  network, and never deploy the stack to an untrusted one.
- Run the nodes on a trusted LAN segment; the Gree protocol has no transport
  authentication beyond the bind key exchange.

## Hardening a production deployment

Anyone who can reach the AC on the LAN can control it (the bind keys are
public), and anyone who can reach the Node-RED editor can change what the
nodes send. For a real installation (e.g. Node-RED on Victron Venus OS):

- **Isolate the AC.** Put the Gree WiFi module on its own VLAN / IoT network
  that only the Node-RED host can reach, and block its internet access unless
  you need the vendor cloud app.
- **Lock down Node-RED.** Enable `adminAuth` (editor + admin API) and, if you
  use Dashboard 2.0 or HTTP-in nodes, `httpNodeAuth`; serve it over HTTPS or
  keep it off untrusted networks. See the Node-RED
  [security guide](https://nodered.org/docs/user-guide/runtime/securing-node-red).
- **Set a real `credentialSecret`** in `settings.js` — the docker stack's
  `gree-sim-dev` value is for local development only.
- **Keep it patched.** Watch this repo's releases (each `.tgz` has signed
  build provenance — verify with `gh attestation verify`) and keep Node-RED
  and Node.js on supported versions.

Reports about the fixed generic keys, or about the unauthenticated simulator
dashboard intended for local development, are considered **out of scope**.
