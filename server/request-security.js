export const INTENT_HEADER = "x-homeops-intent";
export const INTENT_VALUE = "same-origin";

export function isHeartbeatEndpoint(method, pathname) {
  return method === "POST" && /^\/api\/backups\/[^/]+\/heartbeat$/.test(pathname);
}

export function assertRequestProvenance(req, url) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
  if (isHeartbeatEndpoint(req.method, url.pathname)) return;

  assertFetchMetadata(req);
  assertSameOrigin(req);

  if (req.headers[INTENT_HEADER] !== INTENT_VALUE) {
    throw new Error("Missing same-origin request intent");
  }
}

function assertFetchMetadata(req) {
  const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (!site) return;
  if (["same-origin", "same-site", "none"].includes(site)) return;
  throw new Error("Cross-site request rejected");
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (process.env.HOMEOPS_DEV_ORIGIN && origin === process.env.HOMEOPS_DEV_ORIGIN) return;
  const host = req.headers.host;
  if (!host) throw new Error("Missing Host header");
  const parsed = new URL(origin);
  if (parsed.host !== host) throw new Error("Cross-origin request rejected");
}
