# Changelog

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
