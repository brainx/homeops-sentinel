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
const manualCheckLimiter = new Map();
let schedulerBusy = false;
const startedAt = new Date().toISOString();
const schedulerDiagnostics = {
  intervalMs: 10_000,
  busy: false,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastError: null
};
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
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
    throw new Error("Content-Type must be application/json");
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64 * 1024) throw new Error("Request body is too large");
  }
  return raw ? JSON.parse(raw) : {};
}

function publicState(state) {
  const now = new Date();
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
    const monitor = { id: createId("mon"), ...normalizeMonitor(body) };
    const state = await store.update((current) => {
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
    const state = await store.update((latest) => {
      latest.results[id] = result;
      return latest;
    });
    json(res, 200, publicState(state));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/monitors/check-all") {
    if (!rateLimit(req, "check-all", 10000)) {
      safeError(res, 429, "Run all checks is rate-limited");
      return;
    }
    const current = await store.read();
    const monitors = current.monitors.filter((item) => item.enabled);
    const results = {};
    for (const monitor of monitors) {
      results[monitor.id] = await runMonitor(monitor);
    }
    const state = await store.update((latest) => {
      for (const [id, result] of Object.entries(results)) {
        if (latest.monitors.some((monitor) => monitor.id === id)) {
          latest.results[id] = result;
        }
      }
      return latest;
    });
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
        const seconds = Number.parseInt(body.checkIntervalSeconds, 10);
        if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) {
          throw new Error("checkIntervalSeconds must be between 60 and 86400");
        }
        current.settings.checkIntervalSeconds = seconds;
      }
      if (body.notifyOnRecovery !== undefined) {
        current.settings.notifyOnRecovery = Boolean(body.notifyOnRecovery);
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

async function sendAlert(monitor, previous, result, state) {
  const encrypted = state.settings.alertWebhookEncrypted;
  if (!encrypted) return null;
  const previousStatus = previous?.status || "unknown";
  if (previousStatus === result.status) return null;
  if (result.status === "healthy" && !state.settings.notifyOnRecovery) return null;
  if (result.status === "healthy" && previousStatus === "unknown") return null;

  return deliverWebhook(state, {
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
  });
}

async function schedulerTick() {
  if (schedulerBusy) return;
  schedulerBusy = true;
  schedulerDiagnostics.busy = true;
  schedulerDiagnostics.lastStartedAt = new Date().toISOString();
  try {
    const current = await store.read();
    const now = Date.now();
    for (const monitor of current.monitors) {
      if (!monitor.enabled) continue;
      const previous = current.results[monitor.id];
      const dueMs = (monitor.intervalSeconds || current.settings.checkIntervalSeconds) * 1000;
      const last = previous?.checkedAt ? new Date(previous.checkedAt).getTime() : 0;
      if (last && now - last < dueMs) continue;

      const result = await runMonitor(monitor);
      await store.update(async (latest) => {
        const latestPrevious = latest.results[monitor.id];
        latest.results[monitor.id] = result;
        try {
          const delivery = await sendAlert(monitor, latestPrevious, result, latest);
          if (delivery) {
            const sentAt = new Date().toISOString();
            latest.alertLedger[monitor.id] = {
              status: result.status,
              sentAt,
              error: null
            };
            appendAlertEvent(latest, {
              kind: "monitor",
              deliveryStatus: "delivered",
              createdAt: sentAt,
              monitorId: monitor.id,
              monitorName: monitor.name,
              monitorStatus: result.status,
              message: result.message,
              statusCode: delivery.statusCode
            });
          }
        } catch (error) {
          const sentAt = new Date().toISOString();
          latest.alertLedger[monitor.id] = {
            status: result.status,
            sentAt,
            error: error instanceof Error ? error.message : "Alert delivery failed"
          };
          appendAlertEvent(latest, {
            kind: "monitor",
            deliveryStatus: "failed",
            createdAt: sentAt,
            monitorId: monitor.id,
            monitorName: monitor.name,
            monitorStatus: result.status,
            message: result.message,
            error: error instanceof Error ? error.message : "Alert delivery failed"
          });
        }
        return latest;
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

setInterval(schedulerTick, 10_000).unref();
schedulerTick();

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});

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
