import fs from "node:fs";
import path from "node:path";

export const APP_NAME = "HomeOps Sentinel";
export const APP_VERSION = "0.1.0";

export function getConfig() {
  const port = Number.parseInt(process.env.PORT || "4747", 10);
  const host = process.env.HOST || "127.0.0.1";
  const dataDir = process.env.HOMEOPS_DATA_DIR || path.resolve(process.cwd(), "data");
  const staticDir = process.env.HOMEOPS_STATIC_DIR || path.resolve(process.cwd(), "dist");

  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("PORT must be an integer between 1024 and 65535");
  }
  if (typeof host !== "string" || !host.trim() || host.includes("/")) {
    throw new Error("HOST must be a bind address or hostname");
  }

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  return {
    host,
    port,
    dataDir,
    staticDir,
    dataFile: path.join(dataDir, "homeops-sentinel.json"),
    secretFile: path.join(dataDir, ".homeops-secret")
  };
}
