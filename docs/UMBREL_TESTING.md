# Umbrel Testing Log

This log records reviewer-facing validation for the packaged Umbrel app in
`umbrel-app-store/homeops-sentinel/`.

For a step-by-step live Umbrel evidence checklist, see
`docs/UMBREL_LIVE_VALIDATION.md`. Mark the hardware or VM rows below as `PASS`
only after the live checklist has been completed on that environment.

## Image

| Field | Value |
| --- | --- |
| Image | `ghcr.io/brainx/homeops-sentinel-umbrel:0.2.0` |
| Digest | `sha256:931c64accb43a39bf5a93eac2859a1bbcc8c5802a2cccde2fbbff794be6dded4` |
| Platforms | `linux/amd64`, `linux/arm64` |
| Build run | GitHub Actions run `29706123994` |
| SBOM/provenance | BuildKit registry attestations enabled |
| Signature | Keyless cosign signature published through GitHub OIDC |

## Tested Platforms

| Platform | Result | Evidence |
| --- | --- | --- |
| Local Apple Container 1.0.0 on ARM64 | PASS | Exact published digest pulled and started with a read-only root; health returned `0.2.0`; PID 1 ran as UID/GID 1000. A same-source local image also preserved state across a volume-backed restart on 2026-07-20 |
| GitHub Actions `ubuntu-latest` | PASS | Publish workflow run `29706123994` passed checks, Docker restart persistence, multi-architecture image build, published-image Trivy scan, and cosign signing |
| `linux/amd64` image | PASS | Multi-arch manifest includes `linux/amd64`; Docker smoke passed |
| `linux/arm64` image | PASS | Multi-arch manifest includes `linux/arm64`; the Dockerfile also built and ran locally with Apple Container |
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
| Restart app | PASS | GitHub Actions Docker smoke and the local Apple Container check both verified state survives container restart |
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
- Manifest keeps `gallery: []` and `releaseNotes: ""` until the Umbrel app-store submission supplies them.

## Additional Umbrel Hardware Checks

- Follow `docs/UMBREL_LIVE_VALIDATION.md` for a complete evidence row.
- Install through an Umbrel development environment.
- Create one monitor, one backup tracker, and one incident.
- Restart the app from the Umbrel UI and confirm records remain.
- Confirm app opens behind app proxy and no direct public port is exposed.
- Pull the pinned image on both AMD64 and ARM64 hardware or VMs.
- Replace this log's pending live evidence entries with real results.
