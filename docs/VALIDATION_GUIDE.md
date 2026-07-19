# Validation Guide

This guide gives maintainers a deterministic path through HomeOps Sentinel using local Docker or an Umbrel-compatible environment.

For validation on an already-running Umbrel instance, use
`docs/UMBREL_LIVE_VALIDATION.md` to capture live proxy, digest, persistence,
restart, reboot, and uninstall/reinstall evidence without replacing the local
checks below.

## Install And Launch

1. Start the app container.
2. Open the app through the configured proxy or local Docker port.
3. Confirm the dashboard loads and shows the readiness panel.

Expected result: the app opens without exposing unintended public ports and shows setup actions for monitors, backups, and alerts.

Optional network proof from inside the app network:

```sh
curl -fsS http://homeops-sentinel_web_1:4747/api/health
```

Expected output includes `status: "ok"` and the app version:

```json
{"status":"ok","version":"0.2.0"}
```

## Core Flow

1. Add an HTTP monitor that targets the app health endpoint:

   ```text
   http://homeops-sentinel_web_1:4747/api/health
   ```

2. Run the monitor check from the dashboard action strip or monitor table.
3. Add a backup tracker with a 24-hour expected interval.
4. Rotate a heartbeat token and confirm the token is shown once with endpoint and curl command.
5. Configure a disposable external webhook test endpoint and send a test alert. Skip delivery testing if no external HTTPS test sink is available.
6. Record an incident, then resolve it.

Expected result: readiness improves as real checks, backup tracking, alerts, and incidents are configured.

## Persistence Proof

1. Create one monitor, one backup tracker, one incident, and one alert webhook.
2. Restart the app container.
3. Reopen the app.

Expected result: monitor, backup, incident, and masked webhook configuration remain visible.

Expected storage path inside the container: `/data/homeops-sentinel.json`. The secret seed is stored separately at `/data/.homeops-secret` unless Umbrel provides `APP_SEED`.

## Secret Handling Proof

Inspect the app data file after creating a webhook and heartbeat token.

Expected result:

- Webhook URL is encrypted.
- Heartbeat token is not stored in cleartext.
- Public `/api/state` only returns masked webhook metadata and heartbeat token metadata.

Sanity check:

```sh
curl -fsS http://homeops-sentinel_web_1:4747/api/state
```

Expected result: the response includes masked alert metadata only. It must not include a full webhook URL or a heartbeat token value.

## Release Checks

Run:

```sh
npm run check
npm audit --omit=dev --audit-level=high
npm run smoke
npm run smoke:docker
npm run release:status
npm run check:release
```

Expected result: `npm run check` passes, including linting, formatting checks,
type checks, 85/80/85 coverage enforcement, production build, local smoke,
Playwright E2E, and Playwright accessibility checks. `npm audit
--omit=dev --audit-level=high` must complete with no high-or-critical
production dependency findings when registry access is available. `npm run
check:release` must pass before publishing the package; failures for replacement
image digests, placeholder URLs, or missing release evidence mean the package is
not ready.

After the manual publish workflow completes, download the
`homeops-sentinel-image-digest` artifact and record the image digest, BuildKit
SBOM/provenance signals, cosign signature signal, and cosign verification
command.

Expected result: the workflow output or downloaded
`homeops-sentinel-image-digest` artifact shows the final image digest, confirms
BuildKit SBOM and provenance attestations were enabled for the published image,
and includes the cosign verification command for the signed digest.

## Release Evidence

Before release, confirm these values are recorded in `docs/UMBREL_PACKAGE.md`:

| Evidence | Expected signal |
| --- | --- |
| Source ref and app version | Matches the image build and manifest |
| Image digest | Multi-architecture image pinned by digest |
| Image SBOM/provenance/signature | Registry-attached attestations and keyless cosign signature created by the publish workflow |
| Tested environment and date | Real Docker or Umbrel-compatible result |
| Persistence result | Records survive app restart |
| Screenshot files | 3 to 5 metadata-clean `1440x900` PNGs |
