# Umbrel Testing Log

This log records reviewer-facing validation for the packaged Umbrel app in
`umbrel-app-store/homeops-sentinel/`.

For a step-by-step live Umbrel evidence checklist, see
`docs/UMBREL_LIVE_VALIDATION.md`. Mark the hardware or VM rows below as `PASS`
only after the live checklist has been completed on that environment.

## Image

| Field | Value |
| --- | --- |
| Image | `ghcr.io/brainx/homeops-sentinel-umbrel:0.1.0` |
| Digest | `sha256:08f250856e98f6ad130d6beec2b0244283b9ba7ce746be6600686cebf31d60a8` |
| Platforms | `linux/amd64`, `linux/arm64` |
| Build run | GitHub Actions run `27467888491` |
| SBOM/provenance | BuildKit registry attestations enabled |
| Signature | Required from the next manual publish workflow run after cosign signing was added |

## Tested Platforms

| Platform | Result | Evidence |
| --- | --- | --- |
| Local Docker Desktop | PASS | `npm run smoke:docker` passed on 2026-06-13 |
| GitHub Actions `ubuntu-latest` | PASS | Publish workflow run `27467888491` passed checks, image build, and published-image Trivy scan |
| `linux/amd64` image | PASS | Multi-arch manifest includes `linux/amd64`; Docker smoke passed |
| `linux/arm64` image | PASS | Multi-arch manifest includes `linux/arm64` |
| umbrelOS on Raspberry Pi / ARM64 | Pending live evidence | Hardware validation has not been recorded in this release log |
| umbrelOS on x86 VM | Pending live evidence | VM validation has not been recorded in this release log |
| Umbrel Home | Pending live evidence | Optional approval evidence |

## Functional Matrix

| Test | Result | Notes |
| --- | --- | --- |
| Fresh install | PASS | Docker image starts from an empty data volume |
| First launch | PASS | Health endpoint and static UI respond |
| App proxy wiring | PASS | Package uses `app_proxy` with no public `ports` mapping |
| Create HTTP monitor | PASS | Covered by local smoke flow and validation guide |
| Create TCP monitor | PASS | Covered by server monitor tests |
| Create DNS monitor | PASS | Covered by server monitor tests |
| TLS expiry check | PASS | Covered by server monitor tests |
| Backup freshness check | PASS | Covered by unit tests and UI flow |
| Restore-test evidence | PASS | Covered by unit tests and UI flow |
| Incident note persists | PASS | Covered by Docker restart persistence smoke |
| Webhook secret storage | PASS | Encrypted at rest and masked in `/api/state` |
| Restart app | PASS | `npm run smoke:docker` verifies state survives container restart |
| Reboot host | Pending live evidence | Requires Umbrel device or VM |
| Uninstall/reinstall | Pending live evidence | Expected to discard app data per Umbrel behavior |
| ARM64 pull | PASS | Published manifest includes ARM64 |
| AMD64 pull | PASS | Published manifest includes AMD64 |

## Umbrel Package Checks

- App directory: `umbrel-app-store/homeops-sentinel/`.
- Required files present: `docker-compose.yml`, `umbrel-app.yml`, `exports.sh`.
- Persistent state is mapped from `${APP_DATA_DIR}/data` to `/data`.
- Runtime container does not use privileged mode, host networking, public port mappings, or Docker socket mounts.
- Runtime container uses `read_only: true`, `/tmp` tmpfs, and `no-new-privileges:true`.
- Manifest keeps `gallery: []` and `releaseNotes: ""` for the initial package handoff.

## Additional Umbrel Hardware Checks

- Follow `docs/UMBREL_LIVE_VALIDATION.md` for a complete evidence row.
- Install through an Umbrel development environment.
- Create one monitor, one backup tracker, and one incident.
- Restart the app from the Umbrel UI and confirm records remain.
- Confirm app opens behind app proxy and no direct public port is exposed.
- Pull the pinned image on both AMD64 and ARM64 hardware or VMs.
- Replace this log's pending live evidence entries with real results.
