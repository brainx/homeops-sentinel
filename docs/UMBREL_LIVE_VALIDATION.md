# Umbrel Live Validation Guide

Use this guide when HomeOps Sentinel is installed on a running Umbrel instance
and you need reviewer-facing evidence for the pinned app package. These steps are
instructions for live validation and evidence capture; they do not record
hardware validation unless you complete the checks on your own Umbrel host.

Pinned app image:

```text
ghcr.io/brainx/homeops-sentinel-umbrel:0.2.0@sha256:931c64accb43a39bf5a93eac2859a1bbcc8c5802a2cccde2fbbff794be6dded4
```

## Evidence Table

Copy one row per Umbrel host or VM tested:

| Environment | Architecture | Umbrel version | Date | Digest | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  | PASS / FAIL |  |

## 1. Record The Environment

Run these checks on the Umbrel host over SSH:

```sh
uname -m
docker version --format '{{.Server.Version}}'
docker compose version
```

In the Umbrel UI, record the Umbrel version shown in settings or system
information. Record the date and whether the host is physical hardware, a VM, or
another test environment.

Expected result: the evidence table includes the tested environment,
architecture, Umbrel version, date, and notes before functional testing starts.

## 2. Confirm The Running Image Digest

Find the HomeOps Sentinel container:

```sh
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep homeops-sentinel
```

Confirm the image digest attached to the running container:

```sh
CONTAINER=homeops-sentinel_web_1
IMAGE_ID=$(docker inspect --format '{{.Image}}' "$CONTAINER")
docker image inspect "$IMAGE_ID" --format '{{json .RepoDigests}}'
```

Expected result: the output includes:

```text
ghcr.io/brainx/homeops-sentinel-umbrel@sha256:931c64accb43a39bf5a93eac2859a1bbcc8c5802a2cccde2fbbff794be6dded4
```

If Umbrel uses a different container name, replace `homeops-sentinel_web_1` with
the name from the `docker ps` output.

## 3. Open Through The Umbrel Proxy

1. Open the Umbrel dashboard in a browser.
2. Launch HomeOps Sentinel from the Umbrel app tile.
3. Confirm the dashboard loads through the Umbrel app URL, not a direct
   `:4747` URL.
4. Record the visible result in the evidence table notes.

Expected result: the app opens from the Umbrel UI and the dashboard shows
readiness panels for monitors, backups, heartbeats, incidents, and alerts.

## 4. Verify There Is No Public Direct Port

From another machine on the same LAN, set the Umbrel host name or IP and test the
app container port directly:

```sh
UMBREL_HOST=umbrel.local
curl --connect-timeout 3 -fsS "http://$UMBREL_HOST:4747/api/health"
```

Expected result: the command fails to connect or returns no app response. The
package is expected to use Umbrel `app_proxy` rather than a public host port.

On the Umbrel host, confirm Docker is not publishing a host port:

```sh
docker ps --format 'table {{.Names}}\t{{.Ports}}' | grep homeops-sentinel
```

Expected result: the HomeOps Sentinel web container does not show a
`0.0.0.0:4747->4747/tcp` or `:::4747->4747/tcp` mapping.

## 5. Create Functional Records

Use the HomeOps Sentinel UI through Umbrel.

1. Create an HTTP monitor for a reachable endpoint, such as the app health
   endpoint inside the app network:

   ```text
   http://homeops-sentinel_web_1:4747/api/health
   ```

2. Run the monitor check and confirm it records a success.
3. Create a backup tracker with a 24-hour expected interval.
4. Mark the backup as checked or record restore-test evidence.
5. Rotate a heartbeat token, copy the generated curl command, and send one
   heartbeat.
6. Create an incident with a short note.
7. Resolve the incident.

Expected result: the dashboard reflects real monitor, backup, heartbeat, and
incident activity. Do not use fake external integrations or placeholder webhook
URLs unless the evidence row clearly says the external delivery path was skipped.

## 6. Restart The App From Umbrel

1. In the Umbrel UI, open HomeOps Sentinel app settings.
2. Restart the app.
3. Wait for the app to report as running.
4. Open HomeOps Sentinel through the Umbrel app tile again.

Expected result: the monitor, backup tracker, heartbeat metadata, and incident
history created in the previous step remain visible. Record PASS only if the
records are still present after the Umbrel-managed app restart.

## 7. Reboot The Umbrel Host

1. Reboot the Umbrel host using the Umbrel UI or the host's normal safe reboot
   procedure.
2. Wait for Umbrel to return.
3. Open HomeOps Sentinel through the Umbrel app tile.
4. Re-run the HTTP monitor check.

Expected result: the app starts after host reboot, the records from earlier
steps remain visible, and the monitor can run again.

## 8. Verify Persistence Details

After restart or host reboot, confirm the persistent data file exists inside the
container:

```sh
docker exec homeops-sentinel_web_1 test -f /data/homeops-sentinel.json
docker exec homeops-sentinel_web_1 ls -l /data
```

Expected result: `/data/homeops-sentinel.json` exists. If a heartbeat token or
webhook was configured, sensitive values should not be visible through the
public app state endpoint.

Optional masked-state check from the Umbrel host:

```sh
docker exec homeops-sentinel_web_1 wget -qO- http://127.0.0.1:4747/api/state
```

Expected result: the response may include monitor, backup, incident, alert, and
heartbeat metadata, but it must not include a full webhook URL or a raw heartbeat
token value.

## 9. Validate Uninstall And Reinstall Behavior

Only run this step when it is acceptable to remove the app's Umbrel-managed data
for the test instance.

1. Record the current evidence row and any screenshots needed before uninstall.
2. Uninstall HomeOps Sentinel from the Umbrel UI.
3. Reinstall HomeOps Sentinel from the same pinned app package.
4. Open the app through the Umbrel app tile.

Expected result: the reinstall starts with fresh app data unless the Umbrel host
explicitly restores prior app data from a backup. Previously created monitors,
backup trackers, heartbeats, and incidents should not be present after a normal
uninstall and reinstall. If Umbrel preserves or restores data in the tested
environment, record that behavior in the notes rather than marking the check as
a package failure.

## 10. Final Evidence Checklist

Before updating `docs/UMBREL_TESTING.md`, make sure the evidence row includes:

- environment and architecture,
- Umbrel version,
- test date,
- confirmed image digest,
- proxy launch result,
- direct-port result,
- monitor, backup, heartbeat, and incident results,
- app restart result,
- host reboot result when tested,
- uninstall and reinstall behavior when tested,
- clear notes for skipped checks.
