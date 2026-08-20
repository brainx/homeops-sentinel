import assert from "node:assert/strict";
import { createHook } from "node:async_hooks";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "../server/config.js";
import { createSecretBox } from "../server/secrets.js";
import { JsonStore, createId } from "../server/store.js";

function startSecretWorker(secretFile, index, env) {
  const workerFile = fileURLToPath(new URL("fixtures/secret-worker.mjs", import.meta.url));
  const child = spawn(process.execPath, [workerFile, secretFile, String(index)], {
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  let signalReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    signalReady = resolve;
    rejectReady = reject;
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("ready\n")) signalReady();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", (error) => {
      rejectReady(error);
      reject(error);
    });
    child.once("close", (code) => {
      if (!stdout.includes("ready\n")) {
        rejectReady(new Error(`Secret worker exited before ready: ${stderr}`));
      }
      if (code !== 0) {
        reject(new Error(`Secret worker exited with ${code}: ${stderr}`));
        return;
      }
      try {
        const resultLine = stdout
          .trim()
          .split("\n")
          .findLast((line) => line.startsWith("{"));
        resolve(JSON.parse(resultLine));
      } catch (error) {
        reject(new Error(`Secret worker returned invalid output: ${stdout}`, { cause: error }));
      }
    });
  });
  return { child, ready, completed };
}

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-store-"));
const file = path.join(dir, "state.json");
const store = new JsonStore(file);

await store.ensure();
const initial = await store.read();
assert.equal(initial.schemaVersion, 2);
assert.deepEqual(initial.monitors, []);
assert.deepEqual(initial.monitorHistory, {});

const id = createId("mon");
await store.update((state) => {
  state.monitors.push({
    id,
    name: "Local health",
    type: "http",
    intervalSeconds: 300,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    target: { url: "http://127.0.0.1:4747/api/health" }
  });
  return state;
});

const updated = await store.read();
assert.equal(updated.monitors.length, 1);
assert.equal(updated.monitors[0].id, id);

await store.update(() => null);
assert.equal((await store.read()).monitors.length, 1);

assert.equal(typeof store.whenIdle, "function");
let releaseQueuedUpdate;
let markQueuedUpdateStarted;
const queuedUpdateGate = new Promise((resolve) => {
  releaseQueuedUpdate = resolve;
});
const queuedUpdateStarted = new Promise((resolve) => {
  markQueuedUpdateStarted = resolve;
});
const queuedUpdate = store.update(async (state) => {
  markQueuedUpdateStarted();
  await queuedUpdateGate;
  state.settings.checkIntervalSeconds = 301;
  return state;
});
await queuedUpdateStarted;
let idleResolved = false;
const idleWait = store.whenIdle().then(() => {
  idleResolved = true;
});
await new Promise((resolve) => setImmediate(resolve));
assert.equal(idleResolved, false);
releaseQueuedUpdate();
await Promise.all([queuedUpdate, idleWait]);
assert.equal(idleResolved, true);
assert.equal((await store.read()).settings.checkIntervalSeconds, 301);

await fs.writeFile(
  file,
  JSON.stringify({
    schemaVersion: 99,
    settings: null,
    monitors: "bad",
    backups: {},
    incidents: null,
    results: null,
    monitorHistory: "bad",
    alertLedger: null,
    alertEvents: "bad"
  }),
  { mode: 0o600 }
);
const normalizedInvalidState = await store.read();
assert.equal(normalizedInvalidState.schemaVersion, 2);
assert.deepEqual(normalizedInvalidState.settings, {
  checkIntervalSeconds: 300,
  notifyOnRecovery: true,
  alertWebhookEncrypted: null
});
assert.deepEqual(normalizedInvalidState.monitors, []);
assert.deepEqual(normalizedInvalidState.backups, []);
assert.deepEqual(normalizedInvalidState.incidents, []);
assert.deepEqual(normalizedInvalidState.results, {});
assert.deepEqual(normalizedInvalidState.monitorHistory, {});
assert.deepEqual(normalizedInvalidState.alertLedger, {});
assert.deepEqual(normalizedInvalidState.alertEvents, []);

