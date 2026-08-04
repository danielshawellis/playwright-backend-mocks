# Getting started

Get from a Playwright project to a working backend mock in four steps: install the packages, start the proxy, enable the Node agent, compose the fixture, then write a route.

## Prerequisites

| Requirement | Version |
| --- | --- |
| Node.js | `>=20` |
| Playwright | `@playwright/test@1.62.1` |
| Packages | `@playwright-backend-mocks/playwright`, `node`, `proxy` |

::: tip
Keep `@playwright-backend-mocks/playwright`, `@playwright-backend-mocks/node`, `@playwright-backend-mocks/proxy`, and `@playwright-backend-mocks/protocol` on the same version.
:::

## 1. Install

```bash
pnpm add -D @playwright/test@1.62.1 \
  @playwright-backend-mocks/playwright \
  @playwright-backend-mocks/node \
  @playwright-backend-mocks/proxy
```

With npm:

```bash
npm install -D @playwright/test@1.62.1 \
  @playwright-backend-mocks/playwright \
  @playwright-backend-mocks/node \
  @playwright-backend-mocks/proxy
```

## 2. Start the proxy with Playwright

The proxy coordinates decisions between the Playwright worker and your Node process. Start it in `webServer` and pass the same URL to the fixture and the app.

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

Use `PLAYWRIGHT_BACKEND_MOCKS_TOKEN` and `backendMocksToken` as matching shared secrets if the proxy is exposed beyond the local test machine.

## 3. Enable the Node agent

Call `startBackendMocks()` early in the app process. When no proxy URL is configured, the agent returns a no-op handle and does not intercept traffic.

```ts
// app/start-backend-mocks.ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

export async function startTestNetworkMocks() {
  return startBackendMocks({
    proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
    token: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
    clientId: "api-server",
  });
}
```

```ts
// app/server.ts
import { startTestNetworkMocks } from "./start-backend-mocks";

const backendMocksAgent = await startTestNetworkMocks();

process.once("SIGTERM", async () => {
  await backendMocksAgent.stop();
});

// Start the rest of your app normally.
```

`clientId` is optional, but stable names make multi-process tests easier. See [Multiple processes](/guide/multi-process).

## 4. Compose the Playwright fixture

If you already have application fixtures, compose them with `mergeTests`.

```ts
// tests/fixtures.ts
import { mergeTests } from "@playwright/test";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";
import { test as appTest } from "./application-fixtures";

export const test = mergeTests(appTest, backendMocksTest);
export { expect } from "@playwright/test";
```

If you do not have custom fixtures yet, import directly:

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";
```

## 5. Write the first route

Routes look like Playwright `page.route()` handlers, but they target outbound Node requests.

```ts
import { test, expect } from "./fixtures";

test("shows declined payment messaging", async ({ page, backendMocks }) => {
  await backendMocks.route("https://payments.example.test/charges", async (route, request) => {
    expect(request.method()).toBe("POST");

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

## Next steps

- Learn the three-process model in [Concepts](/guide/concepts).
- Choose matchers with [Matching requests](/guide/matching).
- Mock responses with [Mock responses](/guide/mock-responses).
- Inspect traffic with [Spying and waiting](/guide/spying-and-waiting).
