/**
 * ESLint baseline aligned with Playwright pin 26a9e47 (/eslint.config.mjs),
 * adapted for this monorepo (NodeNext packages + parity suite).
 *
 * We keep Playwright-friendly rules (unused vars args:none, prefer-const,
 * eqeqeq, single quotes via Prettier coexistence softened) without importing
 * Playwright-only plugins (notice copyright, react, progress).
 */
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "historical/**",
      "fixtures/**/public/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.vue",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Playwright pin: args/caughtErrors "none" so parity-shaped signatures lint cleanly.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none" },
      ],
      // DIVERGENCE from Playwright: keep no-explicit-any as warn so gradual
      // porting of Route/Request edges does not block the dual-mode gate.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "no-console": "off",
    },
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      // Prefer explicit returns in public package APIs; allow console in CLI/proxy.
      "no-console": "off",
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "commonjs",
    },
  },
);
