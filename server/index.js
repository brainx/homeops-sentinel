import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, APP_VERSION, getConfig } from "./config.js";
import {
  createHeartbeatToken,
  describeHeartbeatToken,
  hashHeartbeatToken,
  readBearerToken,
  verifyHeartbeatToken
} from "./heartbeats.js";
import { JsonStore, createId } from "./store.js";
import { publicMonitorHistory, recordMonitorResult, summarizeMonitorHistory } from "./history.js";
import { createSecretBox } from "./secrets.js";
import { normalizeOutboundUrl, postJsonToSafeUrl } from "./network.js";
import { assertRequestProvenance } from "./request-security.js";
import {
  backupStatus,
  normalizeBackup,
  normalizeMonitor,
  restoreTestStatus,
  runMonitor,
  summarizeState
} from "./monitors.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const config = getConfig();
const store = new JsonStore(config.dataFile);
const secretBox = createSecretBox(config.secretFile);
const processInstanceId = createId("run");
const manualCheckLimiter = new Map();
let schedulerBusy = false;
let activeSchedulerPromise = null;
let shuttingDown = false;
let shutdownStarted = false;
const startedAt = new Date().toISOString();
const schedulerDiagnostics = {
  intervalMs: 10_000,
  busy: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastError: null
};
const ALERT_PENDING_LEASE_MS = 20_000;
const ALERT_RETRY_BASE_MS = 60_000;
const ALERT_RETRY_MAX_MS = 60 * 60_000;
const ALERT_MAX_AUTOMATIC_ATTEMPTS = 5;
const SHUTDOWN_GRACE_MS = 30_000;
const ID_PATTERNS = {
  monitors: /^mon_[A-Za-z0-9_-]{8,120}$/,
  backups: /^bak_[A-Za-z0-9_-]{8,120}$/,
  incidents: /^inc_[A-Za-z0-9_-]{8,120}$/
};

await store.ensure();

function json(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...securityHeaders(),
    ...extraHeaders
  });
  res.end(body);
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "content-security-policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
  };
}

function safeError(res, status, message) {
  json(res, status, { error: message });
}

async function readJsonBody(req) {
  const mediaType = String(req.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new Error("Content-Type must be application/json");
  }
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.length;
    if (byteLength > 64 * 1024) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks, byteLength).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function publicState(state) {
  const now = new Date();
  const monitorHistory = {};
  const monitorMetrics = {};
  for (const monitor of state.monitors) {
    const history = state.monitorHistory?.[monitor.id] || [];
    monitorHistory[monitor.id] = publicMonitorHistory(history);
    monitorMetrics[monitor.id] = summarizeMonitorHistory(history);
  }
  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION
    },
    settings: {
      checkIntervalSeconds: state.settings.checkIntervalSeconds,
      notifyOnRecovery: state.settings.notifyOnRecovery,
      alertWebhook: secretBox.mask(state.settings.alertWebhookEncrypted)
    },
    monitors: state.monitors,
    backups: state.backups.map((backup) => ({
      ...publicBackup(backup, now),
      health: backupStatus(backup, now)
    })),
    incidents: [...state.incidents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    results: state.results,
    monitorHistory,
    monitorMetrics,
    alertEvents: (state.alertEvents || []).slice(0, 50),
    summary: summarizeState(state, now)
  };
}

function publicBackup(backup, now) {
  const { heartbeat, restoreTest, ...safeBackup } = backup;
  const safeRestoreTest = restoreTest && typeof restoreTest === "object" ? restoreTest : {};
  return {
    ...safeBackup,
    restoreTest: {
      intervalDays: safeRestoreTest.intervalDays || 90,
      lastTestedAt: safeRestoreTest.lastTestedAt || null,
      target: typeof safeRestoreTest.target === "string" ? safeRestoreTest.target : "",
      result: ["not_tested", "passed", "failed"].includes(safeRestoreTest.result)
        ? safeRestoreTest.result
        : "not_tested",
      evidence: typeof safeRestoreTest.evidence === "string" ? safeRestoreTest.evidence : "",
      health: restoreTestStatus(backup, now)
    },
    heartbeat: heartbeat?.tokenHash
      ? {
          configured: true,
          label: heartbeat.tokenPrefix || "Configured",
          createdAt: heartbeat.createdAt || null,
          lastUsedAt: heartbeat.lastUsedAt || null
        }
      : {
          configured: false,
          label: "Not configured",
          createdAt: null,
          lastUsedAt: null
        }
  };
}

