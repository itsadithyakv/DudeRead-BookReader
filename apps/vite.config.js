import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../packages/shared", import.meta.url))
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020"
  },
  server: {
    strictPort: true,
    port: 1420
  }
});
