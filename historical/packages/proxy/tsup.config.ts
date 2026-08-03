import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["cjs"],
    dts: false,
    clean: false,
    sourcemap: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
