import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import {
  normalizeBackup,
  normalizeMonitor,
  backupStatus,
  restoreTestStatus,
  runMonitor,
  summarizeState
} from "../server/monitors.js";
import {
  MONITOR_HISTORY_LIMIT,
  normalizeMonitorHistory,
  publicMonitorHistory,
  recordMonitorResult,
  summarizeMonitorHistory
} from "../server/history.js";
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
      name: "Partial interval",
      type: "http",
      intervalSeconds: "120junk",
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
  () =>
    normalizeMonitor({
      name: "Invalid enabled",
      type: "http",
      enabled: "false",
      target: { url: "http://127.0.0.1/" }
    }),
  /enabled/
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
assert.deepEqual(parseIpAddress("0:0:0:0:0:ffff:a9fe:a9fe"), {
  address: "169.254.169.254",
  family: 4,
  mapped: true
});
assert.equal(isBlockedAddress("0:0:0:0:0:ffff:0000:0000"), true);
assert.equal(isBlockedAddress("0:0:0:0:0:ffff:a9fe:a9fe"), true);
assert.equal(isBlockedAddress("0:0:0:0:0:ffff:e000:0001"), true);
assert.equal(isBlockedAddress("0:0:0:0:0:ffff:7f00:0001"), false);
assert.equal(isBlockedAddress("0:0:0:0:0:ffff:7f00:0001", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("0:0:0:0:0:ffff:c0a8:010a"), false);
assert.equal(isBlockedAddress("0:0:0:0:0:ffff:c0a8:010a", { blockPrivate: true }), true);
assert.deepEqual(parseIpAddress("::ffff:127.0.0.1%lo0"), {
  address: "127.0.0.1",
  family: 4,
  mapped: true
});
assert.equal(isBlockedAddress("::ffff:127.0.0.1%lo0", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("fec0::1"), false);
assert.equal(isBlockedAddress("fec0::1", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("64:ff9b::a00:1"), false);
assert.equal(isBlockedAddress("64:ff9b::a00:1", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("64:ff9b::7f00:1", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("64:ff9b::808:808", { blockPrivate: true }), false);
assert.equal(isBlockedAddress("64:ff9b:1::1"), false);
assert.equal(isBlockedAddress("64:ff9b:1::1", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("::ffff:0:a00:1", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("::ffff:0:7f00:1", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("127.0.0.1"), false);
assert.equal(isBlockedAddress("127.0.0.1", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("::"), true);
assert.equal(isBlockedAddress("0:0:0:0:0:0:0:0"), true);
assert.equal(isBlockedAddress("::1"), false);
assert.equal(isBlockedAddress("0:0:0:0:0:0:0:1"), false);
assert.equal(isBlockedAddress("::1", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("0:0:0:0:0:0:0:1", { blockLoopback: true }), true);
assert.equal(isBlockedAddress("10.0.0.8", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("fc00::1", { blockPrivate: true }), true);
assert.equal(isBlockedAddress("ff02::1"), true);
assert.throws(() => normalizeOutboundUrl("https://user:pass@example.com/hook"), /credentials/);
assert.throws(
  () => normalizeOutboundUrl("http://127.0.0.1/hook", { blockLoopback: true }),
  /blocked/
);
assert.doesNotThrow(() =>
  normalizeMonitor({ name: "Private IPv6", type: "tcp", target: { host: "fd12::1", port: 443 } })
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

await new Promise((resolve, reject) => {
  const lookup = createSafeLookup();
  lookup("127.0.0.1", { all: true }, (error, addresses) => {
    if (error) {
      reject(error);
      return;
    }
    try {
      assert.deepEqual(addresses, [{ address: "127.0.0.1", family: 4 }]);
      resolve();
    } catch (assertionError) {
      reject(assertionError);
    }
  });
});

const originalDnsLookup = dns.lookup;
try {
  dns.lookup = () =>
    new Promise((resolve) => {
      setTimeout(() => resolve([{ address: "127.0.0.1", family: 4 }]), 120);
    });
  const lookup = createSafeLookup({ timeoutMs: 25 });
  await assert.rejects(
    () =>
      new Promise((resolve, reject) => {
        lookup("slow-lookup.local", { all: true }, (error, addresses) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(addresses);
        });
      }),
    /lookup timed out/
  );
} finally {
  dns.lookup = originalDnsLookup;
}

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
  normalizeMonitor(
    { name: "Configured default", type: "http", target: { url: "http://127.0.0.1/" } },
    new Date("2026-06-13T12:00:00.000Z"),
    { defaultIntervalSeconds: 900 }
  ).intervalSeconds,
  900
);
assert.equal(
  normalizeMonitor({ name: "Built-in default", type: "http", target: { url: "http://127.0.0.1/" } })
    .intervalSeconds,
  300
);
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
assert.throws(
  () =>
    normalizeMonitor({
      name: "Partial port",
      type: "tcp",
      target: { host: "127.0.0.1", port: "443junk" }
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
assert.throws(
  () =>
    normalizeMonitor({
      name: "Zero TLS port",
      type: "tls",
      target: { host: "example.com", port: 0 }
    }),
  /port/
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "Invalid TLS warning",
      type: "tls",
      target: { host: "example.com", warningDays: "not-a-number" }
    }),
  /warningDays/
);
assert.throws(
  () =>
    normalizeMonitor({
      name: "Partial TLS warning",
      type: "tls",
      target: { host: "example.com", warningDays: "21junk" }
    }),
  /warningDays/
);

const historyState = { results: {}, monitorHistory: {} };
const firstHistoryResult = {
  status: "healthy",
  message: "HTTP 200",
  latencyMs: 12.4,
  checkedAt: "2026-06-13T10:00:00.000Z"
};
recordMonitorResult(historyState, "mon_history", firstHistoryResult);
recordMonitorResult(historyState, "mon_history", {
  status: "down",
  message: "Connection refused",
  latencyMs: 31,
  checkedAt: "2026-06-13T10:05:00.000Z"
});
assert.equal(historyState.results.mon_history.status, "down");
assert.equal(historyState.monitorHistory.mon_history.length, 2);
assert.deepEqual(summarizeMonitorHistory(historyState.monitorHistory.mon_history), {
  totalChecks: 2,
  healthyChecks: 1,
  availabilityPercent: 50,
  averageLatencyMs: 22,
  lastFailureAt: "2026-06-13T10:05:00.000Z"
});
assert.equal(publicMonitorHistory(Array.from({ length: 60 }, () => firstHistoryResult)).length, 48);
assert.throws(
  () => recordMonitorResult(historyState, "mon_history", { status: "healthy" }),
  /invalid/
);

const oversizedHistory = Array.from({ length: MONITOR_HISTORY_LIMIT + 5 }, (_, index) => ({
  ...firstHistoryResult,
  latencyMs: index,
  checkedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
}));
const normalizedHistory = normalizeMonitorHistory({
  mon_history: oversizedHistory,
  mon_invalid: [{ status: "broken" }],
  mon_not_array: "bad"
});
assert.equal(normalizedHistory.mon_history.length, MONITOR_HISTORY_LIMIT);
assert.equal(normalizedHistory.mon_history[0].latencyMs, 5);
assert.equal(normalizedHistory.mon_invalid, undefined);
assert.equal(normalizedHistory.mon_not_array, undefined);

const backup = normalizeBackup({ name: "Nightly", scheduleHours: 24 });
assert.equal(backupStatus(backup).status, "degraded");
assert.equal(restoreTestStatus(backup).message, "No restore test recorded");
assert.throws(() => normalizeBackup({ name: "Bad", scheduleHours: 0 }), /scheduleHours/);
assert.throws(
  () => normalizeBackup({ name: "Partial schedule", scheduleHours: "24junk" }),
  /scheduleHours/
);
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
      name: "Partial restore interval",
      scheduleHours: 24,
      restoreTest: { intervalDays: "90junk" }
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
assert.equal(
  normalizeBackup(
    { name: "Normalized timestamp", scheduleHours: 24, lastSuccessAt: "2026-06-13" },
    restoreTestNow
  ).lastSuccessAt,
  "2026-06-13T00:00:00.000Z"
);
assert.throws(
  () =>
    normalizeBackup(
      { name: "Invalid timestamp", scheduleHours: 24, lastSuccessAt: "not-a-date" },
      restoreTestNow
    ),
  /valid date/
);
assert.throws(
  () =>
    normalizeBackup(
      {
        name: "Future backup",
        scheduleHours: 24,
        lastSuccessAt: "2099-01-01T00:00:00.000Z"
      },
      restoreTestNow
    ),
  /future/
);
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
  backupStatus({ ...restoreProof, lastSuccessAt: "2099-01-01T00:00:00.000Z" }, restoreTestNow)
    .status,
  "degraded"
);
const unknownResultSummary = summarizeState(
  {
    settings: { alertWebhookEncrypted: null },
    monitors: [{ id: "mon_unknown" }, { id: "mon_invalid" }],
    backups: [],
    incidents: [],
    results: {
      mon_unknown: { status: "unknown" },
      mon_invalid: { status: "unexpected" }
    }
  },
  restoreTestNow
);
assert.equal(unknownResultSummary.counts.unknown, 2);
assert.equal(unknownResultSummary.overall, "degraded");
assert.equal(unknownResultSummary.readiness.checks[0].status, "degraded");

const fixedTimeSummary = summarizeState(
  {
    settings: { alertWebhookEncrypted: "configured" },
    monitors: [],
    backups: [restoreProof],
    incidents: [],
    results: {}
  },
  restoreTestNow
);
assert.equal(fixedTimeSummary.overall, "healthy");
assert.equal(fixedTimeSummary.readiness.checks[1].status, "healthy");
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

const originalTlsConnect = tls.connect;
let successfulTlsDestroyed = false;
try {
  tls.connect = () => {
    const socket = new EventEmitter();
    socket.authorized = true;
    socket.authorizationError = null;
    socket.getPeerCertificate = () => ({
      valid_to: new Date(Date.now() - 60 * 60 * 1000).toUTCString()
    });
    socket.end = () => {};
    socket.destroy = () => {
      successfulTlsDestroyed = true;
    };
    queueMicrotask(() => socket.emit("secureConnect"));
    return socket;
  };
  const expiredTlsResult = await runMonitor({
    name: "Recently expired TLS",
    type: "tls",
    target: { host: "example.com", port: 443, warningDays: 21 }
  });
  assert.equal(expiredTlsResult.status, "down");
  assert.equal(expiredTlsResult.message, "Certificate expired");
  assert.equal(successfulTlsDestroyed, true);
} finally {
  tls.connect = originalTlsConnect;
}

let stalledTlsDestroyed = false;
try {
  tls.connect = () => {
    const socket = new EventEmitter();
    socket.authorized = true;
    socket.authorizationError = null;
    socket.getPeerCertificate = () => ({
      valid_to: new Date(Date.now() + 30 * 864e5).toUTCString()
    });
    socket.end = () => {};
    socket.destroy = (error) => {
      stalledTlsDestroyed = true;
      if (error) queueMicrotask(() => socket.emit("error", error));
    };
    setTimeout(() => socket.emit("secureConnect"), 120);
    return socket;
  };
  const stalledTlsResult = await runMonitor(
    {
      name: "Stalled TLS handshake",
      type: "tls",
      target: { host: "example.com", port: 443, warningDays: 1 }
    },
    { tlsTimeoutMs: 25 }
  );
  assert.equal(stalledTlsResult.status, "down");
  assert.equal(stalledTlsResult.message, "TLS connection timed out");
  assert.equal(stalledTlsDestroyed, true);
} finally {
  tls.connect = originalTlsConnect;
}

const originalCreateConnection = net.createConnection;
const stubbornTcpSockets = new Set();
const stubbornTcpServer = net.createServer({ allowHalfOpen: true }, (socket) => {
  stubbornTcpSockets.add(socket);
  socket.once("close", () => stubbornTcpSockets.delete(socket));
});
let successfulTcpSocket;
try {
  await new Promise((resolve) => stubbornTcpServer.listen(0, "127.0.0.1", resolve));
  const stubbornTcpPort = stubbornTcpServer.address().port;
  net.createConnection = (...args) => {
    successfulTcpSocket = originalCreateConnection(...args);
    return successfulTcpSocket;
  };
  const successfulTcpResult = await runMonitor(
    {
      name: "Stubborn successful TCP peer",
      type: "tcp",
      target: { host: "127.0.0.1", port: stubbornTcpPort }
    },
    { tcpTimeoutMs: 25 }
  );
  assert.equal(successfulTcpResult.status, "healthy");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(successfulTcpSocket.destroyed, true);
} finally {
  net.createConnection = originalCreateConnection;
  for (const socket of stubbornTcpSockets) socket.destroy();
  if (stubbornTcpServer.listening) {
    await new Promise((resolve) => stubbornTcpServer.close(resolve));
  }
}

let stalledTcpDestroyed = false;
try {
  net.createConnection = () => {
    const socket = new EventEmitter();
    socket.end = () => {};
    socket.destroy = (error) => {
      stalledTcpDestroyed = true;
      if (error) queueMicrotask(() => socket.emit("error", error));
    };
    setTimeout(() => socket.emit("connect"), 120);
    return socket;
  };
  const stalledTcpResult = await runMonitor(
    {
      name: "Stalled TCP connection",
      type: "tcp",
      target: { host: "127.0.0.1", port: 443 }
    },
    { tcpTimeoutMs: 25 }
  );
  assert.equal(stalledTcpResult.status, "down");
  assert.equal(stalledTcpResult.message, "TCP connection timed out");
  assert.equal(stalledTcpDestroyed, true);
} finally {
  net.createConnection = originalCreateConnection;
}

const originalDnsResolve = dns.resolve;
try {
  dns.resolve = () =>
    new Promise((resolve) => {
      setTimeout(() => resolve(["192.0.2.10"]), 120);
    });
  const dnsResult = await runMonitor(
    {
      name: "Slow DNS",
      type: "dns",
      target: { hostname: "example.com", recordType: "A" }
    },
    { dnsTimeoutMs: 25 }
  );
  assert.equal(dnsResult.status, "down");
  assert.equal(dnsResult.message, "DNS request timed out");
} finally {
  dns.resolve = originalDnsResolve;
}

let resolveMonitorDripClosed;
const monitorDripClosed = new Promise((resolve) => {
  resolveMonitorDripClosed = resolve;
});
let resolveSlowHeadersClosed;
const slowHeadersClosed = new Promise((resolve) => {
  resolveSlowHeadersClosed = resolve;
});
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
  if (_req.url === "/slow-headers") {
    const rawResponse = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let offset = 0;
    const interval = setInterval(() => {
      if (offset >= rawResponse.length) {
        clearInterval(interval);
        _req.socket.end();
        return;
      }
      _req.socket.write(rawResponse[offset]);
      offset += 1;
    }, 5);
    _req.socket.once("close", () => {
      clearInterval(interval);
      resolveSlowHeadersClosed();
    });
    return;
  }
  if (_req.url === "/drip") {
    res.writeHead(200, { "content-type": "text/plain" });
    const interval = setInterval(() => res.write("."), 5);
    const finish = setTimeout(() => {
      clearInterval(interval);
      res.end("done");
    }, 120);
    res.once("close", () => {
      clearInterval(interval);
      clearTimeout(finish);
    });
    return;
  }
  if (_req.url === "/monitor-drip") {
    res.writeHead(200, { "content-type": "text/plain" });
    const interval = setInterval(() => res.write("."), 5);
    const finish = setTimeout(() => {
      clearInterval(interval);
      res.end("done");
    }, 120);
    res.once("close", () => {
      clearInterval(interval);
      clearTimeout(finish);
      resolveMonitorDripClosed();
    });
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
  const slowHeaderHttp = await runMonitor(
    {
      ...monitor,
      target: { url: `http://127.0.0.1:${port}/slow-headers` }
    },
    { httpTimeoutMs: 25 }
  );
  assert.equal(slowHeaderHttp.status, "down");
  assert.equal(slowHeaderHttp.message, "HTTP request timed out");
  assert.equal(
    await Promise.race([
      slowHeadersClosed.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 40))
    ]),
    true
  );
  const streamingHttp = await runMonitor({
    ...monitor,
    target: { url: `http://127.0.0.1:${port}/monitor-drip` }
  });
  assert.equal(streamingHttp.status, "healthy");
  assert.equal(
    await Promise.race([
      monitorDripClosed.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 40))
    ]),
    true
  );

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
    () => postJsonToSafeUrl(`http://127.0.0.1:${port}/drip`, { ok: true }, { timeoutMs: 25 }),
    /timed out/
  );
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
