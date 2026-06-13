import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { performance } from "node:perf_hooks";
import { assertAllowedHost, createSafeLookup, normalizeOutboundUrl } from "./network.js";

const MONITOR_TYPES = new Set(["http", "tcp", "dns", "tls"]);
const DNS_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "TXT"]);
const MAX_NAME_LENGTH = 80;
const DEFAULT_INTERVAL_SECONDS = 300;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 86400;
const RESTORE_TEST_RESULTS = new Set(["not_tested", "passed", "failed"]);
const DEFAULT_RESTORE_TEST_INTERVAL_DAYS = 90;
const MIN_RESTORE_TEST_INTERVAL_DAYS = 1;
const MAX_RESTORE_TEST_INTERVAL_DAYS = 365;

export function assertString(value, field, maxLength = 200) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`${field} is too long`);
  }
  return trimmed;
}

function normalizeInterval(value) {
  const parsed = Number.parseInt(value ?? DEFAULT_INTERVAL_SECONDS, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_INTERVAL_SECONDS || parsed > MAX_INTERVAL_SECONDS) {
    throw new Error(
      `intervalSeconds must be between ${MIN_INTERVAL_SECONDS} and ${MAX_INTERVAL_SECONDS}`
    );
  }
  return parsed;
}

function normalizePort(value) {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("port must be between 1 and 65535");
  }
  return port;
}

function normalizeHost(value) {
  const host = assertString(value, "host", 253).toLowerCase();
  if (host.includes("/") || host.includes("@") || host.includes(" ")) {
    throw new Error("host must be a hostname or IP address");
  }
  assertAllowedHost(host);
  return host;
}

function normalizeUrl(value) {
  const parsed = normalizeOutboundUrl(assertString(value, "url", 2048), { label: "url" });
  return parsed.toString();
}

function normalizeOptionalString(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeRestoreTestInterval(value) {
  const parsed = Number.parseInt(value ?? DEFAULT_RESTORE_TEST_INTERVAL_DAYS, 10);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_RESTORE_TEST_INTERVAL_DAYS ||
    parsed > MAX_RESTORE_TEST_INTERVAL_DAYS
  ) {
    throw new Error(
      `restore test intervalDays must be between ${MIN_RESTORE_TEST_INTERVAL_DAYS} and ${MAX_RESTORE_TEST_INTERVAL_DAYS}`
    );
  }
  return parsed;
}

function normalizeTimestamp(value, field, now) {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00.000Z`) : new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${field} must be a valid date`);
  }
  if (parsed.getTime() > now.getTime() + 60_000) {
    throw new Error(`${field} must not be in the future`);
  }
  return parsed.toISOString();
}

export function normalizeRestoreTest(input, now = new Date()) {
  const source =
    input?.restoreTest && typeof input.restoreTest === "object" ? input.restoreTest : {};
  const result = String(source.result ?? input?.restoreResult ?? "not_tested")
    .trim()
    .toLowerCase();
  if (!RESTORE_TEST_RESULTS.has(result)) {
    throw new Error("restore test result must be not_tested, passed, or failed");
  }

  const restoreTest = {
    intervalDays: normalizeRestoreTestInterval(
      source.intervalDays ?? input?.restoreTestIntervalDays
    ),
    lastTestedAt: normalizeTimestamp(
      source.lastTestedAt ?? input?.lastRestoreTestAt,
      "restore test date",
      now
    ),
    target: normalizeOptionalString(source.target ?? input?.restoreTarget, 120),
    result,
    evidence: normalizeOptionalString(
      source.evidence ?? input?.restoreEvidence ?? input?.restoreEvidenceNotes,
      800
    )
  };

  if (restoreTest.result !== "not_tested" && !restoreTest.lastTestedAt) {
    throw new Error("restore test date is required when result is passed or failed");
  }
  if (restoreTest.result !== "not_tested" && !restoreTest.target) {
    throw new Error("restore target is required when result is passed or failed");
  }

  return restoreTest;
}

