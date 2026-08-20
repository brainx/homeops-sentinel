import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { getConfig } from "../server/config.js";

const tests = [];

test("configuration rejects partially numeric ports", async () => {
  const previousPort = process.env.PORT;
  try {
    for (const value of ["4747junk", "4747.9", "1024e3"]) {
      process.env.PORT = value;
      assert.throws(() => getConfig(), /PORT/);
    }
  } finally {
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
  }
});

test("settings use strict types and configure the default for new monitors", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const malformedInterval = await requestJson(baseUrl, "/api/settings", {
      method: "PATCH",
      body: { checkIntervalSeconds: "600junk" }
    });
    assert.equal(malformedInterval.status, 400);

    const malformedBoolean = await requestJson(baseUrl, "/api/settings", {
      method: "PATCH",
      body: { notifyOnRecovery: "false" }
    });
    assert.equal(malformedBoolean.status, 400);

    const settings = await requestJson(baseUrl, "/api/settings", {
      method: "PATCH",
      body: { checkIntervalSeconds: 180 }
    });
    assert.equal(settings.status, 200);

    const monitor = await requestJson(baseUrl, "/api/monitors", {
      method: "POST",
      body: {
        name: "Default interval probe",
        type: "http",
        target: { url: `${baseUrl}/api/health` }
      }
    });
    assert.equal(monitor.status, 201);
    assert.equal(monitor.payload.monitors[0].intervalSeconds, 180);
  });
});

test("SIGTERM remains clean after a rejected queued mutation", async () => {
  const instance = await startTestServer();
  try {
    const rejected = await requestJson(instance.baseUrl, "/api/settings", {
      method: "PATCH",
      body: { checkIntervalSeconds: "invalid" }
    });
    assert.equal(rejected.status, 400);

    instance.child.kill("SIGTERM");
    const exited = await waitForExit(instance.child, 3_000);
    assert.equal(exited.code, 0);
    assert.equal(exited.signal, null);
  } finally {
    await stopServer(instance.child);
    await fs.rm(instance.dataDir, { recursive: true, force: true });
  }
});

test("split UTF-8 request chunks preserve multibyte text", async () => {
  await withTestServer(async ({ baseUrl, port }) => {
    const title = "A😀B";
    const response = await sendFragmentedJson(port, "/api/incidents", { title });
    assert.equal(response.status, 201);

    const state = await requestJson(baseUrl, "/api/state");
    assert.equal(state.payload.incidents[0].title, title);
  });
});

