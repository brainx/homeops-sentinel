import assert from "node:assert/strict";
import http from "node:http";
import {
  normalizeBackup,
  normalizeMonitor,
  backupStatus,
  restoreTestStatus,
  runMonitor
} from "../server/monitors.js";
import {
  createSafeLookup,
  isBlockedAddress,
  normalizeOutboundUrl,
  parseIpAddress,
  postJsonToSafeUrl,
  resolveSafeAddress
} from "../server/network.js";

assert.throws(
  () => normalizeMonitor({ name: "Bad", type: "http", target: { url: "file:///etc/passwd" } }),
  /http or https/
);
assert.throws(
  () => normalizeMonitor({ name: "", type: "http", target: { url: "http://127.0.0.1/" } }),
  /name is required/
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "x".repeat(81),
      type: "http",
      target: { url: "http://127.0.0.1/" }
    }),
  /name is too long/
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "Bad interval",
      type: "http",
      intervalSeconds: 10,
      target: { url: "http://127.0.0.1/" }
    }),
  /intervalSeconds/
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "Bad type",
      type: "smtp",
      target: { url: "http://127.0.0.1/" }
    }),
  /type must be/
);

assert.throws(
  () => normalizeMonitor({ name: "Bad", type: "http", target: { url: "http://169.254.169.254/" } }),
  /blocked/
);

assert.throws(
  () =>
    normalizeMonitor({
      name: "Bad TCP",
      type: "tcp",
      target: { host: "169.254.169.254", port: 80 }
    }),
  /blocked/
);

await assert.rejects(
  () =>
    resolveSafeAddress("metadata.local", {}, async () => [
      { address: "169.254.169.254", family: 4 }
    ]),
  /blocked/
);

assert.deepEqual(
  await resolveSafeAddress("lan.local", {}, async () => [{ address: "192.168.1.10", family: 4 }]),
  { address: "192.168.1.10", family: 4 }
);
assert.deepEqual(parseIpAddress("[::ffff:192.168.1.10]"), {
  address: "192.168.1.10",
  family: 4,
  mapped: true
});
assert.deepEqual(parseIpAddress("::ffff:c0a8:010a"), {
  address: "192.168.1.10",
  family: 4,
  mapped: true
});
assert.equal(isBlockedAddress("127.0.0.1"), false);
assert.equal(isBlockedAddress("127.0.0.1", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("10.0.0.8", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("fc00::1", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("ff02::1"), true);
assert.throws(() => normalizeOutboundUrl("https://user:pass@example.com/hook"), /credentials/);
assert.throws(
  () => normalizeOutboundUrl("http://127.0.0.1/hook", { blockLoopback: true }),
  /blocked/
);

await new Promise((resolve, reject) => {
  const lookup = createSafeLookup();
  lookup("127.0.0.1", (error, address, family) => {
    if (error) {
      reject(error);
      return;
    }
    try {
      assert.equal(address, "127.0.0.1");
      assert.equal(family, 4);
      resolve();
    } catch (assertionError) {
      reject(assertionError);
    }
  });
});

await assert.rejects(
  () => resolveSafeAddress("empty.local", {}, async () => []),
  /did not resolve/
);
await assert.rejects(
  () => resolveSafeAddress("bad.local", {}, async () => [{ address: "not-an-ip", family: 4 }]),
  /did not resolve to an IP address/
);

const monitor = normalizeMonitor({
  name: "Local test",
  type: "http",
  target: { url: "http://127.0.0.1:0/health" },
  intervalSeconds: 60
});
assert.equal(monitor.type, "http");
assert.equal(
  normalizeMonitor({
    name: "TCP",
    type: "tcp",
    target: { host: "127.0.0.1", port: "4747" }
  }).target.port,
  4747
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "Bad host",
      type: "tcp",
      target: { host: "local/host", port: 80 }
    }),
  /host must be/
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "Bad port",
      type: "tcp",
      target: { host: "127.0.0.1", port: 70000 }
    }),
  /port/
);
assert.equal(
  normalizeMonitor({
    name: "DNS",
    type: "dns",
    target: { hostname: "localhost" }
  }).target.recordType,
  "A"
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "Bad DNS",
      type: "dns",
      target: { hostname: "localhost", recordType: "SOA" }
    }),
  /unsupported/
);
assert.equal(
  normalizeMonitor({
    name: "TLS",
    type: "tls",
    target: { host: "example.com", warningDays: 999 }
  }).target.warningDays,
  90
);

const backup = normalizeBackup({ name: "Nightly", scheduleHours: 24 });
assert.equal(backupStatus(backup).status, "degraded");
assert.equal(restoreTestStatus(backup).message, "No restore test recorded");
assert.throws(() => normalizeBackup({ name: "Bad", scheduleHours: 0 }), /scheduleHours/);
assert.throws(
  () =>
    normalizeBackup({
      name: "Bad restore",
      scheduleHours: 24,
      restoreTest: { intervalDays: 0 }
    }),
  /intervalDays/
);
assert.throws(
  () =>
    normalizeBackup({
      name: "Bad restore result",
      scheduleHours: 24,
      restoreTest: { result: "partial" }
    }),
  /restore test result/
);
assert.throws(
  () =>
    normalizeBackup({
      name: "Missing restore date",
      scheduleHours: 24,
      restoreTest: { result: "passed", target: "Staging" }
    }),
  /date is required/
);
assert.throws(
  () =>
    normalizeBackup({
      name: "Missing restore target",
      scheduleHours: 24,
      restoreTest: { result: "passed", lastTestedAt: "2026-06-01" }
    }),
  /target is required/
);

