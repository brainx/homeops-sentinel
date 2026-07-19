export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";
export type MonitorType = "http" | "tcp" | "dns" | "tls";
export type RestoreTestResult = "not_tested" | "passed" | "failed";

export interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  intervalSeconds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  target:
    | { url: string }
    | { host: string; port: number }
    | { hostname: string; recordType: string }
    | { host: string; port: number; warningDays: number };
}

export interface MonitorResult {
  status: HealthStatus;
  message: string;
  latencyMs: number;
  checkedAt: string;
}

export interface MonitorMetrics {
  totalChecks: number;
  healthyChecks: number;
  availabilityPercent: number | null;
  averageLatencyMs: number | null;
  lastFailureAt: string | null;
}

export interface Backup {
  id: string;
  name: string;
  scheduleHours: number;
  lastSuccessAt: string | null;
  notes: string;
  restoreTest: {
    intervalDays: number;
    lastTestedAt: string | null;
    target: string;
    result: RestoreTestResult;
    evidence: string;
    health: {
      status: HealthStatus;
      message: string;
      overdue: boolean;
      dueAt: string | null;
    };
  };
  createdAt: string;
  updatedAt: string;
  heartbeat: {
    configured: boolean;
    label: string;
    createdAt: string | null;
    lastUsedAt: string | null;
  };
  health: {
    status: HealthStatus;
    message: string;
  };
}

export interface Incident {
  id: string;
  title: string;
  notes: string;
  severity: "info" | "warning" | "critical";
  createdAt: string;
  resolvedAt: string | null;
}

export interface AlertEvent {
  id: string;
  kind: "monitor" | "test";
  deliveryStatus: "delivered" | "failed";
  createdAt: string;
  monitorId: string | null;
  monitorName: string | null;
  monitorStatus: HealthStatus | null;
  message: string;
  statusCode: number | null;
  error: string | null;
}

export interface AppState {
  app: {
    name: string;
    version: string;
  };
  settings: {
    checkIntervalSeconds: number;
    notifyOnRecovery: boolean;
    alertWebhook: {
      configured: boolean;
      label: string;
    };
  };
  monitors: Monitor[];
  backups: Backup[];
  incidents: Incident[];
  results: Record<string, MonitorResult>;
  monitorHistory: Record<string, MonitorResult[]>;
  monitorMetrics: Record<string, MonitorMetrics>;
  alertEvents: AlertEvent[];
  summary: {
    overall: HealthStatus;
    monitors: number;
    enabledMonitors: number;
    pausedMonitors: number;
    backups: number;
    counts: {
      healthy: number;
      degraded: number;
      down: number;
      unknown: number;
    };
    alertWebhookConfigured: boolean;
    readiness: {
      score: number;
      label: string;
      checks: Array<{
        id: string;
        label: string;
        status: HealthStatus;
        message: string;
      }>;
    };
  };
}

export interface HeartbeatTokenResponse {
  state: AppState;
  token: string;
  endpoint: string;
  createdAt: string;
}

export interface AlertTestResponse {
  state: AppState;
  delivery: AlertEvent;
}