export function normalizeMonitor(input, now = new Date()) {
  const type = assertString(input?.type, "type", 16).toLowerCase();
  if (!MONITOR_TYPES.has(type)) throw new Error("type must be http, tcp, dns, or tls");

  const monitor = {
    name: assertString(input?.name, "name", MAX_NAME_LENGTH),
    type,
    intervalSeconds: normalizeInterval(input?.intervalSeconds),
    enabled: input?.enabled !== false,
    createdAt: input?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
    target: {}
  };

  if (type === "http") {
    monitor.target = { url: normalizeUrl(input?.target?.url) };
  }
  if (type === "tcp") {
    monitor.target = {
      host: normalizeHost(input?.target?.host),
      port: normalizePort(input?.target?.port)
    };
  }
  if (type === "dns") {
    const recordType = assertString(
      input?.target?.recordType || "A",
      "recordType",
      8
    ).toUpperCase();
    if (!DNS_TYPES.has(recordType)) throw new Error("unsupported DNS recordType");
    monitor.target = {
      hostname: normalizeHost(input?.target?.hostname),
      recordType
    };
  }
  if (type === "tls") {
    monitor.target = {
      host: normalizeHost(input?.target?.host),
      port: normalizePort(input?.target?.port || 443),
      warningDays: Math.max(1, Math.min(90, Number.parseInt(input?.target?.warningDays || 21, 10)))
    };
  }

  return monitor;
}

export function normalizeBackup(input, now = new Date()) {
  const scheduleHours = Number.parseInt(input?.scheduleHours ?? 24, 10);
  if (!Number.isInteger(scheduleHours) || scheduleHours < 1 || scheduleHours > 2160) {
    throw new Error("scheduleHours must be between 1 and 2160");
  }
  return {
    name: assertString(input?.name, "name", MAX_NAME_LENGTH),
    scheduleHours,
    lastSuccessAt: input?.lastSuccessAt || null,
    notes: typeof input?.notes === "string" ? input.notes.trim().slice(0, 400) : "",
    restoreTest: normalizeRestoreTest(input, now),
    createdAt: input?.createdAt || now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function backupFreshnessStatus(backup, now = new Date()) {
  if (!backup.lastSuccessAt) {
    return { status: "degraded", message: "No successful backup recorded" };
  }

  const last = new Date(backup.lastSuccessAt).getTime();
  const ageHours = (now.getTime() - last) / 36e5;
  if (!Number.isFinite(ageHours)) {
    return { status: "degraded", message: "Last backup timestamp is invalid" };
  }
  if (ageHours > backup.scheduleHours * 1.2) {
    return {
      status: "down",
      message: `Overdue by ${Math.round(ageHours - backup.scheduleHours)}h`
    };
  }
  return { status: "healthy", message: `Last success ${Math.round(ageHours)}h ago` };
}

export function restoreTestStatus(backup, now = new Date()) {
  const restoreTest = backup?.restoreTest || {};
  const intervalDays = Number.parseInt(
    restoreTest.intervalDays ?? DEFAULT_RESTORE_TEST_INTERVAL_DAYS,
    10
  );
  const dueDays =
    Number.isInteger(intervalDays) &&
    intervalDays >= MIN_RESTORE_TEST_INTERVAL_DAYS &&
    intervalDays <= MAX_RESTORE_TEST_INTERVAL_DAYS
      ? intervalDays
      : DEFAULT_RESTORE_TEST_INTERVAL_DAYS;

  if (!restoreTest.lastTestedAt) {
    return {
      status: "degraded",
      message: "No restore test recorded",
      overdue: true,
      dueAt: null
    };
  }

  const last = new Date(restoreTest.lastTestedAt).getTime();
  if (!Number.isFinite(last)) {
    return {
      status: "degraded",
      message: "Restore test timestamp is invalid",
      overdue: true,
      dueAt: null
    };
  }

  const ageDays = (now.getTime() - last) / 864e5;
  const dueAt = new Date(last + dueDays * 864e5).toISOString();
  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return {
      status: "degraded",
      message: "Restore test timestamp is invalid",
      overdue: true,
      dueAt
    };
  }
  if (restoreTest.result === "failed") {
    return {
      status: "down",
      message: restoreTest.target
        ? `Restore test failed for ${restoreTest.target}`
        : "Restore test failed",
      overdue: false,
      dueAt
    };
  }
  if (restoreTest.result !== "passed") {
    return {
      status: "degraded",
      message: "Restore test result not recorded",
      overdue: true,
      dueAt
    };
  }
  if (ageDays > dueDays) {
    return {
      status: "degraded",
      message: `Restore test overdue by ${Math.round(ageDays - dueDays)}d`,
      overdue: true,
      dueAt
    };
  }
  return {
    status: "healthy",
    message: `Restore test passed ${Math.round(ageDays)}d ago`,
    overdue: false,
    dueAt
  };
}

export function backupStatus(backup, now = new Date()) {
  const freshness = backupFreshnessStatus(backup, now);
  const restore = restoreTestStatus(backup, now);
  if (freshness.status === "down") return freshness;
  if (restore.status === "down") return restore;
  if (freshness.status === "degraded") return freshness;
  if (restore.status === "degraded") return restore;
  return freshness;
}

export async function runMonitor(monitor) {
  const started = performance.now();
  try {
    let result;
    if (monitor.type === "http") result = await checkHttp(monitor);
    if (monitor.type === "tcp") result = await checkTcp(monitor);
    if (monitor.type === "dns") result = await checkDns(monitor);
    if (monitor.type === "tls") result = await checkTls(monitor);
    const latencyMs = Math.round(performance.now() - started);
    return {
      ...result,
      latencyMs,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: "down",
      message: error instanceof Error ? error.message : "Monitor failed",
      latencyMs: Math.round(performance.now() - started),
      checkedAt: new Date().toISOString()
    };
  }
}

async function checkHttp(monitor) {
  const parsed = new URL(monitor.target.url);
  assertAllowedHost(parsed.hostname);
  const client = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        lookup: createSafeLookup(),
        headers: {
          "user-agent": "HomeOps-Sentinel/0.1.0"
        }
      },
      (response) => {
        response.resume();
        const statusCode = response.statusCode || 0;
        if (statusCode >= 200 && statusCode < 400) {
          resolve({ status: "healthy", message: `HTTP ${statusCode}` });
          return;
        }
        if (statusCode >= 400 && statusCode < 500) {
          resolve({ status: "degraded", message: `HTTP ${statusCode}` });
          return;
        }
        resolve({ status: "down", message: `HTTP ${statusCode}` });
      }
    );
    req.setTimeout(8000, () => req.destroy(new Error("HTTP request timed out")));
    req.once("error", reject);
    req.end();
  });
}

