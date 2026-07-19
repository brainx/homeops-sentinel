export const MONITOR_HISTORY_LIMIT = 720;
export const PUBLIC_MONITOR_HISTORY_LIMIT = 48;

const HEALTH_STATUSES = new Set(["healthy", "degraded", "down", "unknown"]);

function normalizeHistoryResult(input) {
  if (!input || typeof input !== "object" || !HEALTH_STATUSES.has(input.status)) return null;

  const checkedAt = new Date(input.checkedAt);
  if (!Number.isFinite(checkedAt.getTime())) return null;

  const latencyMs = Number(input.latencyMs);
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return null;

  return {
    status: input.status,
    message: typeof input.message === "string" ? input.message.slice(0, 500) : "Check completed",
    latencyMs: Math.round(latencyMs),
    checkedAt: checkedAt.toISOString()
  };
}

export function normalizeMonitorHistory(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const normalized = {};
  for (const [monitorId, entries] of Object.entries(input)) {
    if (!Array.isArray(entries)) continue;
    const history = entries
      .map(normalizeHistoryResult)
      .filter(Boolean)
      .sort((left, right) => left.checkedAt.localeCompare(right.checkedAt))
      .slice(-MONITOR_HISTORY_LIMIT);
    if (history.length > 0) normalized[monitorId] = history;
  }
  return normalized;
}

export function recordMonitorResult(state, monitorId, result) {
  const normalized = normalizeHistoryResult(result);
  if (!normalized) throw new Error("Monitor result is invalid");

  state.results[monitorId] = normalized;
  state.monitorHistory ||= {};
  state.monitorHistory[monitorId] = [
    ...(Array.isArray(state.monitorHistory[monitorId]) ? state.monitorHistory[monitorId] : []),
    normalized
  ].slice(-MONITOR_HISTORY_LIMIT);
  return normalized;
}

export function summarizeMonitorHistory(history) {
  const entries = Array.isArray(history) ? history.map(normalizeHistoryResult).filter(Boolean) : [];
  if (entries.length === 0) {
    return {
      totalChecks: 0,
      healthyChecks: 0,
      availabilityPercent: null,
      averageLatencyMs: null,
      lastFailureAt: null
    };
  }

  const healthyChecks = entries.filter((entry) => entry.status === "healthy").length;
  const latencyTotal = entries.reduce((sum, entry) => sum + entry.latencyMs, 0);
  const lastFailure = entries.findLast((entry) => entry.status !== "healthy");

  return {
    totalChecks: entries.length,
    healthyChecks,
    availabilityPercent: Math.round((healthyChecks / entries.length) * 1000) / 10,
    averageLatencyMs: Math.round(latencyTotal / entries.length),
    lastFailureAt: lastFailure?.checkedAt || null
  };
}

export function publicMonitorHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-PUBLIC_MONITOR_HISTORY_LIMIT);
}