function buildDiagnostics(state) {
  const now = new Date();
  const summary = summarizeState(state, now);
  const enabledMonitors = state.monitors.filter((monitor) => monitor.enabled);
  const monitorTypes = state.monitors.reduce((counts, monitor) => {
    counts[monitor.type] = (counts[monitor.type] || 0) + 1;
    return counts;
  }, {});
  const recentAlertEvents = Array.isArray(state.alertEvents) ? state.alertEvents : [];
  const failedAlertDeliveries = recentAlertEvents.filter(
    (event) => event.deliveryStatus === "failed"
  ).length;

  return {
    app: {
      name: APP_NAME,
      version: APP_VERSION
    },
    runtime: {
      node: process.versions.node,
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt
    },
    storage: {
      schemaVersion: state.schemaVersion,
      lastRecovery: store.lastRecovery
        ? {
            recoveredAt: store.lastRecovery.recoveredAt,
            corruptFile: store.lastRecovery.corruptPath,
            reason: trimMessage(store.lastRecovery.reason, "State file recovery completed")
          }
        : null
    },
    scheduler: {
      ...schedulerDiagnostics,
      busy: schedulerBusy
    },
    authBoundary: {
      mode: "external-proxy",
      expected: "Umbrel app proxy or a trusted reverse proxy",
      directExposureWarning: directExposureWarning()
    },
    counts: {
      monitors: state.monitors.length,
      enabledMonitors: enabledMonitors.length,
      monitorTypes,
      backups: state.backups.length,
      openIncidents: state.incidents.filter((incident) => !incident.resolvedAt).length,
      alertEvents: recentAlertEvents.length,
      failedAlertDeliveries
    },
    readiness: {
      score: summary.readiness.score,
      label: summary.readiness.label,
      overall: summary.overall
    },
    alerts: {
      webhookConfigured: Boolean(state.settings.alertWebhookEncrypted),
      notifyOnRecovery: Boolean(state.settings.notifyOnRecovery)
    }
  };
}

function directExposureWarning() {
  if (process.env.HOMEOPS_REQUIRE_PROXY === "true") return null;
  const runningUnderUmbrel = Boolean(process.env.APP_SEED || process.env.UMBREL_APP_ID);
  if (config.host === "0.0.0.0" && !runningUnderUmbrel) {
    return "App is bound to all interfaces without an Umbrel marker; place it behind a trusted proxy before exposing it.";
  }
  return null;
}

function parseId(pathname, prefix, action = null) {
  const parts = pathname.split("/").filter(Boolean);
  const expectedLength = action ? 4 : 3;
  if (parts.length !== expectedLength || parts[0] !== "api" || parts[1] !== prefix) return null;
  if (action && parts[3] !== action) return null;
  const id = parts[2];
  if (!ID_PATTERNS[prefix]?.test(id)) return null;
  return id;
}

function rateLimit(req, key, limitMs) {
  const ip = req.socket.remoteAddress || "unknown";
  const limiterKey = `${ip}:${key}`;
  const now = Date.now();
  pruneRateLimiter(now);
  const previous = manualCheckLimiter.get(limiterKey)?.last || 0;
  if (now - previous < limitMs) return false;
  manualCheckLimiter.set(limiterKey, {
    last: now,
    expiresAt: now + Math.max(60_000, limitMs * 4)
  });
  return true;
}

function pruneRateLimiter(now) {
  if (manualCheckLimiter.size === 0) return;
  for (const [key, entry] of manualCheckLimiter.entries()) {
    if (!entry?.expiresAt || entry.expiresAt <= now) manualCheckLimiter.delete(key);
  }
  while (manualCheckLimiter.size > 1000) {
    const oldest = manualCheckLimiter.keys().next().value;
    if (!oldest) break;
    manualCheckLimiter.delete(oldest);
  }
}

function trimMessage(value, fallback = "Alert delivery failed") {
  const message = String(value || fallback).trim();
  return message.slice(0, 240);
}

function appendAlertEvent(state, event) {
  const normalized = {
    id: event.id || createId("evt"),
    kind: event.kind,
    deliveryStatus: event.deliveryStatus,
    createdAt: event.createdAt || new Date().toISOString(),
    monitorId: event.monitorId || null,
    monitorName: event.monitorName || null,
    monitorStatus: event.monitorStatus || null,
    message: trimMessage(event.message, "Alert delivered"),
    statusCode: event.statusCode || null,
    error: event.error ? trimMessage(event.error) : null
  };
  state.alertEvents = [
    normalized,
    ...(Array.isArray(state.alertEvents) ? state.alertEvents : [])
  ].slice(0, 100);
  return normalized;
}

