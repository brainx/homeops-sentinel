import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.HOMEOPS_VITE_BACKEND_PORT || process.env.PORT || "4747";
const configuredVitePort = Number(process.env.HOMEOPS_VITE_PORT || "5173");
const vitePort =
  Number.isInteger(configuredVitePort) && configuredVitePort > 0 && configuredVitePort <= 65535
    ? configuredVitePort
    : 5173;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: vitePort,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${backendPort}`
    }
  },
  build: {
    outDir: "dist",
    sourcemap: true
  }
});
