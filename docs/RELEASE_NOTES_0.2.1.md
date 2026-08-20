# HomeOps Sentinel 0.2.1

HomeOps Sentinel 0.2.1 is a reliability and security-focused maintenance release. It makes alert delivery durable, closes outbound network policy gaps, improves concurrent state recovery, and prevents common dashboard actions from losing work or reporting false success.

## Highlights

- Preserve monitor alert transitions across manual checks, transient webhook failures, process restarts, and graceful shutdowns with a durable, bounded-retry outbox.
- Support hostname-based HTTP, TCP, TLS, and webhook connections correctly on Node.js 22 while enforcing hard end-to-end DNS and socket deadlines.
- Block private, loopback, link-local, translated, mapped, and site-local address forms consistently, including IPv6 canonicalization edge cases.
- Recover corrupted or missing state safely across concurrent readers and processes, and create the first-run encryption secret atomically.
- Apply strict monitor, backup, TLS, settings, and environment validation without silently accepting partial numbers or coercive booleans.
- Keep unsaved restore-test drafts during background refreshes, preserve failed form submissions, and report webhook delivery failures accurately.
- Add accessible monitor dialogs with initial focus, focus trapping, background isolation, focus restoration, and dialog-local validation errors.
- Honor custom development ports and shut down development child processes cleanly.
- Verify release images against the version tag, raw OCI digest, GitHub repository owner, and required `linux/amd64` and `linux/arm64` manifests.

## Verification

The release is covered by linting, formatting checks, type checks, 85/80/85 coverage thresholds, production build and smoke tests, Playwright end-to-end and accessibility tests, production dependency auditing, Docker restart persistence, security regression tests, secret scanning, OSV scanning, and Trivy image scanning.

The Umbrel package is pinned to a signed multi-architecture GHCR image with registry-attached BuildKit SBOM and provenance attestations.

## Compatibility

- Existing monitors, history, backups, incidents, settings, alert configuration, and heartbeat metadata are preserved.
- Existing per-monitor intervals remain unchanged; the global default now applies when creating a monitor without an explicit interval.
- Failed alert deliveries are retried up to five times with backoff; obsolete attempts are superseded after a newer non-notifying transition.
- App access continues to rely on Umbrel app proxy authentication.
- The package supports `linux/amd64` and `linux/arm64` on Node.js 22 or newer.