async function handleApi(req, res, url) {
  assertRequestProvenance(req, url);

  if (req.method === "GET" && url.pathname === "/api/health") {
    json(res, 200, { status: "ok", version: APP_VERSION });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    json(res, 200, publicState(await store.read()));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/diagnostics") {
    json(res, 200, buildDiagnostics(await store.read()));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/monitors") {
    const body = await readJsonBody(req);
    const state = await store.update((current) => {
      const monitor = {
        id: createId("mon"),
        ...normalizeMonitor(body, new Date(), {
          defaultIntervalSeconds: current.settings.checkIntervalSeconds
        })
      };
      current.monitors.push(monitor);
      return current;
    });
    json(res, 201, publicState(state));
    return;
  }

  if (req.method === "PATCH" && parseId(url.pathname, "monitors")) {
    const id = parseId(url.pathname, "monitors");
    const body = await readJsonBody(req);
    const state = await store.update((current) => {
      const index = current.monitors.findIndex((monitor) => monitor.id === id);
      if (index === -1) throw new Error("Monitor not found");
      current.monitors[index] = {
        ...current.monitors[index],
        ...normalizeMonitor({
          ...current.monitors[index],
          ...body,
          target: { ...current.monitors[index].target, ...(body.target || {}) }
        }),
        id
      };
      return current;
    });
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "DELETE" && parseId(url.pathname, "monitors")) {
    const id = parseId(url.pathname, "monitors");
    const state = await store.update((current) => {
      current.monitors = current.monitors.filter((monitor) => monitor.id !== id);
      delete current.results[id];
      delete current.monitorHistory[id];
      delete current.alertLedger[id];
      return current;
    });
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && parseId(url.pathname, "monitors", "check")) {
    const id = parseId(url.pathname, "monitors", "check");
    if (!rateLimit(req, `check:${id}`, 5000)) {
      safeError(res, 429, "Manual checks are rate-limited");
      return;
    }
    const current = await store.read();
    const monitor = current.monitors.find((item) => item.id === id);
    if (!monitor) {
      safeError(res, 404, "Monitor not found");
      return;
    }
    const result = await runMonitor(monitor);
    const completed = await completeMonitorCheck(monitor, result, { requireEnabled: false });
    if (!completed.committed) {
      safeError(res, 409, "Monitor changed while the check was running");
      return;
    }
    json(res, 200, publicState(completed.state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/monitors/check-all") {
    if (!rateLimit(req, "check-all", 10000)) {
      safeError(res, 429, "Run all checks is rate-limited");
      return;
    }
    const current = await store.read();
    const monitors = current.monitors.filter((item) => item.enabled);
    let state = current;
    for (const monitor of monitors) {
      if (shuttingDown) break;
      const result = await runMonitor(monitor);
      const completed = await completeMonitorCheck(monitor, result, { requireEnabled: true });
      state = completed.state;
    }
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/backups") {
    const body = await readJsonBody(req);
    const backup = { id: createId("bak"), ...normalizeBackup(body) };
    const state = await store.update((current) => {
      current.backups.push(backup);
      return current;
    });
    json(res, 201, publicState(state));
    return;
  }

  if (req.method === "PATCH" && parseId(url.pathname, "backups")) {
    const id = parseId(url.pathname, "backups");
    const body = await readJsonBody(req);
    const state = await store.update((current) => {
      const index = current.backups.findIndex((backup) => backup.id === id);
      if (index === -1) throw new Error("Backup not found");
      current.backups[index] = {
        ...current.backups[index],
        ...normalizeBackup({
          ...current.backups[index],
          ...body,
          restoreTest: {
            ...(current.backups[index].restoreTest || {}),
            ...(body.restoreTest || {})
          }
        }),
        id
      };
      return current;
    });
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "DELETE" && parseId(url.pathname, "backups")) {
    const id = parseId(url.pathname, "backups");
    const state = await store.update((current) => {
      current.backups = current.backups.filter((backup) => backup.id !== id);
      return current;
    });
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && parseId(url.pathname, "backups", "heartbeat-token")) {
    const id = parseId(url.pathname, "backups", "heartbeat-token");
    if (!rateLimit(req, `heartbeat-token:${id}`, 3000)) {
      safeError(res, 429, "Token rotation is rate-limited");
      return;
    }
    const token = createHeartbeatToken();
    const now = new Date().toISOString();
    const state = await store.update((current) => {
      const backup = current.backups.find((item) => item.id === id);
      if (!backup) throw new Error("Backup not found");
      backup.heartbeat = {
        tokenHash: hashHeartbeatToken(token),
        tokenPrefix: describeHeartbeatToken(token),
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null
      };
      backup.updatedAt = now;
      return current;
    });
    json(res, 201, {
      state: publicState(state),
      token,
      endpoint: `/api/backups/${id}/heartbeat`,
      createdAt: now
    });
    return;
  }

  if (req.method === "POST" && parseId(url.pathname, "backups", "heartbeat")) {
    const id = parseId(url.pathname, "backups", "heartbeat");
    const token = readBearerToken(req);
    if (!token) {
      safeError(res, 401, "Heartbeat token rejected");
      return;
    }
    const current = await store.read();
    const currentBackup = current.backups.find((item) => item.id === id);
    const tokenAccepted = Boolean(
      currentBackup?.heartbeat?.tokenHash &&
      verifyHeartbeatToken(token, currentBackup.heartbeat.tokenHash)
    );
    const limiterKey = tokenAccepted
      ? `heartbeat:${id}:valid:${hashHeartbeatToken(token).slice(0, 16)}`
      : `heartbeat:${id}:invalid`;
    if (!rateLimit(req, limiterKey, 1000)) {
      safeError(res, 429, "Heartbeat is rate-limited");
      return;
    }
    if (!tokenAccepted) {
      safeError(res, 401, "Heartbeat token rejected");
      return;
    }
    const recordedAt = new Date().toISOString();
    try {
      await store.update((current) => {
        const backup = current.backups.find((item) => item.id === id);
        if (
          !backup?.heartbeat?.tokenHash ||
          !verifyHeartbeatToken(token, backup.heartbeat.tokenHash)
        ) {
          throw new Error("Heartbeat token rejected");
        }
        backup.lastSuccessAt = recordedAt;
        backup.updatedAt = recordedAt;
        backup.heartbeat.lastUsedAt = recordedAt;
        return current;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "Heartbeat token rejected") {
        safeError(res, 401, "Heartbeat token rejected");
        return;
      }
      throw error;
    }
    json(res, 200, { status: "ok", backupId: id, recordedAt });
    return;
  }

  if (req.method === "POST" && parseId(url.pathname, "backups", "mark-success")) {
    const id = parseId(url.pathname, "backups", "mark-success");
    const state = await store.update((current) => {
      const backup = current.backups.find((item) => item.id === id);
      if (!backup) throw new Error("Backup not found");
      backup.lastSuccessAt = new Date().toISOString();
      backup.updatedAt = backup.lastSuccessAt;
      return current;
    });
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/incidents") {
    const body = await readJsonBody(req);
    const title = String(body.title || "")
      .trim()
      .slice(0, 120);
    const notes = String(body.notes || "")
      .trim()
      .slice(0, 2000);
    if (!title) throw new Error("title is required");
    const now = new Date().toISOString();
    const incident = {
      id: createId("inc"),
      title,
      notes,
      severity: ["info", "warning", "critical"].includes(body.severity) ? body.severity : "info",
      createdAt: now,
      resolvedAt: null
    };
    const state = await store.update((current) => {
      current.incidents.push(incident);
      return current;
    });
    json(res, 201, publicState(state));
    return;
  }

  if (req.method === "PATCH" && parseId(url.pathname, "incidents")) {
    const id = parseId(url.pathname, "incidents");
    const body = await readJsonBody(req);
    const state = await store.update((current) => {
      const incident = current.incidents.find((item) => item.id === id);
      if (!incident) throw new Error("Incident not found");
      if (typeof body.title === "string") incident.title = body.title.trim().slice(0, 120);
      if (typeof body.notes === "string") incident.notes = body.notes.trim().slice(0, 2000);
      if (typeof body.resolved === "boolean") {
        incident.resolvedAt = body.resolved ? new Date().toISOString() : null;
      }
      return current;
    });
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/alerts/test") {
    if (!rateLimit(req, "alerts:test", 5000)) {
      safeError(res, 429, "Alert tests are rate-limited");
      return;
    }
    const current = await store.read();
    if (!current.settings.alertWebhookEncrypted) {
      safeError(res, 400, "Webhook is not configured");
      return;
    }

    const createdAt = new Date().toISOString();
    const payload = {
      app: APP_NAME,
      kind: "test",
      status: "test",
      message: "HomeOps Sentinel test alert",
      checkedAt: createdAt
    };
    let event;
    try {
      const delivery = await deliverWebhook(current, payload);
      event = {
        kind: "test",
        deliveryStatus: "delivered",
        createdAt,
        message: "Test alert delivered",
        statusCode: delivery.statusCode
      };
    } catch (error) {
      event = {
        kind: "test",
        deliveryStatus: "failed",
        createdAt,
        message: "Test alert failed",
        error: error instanceof Error ? error.message : "Alert delivery failed"
      };
    }

    let deliveryEvent = null;
    const state = await store.update((latest) => {
      deliveryEvent = appendAlertEvent(latest, event);
      return latest;
    });
    json(res, 200, { state: publicState(state), delivery: deliveryEvent });
    return;
  }

  if (req.method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readJsonBody(req);
    const state = await store.update((current) => {
      if (body.checkIntervalSeconds !== undefined) {
        const seconds = body.checkIntervalSeconds;
        if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) {
          throw new Error("checkIntervalSeconds must be between 60 and 86400");
        }
        current.settings.checkIntervalSeconds = seconds;
      }
      if (body.notifyOnRecovery !== undefined) {
        if (typeof body.notifyOnRecovery !== "boolean") {
          throw new Error("notifyOnRecovery must be a boolean");
        }
        current.settings.notifyOnRecovery = body.notifyOnRecovery;
      }
      if (body.clearWebhook === true) {
        current.settings.alertWebhookEncrypted = null;
      }
      if (typeof body.webhookUrl === "string" && body.webhookUrl.trim()) {
        current.settings.alertWebhookEncrypted = secretBox.encrypt(
          validateWebhookUrl(body.webhookUrl).toString()
        );
      }
      return current;
    });
    json(res, 200, publicState(state));
    return;
  }

  safeError(res, 404, "Not found");
}

async function serveStatic(req, res, url) {
  if (hasPathTraversal(req.url)) {
    safeError(res, 403, "Forbidden");
    return;
  }
  const candidate = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const staticRoot = path.resolve(config.staticDir);
  let filePath = path.resolve(staticRoot, `.${candidate}`);
  const relativePath = path.relative(staticRoot, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    safeError(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
  } catch {
    filePath = path.join(config.staticDir, "index.html");
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".webp": "image/webp"
      }[ext] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable",
      ...securityHeaders()
    });
    res.end(body);
  } catch {
    const fallback = path.join(dirname, "..", "index.html");
    const body = await fs.readFile(fallback);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...securityHeaders()
    });
    res.end(body);
  }
}

