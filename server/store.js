import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const DEFAULT_STATE = Object.freeze({
  schemaVersion: 1,
  settings: {
    checkIntervalSeconds: 300,
    notifyOnRecovery: true,
    alertWebhookEncrypted: null
  },
  monitors: [],
  backups: [],
  incidents: [],
  results: {},
  alertLedger: {},
  alertEvents: []
});

const CURRENT_SCHEMA_VERSION = 1;

export function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function normalizeState(input) {
  const state = {
    ...cloneDefaultState(),
    ...(input && typeof input === "object" ? input : {})
  };

  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  state.settings = {
    ...cloneDefaultState().settings,
    ...(state.settings && typeof state.settings === "object" ? state.settings : {})
  };
  state.monitors = Array.isArray(state.monitors) ? state.monitors : [];
  state.backups = Array.isArray(state.backups) ? state.backups : [];
  state.incidents = Array.isArray(state.incidents) ? state.incidents : [];
  state.results = state.results && typeof state.results === "object" ? state.results : {};
  state.alertLedger =
    state.alertLedger && typeof state.alertLedger === "object" ? state.alertLedger : {};
  state.alertEvents = Array.isArray(state.alertEvents) ? state.alertEvents.slice(0, 100) : [];
  return state;
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
    this.lastRecovery = null;
  }

  async ensure() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      await fs.access(this.filePath);
    } catch {
      await this.write(cloneDefaultState());
    }
  }

  async read() {
    await this.ensure();
    const raw = await fs.readFile(this.filePath, "utf8");
    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      return this.recoverCorruptState(error);
    }
  }

  async write(state) {
    const normalized = normalizeState(state);
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(tmpPath, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, this.filePath);
    await syncDirectory(path.dirname(this.filePath));
    return normalized;
  }

  async update(mutator) {
    const work = async () => {
      const current = await this.read();
      const next = (await mutator(current)) || current;
      return this.write(next);
    };

    this.queue = this.queue.then(work, work);
    return this.queue;
  }

  async recoverCorruptState(error) {
    const recoveredAt = new Date().toISOString();
    const suffix = recoveredAt.replace(/[:.]/g, "-");
    const corruptPath = `${this.filePath}.corrupt.${suffix}`;
    try {
      await fs.rename(this.filePath, corruptPath);
    } catch (renameError) {
      if (renameError?.code !== "ENOENT") throw renameError;
    }
    this.lastRecovery = {
      recoveredAt,
      corruptPath: path.basename(corruptPath),
      reason: error instanceof Error ? error.message : "State file could not be parsed"
    };
    await this.write(cloneDefaultState());
    return cloneDefaultState();
  }
}

async function syncDirectory(dirPath) {
  let handle;
  try {
    handle = await fs.open(dirPath, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "EISDIR", "EPERM", "ENOTSUP"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}
