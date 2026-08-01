import { defineConfig } from "@playwright/test";
import type { BackendMocksWorkerOptions } from "@playwright-backend-mocks/playwright";

const proxyUrl = "http://127.0.0.1:4310";
const appUrl = "http://127.0.0.1:3000";
const workerUrl = "http://127.0.0.1:3001";
const upstreamUrl = "http://127.0.0.1:4001";

export default defineConfig<object, BackendMocksWorkerOptions>({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: appUrl,
    backendMocksProxyUrl: proxyUrl,
  },
  webServer: [
    {
      command:
        "node ../../packages/proxy/dist/cli.cjs --host 127.0.0.1 --port 4310 --log-level warn",
      url: `${proxyUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
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
      command: "pnpm --filter @playwright-backend-mocks/fixture-api-server start",
      url: `${appUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: "3000",
        UPSTREAM_URL: upstreamUrl,
        PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: proxyUrl,
      },
    },
    {
      command: "pnpm --filter @playwright-backend-mocks/fixture-worker start",
      url: `${workerUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: "3001",
        UPSTREAM_URL: upstreamUrl,
        PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: proxyUrl,
      },
    },
  ],
});
