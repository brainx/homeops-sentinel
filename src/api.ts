import type { AlertTestResponse, AppState, HeartbeatTokenResponse } from "./types";

const INTENT_HEADER = "x-homeops-intent";
const INTENT_VALUE = "same-origin";

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = payload.error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = String(options.method || "GET").toUpperCase();
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(method === "GET" ? {} : { [INTENT_HEADER]: INTENT_VALUE }),
      ...(options.headers || {})
    }
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(readErrorMessage(payload, `Request failed with ${response.status}`));
  }
  return payload as T;
}

export function getState() {
  return request<AppState>("/api/state");
}

export function createMonitor(body: unknown) {
  return request<AppState>("/api/monitors", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function deleteMonitor(id: string) {
  return request<AppState>(`/api/monitors/${id}`, { method: "DELETE" });
}

export function runMonitorCheck(id: string) {
  return request<AppState>(`/api/monitors/${id}/check`, { method: "POST", body: "{}" });
}

export function runAllMonitorChecks() {
  return request<AppState>("/api/monitors/check-all", { method: "POST", body: "{}" });
}

export function createBackup(body: unknown) {
  return request<AppState>("/api/backups", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateBackup(id: string, body: unknown) {
  return request<AppState>(`/api/backups/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function markBackupSuccess(id: string) {
  return request<AppState>(`/api/backups/${id}/mark-success`, { method: "POST", body: "{}" });
}

export function rotateBackupHeartbeat(id: string) {
  return request<HeartbeatTokenResponse>(`/api/backups/${id}/heartbeat-token`, {
    method: "POST",
    body: "{}"
  });
}

export function deleteBackup(id: string) {
  return request<AppState>(`/api/backups/${id}`, { method: "DELETE" });
}

export function createIncident(body: unknown) {
  return request<AppState>("/api/incidents", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

export function updateIncident(id: string, body: unknown) {
  return request<AppState>(`/api/incidents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function updateSettings(body: unknown) {
  return request<AppState>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(body)
  });
}

export function sendTestAlert() {
  return request<AlertTestResponse>("/api/alerts/test", {
    method: "POST",
    body: "{}"
  });
}
