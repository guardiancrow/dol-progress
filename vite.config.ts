import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Desktop devUrl is served by Vite, so enforce the same policy as Tauri's devCsp here.
    headers: {
      "Content-Security-Policy": "connect-src 'self' ipc: http://ipc.localhost ws://localhost:1420 ws://127.0.0.1:1420 https://api.github.com/repos/guardiancrow/dol-progress/releases/latest",
    },
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. ignore Rust output and temporary runtime fixtures.
      ignored: ["**/src-tauri/**", "**/tmp/**"],
    },
  },
}));
