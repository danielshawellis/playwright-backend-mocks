import { defineConfig } from "@playwright/test";

/**
 * Library-only suite — product concerns outside the dual-mode oracle:
 * clientId filtering, cross-test ambiguous_route, disconnect / auth,
 * and observability (proxy REST + dashboard).
 *
 * No browser / upstream fixtures; each spec spins its own proxy (+ agents).
 */
export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  // These specs do not use page/context; skip browser install requirements.
  projects: [{ name: "library", testMatch: "**/*.spec.ts" }],
});