await fs.writeFile(
  file,
  JSON.stringify({
    results: [{ status: "up" }],
    alertLedger: [{ status: "down" }]
  }),
  { mode: 0o600 }
);
const normalizedArrayMaps = await store.read();
assert.deepEqual(normalizedArrayMaps.results, {});
assert.deepEqual(normalizedArrayMaps.alertLedger, {});

const validResults = { mon_valid: { status: "up", checkedAt: "2026-08-20T00:00:00.000Z" } };
const validAlertLedger = { mon_valid: { status: "up", notifiedAt: "2026-08-20T00:00:00.000Z" } };
await fs.writeFile(file, JSON.stringify({ results: validResults, alertLedger: validAlertLedger }), {
  mode: 0o600
});
const normalizedMapState = await store.read();
assert.deepEqual(normalizedMapState.results, validResults);
assert.deepEqual(normalizedMapState.alertLedger, validAlertLedger);

await fs.writeFile(file, "{bad json", { mode: 0o600 });
const recovered = await store.read();
assert.equal(recovered.schemaVersion, 2);
assert.deepEqual(recovered.monitors, []);
assert.equal(store.lastRecovery?.corruptPath.startsWith("state.json.corrupt."), true);
assert.match(store.lastRecovery?.reason || "", /JSON/);

const corruptFiles = await fs.readdir(dir);
const corruptFile = corruptFiles.find((name) => name.startsWith("state.json.corrupt."));
assert.ok(corruptFile);
assert.equal(await fs.readFile(path.join(dir, corruptFile), "utf8"), "{bad json");

const repaired = JSON.parse(await fs.readFile(file, "utf8"));
assert.equal(repaired.schemaVersion, 2);
assert.deepEqual(repaired.monitors, []);

const concurrentDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-store-concurrent-"));
const concurrentFile = path.join(concurrentDir, "state.json");
const concurrentStore = new JsonStore(concurrentFile);
const realDateNow = Date.now;
let concurrentReads;
try {
  Date.now = () => 1_777_000_000_000;
  concurrentReads = await Promise.allSettled(
    Array.from({ length: 24 }, () => concurrentStore.read())
  );
} finally {
  Date.now = realDateNow;
}
assert.deepEqual(
  concurrentReads.filter(({ status }) => status === "rejected"),
  []
);
for (const read of concurrentReads) {
  assert.equal(read.value.schemaVersion, 2);
}
assert.deepEqual(
  (await fs.readdir(concurrentDir)).filter((name) => name.endsWith(".tmp")),
  []
);

const concurrentCorruptBody = "{concurrent bad json";
await fs.writeFile(concurrentFile, concurrentCorruptBody, { mode: 0o600 });
const recoveredReads = await Promise.allSettled(
  Array.from({ length: 24 }, () => concurrentStore.read())
);
assert.deepEqual(
  recoveredReads.filter(({ status }) => status === "rejected"),
  []
);
const concurrentCorruptFiles = (await fs.readdir(concurrentDir)).filter((name) =>
  name.startsWith("state.json.corrupt.")
);
assert.equal(concurrentCorruptFiles.length, 1);
assert.equal(
  await fs.readFile(path.join(concurrentDir, concurrentCorruptFiles[0]), "utf8"),
  concurrentCorruptBody
);
assert.equal(concurrentStore.lastRecovery?.corruptPath, concurrentCorruptFiles[0]);
assert.match(concurrentStore.lastRecovery?.reason || "", /JSON/);

const sharedRecoveryDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-store-shared-"));
const sharedRecoveryFile = path.join(sharedRecoveryDir, "state.json");
const firstSharedStore = new JsonStore(sharedRecoveryFile);
const secondSharedStore = new JsonStore(sharedRecoveryFile);
const sharedMissingReads = await Promise.allSettled([
  firstSharedStore.read(),
  secondSharedStore.read()
]);
assert.deepEqual(
  sharedMissingReads.map((result) =>
    result.status === "fulfilled" ? result.value.schemaVersion : result.reason?.code
  ),
  [2, 2]
);

const sharedCorruptBody = "{shared corrupt json";
await fs.writeFile(sharedRecoveryFile, sharedCorruptBody, { mode: 0o600 });
const sharedRecoveryReads = await Promise.allSettled([
  firstSharedStore.read(),
  secondSharedStore.read()
]);
assert.deepEqual(
  sharedRecoveryReads.map((result) =>
    result.status === "fulfilled" ? result.value.schemaVersion : result.reason?.code
  ),
  [2, 2]
);
const sharedCorruptFiles = (await fs.readdir(sharedRecoveryDir)).filter((name) =>
  name.startsWith("state.json.corrupt.")
);
assert.equal(sharedCorruptFiles.length, 1);
assert.equal(
  await fs.readFile(path.join(sharedRecoveryDir, sharedCorruptFiles[0]), "utf8"),
  sharedCorruptBody
);

const interleavedRecoveryDir = await fs.mkdtemp(
  path.join(os.tmpdir(), "homeops-store-interleaved-")
);
const interleavedRecoveryFile = path.join(interleavedRecoveryDir, "state.json");
const interleavedCorruptBody = "{interleaved corrupt json";
await fs.writeFile(interleavedRecoveryFile, interleavedCorruptBody, { mode: 0o600 });
const recoveringStore = new JsonStore(interleavedRecoveryFile);
const delayedReader = new JsonStore(interleavedRecoveryFile);

let markDelayedEnsureComplete;
let releaseDelayedEnsure;
const delayedEnsureComplete = new Promise((resolve) => {
  markDelayedEnsureComplete = resolve;
});
const delayedEnsureGate = new Promise((resolve) => {
  releaseDelayedEnsure = resolve;
});
const originalDelayedEnsure = delayedReader.ensure.bind(delayedReader);
delayedReader.ensure = async () => {
  await originalDelayedEnsure();
  markDelayedEnsureComplete();
  await delayedEnsureGate;
};

let markCorruptFileRenamed;
let releaseRecoveryWrite;
const corruptFileRenamed = new Promise((resolve) => {
  markCorruptFileRenamed = resolve;
});
const recoveryWriteGate = new Promise((resolve) => {
  releaseRecoveryWrite = resolve;
});
const originalRecoveryWrite = recoveringStore.write.bind(recoveringStore);
recoveringStore.write = async (state) => {
  markCorruptFileRenamed();
  await recoveryWriteGate;
  return originalRecoveryWrite(state);
};

const delayedRead = delayedReader.read();
await delayedEnsureComplete;
const recoveringRead = recoveringStore.read();
const interleavedReadResults = Promise.allSettled([recoveringRead, delayedRead]);
await corruptFileRenamed;

let fileOperationId;
let markFileOperationComplete;
const fileOperationComplete = new Promise((resolve) => {
  markFileOperationComplete = resolve;
});
const fileOperationHook = createHook({
  init(asyncId, type) {
    if (fileOperationId === undefined && type === "FSREQPROMISE") fileOperationId = asyncId;
  },
  after(asyncId) {
    if (asyncId !== fileOperationId) return;
    fileOperationHook.disable();
    markFileOperationComplete();
  }
});
fileOperationHook.enable();
releaseDelayedEnsure();
await fileOperationComplete;
fileOperationHook.disable();
await assert.rejects(fs.access(interleavedRecoveryFile), { code: "ENOENT" });
releaseRecoveryWrite();

