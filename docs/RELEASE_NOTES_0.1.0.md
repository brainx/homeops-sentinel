# HomeOps Sentinel 0.1.0

Initial release candidate for HomeOps Sentinel, an Umbrel-ready private readiness dashboard for home servers.

## Highlights

- Monitor HTTP, TCP, DNS, and TLS targets from one local dashboard.
- Track backup freshness and restore-test proof with manual success recording or bearer-token heartbeat endpoints.
- Keep private incident notes for outages, upgrades, and recovery work.
- Score readiness across service checks, backups, alerts, and open incidents.
- Store webhook alert URLs encrypted at rest and show only masked metadata in the browser.
- Run as a single non-root container with persistent state under the app data directory.
- Provide redacted diagnostics for support without exposing webhook URLs, heartbeat tokens, token hashes, or local paths.
- Validate releases with coverage thresholds, Playwright E2E, Playwright accessibility checks, secret scanning, OSV scanning, Trivy, and SHA-pinned GitHub Actions.

## Verification

Release validation used:

```sh
npm run check
npm run check:github-release
npm run check:release
npm run smoke:docker
npm audit --omit=dev --audit-level=high
```

The Umbrel package is pinned to a multi-architecture GHCR image built and scanned by GitHub Actions. Releases created from the hardened publish workflow also record BuildKit SBOM/provenance signals and a keyless cosign verification command for the final digest.

## Known Limitations

- App access relies on Umbrel app proxy authentication.
- Restore-test checks track user-recorded proof; they do not perform automated restores.
- Alerting is best effort and supports one webhook destination.
- The app intentionally allows local-network monitor targets while blocking metadata, link-local, multicast, and unsafe targets.
