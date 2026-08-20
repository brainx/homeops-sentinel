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
    return readStoredSecret(secretFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return createSecretFile(secretFile);
  }
}

function readStoredSecret(secretFile) {
  const stored = fs.readFileSync(secretFile, "utf8").trim();
  validateSecretMaterial(stored, "Stored secret material");
  return stored;
}

function createSecretFile(secretFile) {
  const generated = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(8).toString("hex");
  const temporaryFile = `${secretFile}.${process.pid}.${nonce}.tmp`;
  let handle;
  let prepared = false;
  try {
    handle = fs.openSync(temporaryFile, "wx", 0o600);
    fs.writeFileSync(handle, `${generated}\n`, "utf8");
    fs.fsyncSync(handle);
    prepared = true;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    if (!prepared) removeTemporarySecret(temporaryFile);
  }

  let installed = false;
  try {
    fs.linkSync(temporaryFile, secretFile);
    installed = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    removeTemporarySecret(temporaryFile);
  }

  if (!installed) return readStoredSecret(secretFile);
  syncDirectory(path.dirname(secretFile));
  return generated;
}

function removeTemporarySecret(temporaryFile) {
  try {
    fs.unlinkSync(temporaryFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function syncDirectory(directory) {
  let handle;
  try {
    handle = fs.openSync(directory, "r");
    fs.fsyncSync(handle);
  } catch (error) {
    if (!["EINVAL", "EISDIR", "EPERM", "ENOTSUP"].includes(error.code)) throw error;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
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
