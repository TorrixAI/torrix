import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    rollupOptions: {
      output: {
        // One vendor chunk for all node_modules (a single chunk cannot form a
        // react<->vendor cycle), with ECharts split off so it loads only with
        // the chart pages.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("echarts") || id.includes("zrender")) return "echarts";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8088",
      "/auth": "http://127.0.0.1:8088",
      "/proxy": "http://127.0.0.1:8088",
      "/ui/logout": "http://127.0.0.1:8088",
      "/ui/session": "http://127.0.0.1:8088",
      "/ui/sso-complete": "http://127.0.0.1:8088",
      "/ui/fonts": "http://127.0.0.1:8088",
    },
  },
});