test("manual checks attempt alerts and retry a failed same-status delivery", async () => {
  await withTestServer(async ({ baseUrl }) => {
    const closedPort = await reserveLoopbackPort();
    const monitorResponse = await requestJson(baseUrl, "/api/monitors", {
      method: "POST",
      body: {
        name: "Down transition",
        type: "http",
        intervalSeconds: 30,
        target: { url: `http://127.0.0.1:${closedPort}/` }
      }
    });
    const monitorId = monitorResponse.payload.monitors[0].id;

    const settings = await requestJson(baseUrl, "/api/settings", {
      method: "PATCH",
      body: { webhookUrl: "https://alerts.invalid/homeops" }
    });
    assert.equal(settings.status, 200);

    const first = await requestJson(baseUrl, `/api/monitors/${monitorId}/check`, {
      method: "POST",
      body: {}
    });
    assert.equal(first.status, 200);
    assert.equal(first.payload.alertEvents.length, 1);
    assert.equal(first.payload.alertEvents[0].deliveryStatus, "failed");

    const retry = await requestJson(baseUrl, "/api/monitors/check-all", {
      method: "POST",
      body: {}
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.payload.alertEvents.length, 2);
    assert.equal(
      retry.payload.alertEvents.every((event) => event.deliveryStatus === "failed"),
      true
    );
  });
});

test("a suppressed recovery supersedes its obsolete failed down alert", async () => {
  let targetStatus = 503;
  const target = http.createServer((_req, res) => {
    res.writeHead(targetStatus);
    res.end(targetStatus === 200 ? "ok" : "unavailable");
  });
  await listen(target);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-superseded-alert-"));
  const first = await startTestServer({ dataDir });

  try {
    const created = await requestJson(first.baseUrl, "/api/monitors", {
      method: "POST",
      body: {
        name: "Suppressed recovery",
        type: "http",
        intervalSeconds: 30,
        target: { url: `http://127.0.0.1:${target.address().port}/` }
      }
    });
    const monitorId = created.payload.monitors[0].id;
    await requestJson(first.baseUrl, "/api/settings", {
      method: "PATCH",
      body: {
        notifyOnRecovery: false,
        webhookUrl: "https://alerts.invalid/homeops"
      }
    });

    const down = await requestJson(first.baseUrl, `/api/monitors/${monitorId}/check`, {
      method: "POST",
      body: {}
    });
    assert.equal(down.status, 200);
    assert.equal(down.payload.alertEvents.length, 1);
    assert.equal(down.payload.alertEvents[0].monitorStatus, "down");

    targetStatus = 200;
    const recovered = await requestJson(first.baseUrl, "/api/monitors/check-all", {
      method: "POST",
      body: {}
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.payload.results[monitorId].status, "healthy");
    assert.equal(recovered.payload.alertEvents.length, 1);

    const recoveredState = JSON.parse(await fs.readFile(first.dataFile, "utf8"));
    const recoveryCheckedAt = recoveredState.results[monitorId].checkedAt;
    assert.equal(recoveredState.alertLedger[monitorId].deliveryStatus, "superseded");
    assert.equal(recoveredState.alertLedger[monitorId].supersededByStatus, "healthy");
    assert.equal(recoveredState.alertLedger[monitorId].error, null);
    assert.equal(recoveredState.alertLedger[monitorId].nextAttemptAt, null);

    await stopServer(first.child);
    recoveredState.alertLedger[monitorId].nextAttemptAt = "1970-01-01T00:00:00.000Z";
    await fs.writeFile(first.dataFile, `${JSON.stringify(recoveredState, null, 2)}\n`, "utf8");

    const restarted = await startTestServer({ dataDir });
    try {
      await waitForSchedulerCompletion(restarted.baseUrl);
      const persisted = JSON.parse(await fs.readFile(restarted.dataFile, "utf8"));
      assert.equal(persisted.alertEvents.length, 1);
      assert.equal(persisted.alertEvents[0].monitorStatus, "down");
      assert.equal(persisted.results[monitorId].checkedAt, recoveryCheckedAt);
      assert.equal(persisted.alertLedger[monitorId].deliveryStatus, "superseded");

      await requestJson(restarted.baseUrl, "/api/settings", {
        method: "PATCH",
        body: { notifyOnRecovery: true }
      });
      targetStatus = 503;
      const nextDown = await requestJson(restarted.baseUrl, `/api/monitors/${monitorId}/check`, {
        method: "POST",
        body: {}
      });
      assert.equal(nextDown.status, 200);
      assert.equal(nextDown.payload.alertEvents.length, 2);
      assert.equal(nextDown.payload.alertEvents[0].monitorStatus, "down");

      targetStatus = 200;
      const notifiedRecovery = await requestJson(restarted.baseUrl, "/api/monitors/check-all", {
        method: "POST",
        body: {}
      });
      assert.equal(notifiedRecovery.status, 200);
      assert.equal(notifiedRecovery.payload.alertEvents.length, 3);
      assert.equal(notifiedRecovery.payload.alertEvents[0].monitorStatus, "healthy");
      const recoveryLedger = JSON.parse(await fs.readFile(restarted.dataFile, "utf8")).alertLedger[
        monitorId
      ];
      assert.equal(recoveryLedger.status, "healthy");
      assert.equal(recoveryLedger.previousStatus, "down");
      assert.equal(recoveryLedger.payload.previousStatus, "down");
    } finally {
      await stopServer(restarted.child);
    }
  } finally {
    await stopServer(first.child);
    await fs.rm(dataDir, { recursive: true, force: true });
    await close(target);
  }
});

test("pending and failed alerts drain after restart without a fresh monitor check", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-alert-outbox-"));
  const preload = path.resolve("tests/fixtures/hang-alert-dns.mjs");
  const first = await startTestServer({ dataDir, nodeArgs: ["--import", preload] });
  const requestController = new AbortController();
  let pendingRequest = Promise.resolve();

  try {
    const closedPort = await reserveLoopbackPort();
    const created = await requestJson(first.baseUrl, "/api/monitors", {
      method: "POST",
      body: {
        name: "Durable alert transition",
        type: "http",
        intervalSeconds: 30,
        target: { url: `http://127.0.0.1:${closedPort}/` }
      }
    });
    const monitorId = created.payload.monitors[0].id;
    await requestJson(first.baseUrl, "/api/settings", {
      method: "PATCH",
      body: { webhookUrl: "https://alerts.invalid/homeops" }
    });

    let requestSettled = false;
    pendingRequest = requestJson(first.baseUrl, `/api/monitors/${monitorId}/check`, {
      method: "POST",
      body: {},
      signal: requestController.signal
    })
      .catch(() => null)
      .finally(() => {
        requestSettled = true;
      });

    await waitForPersistedState(
      first.dataFile,
      (state) => state.results?.[monitorId]?.status === "down"
    );
    assert.equal(requestSettled, false);
    const pendingState = await waitForPersistedState(
      first.dataFile,
      (state) => state.alertLedger?.[monitorId]?.deliveryStatus === "pending"
    );
    const pendingAlert = pendingState.alertLedger[monitorId];
    const originalCheckedAt = pendingState.results[monitorId].checkedAt;
    assert.match(pendingAlert.attemptId, /^alert_[A-Za-z0-9_-]+$/);
    assert.equal(pendingAlert.previousStatus, "unknown");
    assert.deepEqual(pendingAlert.payload, {
      app: "HomeOps Sentinel",
      kind: "monitor",
      monitor: {
        id: monitorId,
        name: "Durable alert transition",
        type: "http"
      },
      previousStatus: "unknown",
      status: "down",
      message: pendingState.results[monitorId].message,
      checkedAt: originalCheckedAt
    });
    assert.equal(JSON.stringify(pendingAlert.payload).includes("alerts.invalid"), false);
    assert.equal(JSON.stringify(pendingAlert.payload).includes("alertWebhookEncrypted"), false);

    first.child.kill("SIGKILL");
    const killed = await waitForExit(first.child, 3_000);
    assert.equal(killed.signal, "SIGKILL");
    requestController.abort();
    await pendingRequest;

    const restarted = await startTestServer({ dataDir });
    try {
      const persisted = await waitForPersistedState(
        restarted.dataFile,
        (state) =>
          state.alertEvents?.length === 1 &&
          state.alertLedger?.[monitorId]?.deliveryStatus === "failed"
      );
      assert.equal(persisted.alertEvents[0].deliveryStatus, "failed");
      assert.equal(persisted.results[monitorId].checkedAt, originalCheckedAt);
      assert.equal(persisted.alertLedger[monitorId].attemptCount, 2);
      assert.ok(
        new Date(persisted.alertLedger[monitorId].nextAttemptAt).getTime() > Date.now(),
        "failed automatic delivery should be backed off"
      );
    } finally {
      await stopServer(restarted.child);
    }

    const backoffProbe = await startTestServer({ dataDir });
    try {
      await waitForSchedulerCompletion(backoffProbe.baseUrl);
      const backedOff = JSON.parse(await fs.readFile(backoffProbe.dataFile, "utf8"));
      assert.equal(backedOff.alertEvents.length, 1);
      assert.equal(backedOff.alertLedger[monitorId].attemptCount, 2);
    } finally {
      await stopServer(backoffProbe.child);
    }

    const cappedState = JSON.parse(await fs.readFile(first.dataFile, "utf8"));
    cappedState.alertLedger[monitorId].attemptCount = 5;
    cappedState.alertLedger[monitorId].deliveryStatus = "pending";
    cappedState.alertLedger[monitorId].owner = "stopped-process";
    cappedState.alertLedger[monitorId].completedAt = null;
    cappedState.alertLedger[monitorId].nextAttemptAt = null;
    cappedState.alertLedger[monitorId].error = null;
    await fs.writeFile(first.dataFile, `${JSON.stringify(cappedState, null, 2)}\n`, "utf8");

    const cappedProbe = await startTestServer({ dataDir });
    try {
      const capped = await waitForPersistedState(
        cappedProbe.dataFile,
        (state) =>
          state.alertEvents?.length === 2 &&
          state.alertLedger?.[monitorId]?.deliveryStatus === "failed"
      );
      assert.equal(capped.alertEvents.length, 2);
      assert.equal(capped.alertLedger[monitorId].attemptCount, 5);
      assert.equal(capped.alertLedger[monitorId].deliveryStatus, "failed");
      assert.match(capped.alertLedger[monitorId].error, /automatic retry limit/i);
    } finally {
      await stopServer(cappedProbe.child);
    }

    const dueState = JSON.parse(await fs.readFile(first.dataFile, "utf8"));
    dueState.alertLedger[monitorId].attemptCount = 2;
    dueState.alertLedger[monitorId].nextAttemptAt = "1970-01-01T00:00:00.000Z";
    await fs.writeFile(first.dataFile, `${JSON.stringify(dueState, null, 2)}\n`, "utf8");

    const retriedFailure = await startTestServer({ dataDir });
    try {
      const persisted = await waitForPersistedState(
        retriedFailure.dataFile,
        (state) =>
          state.alertEvents?.length === 3 &&
          state.alertLedger?.[monitorId]?.deliveryStatus === "failed"
      );
      assert.equal(persisted.results[monitorId].checkedAt, originalCheckedAt);
      assert.equal(
        persisted.alertEvents.every((event) => event.deliveryStatus === "failed"),
        true
      );
    } finally {
      await stopServer(retriedFailure.child);
    }

    const legacyState = JSON.parse(await fs.readFile(first.dataFile, "utf8"));
    legacyState.alertLedger[monitorId] = {
      status: "down",
      previousStatus: "unknown",
      sentAt: "1970-01-01T00:00:00.000Z",
      error: "legacy delivery failed"
    };
    await fs.writeFile(first.dataFile, `${JSON.stringify(legacyState, null, 2)}\n`, "utf8");

    const legacyRetry = await startTestServer({ dataDir });
    try {
      const persisted = await waitForPersistedState(
        legacyRetry.dataFile,
        (state) =>
          state.alertEvents?.length === 4 &&
          state.alertLedger?.[monitorId]?.deliveryStatus === "failed"
      );
      assert.equal(persisted.results[monitorId].checkedAt, originalCheckedAt);
      assert.equal(persisted.alertLedger[monitorId].attemptCount, 2);
      assert.match(persisted.alertLedger[monitorId].attemptId, /^alert_[A-Za-z0-9_-]+$/);
      assert.equal(persisted.alertLedger[monitorId].payload.monitor.id, monitorId);
    } finally {
      await stopServer(legacyRetry.child);
    }
  } finally {
    requestController.abort();
    await pendingRequest;
    await stopServer(first.child);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("an older delivery completion cannot overwrite a newer pending attempt", async () => {
  const preload = path.resolve("tests/fixtures/delay-alert-dns.mjs");
  const instance = await startTestServer({
    nodeArgs: ["--import", preload],
    env: { HOMEOPS_TEST_ALERT_DNS_DELAY_MS: "800" }
  });

  try {
    const closedPort = await reserveLoopbackPort();
    const created = await requestJson(instance.baseUrl, "/api/monitors", {
      method: "POST",
      body: {
        name: "Attempt identity",
        type: "http",
        intervalSeconds: 30,
        target: { url: `http://127.0.0.1:${closedPort}/` }
      }
    });
    const monitorId = created.payload.monitors[0].id;
    await requestJson(instance.baseUrl, "/api/settings", {
      method: "PATCH",
      body: { webhookUrl: "https://alerts.invalid/homeops" }
    });

    const inFlight = requestJson(instance.baseUrl, `/api/monitors/${monitorId}/check`, {
      method: "POST",
      body: {}
    });
    const state = await waitForPersistedState(
      instance.dataFile,
      (current) => current.alertLedger?.[monitorId]?.deliveryStatus === "pending"
    );
    const newerPending = {
      ...state.alertLedger[monitorId],
      attemptId: "alert_newerAttempt123",
      attemptedAt: new Date().toISOString(),
      owner: "newer-process"
    };
    state.alertLedger[monitorId] = newerPending;
    await fs.writeFile(instance.dataFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

    const response = await inFlight;
    assert.equal(response.status, 200);
    const persisted = JSON.parse(await fs.readFile(instance.dataFile, "utf8"));
    assert.deepEqual(persisted.alertLedger[monitorId], newerPending);
    assert.equal(persisted.alertEvents.length, 1);
    assert.equal(persisted.alertEvents[0].deliveryStatus, "failed");
  } finally {
    await stopServer(instance.child);
    await fs.rm(instance.dataDir, { recursive: true, force: true });
  }
});

test("a completed attempt cannot suppress or relabel a newer status transition", async () => {
  let targetStatus = 503;
  const target = http.createServer((_req, res) => {
    res.writeHead(targetStatus);
    res.end(targetStatus === 200 ? "ok" : "unavailable");
  });
  await listen(target);
  const preload = path.resolve("tests/fixtures/delay-alert-dns.mjs");
  const instance = await startTestServer({ nodeArgs: ["--import", preload] });

  try {
    const created = await requestJson(instance.baseUrl, "/api/monitors", {
      method: "POST",
      body: {
        name: "Status flap alert",
        type: "http",
        intervalSeconds: 30,
        target: { url: `http://127.0.0.1:${target.address().port}/` }
      }
    });
    const monitorId = created.payload.monitors[0].id;
    await requestJson(instance.baseUrl, "/api/settings", {
      method: "PATCH",
      body: {
        notifyOnRecovery: false,
        webhookUrl: "https://alerts.invalid/homeops"
      }
    });

    const firstStartedAt = Date.now();
    const firstCheck = requestJson(instance.baseUrl, `/api/monitors/${monitorId}/check`, {
      method: "POST",
      body: {}
    });
    await waitForPersistedState(
      instance.dataFile,
      (state) => state.alertLedger?.[monitorId]?.deliveryStatus === "pending"
    );

    targetStatus = 200;
    const recovery = await requestJson(instance.baseUrl, "/api/monitors/check-all", {
      method: "POST",
      body: {}
    });
    assert.equal(recovery.status, 200);
    assert.equal(recovery.payload.results[monitorId].status, "healthy");

    await firstCheck;
    const finalizedFirstAttempt = JSON.parse(await fs.readFile(instance.dataFile, "utf8"));
    assert.equal(finalizedFirstAttempt.alertLedger[monitorId].deliveryStatus, "superseded");
    assert.equal(finalizedFirstAttempt.alertLedger[monitorId].supersededByStatus, "healthy");
    assert.equal(finalizedFirstAttempt.alertLedger[monitorId].attemptCount, 1);

    const limiterRemainingMs = 5_100 - (Date.now() - firstStartedAt);
    if (limiterRemainingMs > 0) await sleep(limiterRemainingMs);
    targetStatus = 503;
    const secondCheck = await requestJson(instance.baseUrl, `/api/monitors/${monitorId}/check`, {
      method: "POST",
      body: {}
    });
    assert.equal(secondCheck.status, 200);
    assert.equal(secondCheck.payload.alertEvents.length, 2);

    const latestLedger = JSON.parse(await fs.readFile(instance.dataFile, "utf8")).alertLedger[
      monitorId
    ];
    assert.equal(latestLedger.deliveryStatus, "failed");
    assert.equal(latestLedger.attemptCount, 1);
    assert.equal(latestLedger.previousStatus, "healthy");
    assert.equal(latestLedger.payload.previousStatus, "healthy");
  } finally {
    await stopServer(instance.child);
    await fs.rm(instance.dataDir, { recursive: true, force: true });
    await close(target);
  }
});

test("a deleted monitor cannot be repopulated by an in-flight check", async () => {
  const started = deferred();
  const target = http.createServer((_req, res) => {
    started.resolve();
    setTimeout(() => {
      res.writeHead(200);
      res.end("ok");
    }, 300);
  });
  await listen(target);

  try {
    const targetPort = target.address().port;
    await withTestServer(async ({ baseUrl }) => {
      const created = await requestJson(baseUrl, "/api/monitors", {
        method: "POST",
        body: {
          name: "Deletion race",
          type: "http",
          target: { url: `http://127.0.0.1:${targetPort}/` }
        }
      });
      const monitorId = created.payload.monitors[0].id;
      const pending = requestJson(baseUrl, `/api/monitors/${monitorId}/check`, {
        method: "POST",
        body: {}
      });
      await started.promise;

      const deleted = await requestJson(baseUrl, `/api/monitors/${monitorId}`, {
        method: "DELETE"
      });
      assert.equal(deleted.status, 200);
      const completed = await pending;
      assert.equal(completed.status, 409);

      const finalState = await requestJson(baseUrl, "/api/state");
      assert.equal(
        finalState.payload.monitors.some((monitor) => monitor.id === monitorId),
        false
      );
      assert.equal(finalState.payload.results[monitorId], undefined);
      assert.equal(finalState.payload.monitorHistory[monitorId], undefined);
    });
  } finally {
    await close(target);
  }
});

test("SIGTERM lets the current check-all monitor finish without starting another", async () => {
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let requestCount = 0;
  const target = http.createServer((_req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      firstStarted.resolve();
      void releaseFirst.promise.then(() => {
        res.writeHead(200);
        res.end("ok");
      });
      return;
    }
    res.writeHead(200);
    res.end("ok");
  });
  await listen(target);
  const instance = await startTestServer();
  let checkAll = Promise.resolve(null);

  try {
    const monitorIds = [];
    for (const name of ["First shutdown check", "Skipped shutdown check"]) {
      const created = await requestJson(instance.baseUrl, "/api/monitors", {
        method: "POST",
        body: {
          name,
          type: "http",
          intervalSeconds: 30,
          target: { url: `http://127.0.0.1:${target.address().port}/` }
        }
      });
      monitorIds.push(created.payload.monitors.at(-1).id);
    }

    checkAll = requestJson(instance.baseUrl, "/api/monitors/check-all", {
      method: "POST",
      body: {}
    });
    await firstStarted.promise;
    instance.child.kill("SIGTERM");
    await waitForPortClosed(instance.port);
    releaseFirst.resolve();

    const response = await checkAll;
    assert.equal(response.status, 200);
    const exited = await waitForExit(instance.child, 4_000);
    assert.equal(exited.code, 0);
    assert.equal(exited.signal, null);
    assert.equal(requestCount, 1);

    const persisted = JSON.parse(await fs.readFile(instance.dataFile, "utf8"));
    assert.equal(persisted.results[monitorIds[0]]?.status, "healthy");
    assert.equal(persisted.results[monitorIds[1]], undefined);
  } finally {
    releaseFirst.resolve();
    await checkAll.catch(() => null);
    await stopServer(instance.child);
    await fs.rm(instance.dataDir, { recursive: true, force: true });
    await close(target);
  }
});

test("SIGTERM waits for an active scheduler check to persist", async () => {
  const started = deferred();
  const target = http.createServer((_req, res) => {
    started.resolve();
    setTimeout(() => {
      res.writeHead(200);
      res.end("ok");
    }, 500);
  });
  await listen(target);
  const instance = await startTestServer();

  try {
    const targetPort = target.address().port;
    const created = await requestJson(instance.baseUrl, "/api/monitors", {
      method: "POST",
      body: {
        name: "Shutdown persistence",
        type: "http",
        intervalSeconds: 30,
        target: { url: `http://127.0.0.1:${targetPort}/` }
      }
    });
    const monitorId = created.payload.monitors[0].id;

    await Promise.race([
      started.promise,
      sleep(12_000).then(() => {
        throw new Error("scheduler did not start the shutdown test monitor");
      })
    ]);
    instance.child.kill("SIGTERM");
    await waitForExit(instance.child, 4_000);

    const persisted = JSON.parse(await fs.readFile(instance.dataFile, "utf8"));
    assert.equal(persisted.results[monitorId]?.status, "healthy");
  } finally {
    await stopServer(instance.child);
    await fs.rm(instance.dataDir, { recursive: true, force: true });
    await close(target);
  }
});

let failures = 0;
for (const { name, run } of tests) {
  try {
    await run();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}
if (failures > 0) {
  throw new Error(`${failures} server regression test(s) failed`);
}
console.log("server regression tests passed");

function test(name, run) {
  tests.push({ name, run });
}

async function withTestServer(callback) {
  const instance = await startTestServer();
  try {
    await callback(instance);
  } finally {
    await stopServer(instance.child);
    await fs.rm(instance.dataDir, { recursive: true, force: true });
  }
}

async function startTestServer(options = {}) {
  const dataDir =
    options.dataDir || (await fs.mkdtemp(path.join(os.tmpdir(), "homeops-server-regression-")));
  const port = await reserveLoopbackPort();
  const child = spawn(process.execPath, [...(options.nodeArgs || []), "server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...(options.env || {}),
      HOST: "127.0.0.1",
      PORT: String(port),
      HOMEOPS_DATA_DIR: dataDir,
      HOMEOPS_STATIC_DIR: path.resolve("dist")
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child, () => output);
  return {
    baseUrl,
    child,
    dataDir,
    dataFile: path.join(dataDir, "homeops-sentinel.json"),
    port
  };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const method = options.method || "GET";
  const headers = { ...(method === "GET" ? {} : { "x-homeops-intent": "same-origin" }) };
  let body;
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body,
    signal: options.signal
  });
  return { status: response.status, payload: await response.json() };
}

async function sendFragmentedJson(port, pathname, value) {
  const body = Buffer.from(JSON.stringify(value));
  const marker = Buffer.from("😀");
  const markerIndex = body.indexOf(marker);
  assert.notEqual(markerIndex, -1);
  const splitAt = markerIndex + 2;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": body.length,
          "x-homeops-intent": "same-origin"
        }
      },
      (res) => {
        res.resume();
        res.once("end", () => resolve({ status: res.statusCode || 0 }));
      }
    );
    req.once("error", reject);
    req.write(body.subarray(0, splitAt));
    void (async () => {
      await sleep(30);
      req.end(body.subarray(splitAt));
    })();
  });
}

