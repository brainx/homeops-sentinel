# Security Threat Model

## What Can Go Wrong

- A stored webhook URL could leak through the browser, logs, or state file.
- A malicious authenticated user could try to use HTTP monitors for unsafe server-side requests.
- State-changing API calls could be triggered from another origin.
- A webhook URL could be abused as an SSRF target.
- User-provided text could be reflected unsafely in the UI.
- A known local development secret could weaken encrypted alert storage.
- A container compromise could try to write outside app data or inspect host resources.

## Sensitive Data

- Webhook URLs and tokens embedded in those URLs.
- Backup heartbeat bearer tokens.
- Internal service names, ports, and availability status.
- Incident notes that may contain operational details.
- Backup schedule, last-success timestamps, restore-test targets, and restore evidence notes.

## Trust Boundaries

- Umbrel app proxy protects the user-facing app boundary.
- Browser code talks only to same-origin `/api` endpoints.
- The server performs monitor checks on user-provided targets.
- Persistent state is limited to the mounted app data directory.
- The container has no Docker socket, no privileged mode, and no host mount.

## Relevant Abuse Cases

- Cross-site form or fetch attempts against state-changing API routes.
- Credential-bearing URLs provided as monitor or webhook targets.
- Link-local or metadata IP probing through HTTP, TCP, or TLS monitors, including through hostnames that resolve to blocked addresses.
- Loopback, metadata, link-local, or redirect-based SSRF through webhook delivery.
- Brute-force or leaked heartbeat tokens used to forge backup success events.
- Webhook endpoints returning errors while the UI incorrectly reports successful alert delivery.
- Large request bodies intended to exhaust memory or disk.
- Stored text that attempts script injection.

## Chosen Mitigations

- State-changing browser API routes reject cross-origin requests, reject cross-site Fetch Metadata when present, and require an explicit same-origin intent header.
- JSON request bodies are capped at 64 KB.
- Webhook URLs are encrypted with AES-256-GCM using `APP_SEED`, a strong `HOMEOPS_SECRET_KEY`, or generated data-dir secret material.
- Known weak configured secrets are rejected at startup.
- The public state API returns only masked webhook metadata.
- The diagnostics API returns app/runtime health, scheduler state, and aggregate counts without webhook URLs, heartbeat tokens, token hashes, or local filesystem paths.
- Backup heartbeat tokens are generated server-side, shown once, stored only as hashes, and verified with constant-time comparison.
- Heartbeat endpoints require bearer tokens and are rate-limited per remote address and backup tracker.
- HTTP monitor URLs are limited to `http` and `https`, reject embedded credentials, and block metadata/link-local targets.
- HTTP, TCP, and TLS connections validate resolved addresses before connecting so DNS names cannot resolve into blocked metadata or link-local addresses.
- Webhook URLs are limited to `http` and `https`, reject embedded credentials, block loopback/private/LAN/CGNAT/metadata/link-local targets, and revalidate redirect targets before delivery.
- Manual monitor checks are rate-limited per remote address and monitor.
- Webhook alert delivery records success and failure events without storing webhook URLs or secrets.
- The React UI renders text through normal JSX and does not use unsafe HTML injection.
- The Docker entrypoint repairs mounted `/data` ownership and then runs the Node server as the unprivileged `node` user, with a read-only filesystem, `no-new-privileges`, and a dedicated `/data` volume.
- Browser responses include a restrictive Content Security Policy, MIME sniffing protection, referrer policy, permissions policy, and same-origin frame policy.

## Known Limitations

- Local network probing is intentionally allowed because monitoring home-network services is the core product use case.
- Webhook delivery is best-effort and currently supports one endpoint.
- Local network monitor targets are intentionally allowed; this includes loopback for local development and self-health checks. Link-local, metadata, multicast, and unspecified targets remain blocked. Webhook targets are stricter and do not allow private/LAN destinations.
- Umbrel app proxy is the intended authentication layer; the app does not add a second login system.