const interleavedReads = await interleavedReadResults;
assert.deepEqual(
  interleavedReads.map((result) =>
    result.status === "fulfilled" ? result.value.schemaVersion : result.reason?.code
  ),
  [2, 2]
);
const interleavedCorruptFiles = (await fs.readdir(interleavedRecoveryDir)).filter((name) =>
  name.startsWith("state.json.corrupt.")
);
assert.equal(interleavedCorruptFiles.length, 1);
assert.equal(
  await fs.readFile(path.join(interleavedRecoveryDir, interleavedCorruptFiles[0]), "utf8"),
  interleavedCorruptBody
);

const secretDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-secret-concurrent-"));
const secretFile = path.join(secretDir, ".homeops-secret");
const secretEnv = { ...process.env };
delete secretEnv.HOMEOPS_SECRET_KEY;
delete secretEnv.APP_SEED;
const secretWorkers = Array.from({ length: 16 }, (_, index) =>
  startSecretWorker(secretFile, index, secretEnv)
);
await Promise.all(secretWorkers.map(({ ready }) => ready));
for (const { child } of secretWorkers) child.stdin.end("start\n");
const secretResults = await Promise.all(secretWorkers.map(({ completed }) => completed));
const previousSecretKey = process.env.HOMEOPS_SECRET_KEY;
const previousAppSeed = process.env.APP_SEED;
delete process.env.HOMEOPS_SECRET_KEY;
delete process.env.APP_SEED;
try {
  const persistedSecretBox = createSecretBox(secretFile);
  const decryptedWorkerValues = secretResults.map(({ error, payload }) => {
    if (error) return `error:${error}`;
    try {
      return persistedSecretBox.decrypt(payload);
    } catch {
      return null;
    }
  });
  assert.deepEqual(
    decryptedWorkerValues,
    Array.from({ length: 16 }, (_, index) => `worker-${index}`)
  );
} finally {
  if (previousSecretKey === undefined) delete process.env.HOMEOPS_SECRET_KEY;
  else process.env.HOMEOPS_SECRET_KEY = previousSecretKey;
  if (previousAppSeed === undefined) delete process.env.APP_SEED;
  else process.env.APP_SEED = previousAppSeed;
}
assert.equal((await fs.stat(secretFile)).mode & 0o777, 0o600);
assert.deepEqual(await fs.readdir(secretDir), [".homeops-secret"]);

const originalEnv = { ...process.env };
const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-config-"));
try {
  process.env.PORT = "4788";
  process.env.HOST = "127.0.0.1";
  process.env.HOMEOPS_DATA_DIR = path.join(configDir, "data");
  process.env.HOMEOPS_STATIC_DIR = path.join(configDir, "static");
  const config = getConfig();
  assert.equal(config.port, 4788);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.dataFile, path.join(configDir, "data", "homeops-sentinel.json"));
  assert.equal(config.secretFile, path.join(configDir, "data", ".homeops-secret"));

  process.env.PORT = "80";
  assert.throws(() => getConfig(), /PORT/);
  process.env.PORT = "4788";
  process.env.HOST = "bad/host";
  assert.throws(() => getConfig(), /HOST/);
  delete process.env.PORT;
  delete process.env.HOST;
  delete process.env.HOMEOPS_DATA_DIR;
  delete process.env.HOMEOPS_STATIC_DIR;
  const defaultConfig = getConfig();
  assert.equal(defaultConfig.port, 4747);
  assert.equal(defaultConfig.host, "127.0.0.1");
  assert.equal(defaultConfig.dataDir, path.resolve(process.cwd(), "data"));
  assert.equal(defaultConfig.staticDir, path.resolve(process.cwd(), "dist"));
} finally {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  await fs.rm(configDir, { recursive: true, force: true });
}

await fs.rm(dir, { recursive: true, force: true });
await fs.rm(concurrentDir, { recursive: true, force: true });
await fs.rm(sharedRecoveryDir, { recursive: true, force: true });
await fs.rm(interleavedRecoveryDir, { recursive: true, force: true });
await fs.rm(secretDir, { recursive: true, force: true });
console.log("store tests passed");
