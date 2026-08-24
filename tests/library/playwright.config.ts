import { defineConfig } from "@playwright/test";

/**
 * Library-only suite — product concerns outside the dual-mode oracle:
 * clientId filtering, cross-test ambiguous_route, disconnect / auth,
 * observability (proxy REST + dashboard), and wire-level passthrough/continue
 * (encoding × framing) against a local HTTP/1.1 upstream with CDN-like shapes.
 *
 * No browser / shared upstream fixtures; each spec spins its own proxy (+ agents).
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
