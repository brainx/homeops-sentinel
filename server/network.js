import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { APP_VERSION } from "./config.js";

export function parseIpAddress(address) {
  const value = String(address || "")
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return { address: mapped[1], family: 4, mapped: true };
  const mappedHex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    if (Number.isFinite(high) && Number.isFinite(low)) {
      return {
        address: `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`,
        family: 4,
        mapped: true
      };
    }
  }
  const family = net.isIP(value);
  return family ? { address: value, family, mapped: false } : null;
}

export function isBlockedAddress(address, options = {}) {
  const parsed = parseIpAddress(address);
  if (!parsed) return false;

  if (parsed.family === 4) {
    const parts = parsed.address.split(".").map((part) => Number.parseInt(part, 10));
    const first = parts[0];
    const second = parts[1];
    return (
      first === 0 ||
      (options.blockLoopback === true && first === 127) ||
      (options.blockPrivate === true && isPrivateIpv4(parts)) ||
      (first === 169 && second === 254) ||
      first >= 224 ||
      parsed.address === "255.255.255.255"
    );
  }

  const groups = parsed.address.split(":");
  const firstGroup = groups[0];
  const firstValue = Number.parseInt(firstGroup || "0", 16);
  return (
    parsed.address === "::" ||
    (options.blockLoopback === true && parsed.address === "::1") ||
    (options.blockPrivate === true && firstValue >= 0xfc00 && firstValue <= 0xfdff) ||
    (options.blockPrivate === true &&
      firstValue === 0x2001 &&
      Number.parseInt(groups[1] || "0", 16) === 0x0db8) ||
    (firstValue >= 0xfe80 && firstValue <= 0xfebf) ||
    (firstValue >= 0xff00 && firstValue <= 0xffff)
  );
}

function isPrivateIpv4(parts) {
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 0 && parts[2] === 2) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && parts[2] === 100) ||
    (first === 203 && second === 0 && parts[2] === 113)
  );
}

export function assertAllowedHost(host, options = {}) {
  if (!isBlockedAddress(host, options)) return;
  throw new Error("target host is blocked");
}

export async function resolveSafeAddress(host, options = {}, lookup = dns.lookup) {
  const literal = parseIpAddress(host);
  if (literal) {
    assertAllowedHost(literal.address, options);
    return { address: literal.address, family: literal.family };
  }

  const records = await lookup(host, { all: true, verbatim: false });
  const addresses = Array.isArray(records) ? records : [records];
  if (addresses.length === 0) {
    throw new Error("target host did not resolve");
  }
  const blocked = addresses.find(
    (record) => record?.address && isBlockedAddress(record.address, options)
  );
  if (blocked) {
    throw new Error("target host is blocked");
  }
  const selected = addresses.find((record) => record?.address && net.isIP(record.address));
  if (!selected) {
    throw new Error("target host did not resolve to an IP address");
  }
  const normalized = parseIpAddress(selected.address);
  return {
    address: normalized?.address || selected.address,
    family: normalized?.family || selected.family
  };
}

export function createSafeLookup(options = {}) {
  return (hostname, lookupOptions, callback) => {
    const done = typeof lookupOptions === "function" ? lookupOptions : callback;
    resolveSafeAddress(hostname, options)
      .then((result) => done(null, result.address, result.family))
      .catch((error) => done(error));
  };
}

export function normalizeOutboundUrl(value, options = {}) {
  const raw = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${options.label || "url"} must be a valid URL`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${options.label || "url"} must use http or https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${options.label || "url"} must not include credentials`);
  }
  assertAllowedHost(parsed.hostname, options);
  return parsed;
}

export async function postJsonToSafeUrl(url, payload, options = {}) {
  const maxRedirects = options.maxRedirects ?? 2;
  let current = normalizeOutboundUrl(url, { ...options, label: options.label || "webhookUrl" });

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const result = await sendJsonOnce(current, payload, options);
    if (!isRedirect(result.statusCode)) return result;
    if (redirectCount === maxRedirects) throw new Error("Webhook redirected too many times");
    const location = result.headers.location;
    if (!location) throw new Error("Webhook redirect did not include a location");
    current = normalizeOutboundUrl(new URL(location, current).toString(), {
      ...options,
      label: options.label || "webhookUrl"
    });
  }

  throw new Error("Webhook redirected too many times");
}

function isRedirect(statusCode) {
  return [301, 302, 303, 307, 308].includes(statusCode);
}

function sendJsonOnce(url, payload, options) {
  const body = JSON.stringify(payload);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        lookup: createSafeLookup(options),
        timeout: options.timeoutMs ?? 5000,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": `HomeOps-Sentinel/${APP_VERSION}`
        }
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          const statusCode = response.statusCode || 0;
          if (statusCode >= 400) {
            reject(new Error(`Webhook returned HTTP ${statusCode}`));
            return;
          }
          resolve({ statusCode, headers: response.headers });
        });
      }
    );
    req.setTimeout(options.timeoutMs ?? 5000, () =>
      req.destroy(new Error("Webhook request timed out"))
    );
    req.once("error", reject);
    req.end(body);
  });
}
