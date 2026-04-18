import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    port: 5173,
    allowedHosts: ["frolic-hence-freestyle.ngrok-free.dev", ".ngrok-free.dev"],
    proxy: {
      "/api": {
        target: "http://localhost:3002",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3002",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        login: resolve(__dirname, "index.html"),
        hostLogin: resolve(__dirname, "host-login.html"),
        arena: resolve(__dirname, "arena.html"),
        host: resolve(__dirname, "host.html"),
      },
    },
  },
});
