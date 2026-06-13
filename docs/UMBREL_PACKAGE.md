# Umbrel Package

This repository includes an Umbrel app package under `umbrel-app-store/homeops-sentinel/`. It contains the app manifest, app-proxy Compose service, runtime container service, icon, exports script, and metadata-clean gallery screenshots.

## Package Contents

- `docker-compose.yml`
- `umbrel-app.yml`
- `icon.svg`
- `exports.sh`
- `gallery/` with numbered `1440x900` PNG screenshots

The initial manifest keeps `gallery: []`, `releaseNotes: ""`, and `submission: ""` because screenshots, release notes, and the submission PR URL are handled outside the manifest for the first package handoff.

## Release Requirements

1. Publish the source repository and update the manifest source, support, maintainer, and release URL fields with final values.
2. Build and publish a multi-architecture image for `linux/amd64` and `linux/arm64`.
3. Confirm the app package Compose file is pinned to the published image digest.
4. Confirm the publish workflow created registry-attached BuildKit SBOM/provenance attestations for the image digest.
5. Confirm the publish workflow created a keyless cosign signature and recorded the verification command.
6. Confirm GitHub workflow actions remain SHA-pinned with adjacent tag comments.
7. Run `npm run check:release`.
8. Run `npm run release:status` and confirm it reports no blockers.
9. Run `npm run check`.
10. Run `npm audit --omit=dev --audit-level=high`.
11. Run `npm run smoke:docker`.
12. Confirm the package contains no `.DS_Store` or other local metadata files.
13. Start the package with Docker or an Umbrel-compatible environment and confirm state persists after restart.
14. Verify the release screenshots are from disposable review state and contain no secrets.
15. If release source changes after publishing, rebuild and repin the package to the new multi-architecture manifest digest.

## Image Build

The included GitHub Actions workflows provide separate reviewer-facing gates:

- `.github/workflows/ci.yml` runs linting, formatting checks, type checks, tests, build, local smoke, production dependency audit, and Docker smoke.
- `.github/workflows/dependency-review.yml` blocks high-severity dependency changes in pull requests.
- `.github/workflows/secret-scan.yml` runs gitleaks without PR comment noise.
- `.github/workflows/osv-scan.yml` runs OSV scanning without requiring code-scanning upload permissions.
- `.github/workflows/container-scan.yml` builds the container and scans it with Trivy.
- `.github/workflows/publish-image.yml` can publish a multi-architecture GHCR image through manual dispatch. It writes the digest needed by the Umbrel package Compose file, scans the published digest with Trivy, signs the digest with keyless cosign, and publishes BuildKit SBOM/provenance attestations to the registry.

All external workflow actions are pinned by commit SHA with the source tag kept
in the adjacent comment for reviewability.

Manual build equivalent:

```sh
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag ghcr.io/<owner>/homeops-sentinel-umbrel:0.1.0 \
  --attest type=provenance,mode=max \
  --attest type=sbom \
  --push .
```

Inspect the digest before updating the package:

```sh
docker buildx imagetools inspect ghcr.io/<owner>/homeops-sentinel-umbrel:0.1.0
```

## Release Evidence

Current package digest evidence:

The package currently points at the last published digest below. If any source,
dependency, workflow, or package file changes are included in a release, run the
manual publish workflow again and replace this evidence with the new digest and
workflow output before submitting the package.

| Evidence | Value |
| --- | --- |
| Source ref | Image built from `c6fd4a5` in GitHub Actions run `27467888491` |
| App version | `0.1.0` |
| Image digest | `sha256:08f250856e98f6ad130d6beec2b0244283b9ba7ce746be6600686cebf31d60a8` |
| Image platforms | `linux/amd64`, `linux/arm64` |
| Build workflow or command | GitHub Actions run `27467888491` |
| Image SBOM/provenance | BuildKit registry SBOM/provenance enabled in run `27467888491` |
| Image signature | Required from the next manual publish workflow run after cosign signing was added |
| Tested environment | Local Docker Desktop; GitHub Actions `ubuntu-latest` |
| Test date | `2026-06-13` |
| `npm run check` | Passed locally and in GitHub Actions run `27467888491` |
| `npm audit --omit=dev --audit-level=high` | Passed locally and in GitHub Actions run `27467888491` |
| `npm run smoke:docker` | Passed locally and in GitHub Actions run `27467888491` |
| `npm run check:release` | Passed locally on `2026-06-13` |
| Persistence restart result | Passed locally in `npm run smoke:docker`; state survived container restart |
| Screenshot files | `1.png`, `2.png`, `3.png` |

## QA Matrix

| Environment | Install/start | `/api/health` | App proxy/no public ports | Monitors | Backups | Alerts | Incidents | Persistence | Unsafe URL blocking |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Local production | Passed via `npm run smoke` | Passed | N/A | Static/API smoke passed | Heartbeat token secrecy passed | Not separately exercised | Not separately exercised | Temporary data write passed | Same-origin mutation guard passed |
| Docker Compose | Passed via `docker compose config` | Compose valid | No public ports configured | Not separately exercised | Persistent `/data` mount configured | Not separately exercised | Not separately exercised | Persistent volume configured | Package check passed |
| `linux/amd64` image | Built in run `27467888491` | Docker smoke passed in workflow | No public ports configured | Docker smoke covered startup | Docker smoke covered persistence | Not separately exercised | Not separately exercised | Restart persistence passed locally | Package check passed |
| `linux/arm64` image | Built in run `27467888491` | Build completed | No public ports configured | Build completed | Persistent `/data` mount configured | Not separately exercised | Not separately exercised | Image manifest published | Package check passed |
| Umbrel-compatible environment | Package structure checked | Health endpoint configured | App proxy service configured | Validation guide covers manual proof | Validation guide covers manual proof | Validation guide covers manual proof | Validation guide covers manual proof | Validation guide covers manual proof | Package check passed |

## Operational Notes

- The app relies on Umbrel app proxy authentication and does not add separate app-local users or roles.
- Backup health combines freshness tracking with user-recorded restore-test proof.
- Webhook alert delivery is best effort and single-destination.
- Local-network monitor probing is intentional; unsafe metadata and link-local targets remain blocked.
- The hardened publish workflow publishes registry-attached BuildKit SBOM/provenance and a keyless cosign signature for the pinned image digest.
