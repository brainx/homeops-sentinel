# Architecture

HomeOps Sentinel is a single-container web app for local readiness monitoring on Umbrel and
home-server deployments.

## Runtime Shape

- The browser UI is a React/Vite app served by the same Node.js process as the API.
- The API stores state in a local JSON file under the configured data directory.
- In Docker and Umbrel, persistent state is written under `/data`.
- In the Umbrel package, `${APP_DATA_DIR}/data` is mounted to `/data`.
- The app is exposed through Umbrel `app_proxy`; the package does not publish direct host ports.

## Server Modules

| Module | Responsibility |
| --- | --- |
| `server/index.js` | HTTP server, API routes, static file serving, scheduler |
| `server/monitors.js` | HTTP, TCP, DNS, TLS, backup, and restore-test health logic |
| `server/store.js` | Atomic JSON persistence and corrupt-state recovery |
| `server/secrets.js` | Webhook encryption and masked public metadata |
| `server/heartbeats.js` | Backup heartbeat token generation, hashing, and verification |
| `server/network.js` | Outbound URL validation, safe DNS lookup, and webhook delivery |
| `server/request-security.js` | Same-origin mutation intent checks |

## Trust Boundaries

- Browser clients are untrusted and must use same-origin API requests for state-changing actions.
- Monitor targets are user configured and treated as untrusted network input.
- Webhook URLs are sensitive and stay server-side; public API responses only include masked metadata.
- Heartbeat tokens are shown once and stored only as hashes.
- Umbrel app proxy is the outer user-authentication boundary.

## Persistence

State is stored in `homeops-sentinel.json` with atomic write-and-rename semantics. Secret material is
stored separately in `.homeops-secret` unless Umbrel provides `APP_SEED`.

The Docker smoke test verifies that:

- the app starts as the unprivileged `node` user,
- state survives container restart,
- webhook URLs are encrypted at rest,
- heartbeat tokens are not stored or returned in cleartext.

## Diagnostics

`GET /api/diagnostics` returns support-safe app version, runtime, storage
recovery, scheduler, readiness, alert configuration, and aggregate count data.
It does not return monitor target secrets beyond normal public state, webhook
URLs, heartbeat tokens, token hashes, or local filesystem paths.

## Network Posture

- Local-network monitor targets are allowed because the app is designed for home-server checks.
- Metadata, link-local, multicast, unspecified, credential-bearing, and unsupported-scheme targets are blocked.
- Webhook delivery is stricter than monitor probing and blocks loopback and private network targets.
- The app has no telemetry and makes outbound requests only for user-configured monitors and webhook alerts.

## Container Posture

The release container:

- uses a multi-stage Docker build,
- runs the server as the unprivileged `node` user after data-directory ownership repair,
- uses the Umbrel app data volume for persistent state,
- does not mount the Docker socket,
- does not request privileged mode,
- does not use host networking.
