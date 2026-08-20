import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { APP_VERSION } from "./config.js";

const DEFAULT_LOOKUP_TIMEOUT_MS = 8000;

export function parseIpAddress(address) {
  const value = String(address || "")
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  const family = net.isIP(value);
  if (family === 6) {
    const groups = expandIpv6Groups(value);
    if (groups?.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
      const high = groups[6];
      const low = groups[7];
      return {
        address: `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`,
        family: 4,
        mapped: true
      };
    }
  }
  return family ? { address: value, family, mapped: false } : null;
}

function expandIpv6Groups(address) {
  const zoneIndex = address.lastIndexOf("%");
  let normalized = zoneIndex >= 0 ? address.slice(0, zoneIndex) : address;
  if (normalized.includes(".")) {
    const separator = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(separator + 1);
    if (separator < 0 || net.isIP(ipv4) !== 4) return null;
    const bytes = ipv4.split(".").map(Number);
    normalized = `${normalized.slice(0, separator + 1)}${((bytes[0] << 8) | bytes[1]).toString(
      16
    )}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((group) =>
    Number.parseInt(group, 16)
  );
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null;
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

  const groups = expandIpv6Groups(parsed.address);
  if (!groups) return true;
  const firstValue = groups[0];
  const isUnspecified = groups.every((group) => group === 0);
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  const isLocalUseTranslation =
    groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0x0001;
  const translatedIpv4 = ipv4TranslationTarget(groups);
  return (
    isUnspecified ||
    (options.blockLoopback === true && isLoopback) ||
    (translatedIpv4 !== null && isBlockedAddress(translatedIpv4, options)) ||
    (options.blockPrivate === true && firstValue >= 0xfc00 && firstValue <= 0xfdff) ||
    (options.blockPrivate === true && isLocalUseTranslation) ||
    (options.blockPrivate === true && firstValue >= 0xfec0 && firstValue <= 0xfeff) ||
    (options.blockPrivate === true && firstValue === 0x2001 && groups[1] === 0x0db8) ||
    (firstValue >= 0xfe80 && firstValue <= 0xfebf) ||
    (firstValue >= 0xff00 && firstValue <= 0xffff)
  );
}

function ipv4TranslationTarget(groups) {
  const isWellKnownNat64 =
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0);
  const isIpv4Translatable =
    groups.slice(0, 4).every((group) => group === 0) && groups[4] === 0xffff && groups[5] === 0;
  if (!isWellKnownNat64 && !isIpv4Translatable) return null;

  const high = groups[6];
  const low = groups[7];
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
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
  const addresses = await resolveSafeAddresses(host, options, lookup);
  return addresses[0];
}

async function resolveSafeAddresses(host, options = {}, lookup = dns.lookup, lookupOptions = {}) {
  const literal = parseIpAddress(host);
  if (literal) {
    assertAllowedHost(literal.address, options);
    return [{ address: literal.address, family: literal.family }];
  }

  const family = [4, 6].includes(lookupOptions.family) ? lookupOptions.family : undefined;
  const records = await lookup(host, { all: true, verbatim: false, ...(family ? { family } : {}) });
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
  const normalized = addresses
    .filter((record) => record?.address && net.isIP(record.address))
    .map((record) => {
      const parsed = parseIpAddress(record.address);
      return {
        address: parsed?.address || record.address,
        family: parsed?.family || record.family
      };
    });
  if (normalized.length === 0) {
    throw new Error("target host did not resolve to an IP address");
  }
  return normalized;
}

export function createSafeLookup(options = {}) {
  return (hostname, lookupOptions, callback) => {
    const done = typeof lookupOptions === "function" ? lookupOptions : callback;
    const requestedOptions =
      lookupOptions && typeof lookupOptions === "object"
        ? lookupOptions
        : Number.isInteger(lookupOptions)
          ? { family: lookupOptions }
          : {};
    withTimeout(
      resolveSafeAddresses(hostname, options, dns.lookup, requestedOptions),
      options.lookupTimeoutMs ?? options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS,
      "target host lookup timed out"
    )
      .then((addresses) => {
        if (requestedOptions.all === true) {
          done(null, addresses);
          return;
        }
        done(null, addresses[0].address, addresses[0].family);
      })
      .catch((error) => done(error));
  };
}

function withTimeout(operation, timeoutMs, message) {
  let timer;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
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
  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise((resolve, reject) => {
    let response;
    let wallClockTimer;
    let settled = false;
    let req;
    const settle = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallClockTimer);
      if (req) req.setTimeout(0);
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    req = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        lookup: createSafeLookup(options),
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": `HomeOps-Sentinel/${APP_VERSION}`
        }
      },
      (incomingResponse) => {
        response = incomingResponse;
        response.resume();
        response.once("error", (error) => settle(error));
        response.once("aborted", () => settle(new Error("Webhook response was aborted")));
        response.once("end", () => {
          const statusCode = response.statusCode || 0;
          if (statusCode >= 400) {
            settle(new Error(`Webhook returned HTTP ${statusCode}`));
            return;
          }
          settle(null, { statusCode, headers: response.headers });
        });
      }
    );
    wallClockTimer = setTimeout(() => {
      const error = new Error("Webhook request timed out");
      settle(error);
      response?.destroy(error);
      req.destroy(error);
    }, timeoutMs);
    req.setTimeout(timeoutMs, () => {
      const error = new Error("Webhook request timed out");
      settle(error);
      response?.destroy(error);
      req.destroy(error);
    });
    req.once("error", (error) => settle(error));
    req.end(body);
  });
}
