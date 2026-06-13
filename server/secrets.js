import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const AAD = Buffer.from("homeops-sentinel-secret-v1", "utf8");
const WEAK_CONFIGURED_SECRETS = new Set([
  "local-development-secret-change-me",
  ["secret", "key", "here"].join("_"),
  ["real", "api", "key"].join("_"),
  "change-me-change-me-change-me-change-me"
]);

function readOrCreateSecret(secretFile) {
  const configured = process.env.HOMEOPS_SECRET_KEY || process.env.APP_SEED;
  if (configured) {
    validateSecretMaterial(configured, "Configured secret material");
    return configured;
  }

  fs.mkdirSync(path.dirname(secretFile), { recursive: true, mode: 0o700 });
  try {
    const stored = fs.readFileSync(secretFile, "utf8").trim();
    validateSecretMaterial(stored, "Stored secret material");
    return stored;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const generated = crypto.randomBytes(32).toString("base64url");
    fs.writeFileSync(secretFile, `${generated}\n`, { mode: 0o600 });
    return generated;
  }
}

function validateSecretMaterial(value, label) {
  if (WEAK_CONFIGURED_SECRETS.has(value) || String(value || "").length < 32) {
    throw new Error(`${label} is too weak`);
  }
}

export function createSecretBox(secretFile) {
  const keyMaterial = readOrCreateSecret(secretFile);
  const key = crypto.createHash("sha256").update(keyMaterial).digest();

  return {
    encrypt(value) {
      if (!value) return null;
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
    },

    decrypt(payload) {
      if (!payload) return null;
      const [version, ivRaw, tagRaw, ciphertextRaw] = String(payload).split(":");
      if (version !== "v1" || !ivRaw || !tagRaw || !ciphertextRaw) {
        throw new Error("Unsupported secret payload");
      }

      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
      decipher.setAAD(AAD);
      decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
      const clear = Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, "base64url")),
        decipher.final()
      ]);
      return clear.toString("utf8");
    },

    mask(payload) {
      if (!payload) return { configured: false, label: "Not configured" };
      try {
        const value = this.decrypt(payload);
        const url = new URL(value);
        return { configured: true, label: `${url.protocol}//${url.host}/...` };
      } catch {
        return { configured: true, label: "Configured" };
      }
    }
  };
}
