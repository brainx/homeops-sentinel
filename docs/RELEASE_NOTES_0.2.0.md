# HomeOps Sentinel 0.2.0

HomeOps Sentinel 0.2.0 adds durable service reliability history and complete monitor lifecycle controls for planned maintenance.

## Highlights

- Retain the latest 720 results per monitor and expose a compact 48-result timeline to the dashboard.
- Show availability percentage, average latency, recent status history, and the last failure time for every monitor.
- Edit monitor names, targets, types, and intervals without deleting check history.
- Pause and resume monitors while excluding paused checks from active health counts and readiness scoring.
- Preserve prior results and history while a monitor is paused, with an explicit degraded state when every monitor is paused.
- Migrate existing persisted state safely to schema version 2.

## Verification

The release is validated with linting, formatting, type checks, 85/80/85 coverage thresholds, production build and smoke tests, Playwright end-to-end and accessibility tests, dependency auditing, Docker restart persistence, secret scanning, OSV scanning, and Trivy image scanning.

The Umbrel package is pinned to a signed multi-architecture GHCR image with registry-attached BuildKit SBOM and provenance attestations.

## Compatibility

- Existing monitors, backups, incidents, settings, and latest results are preserved.
- Reliability history begins with checks recorded after this upgrade.
- App access continues to rely on Umbrel app proxy authentication.
- The package supports `linux/amd64` and `linux/arm64`.
