# Changelog

## 0.2.1 - 2026-08-20

- Made alert transitions durable across manual checks, delivery failures, restarts, and graceful shutdowns with bounded retries and stale-attempt protection.
- Hardened outbound monitor and webhook networking against IPv6 address-policy bypasses, stalled DNS and socket operations, and leaked TCP/TLS connections.
- Fixed hostname checks on Node.js 22 and corrected TLS expiry, backup freshness, unknown-state, and default-interval calculations.
- Made state recovery and first-run secret creation safe under concurrent processes while strictly validating persisted maps and API configuration.
- Preserved unsaved form drafts during polling, surfaced delivery and save failures accurately, and added complete keyboard focus management to monitor dialogs.
- Made custom development ports reliable and ensured the development coordinator cleans up child processes during exit and shutdown.
- Strengthened release verification to validate the versioned registry tag, pinned OCI digest, repository owner, and required AMD64/ARM64 platforms.
- Added focused regression, security, lifecycle, accessibility, and release-tooling coverage to the default test path.

## 0.2.0 - 2026-07-20

- Added bounded per-monitor check history with availability, average latency, and recent-check timelines.
- Added monitor editing plus pause and resume controls without discarding prior results or history.
- Excluded paused monitors from active health counts while keeping an all-paused setup visibly degraded.
- Migrated persisted state to schema version 2 with safe normalization for existing installations.
- Expanded API, unit, end-to-end, and accessibility coverage for monitor history and lifecycle controls.

## 0.1.0 - Initial Release Candidate

- Added HomeOps Sentinel dashboard for self-hosted readiness checks.
- Added HTTP, TCP, DNS, and TLS monitor support.
- Added backup freshness tracking with manual success recording and bearer-token heartbeat endpoints.
- Added private incident tracking and readiness scoring.
- Added encrypted webhook alert storage, alert test delivery, and recent delivery history.
- Added Umbrel package assets with hardened container settings and local persistence.
- Added redacted diagnostics for app/runtime status, scheduler state, and support-safe counts.
- Added Playwright E2E, Playwright accessibility, and 85/80/85 coverage gates to the release check path.
- Added release checks for Umbrel package structure, image metadata hygiene, screenshot dimensions, SHA-pinned workflows, secret scanning, OSV scanning, and signed image publication.
