import { defineConfig, devices } from "@playwright/test";

/**
 * Oracle suite pin (see README.md):
 * - @playwright/test npm: 1.62.1
 * - microsoft/playwright research inventory: 15b1aec
 */
export const PLAYWRIGHT_NPM_VERSION = "1.62.1";
export const PLAYWRIGHT_RESEARCH_COMMIT = "15b1aec";

const harnessUrl = "http://127.0.0.1:3000";
const upstreamUrl = "http://127.0.0.1:4001";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: harnessUrl,
  },
  webServer: [
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
      command: "pnpm --filter @playwright-backend-mocks/fixture-browser-harness start",
      url: `${harnessUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        ...process.env,
        PORT: "3000",
      },
    },
  ],
});
