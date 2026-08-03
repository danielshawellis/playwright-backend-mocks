import { defineConfig, devices } from "@playwright/test";

/**
 * Oracle suite pin (see README.md):
 * - @playwright/test npm: 1.62.1
 * - microsoft/playwright research inventory: 15b1aec
 *
 * PARITY_MODE=browser (default) — stock Playwright page.route + browser downstream
 * PARITY_MODE=node — Node downstream via control-plane WebSocket (Step 2: + backendMocks)
 * PARITY_NODE_FULL=1 — with node mode, run the full suite (expect mostly red until Step 2)
 */
export const PLAYWRIGHT_NPM_VERSION = "1.62.1";
export const PLAYWRIGHT_RESEARCH_COMMIT = "15b1aec";

const mode = process.env.PARITY_MODE === "node" ? "node" : "browser";
const nodeFull = process.env.PARITY_NODE_FULL === "1";

const browserHarnessUrl = "http://127.0.0.1:3000";
const nodeDownstreamUrl = "http://127.0.0.1:3001";
const upstreamUrl = "http://127.0.0.1:4001";
const wsUpstreamUrl = "http://127.0.0.1:4002";

const sharedServers = [
  {
    command: "pnpm --filter @playwright-backend-mocks/fixture-upstream start",
    url: `${upstreamUrl}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      PORT: "4001",
    },
  },
  {
    command: "pnpm --filter @playwright-backend-mocks/fixture-ws-upstream start",
    url: `${wsUpstreamUrl}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      PORT: "4002",
    },
  },
];

const downstreamServer =
  mode === "node"
    ? {
        command:
          "pnpm --filter @playwright-backend-mocks/fixture-node-downstream start",
        url: `${nodeDownstreamUrl}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          ...process.env,
          PORT: "3001",
        },
      }
    : {
        command:
          "pnpm --filter @playwright-backend-mocks/fixture-browser-harness start",
        url: `${browserHarnessUrl}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          ...process.env,
          PORT: "3000",
        },
      };

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  // Until Step 2 wires backendMocks, node mode defaults to passthrough smokes only.
  ...(mode === "node" && !nodeFull
    ? { testMatch: "**/smoke-passthrough.spec.ts" }
    : {}),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: mode === "node" ? nodeDownstreamUrl : browserHarnessUrl,
  },
  webServer: [...sharedServers, downstreamServer],
});
