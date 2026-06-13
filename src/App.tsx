import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Copy,
  DatabaseBackup,
  Gauge,
  HardDrive,
  Home,
  KeyRound,
  ListChecks,
  Loader2,
  LockKeyhole,
  NotebookPen,
  Play,
  Plus,
  RefreshCw,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  WifiOff,
  XCircle
} from "lucide-react";
import type {
  AppState,
  Backup,
  HealthStatus,
  HeartbeatTokenResponse,
  Monitor,
  MonitorType,
  RestoreTestResult
} from "./types";
import {
  createBackup,
  createIncident,
  createMonitor,
  deleteBackup,
  deleteMonitor,
  getState,
  markBackupSuccess,
  rotateBackupHeartbeat,
  runAllMonitorChecks,
  runMonitorCheck,
  sendTestAlert,
  updateBackup,
  updateIncident,
  updateSettings
} from "./api";

const navItems = [
  { id: "dashboard", label: "Dashboard", icon: Home },
  { id: "monitors", label: "Monitors", icon: ListChecks },
  { id: "backups", label: "Backups", icon: DatabaseBackup },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "incidents", label: "Incidents", icon: NotebookPen },
  { id: "settings", label: "Settings", icon: Settings }
] as const;

type ActiveView = (typeof navItems)[number]["id"];

const statusCopy: Record<HealthStatus, string> = {
  healthy: "Healthy",
  degraded: "Needs attention",
  down: "Down",
  unknown: "Waiting"
};

const typeLabels: Record<MonitorType, string> = {
  http: "HTTP",
  tcp: "TCP",
  dns: "DNS",
  tls: "TLS"
};

const defaultState: AppState = {
  app: { name: "HomeOps Sentinel", version: "0.1.0" },
  settings: {
    checkIntervalSeconds: 300,
    notifyOnRecovery: true,
    alertWebhook: { configured: false, label: "Not configured" }
  },
  monitors: [],
  backups: [],
  incidents: [],
  results: {},
  alertEvents: [],
  summary: {
    overall: "unknown",
    monitors: 0,
    backups: 0,
    counts: { healthy: 0, degraded: 0, down: 0, unknown: 0 },
    alertWebhookConfigured: false,
    readiness: {
      score: 0,
      label: "Setup needed",
      checks: []
    }
  }
};

