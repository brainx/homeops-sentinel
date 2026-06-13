import { spawn } from "node:child_process";
import process from "node:process";

const env = {
  ...process.env,
  PORT: process.env.PORT || "4747",
  HOMEOPS_DATA_DIR: process.env.HOMEOPS_DATA_DIR || "./data",
  HOMEOPS_DEV_ORIGIN: "http://127.0.0.1:5173"
};

const processes = [
  spawn(process.execPath, ["server/index.js"], { stdio: "inherit", env }),
  spawn("npm", ["exec", "--", "vite", "--host", "127.0.0.1", "--port", "5173"], {
    stdio: "inherit",
    env
  })
];

function shutdown(signal) {
  for (const child of processes) child.kill(signal);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

for (const child of processes) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      shutdown("SIGTERM");
      process.exit(code);
    }
  });
}