function hasPathTraversal(rawUrl) {
  const rawPath = String(rawUrl || "/").split(/[?#]/, 1)[0];
  let decoded = rawPath;
  for (let index = 0; index < 2; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }
  return decoded.split(/[\\/]+/).includes("..");
}

async function deliverWebhook(state, payload) {
  const encrypted = state.settings.alertWebhookEncrypted;
  if (!encrypted) throw new Error("Webhook is not configured");
  const webhookUrl = secretBox.decrypt(encrypted);
  return postJsonToSafeUrl(webhookUrl, payload, {
    blockLoopback: true,
    blockPrivate: true,
    label: "webhookUrl",
    maxRedirects: 2,
    timeoutMs: 5000
  });
}

function validateWebhookUrl(value) {
  return normalizeOutboundUrl(value, {
    blockLoopback: true,
    blockPrivate: true,
    label: "webhookUrl"
  });
}

function monitorRevision(monitor) {
  return JSON.stringify([
    monitor.id,
    monitor.name,
    monitor.type,
    monitor.intervalSeconds,
    monitor.enabled,
    monitor.updatedAt,
    monitor.target
  ]);
}

function alertDecision(monitor, previous, result, state, options = {}) {
  if (!state.settings.alertWebhookEncrypted) return null;
  const previousStatus = previous?.status || "unknown";
  const isNewTransition = previousStatus !== result.status;
  const ledger = state.alertLedger?.[monitor.id];
  const sameLedgerStatus = ledger?.status === result.status;
  const pendingInThisProcess = Boolean(
    sameLedgerStatus &&
    ledger?.deliveryStatus === "pending" &&
    ledger.owner === processInstanceId &&
    pendingLeaseActive(ledger)
  );
  const retryingFailure = Boolean(
    !isNewTransition &&
    sameLedgerStatus &&
    (ledger?.deliveryStatus === "failed" ||
      ledger?.error ||
      (ledger?.deliveryStatus === "pending" && !pendingInThisProcess))
  );
  if (!isNewTransition && pendingInThisProcess) return null;
  if (!isNewTransition && !retryingFailure) return null;
  if (retryingFailure && options.allowAlertRetry === false) return null;
  if (result.status === "healthy" && !state.settings.notifyOnRecovery) return null;
  const alertPreviousStatus = retryingFailure
    ? ledger.previousStatus || previousStatus
    : previousStatus;
  if (result.status === "healthy" && alertPreviousStatus === "unknown") return null;
  return {
    previousStatus: alertPreviousStatus,
    previousAttemptCount: retryingFailure ? alertAttemptCount(ledger) : 0
  };
}

function buildMonitorAlertPayload(monitor, result, previousStatus) {
  return {
    app: APP_NAME,
    kind: "monitor",
    monitor: {
      id: monitor.id,
      name: monitor.name,
      type: monitor.type
    },
    previousStatus,
    status: result.status,
    message: result.message,
    checkedAt: result.checkedAt
  };
}

function createPendingAlert(payload, previousAttemptCount = 0) {
  const attemptedAt = new Date().toISOString();
  return {
    status: payload.status,
    previousStatus: payload.previousStatus,
    deliveryStatus: "pending",
    attemptId: createId("alert"),
    attemptCount: Math.max(0, previousAttemptCount) + 1,
    attemptedAt,
    sentAt: null,
    completedAt: null,
    nextAttemptAt: null,
    owner: processInstanceId,
    error: null,
    payload
  };
}

function supersedeRetryableAlert(state, monitorId, result) {
  const ledger = state.alertLedger?.[monitorId];
  const retryable = Boolean(
    ledger &&
    (ledger.deliveryStatus === "pending" || ledger.deliveryStatus === "failed" || ledger.error)
  );
  if (!retryable) return;
  state.alertLedger[monitorId] = {
    ...ledger,
    deliveryStatus: "superseded",
    supersededAt: result.checkedAt,
    supersededByStatus: result.status,
    nextAttemptAt: null,
    owner: null,
    error: null
  };
}

function alertAttemptCount(ledger) {
  return Number.isInteger(ledger?.attemptCount) && ledger.attemptCount > 0
    ? ledger.attemptCount
    : 1;
}

function pendingLeaseActive(ledger, now = Date.now()) {
  const attemptedAt = new Date(ledger?.attemptedAt || ledger?.sentAt || 0).getTime();
  return Number.isFinite(attemptedAt) && now - attemptedAt < ALERT_PENDING_LEASE_MS;
}

function abandonedPendingAttempt(ledger, now = Date.now()) {
  return Boolean(
    ledger?.deliveryStatus === "pending" &&
    (ledger.owner !== processInstanceId || !pendingLeaseActive(ledger, now))
  );
}

function pendingRetryExhausted(ledger, now = Date.now()) {
  return Boolean(
    abandonedPendingAttempt(ledger, now) &&
    alertAttemptCount(ledger) >= ALERT_MAX_AUTOMATIC_ATTEMPTS
  );
}

function automaticRetryDue(ledger, now = Date.now()) {
  if (!ledger || alertAttemptCount(ledger) >= ALERT_MAX_AUTOMATIC_ATTEMPTS) return false;
  if (ledger.deliveryStatus === "pending") {
    return abandonedPendingAttempt(ledger, now);
  }
  if (ledger.deliveryStatus !== "failed" && !ledger.error) return false;
  const nextAttemptAt = new Date(ledger.nextAttemptAt || 0).getTime();
  return !Number.isFinite(nextAttemptAt) || nextAttemptAt <= now;
}

function retryDelayMs(attemptCount) {
  return Math.min(ALERT_RETRY_MAX_MS, ALERT_RETRY_BASE_MS * 2 ** Math.max(0, attemptCount - 1));
}

function safePersistedAlertPayload(payload, monitorId, status) {
  const checkedAt = new Date(payload?.checkedAt || "");
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.kind !== "monitor" ||
    payload.monitor?.id !== monitorId ||
    payload.status !== status ||
    typeof payload.monitor?.name !== "string" ||
    typeof payload.monitor?.type !== "string" ||
    typeof payload.previousStatus !== "string" ||
    typeof payload.message !== "string" ||
    !Number.isFinite(checkedAt.getTime())
  ) {
    return null;
  }
  return {
    app: APP_NAME,
    kind: "monitor",
    monitor: {
      id: monitorId,
      name: payload.monitor.name.slice(0, 80),
      type: payload.monitor.type.slice(0, 16)
    },
    previousStatus: payload.previousStatus.slice(0, 20),
    status: String(status).slice(0, 20),
    message: payload.message.slice(0, 500),
    checkedAt: checkedAt.toISOString()
  };
}

function payloadForAlertLedger(state, monitorId, ledger) {
  const persisted = safePersistedAlertPayload(ledger?.payload, monitorId, ledger?.status);
  if (persisted) return persisted;

  const monitor = state.monitors.find((item) => item.id === monitorId);
  const result = state.results?.[monitorId];
  if (!monitor || !result || result.status !== ledger?.status) return null;
  return buildMonitorAlertPayload(monitor, result, ledger.previousStatus || "unknown");
}

async function completeMonitorCheck(snapshot, result, options = {}) {
  const expectedRevision = monitorRevision(snapshot);
  let committedMonitor = null;
  let decision = null;
  let state = await store.update((latest) => {
    const currentMonitor = latest.monitors.find((monitor) => monitor.id === snapshot.id);
    if (
      !currentMonitor ||
      (options.requireEnabled === true && !currentMonitor.enabled) ||
      monitorRevision(currentMonitor) !== expectedRevision
    ) {
      return latest;
    }
    const previous = latest.results[currentMonitor.id];
    const isNewTransition = (previous?.status || "unknown") !== result.status;
    recordMonitorResult(latest, currentMonitor.id, result);
    committedMonitor = structuredClone(currentMonitor);
    decision = alertDecision(currentMonitor, previous, result, latest, options);
    if (decision) {
      const payload = buildMonitorAlertPayload(currentMonitor, result, decision.previousStatus);
      decision = createPendingAlert(payload, decision.previousAttemptCount);
      latest.alertLedger[currentMonitor.id] = decision;
    } else if (isNewTransition) {
      supersedeRetryableAlert(latest, currentMonitor.id, result);
    }
    return latest;
  });

  if (!committedMonitor) return { committed: false, state };
  if (!decision) return { committed: true, state };
  state = await deliverMonitorAlert(committedMonitor.id, decision, state);
  return { committed: true, state };
}

async function deliverMonitorAlert(monitorId, pendingAlert, state) {
  const { payload } = pendingAlert;
  let delivery = null;
  let deliveryError = null;
  try {
    delivery = await deliverWebhook(state, payload);
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : "Alert delivery failed";
  }

  const completedAt = new Date().toISOString();
  return store.update((latest) => {
    const currentLedger = latest.alertLedger[monitorId];
    if (
      currentLedger?.deliveryStatus === "pending" &&
      currentLedger.attemptId === pendingAlert.attemptId
    ) {
      latest.alertLedger[monitorId] = {
        ...currentLedger,
        deliveryStatus: deliveryError ? "failed" : "delivered",
        sentAt: deliveryError ? null : completedAt,
        completedAt,
        nextAttemptAt: deliveryError
          ? new Date(
              new Date(completedAt).getTime() + retryDelayMs(pendingAlert.attemptCount)
            ).toISOString()
          : null,
        error: deliveryError
      };
    }
    appendAlertEvent(latest, {
      kind: "monitor",
      deliveryStatus: deliveryError ? "failed" : "delivered",
      createdAt: completedAt,
      monitorId,
      monitorName: payload.monitor.name,
      monitorStatus: payload.status,
      message: payload.message,
      statusCode: delivery?.statusCode || null,
      error: deliveryError
    });
    return latest;
  });
}

async function claimOutboxAlert(monitorId) {
  let pendingAlert = null;
  const state = await store.update((latest) => {
    const ledger = latest.alertLedger?.[monitorId];
    const payload = payloadForAlertLedger(latest, monitorId, ledger);
    if (pendingRetryExhausted(ledger)) {
      const completedAt = new Date().toISOString();
      const error = "Automatic retry limit reached after an interrupted alert delivery";
      latest.alertLedger[monitorId] = {
        ...ledger,
        deliveryStatus: "failed",
        sentAt: null,
        completedAt,
        nextAttemptAt: null,
        error
      };
      const monitor = latest.monitors.find((item) => item.id === monitorId);
      appendAlertEvent(latest, {
        kind: "monitor",
        deliveryStatus: "failed",
        createdAt: completedAt,
        monitorId,
        monitorName: payload?.monitor.name || monitor?.name || null,
        monitorStatus: payload?.status || ledger.status || null,
        message: payload?.message || "Alert delivery was interrupted",
        error
      });
      return latest;
    }
    if (!latest.settings.alertWebhookEncrypted || !automaticRetryDue(ledger)) return latest;
    if (!payload) return latest;
    pendingAlert = createPendingAlert(payload, alertAttemptCount(ledger));
    latest.alertLedger[monitorId] = pendingAlert;
    return latest;
  });
  return { pendingAlert, state };
}

async function drainAlertOutbox() {
  const processedMonitorIds = new Set();
  while (!shuttingDown) {
    const snapshot = await store.read();
    const candidate = Object.entries(snapshot.alertLedger || {}).find(
      ([monitorId, ledger]) =>
        !processedMonitorIds.has(monitorId) &&
        (pendingRetryExhausted(ledger) ||
          (automaticRetryDue(ledger) && payloadForAlertLedger(snapshot, monitorId, ledger)))
    );
    if (!candidate) break;

    const monitorId = candidate[0];
    processedMonitorIds.add(monitorId);
    const claimed = await claimOutboxAlert(monitorId);
    if (!claimed.pendingAlert) continue;
    await deliverMonitorAlert(monitorId, claimed.pendingAlert, claimed.state);
  }
  return processedMonitorIds;
}

async function schedulerTick() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  schedulerDiagnostics.busy = true;
  schedulerDiagnostics.lastStartedAt = new Date().toISOString();
  try {
    const processedAlertMonitors = await drainAlertOutbox();
    const current = await store.read();
    const now = Date.now();
    for (const monitor of current.monitors) {
      if (shuttingDown) break;
      if (!monitor.enabled) continue;
      if (processedAlertMonitors.has(monitor.id)) continue;
      const previous = current.results[monitor.id];
      const dueMs = (monitor.intervalSeconds || current.settings.checkIntervalSeconds) * 1000;
      const last = previous?.checkedAt ? new Date(previous.checkedAt).getTime() : 0;
      if (last && now - last < dueMs) continue;

      const result = await runMonitor(monitor);
      await completeMonitorCheck(monitor, result, {
        requireEnabled: true,
        allowAlertRetry: false
      });
    }
    schedulerDiagnostics.lastError = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduler failed";
    schedulerDiagnostics.lastError = trimMessage(message, "Scheduler failed");
    console.error("scheduler failed", message);
  } finally {
    schedulerBusy = false;
    schedulerDiagnostics.busy = false;
    schedulerDiagnostics.lastCompletedAt = new Date().toISOString();
  }
}

