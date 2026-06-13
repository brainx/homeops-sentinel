import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PLAYWRIGHT_PORT || "4761", 10);
const baseURL = `http://${host}:${port}`;
const runId = process.env.HOMEOPS_PLAYWRIGHT_RUN_ID || `${Date.now()}-${process.pid}`;
const runRoot = path.join(process.cwd(), "tmp", "playwright", runId);

export default defineConfig({
  testDir: ".",
  testMatch: ["tests/e2e/**/*.spec.ts", "tests/a11y/**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(runRoot, "results"),
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: {
    command: "npm run build && npm start",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      HOST: host,
      PORT: String(port),
      HOMEOPS_DATA_DIR: path.join(runRoot, "data"),
      HOMEOPS_STATIC_DIR: path.join(process.cwd(), "dist"),
      NODE_ENV: "production"
    }
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
