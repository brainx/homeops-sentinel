import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const port = await choosePort();
const smokeRoot = path.join(root, ".release", `smoke-${process.pid}`);
const dataDir = path.join(smokeRoot, "data");
const baseUrl = `http://127.0.0.1:${port}`;
let server = null;
let stdout = "";
let stderr = "";

await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });

try {
  await startServer();

  const health = await getJson("/api/health");
  assert.deepEqual(health, { status: "ok", version: "0.1.0" });

  const rootResponse = await fetch(`${baseUrl}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(rootResponse.headers.get("x-content-type-options"), "nosniff");
  assert.equal(rootResponse.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(await rootResponse.text(), /<div id="root"><\/div>/);

  assert.equal(await rawStatus("/%2e%2e/package.json"), 403);

  const rejectedMutation = await fetch(`${baseUrl}/api/backups`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Nightly", scheduleHours: 24 })
  });
  assert.equal(rejectedMutation.status, 400);

  const stateAfterBackup = await postJson("/api/backups", {
    name: "Nightly",
    scheduleHours: 24
  });
  const backup = stateAfterBackup.backups.find((item) => item.name === "Nightly");
  assert.ok(backup?.id);
  assert.equal(backup.heartbeat.configured, false);

  const heartbeatResponse = await postJson(`/api/backups/${backup.id}/heartbeat-token`, {});
  assert.match(heartbeatResponse.token, /^hop_[A-Za-z0-9_-]+$/);
  assert.equal(heartbeatResponse.state.backups[0].heartbeat.configured, true);
  assert.equal(JSON.stringify(heartbeatResponse.state).includes(heartbeatResponse.token), false);

  await postJson("/api/monitors", {
    name: "Self health",
    type: "http",
    intervalSeconds: 300,
    target: { url: `${baseUrl}/api/health` }
  });
  await postJson("/api/incidents", {
    title: "Smoke incident",
    severity: "info",
    notes: "Created by local smoke verification"
  });
  const stateWithWebhook = await patchJson("/api/settings", {
    webhookUrl: "https://example.invalid/hooks/homeops",
    notifyOnRecovery: true
  });
  assert.equal(stateWithWebhook.settings.alertWebhook.configured, true);
  assert.equal(JSON.stringify(stateWithWebhook).includes("example.invalid/hooks/homeops"), false);

  const stateFile = path.join(dataDir, "homeops-sentinel.json");
  const persistedRaw = await fs.readFile(stateFile, "utf8");
  assert.equal(persistedRaw.includes(heartbeatResponse.token), false);
  assert.equal(persistedRaw.includes("https://example.invalid/hooks/homeops"), false);
  assert.match(persistedRaw, /"alertWebhookEncrypted": "v1:/);
  assert.match(persistedRaw, /"tokenHash":/);

  await stopServer();
  await startServer();

  const publicState = await getJson("/api/state");
  assert.ok(publicState.monitors.some((monitor) => monitor.name === "Self health"));
  assert.ok(publicState.backups.some((item) => item.name === "Nightly"));
  assert.ok(publicState.incidents.some((incident) => incident.title === "Smoke incident"));
  assert.equal(publicState.settings.alertWebhook.configured, true);
  assert.equal(JSON.stringify(publicState).includes(heartbeatResponse.token), false);
  assert.equal(JSON.stringify(publicState).includes("example.invalid/hooks/homeops"), false);

  console.log("local smoke test passed");
} finally {
  await stopServer();
  await fs.rm(smokeRoot, { recursive: true, force: true });
  await fs.rmdir(path.dirname(smokeRoot)).catch((error) => {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error;
  });
}

async function startServer() {
  stdout = "";
  stderr = "";
  server = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      HOMEOPS_DATA_DIR: dataDir,
      HOMEOPS_STATIC_DIR: path.join(root, "dist")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  await waitForServer();
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!server || server.exitCode !== null) break;
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`server did not become ready\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function getJson(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  assert.equal(response.ok, true, `${pathname} returned HTTP ${response.status}`);
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
  if (!response.ok) {
    throw new Error(`${pathname} returned HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (server && server.exitCode === null) server.kill("SIGKILL");
      resolve();
    }, 3000);
    server?.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  server = null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rawStatus(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "GET"
      },
      (res) => {
        res.resume();
        res.once("end", () => resolve(res.statusCode || 0));
      }
    );
    req.once("error", reject);
    req.end();
  });
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
          reject(new Error("could not allocate smoke-test port"));
          return;
        }
        resolve(selected);
      });
    });
  });
}