const restoreTestNow = new Date("2026-06-13T12:00:00.000Z");
const restoreProof = normalizeBackup(
  {
    name: "Nightly",
    scheduleHours: 24,
    lastSuccessAt: "2026-06-13T10:00:00.000Z",
    restoreTest: {
      intervalDays: 90,
      lastTestedAt: "2026-06-01",
      target: "Staging VM",
      result: "passed",
      evidence: "Booted the restored service and checked the login page."
    }
  },
  restoreTestNow
);
assert.equal(restoreProof.restoreTest.lastTestedAt, "2026-06-01T00:00:00.000Z");
assert.equal(backupStatus(restoreProof, restoreTestNow).status, "healthy");
assert.equal(
  backupStatus({ ...restoreProof, lastSuccessAt: "not a date" }, restoreTestNow).message,
  "Last backup timestamp is invalid"
);
assert.equal(
  backupStatus({ ...restoreProof, lastSuccessAt: "2026-06-10T00:00:00.000Z" }, restoreTestNow)
    .status,
  "down"
);

const overdueRestore = normalizeBackup(
  {
    name: "Archive",
    scheduleHours: 24,
    lastSuccessAt: "2026-06-13T10:00:00.000Z",
    restoreTest: {
      intervalDays: 30,
      lastTestedAt: "2026-04-01",
      target: "Sandbox NAS",
      result: "passed"
    }
  },
  restoreTestNow
);
assert.equal(backupStatus(overdueRestore, restoreTestNow).status, "degraded");
assert.equal(restoreTestStatus(overdueRestore, restoreTestNow).overdue, true);

const failedRestore = normalizeBackup(
  {
    name: "Photos",
    scheduleHours: 24,
    lastSuccessAt: "2026-06-13T10:00:00.000Z",
    restoreTest: {
      intervalDays: 90,
      lastTestedAt: "2026-06-01",
      target: "Test share",
      result: "failed"
    }
  },
  restoreTestNow
);
assert.equal(backupStatus(failedRestore, restoreTestNow).status, "down");

assert.throws(
  () =>
    normalizeBackup(
      {
        name: "Future restore",
        scheduleHours: 24,
        restoreTest: {
          result: "passed",
          target: "Future target",
          lastTestedAt: "2026-06-14T12:02:00.000Z"
        }
      },
      restoreTestNow
    ),
  /future/
);
assert.equal(
  restoreTestStatus(
    {
      restoreTest: {
        intervalDays: 999,
        lastTestedAt: "not a date",
        result: "passed"
      }
    },
    restoreTestNow
  ).message,
  "Restore test timestamp is invalid"
);
assert.equal(
  restoreTestStatus(
    {
      restoreTest: {
        intervalDays: 30,
        lastTestedAt: "2026-06-15T00:00:00.000Z",
        result: "passed"
      }
    },
    restoreTestNow
  ).message,
  "Restore test timestamp is invalid"
);

const blockedStoredResult = await runMonitor({
  name: "Stored bad target",
  type: "http",
  target: { url: "http://169.254.169.254/" }
});
assert.equal(blockedStoredResult.status, "down");
assert.match(blockedStoredResult.message, /blocked/);

const server = http.createServer((_req, res) => {
  if (_req.url === "/redirect") {
    res.writeHead(302, { location: "/webhook" });
    res.end();
    return;
  }
  if (_req.url === "/blocked-redirect") {
    res.writeHead(302, { location: "http://169.254.169.254/" });
    res.end();
    return;
  }
  if (_req.url === "/failing-webhook") {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("nope");
    return;
  }
  if (_req.url === "/missing") {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("missing");
    return;
  }
  if (_req.url === "/server-error") {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("unavailable");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const result = await runMonitor({
    ...monitor,
    target: { url: `http://127.0.0.1:${port}/health` }
  });
  assert.equal(result.status, "healthy");
  assert.match(result.message, /HTTP 200/);
  const degradedHttp = await runMonitor({
    ...monitor,
    target: { url: `http://127.0.0.1:${port}/missing` }
  });
  assert.equal(degradedHttp.status, "degraded");
  assert.match(degradedHttp.message, /HTTP 404/);
  const downHttp = await runMonitor({
    ...monitor,
    target: { url: `http://127.0.0.1:${port}/server-error` }
  });
  assert.equal(downHttp.status, "down");
  assert.match(downHttp.message, /HTTP 503/);

  const tcpResult = await runMonitor({
    name: "TCP local",
    type: "tcp",
    target: { host: "127.0.0.1", port }
  });
  assert.equal(tcpResult.status, "healthy");
  assert.match(tcpResult.message, /TCP .* reachable/);

  const delivered = await postJsonToSafeUrl(`http://127.0.0.1:${port}/redirect`, { ok: true });
  assert.equal(delivered.statusCode, 200);
  await assert.rejects(
    () => postJsonToSafeUrl(`http://127.0.0.1:${port}/blocked-redirect`, { ok: true }),
    /blocked/
  );
  await assert.rejects(
    () => postJsonToSafeUrl(`http://127.0.0.1:${port}/failing-webhook`, { ok: true }),
    /HTTP 500/
  );
} finally {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}
console.log("monitor tests passed");
