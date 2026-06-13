import crypto from "node:crypto";

const TOKEN_PREFIX = "hop";
const TOKEN_BYTES = 32;

export function createHeartbeatToken() {
  return `${TOKEN_PREFIX}_${crypto.randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

export function hashHeartbeatToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("base64url");
}

export function describeHeartbeatToken(token) {
  const value = String(token);
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

export function readBearerToken(req) {
  const value = String(req.headers.authorization || "");
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length).trim();
  if (!token || token.length > 160) return null;
  return token;
}

export function verifyHeartbeatToken(providedToken, expectedHash) {
  if (!providedToken || !expectedHash) return false;
  const actual = Buffer.from(hashHeartbeatToken(providedToken), "base64url");
  const expected = Buffer.from(String(expectedHash), "base64url");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
