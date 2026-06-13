import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";

const root = process.cwd();
const suffix = `${process.pid}-${Date.now()}`;
const image = `homeops-sentinel:docker-smoke-${suffix}`;
const container = `homeops-sentinel-smoke-${suffix}`;
const volume = `homeops-sentinel-smoke-${suffix}`;
const port = await choosePort();
const baseUrl = `http://127.0.0.1:${port}`;

try {
  run("docker", ["build", "--tag", image, "."]);
  run("docker", [
    "run",
    "--detach",
    "--name",
    container,
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--security-opt",
    "no-new-privileges:true",
    "--mount",
    `type=volume,source=${volume},target=/data`,
    "--publish",
    `127.0.0.1:${port}:4747`,
    "--env",
    "HOST=0.0.0.0",
    "--env",
    "PORT=4747",
    "--env",
    "HOMEOPS_DATA_DIR=/data",
    "--env",
    "HOMEOPS_STATIC_DIR=/app/dist",
    image
  ]);

  await waitForHealth();

  const readOnlyRoot = run("docker", [
    "inspect",
    "--format",
    "{{.HostConfig.ReadonlyRootfs}}",
    container
  ]);
  assert.equal(readOnlyRoot, "true");
  const securityOptions = run("docker", [
    "inspect",
    "--format",
    "{{range .HostConfig.SecurityOpt}}{{.}}{{end}}",
    container
  ]);
  assert.match(securityOptions, /no-new-privileges:true/);
  const healthcheck = run("docker", [
    "inspect",
    "--format",
    "{{json .Config.Healthcheck.Test}}",
    container
  ]);
  assert.match(healthcheck, /api\/health/);

  const processStatus = run("docker", ["exec", container, "cat", "/proc/1/status"]);
  const uid = processStatus.match(/^Uid:\s+(\d+)/m)?.[1] || "";
  assert.equal(uid, "1000");

  const health = await getJson("/api/health");
  assert.deepEqual(health, { status: "ok", version: "0.1.0" });

  const backupState = await postJson("/api/backups", {
    name: "Docker nightly",
    scheduleHours: 24
  });
  const backup = backupState.backups.find((item) => item.name === "Docker nightly");
  assert.ok(backup?.id);

  const heartbeatResponse = await postJson(`/api/backups/${backup.id}/heartbeat-token`, {});
  assert.match(heartbeatResponse.token, /^hop_[A-Za-z0-9_-]+$/);

  await postJson("/api/monitors", {
    name: "Docker self health",
    type: "http",
    intervalSeconds: 300,
    target: { url: "http://127.0.0.1:4747/api/health" }
  });

  await postJson("/api/incidents", {
    title: "Docker smoke incident",
    severity: "info",
    notes: "Created by Docker smoke verification"
  });

  await patchJson("/api/settings", {
    webhookUrl: "https://example.invalid/hooks/homeops-docker"
  });

  const persistedRaw = run("docker", ["exec", container, "cat", "/data/homeops-sentinel.json"]);
  assert.equal(persistedRaw.includes(heartbeatResponse.token), false);
  assert.equal(persistedRaw.includes("https://example.invalid/hooks/homeops-docker"), false);
  assert.match(persistedRaw, /"alertWebhookEncrypted": "v1:/);
  assert.match(persistedRaw, /"tokenHash":/);

  run("docker", ["restart", container]);
  await waitForHealth();

  const stateAfterRestart = await getJson("/api/state");
  assert.ok(stateAfterRestart.monitors.some((item) => item.name === "Docker self health"));
  assert.ok(stateAfterRestart.backups.some((item) => item.name === "Docker nightly"));
  assert.ok(stateAfterRestart.incidents.some((item) => item.title === "Docker smoke incident"));
  assert.equal(JSON.stringify(stateAfterRestart).includes(heartbeatResponse.token), false);
  assert.equal(
    JSON.stringify(stateAfterRestart).includes("example.invalid/hooks/homeops-docker"),
    false
  );

  const healthStatus = run("docker", [
    "inspect",
    "--format",
    "{{.State.Health.Status}}",
    container
  ]);
  assert.match(healthStatus, /^(starting|healthy)$/);

  console.log("docker smoke test passed");
} finally {
  cleanup();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}${result.stderr}`);
  }
  return result.stdout.trim();
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  const logs = spawnSync("docker", ["logs", container], { encoding: "utf8" });
  throw new Error(`Docker container did not become healthy\n${logs.stdout}${logs.stderr}`);
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  if (!response.ok)
    throw new Error(`${pathname} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function postJson(pathname, payload) {
  return sendJson("POST", pathname, payload);
}

async function patchJson(pathname, payload) {
  return sendJson("PATCH", pathname, payload);
}

async function sendJson(method, pathname, payload) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-homeops-intent": "same-origin",
      "sec-fetch-site": "same-origin",
      origin: baseUrl
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok)
    throw new Error(`${pathname} returned HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

function cleanup() {
  bestEffortDocker(["rm", "--force", container]);
  bestEffortDocker(["volume", "rm", "--force", volume]);
  bestEffortDocker(["image", "rm", "--force", image]);
}

function bestEffortDocker(args) {
  try {
    execFileSync("docker", args, { stdio: "ignore" });
  } catch {
    // Cleanup should not hide the smoke-test failure that triggered it.
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function choosePort() {
  return new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const selected = typeof address === "object" && address ? address.port : null;
      probe.close(() => {
        if (!selected) {
          reject(new Error("could not allocate Docker smoke-test port"));
          return;
        }
        resolve(selected);
      });
    });
  });
}
