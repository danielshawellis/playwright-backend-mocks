# Getting Started

Get from zero to a working backend mock in four steps.

## Prerequisites

- Node.js 20+
- A Playwright test project (`@playwright/test` ≥ 1.40)
- One or more Node.js processes that make outbound HTTP/HTTPS calls during tests

## Install

```bash
npm install -D @playwright-backend-mocks/playwright \
  @playwright-backend-mocks/node \
  @playwright-backend-mocks/proxy
```

Or with pnpm / yarn:

```bash
pnpm add -D @playwright-backend-mocks/playwright \
  @playwright-backend-mocks/node \
  @playwright-backend-mocks/proxy
```

Keep these packages on the **same version**.

## 1. Start the proxy

The proxy coordinates mock decisions between Playwright and your Node app. Start it with Playwright's `webServer` so it comes up with your tests:

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import type { BackendMocksWorkerOptions } from "@playwright-backend-mocks/playwright";

const proxyUrl = "http://127.0.0.1:4310";

export default defineConfig<object, BackendMocksWorkerOptions>({
  use: {
    backendMocksProxyUrl: proxyUrl,
  },
  webServer: [
    {
      command: "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
      url: `${proxyUrl}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npm run start:e2e",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      env: {
        PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: proxyUrl,
      },
    },
  ],
});
```

Open `http://127.0.0.1:4310/dashboard` while tests run for a live view of connections and request history.

## 2. Enable the Node agent in your app

Call `startBackendMocks` early in your application startup. When the proxy URL env var is unset, this is a **no-op** — safe to leave in production code paths:

```ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

if (process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL !== undefined) {
  await startBackendMocks({
    proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
    clientId: "api-server",
  });
}
```

Give each process a stable `clientId` if you run more than one Node agent (API + worker, etc.). See [Multiple processes](/guide/multiple-processes).

## 3. Compose the Playwright fixture

```ts
// tests/fixtures.ts
import { mergeTests } from "@playwright/test";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";
import { test as appTest } from "./application-fixtures";

export const test = mergeTests(appTest, backendMocksTest);
export { expect } from "@playwright/test";
```

If you don't have other custom fixtures yet, import `test` and `expect` directly from `@playwright-backend-mocks/playwright`.

## 4. Mock backend traffic in a test

```ts
import { test, expect } from "./fixtures";

test("handles a declined payment", async ({ page, backendMocks }) => {
  await backendMocks.route("https://payments.example.test/charges", async (route) => {
    await route.fulfill({
      status: 402,
      json: { error: "card_declined" },
    });
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText("Your card was declined")).toBeVisible();
});
```

That's the core loop: **register a route → exercise the UI → assert**.

## Next steps

- [Concepts](/guide/concepts) — how the proxy, agent, and fixture fit together
- [Mocking requests](/guide/mocking-requests) — `fulfill`, `continue`, `fetch`, `abort`
- [Matching requests](/guide/matching-requests) — globs, RegExp, method, `clientId`
- [Recipes](/recipes/compose-fixtures) — common patterns
