import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfig } from "../server/config.js";
import { JsonStore, createId } from "../server/store.js";

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
console.log("store tests passed");
