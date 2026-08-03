import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  base: "./",
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
});