async function waitForServer(baseUrl, child, readOutput) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before readiness: ${readOutput()}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {
      // The server may still be binding its socket.
    }
    await sleep(25);
  }
  throw new Error(`server did not become ready: ${readOutput()}`);
}

async function waitForSchedulerCompletion(baseUrl, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const diagnostics = await requestJson(baseUrl, "/api/diagnostics");
    if (diagnostics.status === 200 && diagnostics.payload.scheduler.lastCompletedAt) return;
    await sleep(20);
  }
  throw new Error("scheduler did not complete its startup tick");
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal }))
  );
  return Promise.race([
    exited,
    sleep(timeoutMs).then(() => {
      throw new Error("server did not exit within the expected grace period");
    })
  ]);
}

async function waitForPersistedState(file, predicate, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await fs.readFile(file, "utf8"));
      if (predicate(state)) return state;
    } catch {
      // Atomic replacement can briefly race this polling read.
    }
    await sleep(20);
  }
  throw new Error("persisted state did not reach the expected condition");
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await waitForExit(child, 3_000);
  } catch {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function reserveLoopbackPort() {
  const server = net.createServer();
  await listen(server);
  const port = server.address().port;
  await close(server);
  return port;
}

async function waitForPortClosed(port, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portAcceptsConnections(port))) return;
    await sleep(20);
  }
  throw new Error("server continued accepting connections after SIGTERM");
}

function portAcceptsConnections(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
