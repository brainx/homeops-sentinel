import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  createHeartbeatToken,
  describeHeartbeatToken,
  hashHeartbeatToken,
  readBearerToken,
  verifyHeartbeatToken
} from "../server/heartbeats.js";
import { createSecretBox } from "../server/secrets.js";
import { APP_VERSION } from "../server/config.js";
import { normalizeOutboundUrl, resolveSafeAddress } from "../server/network.js";
import { normalizeMonitor, summarizeState } from "../server/monitors.js";
import {
  INTENT_HEADER,
  INTENT_VALUE,
  assertRequestProvenance
} from "../server/request-security.js";

async function reserveLoopbackPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : null;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) throw new Error("Unable to reserve loopback port");
  return port;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(baseUrl, child, readOutput) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before readiness: ${readOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // Retry until the child process has bound the test port.
    }
    await sleep(50);
  }
  throw new Error(`Server did not become ready: ${readOutput()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", () => resolve(true)));
  child.kill("SIGTERM");
  if (await Promise.race([exited, sleep(1000).then(() => false)])) return;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function withTestServer(callback) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-heartbeat-test-"));
  const port = await reserveLoopbackPort();
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    HOMEOPS_DATA_DIR: dataDir,
    HOMEOPS_STATIC_DIR: path.resolve("dist")
  };
  delete env.APP_SEED;
  delete env.HOMEOPS_SECRET_KEY;

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForServer(baseUrl, child, () => output);
    await callback(baseUrl);
  } finally {
    await stopServer(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

async function requestJson(baseUrl, pathname, options = {}) {
  const headers = { ...(options.headers || {}) };
  const init = {
    method: options.method || "GET",
    headers
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return {
    status: response.status,
    payload: await response.json()
  };
}

const token = createHeartbeatToken();
assert.match(token, /^hop_[A-Za-z0-9_-]+$/);
assert.notEqual(hashHeartbeatToken(token), token);
assert.equal(verifyHeartbeatToken(token, hashHeartbeatToken(token)), true);
assert.equal(verifyHeartbeatToken(`${token}x`, hashHeartbeatToken(token)), false);
assert.equal(verifyHeartbeatToken("", hashHeartbeatToken(token)), false);
assert.equal(verifyHeartbeatToken(token, ""), false);
assert.equal(verifyHeartbeatToken(token, "short"), false);
assert.match(describeHeartbeatToken(token), /^hop_.+\.\.\..+$/);
assert.equal(readBearerToken({ headers: {} }), null);
assert.equal(readBearerToken({ headers: { authorization: "Basic abc" } }), null);
assert.equal(readBearerToken({ headers: { authorization: "Bearer " } }), null);
assert.equal(readBearerToken({ headers: { authorization: `Bearer ${token}` } }), token);
assert.equal(readBearerToken({ headers: { authorization: `Bearer ${"x".repeat(161)}` } }), null);

const emptySummary = summarizeState({
  settings: { alertWebhookEncrypted: null },
  monitors: [],
  backups: [],
  incidents: [],
  results: {}
});
assert.equal(emptySummary.readiness.score < 50, true);
assert.equal(emptySummary.readiness.label, "Setup needed");

const readySummary = summarizeState({
  settings: { alertWebhookEncrypted: "encrypted-placeholder" },
  monitors: [{ id: "mon_ready" }],
  backups: [
    {
      id: "bak_ready",
      name: "Nightly",
      scheduleHours: 24,
      lastSuccessAt: new Date().toISOString(),
      restoreTest: {
        intervalDays: 90,
        lastTestedAt: new Date().toISOString(),
        target: "Staging restore",
        result: "passed",
        evidence: "Smoke test completed"
      }
    }
  ],
  incidents: [],
  results: {
    mon_ready: {
      status: "healthy",
      message: "HTTP 200",
      latencyMs: 12,
      checkedAt: new Date().toISOString()
    }
  }
});
assert.equal(readySummary.readiness.score >= 90, true);
assert.equal(readySummary.readiness.label, "Ready");

const pausedSummary = summarizeState({
  settings: { alertWebhookEncrypted: null },
  monitors: [{ id: "mon_paused", enabled: false }],
  backups: [],
  incidents: [],
  results: {
    mon_paused: {
      status: "down",
      message: "Previous failure",
      latencyMs: 20,
      checkedAt: new Date().toISOString()
    }
  }
});
assert.equal(pausedSummary.overall, "degraded");
assert.equal(pausedSummary.counts.down, 0);
assert.equal(pausedSummary.counts.unknown, 0);
assert.equal(pausedSummary.enabledMonitors, 0);
assert.equal(pausedSummary.pausedMonitors, 1);
assert.equal(pausedSummary.readiness.checks[0].message, "All service monitors are paused");

const pausedWithFailedBackup = summarizeState({
  settings: { alertWebhookEncrypted: null },
  monitors: [{ id: "mon_paused", enabled: false }],
  backups: [
    {
      scheduleHours: 1,
      lastSuccessAt: "2026-01-01T00:00:00.000Z",
      restoreTest: { intervalDays: 30, result: "not_tested" }
    }
  ],
  incidents: [],
  results: {}
});
assert.equal(pausedWithFailedBackup.overall, "down");

assert.throws(
  () =>
    assertRequestProvenance(
      { method: "POST", headers: { host: "homeops.local" } },
      new URL("http://homeops.local/api/backups")
    ),
  /same-origin request intent/
);

assert.throws(
  () =>
    assertRequestProvenance(
      {
        method: "POST",
        headers: {
          host: "homeops.local",
          origin: "https://evil.example",
          [INTENT_HEADER]: INTENT_VALUE
        }
      },
      new URL("http://homeops.local/api/backups")
    ),
  /Cross-origin/
);

assert.throws(
  () =>
    assertRequestProvenance(
      {
        method: "POST",
        headers: {
          host: "homeops.local",
          "sec-fetch-site": "cross-site",
          [INTENT_HEADER]: INTENT_VALUE
        }
      },
      new URL("http://homeops.local/api/backups")
    ),
  /Cross-site/
);

assert.doesNotThrow(() =>
  assertRequestProvenance({ method: "GET", headers: {} }, new URL("http://homeops.local/api/state"))
);
assert.throws(
  () =>
    assertRequestProvenance(
      {
        method: "POST",
        headers: {
          origin: "http://homeops.local",
          [INTENT_HEADER]: INTENT_VALUE
        }
      },
      new URL("http://homeops.local/api/settings")
    ),
  /Missing Host/
);

const previousDevOrigin = process.env.HOMEOPS_DEV_ORIGIN;
try {
  process.env.HOMEOPS_DEV_ORIGIN = "http://127.0.0.1:5173";
  assert.doesNotThrow(() =>
    assertRequestProvenance(
      {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:5173",
          [INTENT_HEADER]: INTENT_VALUE
        }
      },
      new URL("http://127.0.0.1:4747/api/settings")
    )
  );
} finally {
  if (previousDevOrigin === undefined) {
    delete process.env.HOMEOPS_DEV_ORIGIN;
  } else {
    process.env.HOMEOPS_DEV_ORIGIN = previousDevOrigin;
  }
}

assert.doesNotThrow(() =>
  assertRequestProvenance(
    { method: "POST", headers: {} },
    new URL("http://homeops.local/api/backups/bak_123/heartbeat")
  )
);

assert.doesNotThrow(() =>
  assertRequestProvenance(
    {
      method: "PATCH",
      headers: {
        host: "homeops.local",
        origin: "http://homeops.local",
        "sec-fetch-site": "same-origin",
        [INTENT_HEADER]: INTENT_VALUE
      }
    },
    new URL("http://homeops.local/api/settings")
  )
);

assert.throws(
  () =>
    normalizeOutboundUrl("http://127.0.0.1:3000/hook", {
      blockLoopback: true,
      label: "webhookUrl"
    }),
  /blocked/
);
assert.throws(
  () =>
    normalizeOutboundUrl("http://192.168.1.1/hook", {
      blockLoopback: true,
      blockPrivate: true,
      label: "webhookUrl"
    }),
  /blocked/
);
assert.throws(
  () =>
    normalizeOutboundUrl("http://10.0.0.1/hook", {
      blockLoopback: true,
      blockPrivate: true,
      label: "webhookUrl"
    }),
  /blocked/
);
assert.throws(
  () =>
    normalizeOutboundUrl("http://[fd12::1]/hook", {
      blockLoopback: true,
      blockPrivate: true,
      label: "webhookUrl"
    }),
  /blocked/
);
assert.doesNotThrow(() => normalizeOutboundUrl("http://192.168.1.1/status", { label: "url" }));
assert.throws(
  () =>
    normalizeOutboundUrl("http://[::ffff:169.254.169.254]/hook", {
      blockLoopback: true,
      label: "webhookUrl"
    }),
  /blocked/
);
assert.throws(
  () =>
    normalizeOutboundUrl("https://user:pass@example.com/hook", {
      blockLoopback: true,
      label: "webhookUrl"
    }),
  /credentials/
);
assert.doesNotThrow(() =>
  normalizeMonitor({
    name: "Local health",
    type: "http",
    target: { url: "http://127.0.0.1:4747/api/health" }
  })
);
await assert.rejects(
  () =>
    resolveSafeAddress("webhook.local", { blockLoopback: true }, async () => [
      { address: "127.0.0.1", family: 4 }
    ]),
  /blocked/
);

const previousSecret = process.env.HOMEOPS_SECRET_KEY;
try {
  process.env.HOMEOPS_SECRET_KEY = "local-development-secret-change-me";
  assert.throws(() => createSecretBox("/tmp/homeops-unused-secret"), /too weak/);
} finally {
  if (previousSecret === undefined) {
    delete process.env.HOMEOPS_SECRET_KEY;
  } else {
    process.env.HOMEOPS_SECRET_KEY = previousSecret;
  }
}

const weakSecretDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-weak-secret-"));
try {
  const weakSecretFile = path.join(weakSecretDir, ".homeops-secret");
  await fs.writeFile(weakSecretFile, "short\n", { mode: 0o600 });
  assert.throws(() => createSecretBox(weakSecretFile), /Stored secret material is too weak/);
} finally {
  await fs.rm(weakSecretDir, { recursive: true, force: true });
}

const previousStrongSecret = process.env.HOMEOPS_SECRET_KEY;
const previousSeed = process.env.APP_SEED;
const seedSecretDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-seed-secret-"));
try {
  delete process.env.HOMEOPS_SECRET_KEY;
  process.env.APP_SEED = "x".repeat(32);
  const seedBox = createSecretBox(path.join(seedSecretDir, ".homeops-secret"));
  assert.equal(seedBox.encrypt(""), null);
  assert.equal(seedBox.decrypt(null), null);
  assert.deepEqual(seedBox.mask(null), { configured: false, label: "Not configured" });
  const encryptedWebhook = seedBox.encrypt("https://example.com/hooks/homeops");
  assert.equal(seedBox.decrypt(encryptedWebhook), "https://example.com/hooks/homeops");
  assert.deepEqual(seedBox.mask(encryptedWebhook), {
    configured: true,
    label: "https://example.com/..."
  });
  assert.throws(() => seedBox.decrypt("v2:bad"), /Unsupported secret payload/);
  assert.deepEqual(seedBox.mask("v2:bad"), { configured: true, label: "Configured" });
} finally {
  if (previousStrongSecret === undefined) {
    delete process.env.HOMEOPS_SECRET_KEY;
  } else {
    process.env.HOMEOPS_SECRET_KEY = previousStrongSecret;
  }
  if (previousSeed === undefined) {
    delete process.env.APP_SEED;
  } else {
    process.env.APP_SEED = previousSeed;
  }
  await fs.rm(seedSecretDir, { recursive: true, force: true });
}

await withTestServer(async (baseUrl) => {
  const intentHeaders = { [INTENT_HEADER]: INTENT_VALUE };
  const initialDiagnostics = await requestJson(baseUrl, "/api/diagnostics");
  assert.equal(initialDiagnostics.status, 200);
  assert.equal(initialDiagnostics.payload.app.version, APP_VERSION);
  assert.equal(typeof initialDiagnostics.payload.runtime.uptimeSeconds, "number");
  assert.equal(initialDiagnostics.payload.scheduler.intervalMs, 10000);
  assert.equal(initialDiagnostics.payload.counts.monitors, 0);
  assert.equal(initialDiagnostics.payload.authBoundary.mode, "external-proxy");

  const createResponse = await requestJson(baseUrl, "/api/backups", {
    method: "POST",
    headers: intentHeaders,
    body: { name: "Nightly regression", scheduleHours: 24 }
  });
  assert.equal(createResponse.status, 201);
  const backup = createResponse.payload.backups.find((item) => item.name === "Nightly regression");
  assert.ok(backup?.id);

  const tokenResponse = await requestJson(baseUrl, `/api/backups/${backup.id}/heartbeat-token`, {
    method: "POST",
    headers: intentHeaders
  });
  assert.equal(tokenResponse.status, 201);
  assert.match(tokenResponse.payload.token, /^hop_[A-Za-z0-9_-]+$/);

  const settingsResponse = await requestJson(baseUrl, "/api/settings", {
    method: "PATCH",
    headers: intentHeaders,
    body: { webhookUrl: "https://example.com/homeops-regression-hook" }
  });
  assert.equal(settingsResponse.status, 200);
  assert.equal(settingsResponse.payload.settings.alertWebhook.configured, true);

  const populatedDiagnostics = await requestJson(baseUrl, "/api/diagnostics");
  assert.equal(populatedDiagnostics.status, 200);
  assert.equal(populatedDiagnostics.payload.counts.backups, 1);
  assert.equal(populatedDiagnostics.payload.alerts.webhookConfigured, true);
  const diagnosticsRaw = JSON.stringify(populatedDiagnostics.payload);
  assert.equal(diagnosticsRaw.includes("homeops-regression-hook"), false);
  assert.equal(diagnosticsRaw.includes(tokenResponse.payload.token), false);
  assert.equal(diagnosticsRaw.includes("tokenHash"), false);
  assert.equal(diagnosticsRaw.includes("/tmp/"), false);
  assert.equal(diagnosticsRaw.includes(process.cwd()), false);

  const firstInvalid = await requestJson(baseUrl, `/api/backups/${backup.id}/heartbeat`, {
    method: "POST",
    headers: { authorization: `Bearer ${createHeartbeatToken()}` }
  });
  assert.equal(firstInvalid.status, 401);

  const secondInvalid = await requestJson(baseUrl, `/api/backups/${backup.id}/heartbeat`, {
    method: "POST",
    headers: { authorization: `Bearer ${createHeartbeatToken()}` }
  });
  assert.equal(secondInvalid.status, 429);

  const validHeartbeat = await requestJson(baseUrl, `/api/backups/${backup.id}/heartbeat`, {
    method: "POST",
    headers: { authorization: `Bearer ${tokenResponse.payload.token}` }
  });
  assert.equal(validHeartbeat.status, 200);
  assert.equal(validHeartbeat.payload.status, "ok");
});

await withTestServer(async (baseUrl) => {
  const intentHeaders = { [INTENT_HEADER]: INTENT_VALUE };

  const monitorCreate = await requestJson(baseUrl, "/api/monitors", {
    method: "POST",
    headers: intentHeaders,
    body: {
      name: "Self health route coverage",
      type: "http",
      intervalSeconds: 120,
      target: { url: `${baseUrl}/api/health` }
    }
  });
  assert.equal(monitorCreate.status, 201);
  const monitor = monitorCreate.payload.monitors.find(
    (item) => item.name === "Self health route coverage"
  );
  assert.ok(monitor?.id);

  const monitorPatch = await requestJson(baseUrl, `/api/monitors/${monitor.id}`, {
    method: "PATCH",
    headers: intentHeaders,
    body: { name: "Self health renamed", enabled: true }
  });
  assert.equal(monitorPatch.status, 200);
  assert.ok(monitorPatch.payload.monitors.some((item) => item.name === "Self health renamed"));

  const monitorCheck = await requestJson(baseUrl, `/api/monitors/${monitor.id}/check`, {
    method: "POST",
    headers: intentHeaders
  });
  assert.equal(monitorCheck.status, 200);
  assert.equal(monitorCheck.payload.results[monitor.id].status, "healthy");
  assert.equal(monitorCheck.payload.monitorHistory[monitor.id].length, 1);
  assert.equal(monitorCheck.payload.monitorMetrics[monitor.id].totalChecks, 1);
  assert.equal(monitorCheck.payload.monitorMetrics[monitor.id].availabilityPercent, 100);

  const checkAll = await requestJson(baseUrl, "/api/monitors/check-all", {
    method: "POST",
    headers: intentHeaders
  });
  assert.equal(checkAll.status, 200);
  assert.equal(checkAll.payload.results[monitor.id].status, "healthy");
  assert.equal(checkAll.payload.monitorHistory[monitor.id].length, 2);

  const monitorPause = await requestJson(baseUrl, `/api/monitors/${monitor.id}`, {
    method: "PATCH",
    headers: intentHeaders,
    body: { enabled: false }
  });
  assert.equal(monitorPause.status, 200);
  assert.equal(monitorPause.payload.monitors.find((item) => item.id === monitor.id).enabled, false);
  assert.equal(monitorPause.payload.summary.enabledMonitors, 0);
  assert.equal(monitorPause.payload.summary.counts.healthy, 0);

  const monitorResume = await requestJson(baseUrl, `/api/monitors/${monitor.id}`, {
    method: "PATCH",
    headers: intentHeaders,
    body: { enabled: true }
  });
  assert.equal(monitorResume.status, 200);
  assert.equal(monitorResume.payload.summary.enabledMonitors, 1);

  const backupCreate = await requestJson(baseUrl, "/api/backups", {
    method: "POST",
    headers: intentHeaders,
    body: {
      name: "Route coverage backup",
      scheduleHours: 12,
      notes: "Created by API integration coverage",
      restoreTest: { intervalDays: 45 }
    }
  });
  assert.equal(backupCreate.status, 201);
  const backup = backupCreate.payload.backups.find((item) => item.name === "Route coverage backup");
  assert.ok(backup?.id);

  const backupPatch = await requestJson(baseUrl, `/api/backups/${backup.id}`, {
    method: "PATCH",
    headers: intentHeaders,
    body: {
      notes: "Updated notes",
      restoreTest: {
        lastTestedAt: new Date().toISOString(),
        target: "Staging dataset",
        result: "passed",
        evidence: "Checksum verified"
      }
    }
  });
  assert.equal(backupPatch.status, 200);
  const patchedBackup = backupPatch.payload.backups.find((item) => item.id === backup.id);
  assert.equal(patchedBackup.restoreTest.result, "passed");

  const markSuccess = await requestJson(baseUrl, `/api/backups/${backup.id}/mark-success`, {
    method: "POST",
    headers: intentHeaders
  });
  assert.equal(markSuccess.status, 200);
  assert.ok(markSuccess.payload.backups.find((item) => item.id === backup.id).lastSuccessAt);

  const settings = await requestJson(baseUrl, "/api/settings", {
    method: "PATCH",
    headers: intentHeaders,
    body: {
      checkIntervalSeconds: 180,
      notifyOnRecovery: false,
      webhookUrl: "https://example.com/homeops-route-coverage"
    }
  });
  assert.equal(settings.status, 200);
  assert.equal(settings.payload.settings.checkIntervalSeconds, 180);
  assert.equal(settings.payload.settings.notifyOnRecovery, false);
  assert.equal(settings.payload.settings.alertWebhook.configured, true);

  const alertTest = await requestJson(baseUrl, "/api/alerts/test", {
    method: "POST",
    headers: intentHeaders
  });
  assert.equal(alertTest.status, 200);
  assert.equal(["delivered", "failed"].includes(alertTest.payload.delivery.deliveryStatus), true);

  const incidentCreate = await requestJson(baseUrl, "/api/incidents", {
    method: "POST",
    headers: intentHeaders,
    body: {
      title: "Route coverage incident",
      severity: "warning",
      notes: "Firmware update"
    }
  });
  assert.equal(incidentCreate.status, 201);
  const incident = incidentCreate.payload.incidents.find(
    (item) => item.title === "Route coverage incident"
  );
  assert.ok(incident?.id);

  const incidentPatch = await requestJson(baseUrl, `/api/incidents/${incident.id}`, {
    method: "PATCH",
    headers: intentHeaders,
    body: { resolved: true, notes: "Resolved after reboot" }
  });
  assert.equal(incidentPatch.status, 200);
  assert.ok(incidentPatch.payload.incidents.find((item) => item.id === incident.id).resolvedAt);

  const diagnostics = await requestJson(baseUrl, "/api/diagnostics");
  assert.equal(diagnostics.status, 200);
  assert.equal(diagnostics.payload.counts.monitors, 1);
  assert.equal(diagnostics.payload.counts.backups, 1);
  assert.equal(diagnostics.payload.counts.openIncidents, 0);
  assert.equal(diagnostics.payload.alerts.webhookConfigured, true);

  const clearWebhook = await requestJson(baseUrl, "/api/settings", {
    method: "PATCH",
    headers: intentHeaders,
    body: { clearWebhook: true }
  });
  assert.equal(clearWebhook.status, 200);
  assert.equal(clearWebhook.payload.settings.alertWebhook.configured, false);

  const deleteBackup = await requestJson(baseUrl, `/api/backups/${backup.id}`, {
    method: "DELETE",
    headers: intentHeaders
  });
  assert.equal(deleteBackup.status, 200);
  assert.equal(
    deleteBackup.payload.backups.some((item) => item.id === backup.id),
    false
  );

  const deleteMonitor = await requestJson(baseUrl, `/api/monitors/${monitor.id}`, {
    method: "DELETE",
    headers: intentHeaders
  });
  assert.equal(deleteMonitor.status, 200);
  assert.equal(
    deleteMonitor.payload.monitors.some((item) => item.id === monitor.id),
    false
  );
  assert.equal(deleteMonitor.payload.results[monitor.id], undefined);
  assert.equal(deleteMonitor.payload.monitorHistory[monitor.id], undefined);
  assert.equal(deleteMonitor.payload.monitorMetrics[monitor.id], undefined);
});

console.log("security tests passed");