function triggerSchedulerTick() {
  if (shuttingDown) return Promise.resolve();
  if (activeSchedulerPromise) return activeSchedulerPromise;
  const promise = schedulerTick().finally(() => {
    if (activeSchedulerPromise === promise) activeSchedulerPromise = null;
  });
  activeSchedulerPromise = promise;
  return promise;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (isClientSafeError(message)) {
      safeError(res, message.toLowerCase().includes("not found") ? 404 : 400, message);
      return;
    }
    console.error("request failed", message);
    safeError(res, 400, "Request failed");
  }
});

server.listen(config.port, config.host, () => {
  console.log(`${APP_NAME} ${APP_VERSION} listening on ${config.host}:${config.port}`);
});

const schedulerInterval = setInterval(() => void triggerSchedulerTick(), 10_000);
schedulerInterval.unref();
void triggerSchedulerTick();

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  shuttingDown = true;
  clearInterval(schedulerInterval);

  const closeServer = new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  const finishWork = (async () => {
    await activeSchedulerPromise;
    await store.whenIdle();
  })();
  let timeout;
  try {
    await Promise.race([
      Promise.all([closeServer, finishWork]),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Graceful shutdown timed out")),
          SHUTDOWN_GRACE_MS
        );
      })
    ]);
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    console.error(`${signal} shutdown failed`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function isClientSafeError(message) {
  return [
    "required",
    "too long",
    "too large",
    "too weak",
    "between",
    "must",
    "unsupported",
    "blocked",
    "not found",
    "rejected",
    "rate-limited",
    "configured",
    "valid URL"
  ].some((fragment) => message.includes(fragment));
}
