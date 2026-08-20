import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const backendPort = process.env.PORT || "4747";
const vitePort = process.env.HOMEOPS_VITE_PORT || "5173";
const viteHost = "127.0.0.1";
const viteCli =
  process.env.HOMEOPS_DEV_VITE_CLI ||
  fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const env = {
  ...process.env,
  PORT: backendPort,
  HOMEOPS_DATA_DIR: process.env.HOMEOPS_DATA_DIR || "./data",
  HOMEOPS_DEV_ORIGIN: `http://${viteHost}:${vitePort}`,
  HOMEOPS_VITE_BACKEND_PORT: backendPort,
  HOMEOPS_VITE_PORT: vitePort
};

const processes = [
  spawn(process.execPath, ["server/index.js"], { stdio: "inherit", env }),
  spawn(process.execPath, [viteCli, "--host", viteHost, "--port", vitePort, "--strictPort"], {
    stdio: "inherit",
    env
  })
];
let shuttingDown = false;
let shutdownPromise = null;

function shutdown(signal, exitCode) {
  if (shutdownPromise) {
    if (exitCode !== 0) process.exitCode = exitCode;
    return shutdownPromise;
  }

  shuttingDown = true;
  process.exitCode = exitCode;
  for (const child of processes) {
    if (child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      child.kill(signal);
    }
  }
  shutdownPromise = Promise.all(processes.map(waitForClose));
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown("SIGINT", 0));
process.once("SIGTERM", () => void shutdown("SIGTERM", 0));

for (const child of processes) {
  child.once("error", (error) => {
    console.error(`Development child process failed to start: ${error.message}`);
    void shutdown("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    void shutdown("SIGTERM", typeof code === "number" ? code : signal ? 1 : 0);
  });
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 35_000);
    child.once("close", () => {
      clearTimeout(forceTimer);
      resolve();
    });
  });
}
