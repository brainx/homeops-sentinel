# Troubleshooting

## The App Does Not Open

- Confirm the container is running.
- Confirm `/api/health` returns a JSON response with `{"status":"ok"}` from inside the app network.
- For local production runs, the server binds to `127.0.0.1` by default. Docker and Umbrel set `HOST=0.0.0.0` inside the container network.

## Monitor Target Is Rejected

HomeOps Sentinel rejects unsupported schemes, credential-bearing URLs, metadata targets, link-local targets, multicast targets, and unspecified addresses.

Allowed examples:

- `https://example.com`
- `http://192.168.1.10:8080`
- `http://127.0.0.1:4747/api/health` for local self-checks

Rejected examples:

- `file:///etc/passwd`
- `http://user:pass@example.com`
- `http://169.254.169.254`

## Webhook Is Rejected Or Fails

Webhook URLs must use `http` or `https` and must not include credentials. Delivery also blocks loopback, private/LAN, CGNAT, metadata, link-local, multicast, unspecified, and redirect-to-blocked targets.

Recent delivery attempts appear in Alerts > Delivery history. The app stores only the encrypted webhook URL and masked metadata.

## Heartbeat Does Not Update A Backup

- Confirm the backup has a heartbeat token.
- Confirm the external job sends `Authorization: Bearer <token>`.
- If the token was rotated, update the external job with the new token.
- Rate-limited or invalid token attempts return safe errors and do not update backup freshness.

## State Does Not Persist

- Confirm `HOMEOPS_DATA_DIR` points to the mounted data directory.
- In Umbrel, the app data volume should map `${APP_DATA_DIR}/data:/data`.
- The container entrypoint repairs `/data` ownership before the app server drops to the unprivileged `node` user.

## Release Check Fails

`npm run check:release` intentionally fails until:

- The package Compose image is pinned with a real release digest.
- Manifest source/support URLs are real.
- The manifest release URL fields are filled.
- Package release evidence contains final checked values.
- The app package does not contain local metadata such as `.DS_Store`.
- Gallery screenshots are sanitized release images from disposable demo state.
- The package Compose file does not expose public ports.

Run:

```sh
npm run smoke:docker
```

Expected result: Docker smoke passes before release checks are rerun.

## Umbrel Pull Or Install Fails

- If the image cannot be pulled, confirm the image is public and the Compose image includes a real digest.
- If the wrong architecture is pulled, inspect the pushed manifest and confirm both `linux/amd64` and `linux/arm64` are present.
- If the app proxy cannot reach the app, confirm `APP_HOST` is `homeops-sentinel_web_1` and `APP_PORT` is `4747`.
- If persistence fails, confirm `${APP_DATA_DIR}/data:/data` is mounted and the entrypoint can repair `/data` ownership.
- If the app reports write errors, confirm the only writable path the server needs is `/data`; the container filesystem is intentionally read-only.

Expected result: the app starts through Umbrel app proxy, `/api/health` returns status `ok`, and created records survive restart.