export function App() {
  const [state, setState] = useState<AppState>(defaultState);
  const [activeView, setActiveView] = useState<ActiveView>("dashboard");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  async function refresh(silent = false) {
    try {
      if (!silent) setLoading(true);
      setState(await getState());
      setLastRefreshedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load application state");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function runAction<T>(action: () => Promise<T>, success: string, id?: string) {
    try {
      setBusyId(id || "global");
      const next = await action();
      if (isAppState(next)) {
        setState(next);
        setLastRefreshedAt(new Date());
      }
      setNotice(success);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(true), 8000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openIncidents = state.incidents.filter((incident) => !incident.resolvedAt);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="App navigation">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={22} />
          </div>
          <div>
            <strong>HomeOps</strong>
            <span>Sentinel</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activeView === item.id ? "nav-item active" : "nav-item"}
                aria-current={activeView === item.id ? "page" : undefined}
                aria-label={item.label}
                aria-pressed={activeView === item.id}
                onClick={() => setActiveView(item.id)}
                type="button"
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="sidebar-status">
          <StatusDot status={state.summary.overall} />
          <div>
            <span>Current posture</span>
            <strong>{statusCopy[state.summary.overall]}</strong>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <h1>{state.app.name}</h1>
            <p>Private readiness checks for the services, backups, and domains you run at home.</p>
          </div>
          <div className="top-actions">
            <div className="top-metric">
              <Gauge size={16} />
              <span>{state.summary.readiness.score} readiness</span>
            </div>
            <div className="top-metric">
              <Activity size={16} />
              <span>{state.summary.monitors} monitors</span>
            </div>
            <div className="top-metric">
              <DatabaseBackup size={16} />
              <span>{state.summary.backups} backups</span>
            </div>
            <div className={openIncidents.length > 0 ? "top-metric warn" : "top-metric"}>
              <AlertTriangle size={16} />
              <span>{openIncidents.length} open incidents</span>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="loading-block">
            <Loader2 className="spin" size={24} />
            <span>Loading dashboard</span>
          </div>
        ) : (
          <>
            {(error || notice) && (
              <div
                className={error ? "message error" : "message success"}
                role={error ? "alert" : "status"}
                aria-live={error ? "assertive" : "polite"}
              >
                {error || notice}
              </div>
            )}

            {activeView === "dashboard" && (
              <Dashboard
                state={state}
                busyId={busyId}
                runAction={runAction}
                setActiveView={setActiveView}
                lastRefreshedAt={lastRefreshedAt}
              />
            )}
            {activeView === "monitors" && (
              <MonitorsView state={state} busyId={busyId} runAction={runAction} />
            )}
            {activeView === "backups" && (
              <BackupsView state={state} busyId={busyId} runAction={runAction} />
            )}
            {activeView === "alerts" && (
              <AlertsView state={state} busyId={busyId} runAction={runAction} />
            )}
            {activeView === "incidents" && (
              <IncidentsView state={state} busyId={busyId} runAction={runAction} />
            )}
            {activeView === "settings" && (
              <SettingsView state={state} busyId={busyId} runAction={runAction} />
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Dashboard({
  state,
  busyId,
  runAction,
  setActiveView,
  lastRefreshedAt
}: {
  state: AppState;
  busyId: string | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
  setActiveView: (view: ActiveView) => void;
  lastRefreshedAt: Date | null;
}) {
  const latestChecks = state.monitors.slice(0, 4);
  return (
    <div className="dashboard-grid">
      <section className="summary-grid">
        <SummaryCard
          title="Healthy"
          value={state.summary.counts.healthy}
          status="healthy"
          icon={<CheckCircle2 size={20} />}
        />
        <SummaryCard
          title="Attention"
          value={state.summary.counts.degraded}
          status="degraded"
          icon={<AlertTriangle size={20} />}
        />
        <SummaryCard
          title="Down"
          value={state.summary.counts.down}
          status="down"
          icon={<WifiOff size={20} />}
        />
        <SummaryCard
          title="Waiting"
          value={state.summary.counts.unknown}
          status="unknown"
          icon={<Clock3 size={20} />}
        />
      </section>

      <ReadinessPanel state={state} setActiveView={setActiveView} />

      <DashboardActionStrip
        state={state}
        busyId={busyId}
        lastRefreshedAt={lastRefreshedAt}
        runAction={runAction}
        setActiveView={setActiveView}
      />

      <section className="panel monitor-panel">
        <PanelHeader
          title="Service checks"
          actionLabel="New monitor"
          onAction={() => setActiveView("monitors")}
          icon={<Plus size={16} />}
        />
        {state.monitors.length === 0 ? (
          <EmptyState
            icon={<Server size={28} />}
            title="No monitors yet"
            body="Add an HTTP, TCP, DNS, or TLS check to start tracking your Umbrel services."
            action="Add monitor"
            onAction={() => setActiveView("monitors")}
          />
        ) : (
          <div className="service-cards">
            {latestChecks.map((monitor) => (
              <MonitorCard
                key={monitor.id}
                monitor={monitor}
                result={state.results[monitor.id]}
                busy={busyId === monitor.id}
                onCheck={() =>
                  runAction(
                    () => runMonitorCheck(monitor.id),
                    "Monitor check completed",
                    monitor.id
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      <aside className="right-rail" aria-label="Dashboard details">
        <section className="panel">
          <PanelHeader title="Alert channel" />
          <div className="rail-status">
            <StatusDot status={state.settings.alertWebhook.configured ? "healthy" : "unknown"} />
            <div>
              <strong>
                {state.settings.alertWebhook.configured ? "Webhook connected" : "No webhook"}
              </strong>
              <span>{state.settings.alertWebhook.label}</span>
            </div>
          </div>
          <button
            className="secondary-button wide"
            type="button"
            onClick={() => setActiveView("alerts")}
          >
            <Bell size={16} />
            Configure alerts
          </button>
        </section>

        <section className="panel">
          <PanelHeader title="Backup recovery" />
          {state.backups.length === 0 ? (
            <MiniEmpty body="Track backup schedules and record successful runs." />
          ) : (
            <div className="backup-stack">
              {state.backups.slice(0, 3).map((backup) => (
                <div className="backup-row" key={backup.id}>
                  <StatusDot status={backup.health.status} />
                  <div>
                    <strong>{backup.name}</strong>
                    <span>{backup.health.message}</span>
                    <span>{backup.restoreTest.health.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <PanelHeader title="Incident log" />
          {state.incidents.length === 0 ? (
            <MiniEmpty body="Capture operational notes when something changes." />
          ) : (
            <div className="incident-stack">
              {state.incidents.slice(0, 4).map((incident) => (
                <div className="incident-row" key={incident.id}>
                  <span className={`severity ${incident.severity}`}>{incident.severity}</span>
                  <strong>{incident.title}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>

      <section className="panel table-panel">
        <PanelHeader title="All monitors" />
        <MonitorTable state={state} busyId={busyId} runAction={runAction} />
      </section>
    </div>
  );
}

function ReadinessPanel({
  state,
  setActiveView
}: {
  state: AppState;
  setActiveView: (view: ActiveView) => void;
}) {
  const needsSetup =
    state.summary.monitors === 0 ||
    state.summary.backups === 0 ||
    !state.summary.alertWebhookConfigured;

  return (
    <section className="panel readiness-panel">
      <div className="readiness-layout">
        <div className="readiness-score">
          <div className={`score-ring ${state.summary.overall}`}>
            <strong>{state.summary.readiness.score}</strong>
            <span>/100</span>
          </div>
          <div>
            <h2>{state.summary.readiness.label}</h2>
            <p>
              Readiness reflects service checks, backup freshness, restore tests, alerting, and open
              incidents.
            </p>
          </div>
        </div>
        <div className="readiness-checks">
          {state.summary.readiness.checks.map((check) => (
            <div className="readiness-check" key={check.id}>
              <StatusDot status={check.status} />
              <div>
                <strong>{check.label}</strong>
                <span>{check.message}</span>
              </div>
            </div>
          ))}
        </div>
        {needsSetup && <SetupChecklist state={state} setActiveView={setActiveView} />}
      </div>
    </section>
  );
}

function SetupChecklist({
  state,
  setActiveView
}: {
  state: AppState;
  setActiveView: (view: ActiveView) => void;
}) {
  const steps = [
    {
      id: "monitor",
      label: "Add first monitor",
      done: state.summary.monitors > 0,
      view: "monitors" as ActiveView,
      icon: <ListChecks size={16} />
    },
    {
      id: "backup",
      label: "Track first backup",
      done: state.summary.backups > 0,
      view: "backups" as ActiveView,
      icon: <DatabaseBackup size={16} />
    },
    {
      id: "alerts",
      label: "Connect alert channel",
      done: state.summary.alertWebhookConfigured,
      view: "alerts" as ActiveView,
      icon: <Bell size={16} />
    }
  ];
  const nextStep = steps.find((step) => !step.done) || steps[0];

  return (
    <div className="setup-checklist" aria-label="First-run setup checklist">
      {steps.map((step) => (
        <button
          className={step.done ? "setup-step done" : "setup-step"}
          key={step.id}
          type="button"
          onClick={() => setActiveView(step.view)}
        >
          {step.done ? <CheckCircle2 size={16} /> : step.icon}
          <span>{step.label}</span>
        </button>
      ))}
      <button className="primary-button" type="button" onClick={() => setActiveView(nextStep.view)}>
        {nextStep.icon}
        Start next step
      </button>
    </div>
  );
}

function DashboardActionStrip({
  state,
  busyId,
  lastRefreshedAt,
  runAction,
  setActiveView
}: {
  state: AppState;
  busyId: string | null;
  lastRefreshedAt: Date | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
  setActiveView: (view: ActiveView) => void;
}) {
  return (
    <section className="panel action-strip">
      <div>
        <span>Last refreshed</span>
        <strong>{lastRefreshedAt ? formatTime(lastRefreshedAt) : "Waiting"}</strong>
      </div>
      <div className="action-buttons">
        <button
          className="secondary-button"
          type="button"
          disabled={state.monitors.length === 0 || busyId === "check-all"}
          onClick={() =>
            runAction(() => runAllMonitorChecks(), "All monitor checks completed", "check-all")
          }
        >
          {busyId === "check-all" ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          Run all checks
        </button>
        <button className="secondary-button" type="button" onClick={() => setActiveView("backups")}>
          <CheckCircle2 size={16} />
          Record backup
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setActiveView("incidents")}
        >
          <NotebookPen size={16} />
          Open incident
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={!state.settings.alertWebhook.configured || busyId === "dashboard-alert-test"}
          onClick={() =>
            runAction(
              async () => {
                const response = await sendTestAlert();
                return response.state;
              },
              "Alert test completed",
              "dashboard-alert-test"
            )
          }
        >
          {busyId === "dashboard-alert-test" ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <Send size={16} />
          )}
          Test alert
        </button>
      </div>
    </section>
  );
}

function MonitorsView({
  state,
  busyId,
  runAction
}: {
  state: AppState;
  busyId: string | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
}) {
  return (
    <div className="content-stack">
      <section className="panel">
        <PanelHeader title="Create monitor" />
        <MonitorForm onSubmit={(body) => runAction(() => createMonitor(body), "Monitor created")} />
      </section>
      <section className="panel">
        <PanelHeader title="Monitor inventory" />
        <MonitorTable state={state} busyId={busyId} runAction={runAction} />
      </section>
    </div>
  );
}

function BackupsView({
  state,
  busyId,
  runAction
}: {
  state: AppState;
  busyId: string | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [scheduleHours, setScheduleHours] = useState(24);
  const [restoreTestIntervalDays, setRestoreTestIntervalDays] = useState(90);
  const [notes, setNotes] = useState("");
  const [heartbeatSecret, setHeartbeatSecret] = useState<HeartbeatTokenResponse | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    return runAction(
      () =>
        createBackup({
          name,
          scheduleHours,
          notes,
          restoreTest: { intervalDays: restoreTestIntervalDays }
        }),
      "Backup tracker created"
    ).then(() => {
      setName("");
      setNotes("");
      setScheduleHours(24);
      setRestoreTestIntervalDays(90);
    });
  }

  function rotateHeartbeat(id: string) {
    const backup = state.backups.find((item) => item.id === id);
    if (
      backup?.heartbeat.configured &&
      !window.confirm(
        `Rotate the heartbeat token for ${backup.name}? Existing jobs using the old token will stop updating this backup.`
      )
    ) {
      return Promise.resolve();
    }
    return runAction(
      async () => {
        const response = await rotateBackupHeartbeat(id);
        setHeartbeatSecret(response);
        return response.state;
      },
      "Heartbeat token ready",
      id
    );
  }

  return (
    <div className="content-stack">
      <section className="panel">
        <PanelHeader title="Backup tracker" />
        <form className="form-grid" onSubmit={submit}>
          <label>
            <span>Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={80}
            />
          </label>
          <label>
            <span>Expected interval in hours</span>
            <input
              type="number"
              min={1}
              max={2160}
              value={scheduleHours}
              onChange={(event) => setScheduleHours(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Restore test cadence in days</span>
            <input
              type="number"
              min={1}
              max={365}
              value={restoreTestIntervalDays}
              onChange={(event) => setRestoreTestIntervalDays(Number(event.target.value))}
            />
          </label>
          <label className="wide-field">
            <span>Notes</span>
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={400}
            />
          </label>
          <button className="primary-button" type="submit" disabled={busyId === "global"}>
            <Plus size={16} />
            Add backup
          </button>
        </form>
      </section>

      <section className="panel">
        <PanelHeader title="Backup recovery" />
        {state.backups.length === 0 ? (
          <EmptyState
            icon={<HardDrive size={28} />}
            title="No backup trackers"
            body="Add the schedules you rely on, then record successful runs and periodic restore tests."
          />
        ) : (
          <div className="backup-list">
            {heartbeatSecret && <HeartbeatTokenPanel secret={heartbeatSecret} />}
            {state.backups.map((backup) => (
              <BackupCard
                key={backup.id}
                backup={backup}
                busy={busyId === backup.id}
                onMarkSuccess={() =>
                  runAction(
                    () => markBackupSuccess(backup.id),
                    "Backup success recorded",
                    backup.id
                  )
                }
                onRotateHeartbeat={() => rotateHeartbeat(backup.id)}
                onRecordRestoreTest={(restoreTest) =>
                  runAction(
                    () => updateBackup(backup.id, { restoreTest }),
                    "Restore test recorded",
                    backup.id
                  )
                }
                onDelete={() => {
                  if (window.confirm(`Delete backup tracker "${backup.name}"?`)) {
                    void runAction(
                      () => deleteBackup(backup.id),
                      "Backup tracker deleted",
                      backup.id
                    );
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BackupCard({
  backup,
  busy,
  onMarkSuccess,
  onRotateHeartbeat,
  onRecordRestoreTest,
  onDelete
}: {
  backup: Backup;
  busy: boolean;
  onMarkSuccess: () => void;
  onRotateHeartbeat: () => Promise<void>;
  onRecordRestoreTest: (restoreTest: {
    intervalDays: number;
    lastTestedAt: string | null;
    target: string;
    result: RestoreTestResult;
    evidence: string;
  }) => Promise<void>;
  onDelete: () => void;
}) {
  const initialResult =
    backup.restoreTest.result === "not_tested" ? "passed" : backup.restoreTest.result;
  const [expanded, setExpanded] = useState(false);
  const [lastTestedAt, setLastTestedAt] = useState(
    toDateInputValue(backup.restoreTest.lastTestedAt)
  );
  const [target, setTarget] = useState(backup.restoreTest.target);
  const [result, setResult] = useState<RestoreTestResult>(initialResult);
  const [evidence, setEvidence] = useState(backup.restoreTest.evidence);
  const [intervalDays, setIntervalDays] = useState(backup.restoreTest.intervalDays);

  useEffect(() => {
    setLastTestedAt(toDateInputValue(backup.restoreTest.lastTestedAt));
    setTarget(backup.restoreTest.target);
    setResult(backup.restoreTest.result === "not_tested" ? "passed" : backup.restoreTest.result);
    setEvidence(backup.restoreTest.evidence);
    setIntervalDays(backup.restoreTest.intervalDays);
  }, [backup.id, backup.restoreTest]);

  function submitRestoreTest(event: React.FormEvent) {
    event.preventDefault();
    return onRecordRestoreTest({
      intervalDays,
      lastTestedAt: lastTestedAt || null,
      target,
      result,
      evidence
    }).then(() => setExpanded(false));
  }

  return (
    <article className="backup-card">
      <StatusDot status={backup.health.status} />
      <div className="backup-card-body">
        <div className="backup-title-row">
          <strong>{backup.name}</strong>
          <StatusPill status={backup.restoreTest.health.status} />
        </div>
        <span>{backup.health.message}</span>
        <span>{backup.restoreTest.health.message}</span>
        {backup.restoreTest.lastTestedAt && (
          <span>
            Restore target {backup.restoreTest.target},{" "}
            {backup.restoreTest.result.replace("_", " ")} on{" "}
            {formatDate(backup.restoreTest.lastTestedAt)}
          </span>
        )}
        <span>
          Heartbeat {backup.heartbeat.configured ? backup.heartbeat.label : "not configured"}
          {backup.heartbeat.lastUsedAt
            ? `, last used ${formatDate(backup.heartbeat.lastUsedAt)}`
            : ""}
        </span>
        {backup.restoreTest.evidence && <p>{backup.restoreTest.evidence}</p>}
        {backup.notes && <p>{backup.notes}</p>}
      </div>
      <div className="row-actions">
        <button
          className="icon-button"
          type="button"
          aria-label={`Mark ${backup.name} successful`}
          onClick={onMarkSuccess}
          disabled={busy}
        >
          <CheckCircle2 size={16} />
        </button>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setExpanded((value) => !value)}
          disabled={busy}
        >
          <CheckCircle2 size={16} />
          Restore test
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label={`${backup.heartbeat.configured ? "Rotate" : "Create"} heartbeat token for ${backup.name}`}
          onClick={onRotateHeartbeat}
          disabled={busy}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
        </button>
        <button
          className="icon-button danger"
          type="button"
          aria-label={`Delete ${backup.name}`}
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 size={16} />
        </button>
      </div>
      {expanded && (
        <form className="restore-test-form" onSubmit={submitRestoreTest}>
          <label>
            <span>Last restore test date</span>
            <input
              type="date"
              value={lastTestedAt}
              max={toDateInputValue(new Date().toISOString())}
              onChange={(event) => setLastTestedAt(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Restore target</span>
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              maxLength={120}
              required
            />
          </label>
          <label>
            <span>Result</span>
            <select
              value={result}
              onChange={(event) => setResult(event.target.value as RestoreTestResult)}
            >
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label>
            <span>Cadence in days</span>
            <input
              type="number"
              min={1}
              max={365}
              value={intervalDays}
              onChange={(event) => setIntervalDays(Number(event.target.value))}
            />
          </label>
          <label className="wide-label">
            <span>Evidence notes</span>
            <textarea
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              maxLength={800}
            />
          </label>
          <div className="button-row wide-label">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
              Save restore test
            </button>
            <button className="secondary-button" type="button" onClick={() => setExpanded(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function HeartbeatTokenPanel({ secret }: { secret: HeartbeatTokenResponse }) {
  const origin = window.location.origin;
  const endpoint = `${origin}${secret.endpoint}`;
  const command = `curl -fsS -X POST -H "Authorization: Bearer ${secret.token}" "${endpoint}"`;
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setCopied("Copy unavailable");
      window.setTimeout(() => setCopied(null), 2400);
    }
  }

  return (
    <article className="token-reveal">
      <div className="token-heading">
        <KeyRound size={18} />
        <div>
          <strong>Heartbeat token</strong>
          <span>{copied || "Store it now. It will not be shown again after refresh."}</span>
        </div>
      </div>
      <label>
        <span>Endpoint</span>
        <div className="copy-field">
          <input value={endpoint} readOnly />
          <button
            className="icon-button"
            type="button"
            aria-label="Copy heartbeat endpoint"
            onClick={() => copy("Endpoint copied", endpoint)}
          >
            <Copy size={16} />
          </button>
        </div>
      </label>
      <label>
        <span>Bearer token</span>
        <div className="copy-field">
          <input value={secret.token} readOnly />
          <button
            className="icon-button"
            type="button"
            aria-label="Copy heartbeat token"
            onClick={() => copy("Token copied", secret.token)}
          >
            <Copy size={16} />
          </button>
        </div>
      </label>
      <label className="wide-label">
        <span>Shell command</span>
        <div className="copy-field">
          <input value={command} readOnly />
          <button
            className="icon-button"
            type="button"
            aria-label="Copy heartbeat command"
            onClick={() => copy("Command copied", command)}
          >
            <Copy size={16} />
          </button>
        </div>
      </label>
    </article>
  );
}

function AlertsView({
  state,
  busyId,
  runAction
}: {
  state: AppState;
  busyId: string | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
}) {
  const [webhookUrl, setWebhookUrl] = useState("");
  const [notifyOnRecovery, setNotifyOnRecovery] = useState(state.settings.notifyOnRecovery);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    return runAction(
      () => updateSettings({ webhookUrl, notifyOnRecovery }),
      "Alert settings saved"
    ).then(() => setWebhookUrl(""));
  }

  function testAlert() {
    return runAction(
      async () => {
        const response = await sendTestAlert();
        return response.state;
      },
      "Alert test completed",
      "alert-test"
    );
  }

  return (
    <div className="content-stack">
      <section className="panel">
        <PanelHeader title="Webhook alerts" />
        <form className="settings-form" onSubmit={submit}>
          <div className="secure-note">
            <LockKeyhole size={18} />
            <span>Webhook URLs are encrypted before they are written to the data volume.</span>
          </div>
          <label>
            <span>Current channel</span>
            <input value={state.settings.alertWebhook.label} disabled />
          </label>
          <label>
            <span>Webhook URL</span>
            <input
              type="url"
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
              placeholder="https://example.com/hooks/homeops"
              inputMode="url"
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={notifyOnRecovery}
              onChange={(event) => setNotifyOnRecovery(event.target.checked)}
            />
            <span>Send recovery notifications</span>
          </label>
          <div className="button-row">
            <button className="primary-button" type="submit" disabled={busyId === "global"}>
              <Bell size={16} />
              Save alerts
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={testAlert}
              disabled={!state.settings.alertWebhook.configured || busyId === "alert-test"}
            >
              {busyId === "alert-test" ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              Test alert
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                if (window.confirm("Clear the configured alert webhook?")) {
                  void runAction(() => updateSettings({ clearWebhook: true }), "Webhook cleared");
                }
              }}
            >
              <XCircle size={16} />
              Clear webhook
            </button>
          </div>
        </form>
      </section>
      <section className="panel">
        <PanelHeader title="Delivery history" />
        {state.alertEvents.length === 0 ? (
          <MiniEmpty body="No alert deliveries recorded yet." />
        ) : (
          <div className="delivery-list">
            {state.alertEvents.map((event) => (
              <article className="delivery-card" key={event.id}>
                <div className={`delivery-status ${event.deliveryStatus}`}>
                  {event.deliveryStatus === "delivered" ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <AlertTriangle size={16} />
                  )}
                </div>
                <div>
                  <strong>
                    {event.kind === "test" ? "Test alert" : event.monitorName || "Monitor alert"}
                  </strong>
                  <span>
                    {event.deliveryStatus === "delivered" ? "Delivered" : "Failed"}
                    {event.statusCode ? ` with HTTP ${event.statusCode}` : ""} at{" "}
                    {formatDate(event.createdAt)}
                  </span>
                  <p>{event.error || event.message}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function IncidentsView({
  state,
  busyId,
  runAction
}: {
  state: AppState;
  busyId: string | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [severity, setSeverity] = useState("info");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    return runAction(() => createIncident({ title, notes, severity }), "Incident recorded").then(
      () => {
        setTitle("");
        setNotes("");
        setSeverity("info");
      }
    );
  }

  return (
    <div className="content-stack">
      <section className="panel">
        <PanelHeader title="Record incident" />
        <form className="form-grid" onSubmit={submit}>
          <label>
            <span>Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={120}
            />
          </label>
          <label>
            <span>Severity</span>
            <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="wide-field">
            <span>Notes</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={2000}
            />
          </label>
          <button className="primary-button" type="submit" disabled={busyId === "global"}>
            <NotebookPen size={16} />
            Save incident
          </button>
        </form>
      </section>

      <section className="panel">
        <PanelHeader title="Incident history" />
        {state.incidents.length === 0 ? (
          <EmptyState
            icon={<NotebookPen size={28} />}
            title="No incidents recorded"
            body="Use incident notes to preserve what changed during outages, upgrades, and backup recoveries."
          />
        ) : (
          <div className="incident-list">
            {state.incidents.map((incident) => (
              <article
                className={incident.resolvedAt ? "incident-card resolved" : "incident-card"}
                key={incident.id}
              >
                <span className={`severity ${incident.severity}`}>{incident.severity}</span>
                <div>
                  <strong>{incident.title}</strong>
                  {incident.notes && <p>{incident.notes}</p>}
                  <span>{formatDate(incident.createdAt)}</span>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyId === incident.id}
                  onClick={() =>
                    runAction(
                      () => updateIncident(incident.id, { resolved: !incident.resolvedAt }),
                      incident.resolvedAt ? "Incident reopened" : "Incident resolved",
                      incident.id
                    )
                  }
                >
                  <CheckCircle2 size={16} />
                  {incident.resolvedAt ? "Reopen" : "Resolve"}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SettingsView({
  state,
  busyId,
  runAction
}: {
  state: AppState;
  busyId: string | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
}) {
  const [checkIntervalSeconds, setCheckIntervalSeconds] = useState(
    state.settings.checkIntervalSeconds
  );

  return (
    <div className="content-stack">
      <section className="panel">
        <PanelHeader title="Runtime settings" />
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            void runAction(() => updateSettings({ checkIntervalSeconds }), "Settings saved");
          }}
        >
          <label>
            <span>Default check interval in seconds</span>
            <input
              type="number"
              min={60}
              max={86400}
              value={checkIntervalSeconds}
              onChange={(event) => setCheckIntervalSeconds(Number(event.target.value))}
            />
          </label>
          <button className="primary-button" type="submit" disabled={busyId === "global"}>
            <Settings size={16} />
            Save settings
          </button>
        </form>
      </section>
      <section className="panel two-column-note">
        <div>
          <h2>App-store posture</h2>
          <p>
            The container runs without Docker socket access, stores state only under the mounted
            data volume, and relies on Umbrel's app proxy for the user-facing authentication
            boundary.
          </p>
        </div>
        <div>
          <h2>Version</h2>
          <p>{state.app.version}</p>
        </div>
      </section>
    </div>
  );
}

function MonitorForm({ onSubmit }: { onSubmit: (body: unknown) => Promise<void> }) {
  const [type, setType] = useState<MonitorType>("http");
  const [name, setName] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(300);
  const [url, setUrl] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(443);
  const [hostname, setHostname] = useState("");
  const [recordType, setRecordType] = useState("A");
  const [warningDays, setWarningDays] = useState(21);

  const targetFields = useMemo(() => {
    if (type === "http") {
      return (
        <label className="wide-field">
          <span>URL</span>
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
            inputMode="url"
          />
        </label>
      );
    }
    if (type === "tcp") {
      return (
        <>
          <label>
            <span>Host</span>
            <input value={host} onChange={(event) => setHost(event.target.value)} required />
          </label>
          <label>
            <span>Port</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => setPort(Number(event.target.value))}
            />
          </label>
        </>
      );
    }
    if (type === "dns") {
      return (
        <>
          <label>
            <span>Hostname</span>
            <input
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Record</span>
            <select value={recordType} onChange={(event) => setRecordType(event.target.value)}>
              <option>A</option>
              <option>AAAA</option>
              <option>CNAME</option>
              <option>MX</option>
              <option>TXT</option>
            </select>
          </label>
        </>
      );
    }
    return (
      <>
        <label>
          <span>Host</span>
          <input value={host} onChange={(event) => setHost(event.target.value)} required />
        </label>
        <label>
          <span>Port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(Number(event.target.value))}
          />
        </label>
        <label>
          <span>Warning days</span>
          <input
            type="number"
            min={1}
            max={90}
            value={warningDays}
            onChange={(event) => setWarningDays(Number(event.target.value))}
          />
        </label>
      </>
    );
  }, [type, url, host, port, hostname, recordType, warningDays]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const target =
      type === "http"
        ? { url }
        : type === "tcp"
          ? { host, port }
          : type === "dns"
            ? { hostname, recordType }
            : { host, port, warningDays };
    return onSubmit({ name, type, intervalSeconds, target }).then(() => {
      setName("");
      setUrl("");
      setHost("");
      setHostname("");
    });
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        <span>Name</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
        />
      </label>
      <label>
        <span>Type</span>
        <select value={type} onChange={(event) => setType(event.target.value as MonitorType)}>
          <option value="http">HTTP</option>
          <option value="tcp">TCP</option>
          <option value="dns">DNS</option>
          <option value="tls">TLS</option>
        </select>
      </label>
      <label>
        <span>Interval in seconds</span>
        <input
          type="number"
          min={30}
          max={86400}
          value={intervalSeconds}
          onChange={(event) => setIntervalSeconds(Number(event.target.value))}
        />
      </label>
      {targetFields}
      <button className="primary-button" type="submit">
        <Plus size={16} />
        Create monitor
      </button>
    </form>
  );
}

function MonitorTable({
  state,
  busyId,
  runAction
}: {
  state: AppState;
  busyId: string | null;
  runAction: <T>(action: () => Promise<T>, success: string, id?: string) => Promise<void>;
}) {
  if (state.monitors.length === 0) {
    return <MiniEmpty body="No monitor rows yet. Create one from the Monitors view." />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Type</th>
            <th>Target</th>
            <th>Last check</th>
            <th>Latency</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {state.monitors.map((monitor) => {
            const result = state.results[monitor.id];
            const status = result?.status || "unknown";
            return (
              <tr key={monitor.id}>
                <td>
                  <StatusPill status={status} />
                </td>
                <td>{monitor.name}</td>
                <td>{typeLabels[monitor.type]}</td>
                <td className="target-cell" title={targetSummary(monitor)}>
                  {targetSummary(monitor)}
                </td>
                <td>{result ? formatDate(result.checkedAt) : "Not checked"}</td>
                <td>{result ? `${result.latencyMs}ms` : "n/a"}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Run ${monitor.name}`}
                      disabled={busyId === monitor.id}
                      onClick={() =>
                        runAction(
                          () => runMonitorCheck(monitor.id),
                          "Monitor check completed",
                          monitor.id
                        )
                      }
                    >
                      {busyId === monitor.id ? (
                        <Loader2 className="spin" size={16} />
                      ) : (
                        <Play size={16} />
                      )}
                    </button>
                    <button
                      className="icon-button danger"
                      type="button"
                      aria-label={`Delete ${monitor.name}`}
                      disabled={busyId === monitor.id}
                      onClick={() => {
                        if (window.confirm(`Delete monitor "${monitor.name}"?`)) {
                          void runAction(
                            () => deleteMonitor(monitor.id),
                            "Monitor deleted",
                            monitor.id
                          );
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonitorCard({
  monitor,
  result,
  busy,
  onCheck
}: {
  monitor: Monitor;
  result: AppState["results"][string] | undefined;
  busy: boolean;
  onCheck: () => void;
}) {
  const status = result?.status || "unknown";
  return (
    <article className={`service-card ${status}`}>
      <div className="card-topline">
        <StatusDot status={status} />
        <span>{typeLabels[monitor.type]}</span>
      </div>
      <h3>{monitor.name}</h3>
      <p>{targetSummary(monitor)}</p>
      <footer>
        <span>{result?.message || "Waiting for first check"}</span>
        <button
          className="icon-button"
          type="button"
          onClick={onCheck}
          disabled={busy}
          aria-label={`Run ${monitor.name}`}
        >
          {busy ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
        </button>
      </footer>
    </article>
  );
}

function SummaryCard({
  title,
  value,
  status,
  icon
}: {
  title: string;
  value: number;
  status: HealthStatus;
  icon: React.ReactNode;
}) {
  return (
    <article className={`summary-card ${status}`}>
      <div>{icon}</div>
      <span>{title}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PanelHeader({
  title,
  actionLabel,
  onAction,
  icon
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {actionLabel && onAction && (
        <button className="secondary-button" type="button" onClick={onAction}>
          {icon}
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
  onAction
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action && onAction && (
        <button className="primary-button" type="button" onClick={onAction}>
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  );
}

function MiniEmpty({ body }: { body: string }) {
  return <p className="mini-empty">{body}</p>;
}

function StatusDot({ status }: { status: HealthStatus }) {
  return <span className={`status-dot ${status}`} role="img" aria-label={statusCopy[status]} />;
}

function StatusPill({ status }: { status: HealthStatus }) {
  return (
    <span className={`status-pill ${status}`}>
      <StatusDot status={status} />
      {statusCopy[status]}
    </span>
  );
}

function targetSummary(monitor: Monitor) {
  if (monitor.type === "http" && "url" in monitor.target) return monitor.target.url;
  if (monitor.type === "dns" && "hostname" in monitor.target) {
    return `${monitor.target.recordType} ${monitor.target.hostname}`;
  }
  if ("host" in monitor.target && "port" in monitor.target) {
    return `${monitor.target.host}:${monitor.target.port}`;
  }
  return "Configured target";
}

function toDateInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}

function isAppState(value: unknown): value is AppState {
  return Boolean(value && typeof value === "object" && "summary" in value);
}
