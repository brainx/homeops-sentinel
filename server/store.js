import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeMonitorHistory } from "./history.js";

export const DEFAULT_STATE = Object.freeze({
  schemaVersion: 2,
  settings: {
    checkIntervalSeconds: 300,
    notifyOnRecovery: true,
    alertWebhookEncrypted: null
  },
  monitors: [],
  backups: [],
  incidents: [],
  results: {},
  monitorHistory: {},
  alertLedger: {},
  alertEvents: []
});

const CURRENT_SCHEMA_VERSION = 2;
const recoveryQueues = new Map();

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
  state.results =
    state.results && typeof state.results === "object" && !Array.isArray(state.results)
      ? state.results
      : {};
  state.monitorHistory = normalizeMonitorHistory(state.monitorHistory);
  state.alertLedger =
    state.alertLedger && typeof state.alertLedger === "object" && !Array.isArray(state.alertLedger)
      ? state.alertLedger
      : {};
  state.alertEvents = Array.isArray(state.alertEvents) ? state.alertEvents.slice(0, 100) : [];
  return state;
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.queue = Promise.resolve();
    this.ensurePromise = null;
    this.lastRecovery = null;
  }

  async ensure() {
    if (!this.ensurePromise) {
      this.ensurePromise = this.ensureFile().finally(() => {
        this.ensurePromise = null;
      });
    }
    return this.ensurePromise;
  }

  async ensureFile() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      await fs.access(this.filePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.write(cloneDefaultState());
    }
  }

  async read() {
    await this.ensure();
    let raw;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const activeRecovery = recoveryQueues.get(path.resolve(this.filePath));
      if (activeRecovery) await activeRecovery;
      raw = await fs.readFile(this.filePath, "utf8");
    }
    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      return this.recoverCorruptState(error);
    }
  }

  async write(state) {
    const normalized = normalizeState(state);
    const nonce = crypto.randomBytes(8).toString("hex");
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.${nonce}.tmp`;
    const handle = await fs.open(tmpPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(tmpPath, this.filePath);
    } catch (error) {
      await fs.unlink(tmpPath).catch((unlinkError) => {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      });
      throw error;
    }
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

  async whenIdle() {
    // Individual callers observe their own update failures. An idle wait only
    // needs to know that the serialized work has settled, including after a
    // rejected validation mutation.
    await this.queue.catch(() => undefined);
  }

  async recoverCorruptState(error) {
    const work = async () => {
      const currentRaw = await fs.readFile(this.filePath, "utf8");
      let currentError;
      try {
        return normalizeState(JSON.parse(currentRaw));
      } catch (parseError) {
        currentError = parseError;
      }

      const recoveredAt = new Date().toISOString();
      const suffix = recoveredAt.replace(/[:.]/g, "-");
      const nonce = crypto.randomBytes(6).toString("hex");
      const corruptPath = `${this.filePath}.corrupt.${suffix}.${nonce}`;
      await fs.rename(this.filePath, corruptPath);
      this.lastRecovery = {
        recoveredAt,
        corruptPath: path.basename(corruptPath),
        reason:
          currentError instanceof Error
            ? currentError.message
            : error instanceof Error
              ? error.message
              : "State file could not be parsed"
      };
      await this.write(cloneDefaultState());
      return cloneDefaultState();
    };

    return enqueueRecovery(this.filePath, work);
  }
}

function enqueueRecovery(filePath, work) {
  const key = path.resolve(filePath);
  const previous = recoveryQueues.get(key) || Promise.resolve();
  const queued = previous.then(work, work);
  recoveryQueues.set(key, queued);
  const cleanup = () => {
    if (recoveryQueues.get(key) === queued) recoveryQueues.delete(key);
  };
  void queued.then(cleanup, cleanup);
  return queued;
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