function checkTcp(monitor) {
  assertAllowedHost(monitor.target.host);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: monitor.target.host,
      port: monitor.target.port,
      timeout: 6000,
      lookup: createSafeLookup()
    });
    socket.once("connect", () => {
      socket.end();
      resolve({ status: "healthy", message: `TCP ${monitor.target.port} reachable` });
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("TCP connection timed out"));
    });
    socket.once("error", (error) => reject(error));
  });
}

async function checkDns(monitor) {
  const answers = await dns.resolve(monitor.target.hostname, monitor.target.recordType);
  if (!answers || answers.length === 0) {
    return { status: "down", message: "No DNS records returned" };
  }
  return { status: "healthy", message: `${answers.length} ${monitor.target.recordType} record(s)` };
}

function checkTls(monitor) {
  assertAllowedHost(monitor.target.host);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: monitor.target.host,
      port: monitor.target.port,
      servername: monitor.target.host,
      rejectUnauthorized: false,
      timeout: 8000,
      lookup: createSafeLookup()
    });

    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate();
      socket.end();
      if (!certificate || !certificate.valid_to) {
        resolve({ status: "down", message: "No certificate returned" });
        return;
      }
      const expiresAt = new Date(certificate.valid_to);
      const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 864e5);
      if (!Number.isFinite(daysLeft) || daysLeft < 0) {
        resolve({ status: "down", message: "Certificate expired" });
        return;
      }
      if (!socket.authorized) {
        resolve({
          status: "degraded",
          message: `Certificate not trusted: ${socket.authorizationError || "unknown reason"}`
        });
        return;
      }
      if (daysLeft <= monitor.target.warningDays) {
        resolve({ status: "degraded", message: `Certificate expires in ${daysLeft}d` });
        return;
      }
      resolve({ status: "healthy", message: `Certificate valid for ${daysLeft}d` });
    });

    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("TLS connection timed out"));
    });
    socket.once("error", (error) => reject(error));
  });
}

