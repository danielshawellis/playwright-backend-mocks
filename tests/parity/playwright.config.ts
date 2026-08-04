import { defineConfig, devices } from "@playwright/test";

/**
 * Oracle suite pin (see README.md):
 * - @playwright/test npm: 1.62.1
 * - microsoft/playwright research inventory: 15b1aec
 * - implementation reference SHA: 26a9e47
 *
 * PARITY_MODE=browser (default) — stock Playwright page.route + browser downstream
 * PARITY_MODE=node — Node downstream + backendMocks (proxy + startBackendMocks)
 * PARITY_NODE_FULL=1 — with node mode, run the full suite
 */
export const PLAYWRIGHT_NPM_VERSION = "1.62.1";
export const PLAYWRIGHT_RESEARCH_COMMIT = "15b1aec";
export const PLAYWRIGHT_PIN_SHA = "26a9e47";

const mode = process.env.PARITY_MODE === "node" ? "node" : "browser";
const nodeFull = process.env.PARITY_NODE_FULL === "1";

const browserHarnessUrl = "http://127.0.0.1:3000";
const nodeDownstreamUrl = "http://127.0.0.1:3001";
const upstreamUrl = "http://127.0.0.1:4001";
const wsUpstreamUrl = "http://127.0.0.1:4002";
const proxyUrl = "http://127.0.0.1:4310";

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

const proxyServer = {
  command:
    "pnpm --filter @playwright-backend-mocks/proxy start -- --host 127.0.0.1 --port 4310 --log-level warn",
  url: `${proxyUrl}/health`,
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
  env: {
    ...process.env,
  },
};

const downstreamServer =
  mode === "node"
    ? {
        command: "pnpm --filter @playwright-backend-mocks/fixture-node-downstream start",
        url: `${nodeDownstreamUrl}/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          ...process.env,
          PORT: "3001",
          ENABLE_BACKEND_MOCKS: "1",
          PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: proxyUrl,
          CLIENT_ID: "parity-node",
        },
      }
    : {
        command: "pnpm --filter @playwright-backend-mocks/fixture-browser-harness start",
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
  // Node mode without FULL still runs passthrough smokes; routed cases need the library.
  ...(mode === "node" && !nodeFull ? { testMatch: "**/smoke-passthrough.spec.ts" } : {}),
  use: {
    ...devices["Desktop Chrome"],
    baseURL: mode === "node" ? nodeDownstreamUrl : browserHarnessUrl,
  },
  webServer:
    mode === "node"
      ? [...sharedServers, proxyServer, downstreamServer]
      : [...sharedServers, downstreamServer],
});
