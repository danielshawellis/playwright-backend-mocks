import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "cli/cli.ts" },
  format: ["cjs"],
  dts: false,
  clean: false,
  sourcemap: true,
  shims: true,
  outDir: "dist",
  banner: {
    js: "#!/usr/bin/env node",
  },
});