export function summarizeState(state, now = new Date()) {
  const monitorResults = Object.values(state.results || {});
  const backupResults = state.backups.map((backup) => backupStatus(backup, now));
  const openIncidents = state.incidents.filter((incident) => !incident.resolvedAt);
  const allStatuses = [
    ...monitorResults.map((result) => result.status),
    ...backupResults.map((result) => result.status)
  ];

  const counts = {
    healthy: allStatuses.filter((status) => status === "healthy").length,
    degraded: allStatuses.filter((status) => status === "degraded").length,
    down: allStatuses.filter((status) => status === "down").length,
    unknown: state.monitors.length - monitorResults.length
  };
  const hasConfiguredChecks = state.monitors.length > 0 || state.backups.length > 0;
  const alertWebhookConfigured = Boolean(state.settings.alertWebhookEncrypted);
  const readiness = calculateReadiness({
    state,
    counts,
    hasConfiguredChecks,
    alertWebhookConfigured,
    openIncidents
  });

  return {
    overall: !hasConfiguredChecks
      ? "unknown"
      : counts.down > 0
        ? "down"
        : counts.degraded > 0 || counts.unknown > 0
          ? "degraded"
          : "healthy",
    monitors: state.monitors.length,
    backups: state.backups.length,
    counts,
    alertWebhookConfigured,
    readiness
  };
}

function calculateReadiness({
  state,
  counts,
  hasConfiguredChecks,
  alertWebhookConfigured,
  openIncidents
}) {
  const monitorResults = state.monitors
    .map((monitor) => state.results?.[monitor.id])
    .filter(Boolean);
  const uncheckedMonitors = Math.max(0, state.monitors.length - monitorResults.length);
  const monitorStatus =
    state.monitors.length === 0
      ? "unknown"
      : monitorResults.some((result) => result.status === "down")
        ? "down"
        : monitorResults.some((result) => result.status === "degraded") || uncheckedMonitors > 0
          ? "degraded"
          : "healthy";
  const backupResults = state.backups.map((backup) => backupStatus(backup));
  const restoreResults = state.backups.map((backup) => restoreTestStatus(backup));
  const backupReadinessStatus =
    state.backups.length === 0
      ? "unknown"
      : backupResults.some((result) => result.status === "down")
        ? "down"
        : backupResults.some((result) => result.status === "degraded")
          ? "degraded"
          : "healthy";
  const restoreWarnings = restoreResults.filter((result) => result.status !== "healthy").length;
  let score = hasConfiguredChecks ? 100 : 35;
  if (state.monitors.length === 0) score -= 25;
  if (state.backups.length === 0) score -= 20;
  if (!alertWebhookConfigured) score -= 10;
  score -= Math.min(counts.down * 20, 40);
  score -= Math.min(counts.degraded * 10, 30);
  score -= Math.min(counts.unknown * 8, 24);
  score -= Math.min(openIncidents.length * 8, 24);
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    label: score >= 90 ? "Ready" : score >= 70 ? "Watch" : score >= 50 ? "Risk" : "Setup needed",
    checks: [
      {
        id: "monitors",
        label: "Service monitors",
        status: monitorStatus,
        message:
          state.monitors.length === 0
            ? "No service checks configured"
            : `${state.monitors.length} monitor${state.monitors.length === 1 ? "" : "s"} configured`
      },
      {
        id: "backups",
        label: "Backup recovery",
        status: backupReadinessStatus,
        message:
          state.backups.length === 0
            ? "No backup schedules tracked"
            : restoreWarnings > 0
              ? `${restoreWarnings} restore test warning${restoreWarnings === 1 ? "" : "s"}`
              : `${state.backups.length} backup tracker${state.backups.length === 1 ? "" : "s"} active`
      },
      {
        id: "alerts",
        label: "Alert channel",
        status: alertWebhookConfigured ? "healthy" : "unknown",
        message: alertWebhookConfigured ? "Webhook configured" : "No webhook configured"
      },
      {
        id: "incidents",
        label: "Incident status",
        status: openIncidents.length > 0 ? "degraded" : "healthy",
        message:
          openIncidents.length > 0
            ? `${openIncidents.length} open incident${openIncidents.length === 1 ? "" : "s"}`
            : "No open incidents"
      }
    ]
  };
}
