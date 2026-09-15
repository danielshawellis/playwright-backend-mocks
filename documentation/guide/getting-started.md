# Getting started

Wire Playwright Backend Mocks into a Node app: run the proxy, enable the Node agent, connect Playwright, then write a route.

You can follow along in the sample app **or** apply each step to a project you already have.

## 0. Optional: scaffold the sample app

If you do not already have a Playwright + Node app, scaffold a tiny checkout demo and follow the rest of this guide in that folder:

```bash
npm create @playwright-backend-mocks@latest getting-started-demo
cd getting-started-demo
```

When prompted, accept installing dependencies and Chromium (or pass `--quiet`).

The sample is plain Node (one `app/server.js`) plus TypeScript Playwright tests. It is also checked in at [`examples/getting-started`](https://github.com/danielshawellis/playwright-backend-mocks/tree/main/examples/getting-started).

If you already have a project, skip this step and map each snippet below onto your own server entry and Playwright config.

::: tip
Keep `@playwright-backend-mocks/playwright`, `@playwright-backend-mocks/node`, `@playwright-backend-mocks/proxy`, and `@playwright-backend-mocks/protocol` on the same version. Playwright pin: `@playwright/test@1.62.1`. Node.js `>=20`.
:::

## 1. Start the proxy

The proxy sits between Playwright and your Node process. Start it from Playwright `webServer` and pass the same URL to the fixture and the app.

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import type { BackendMocksWorkerOptions } from "@playwright-backend-mocks/playwright";

const proxyUrl = "http://127.0.0.1:4310";
const appUrl = "http://127.0.0.1:3000";

export default defineConfig<object, BackendMocksWorkerOptions>({
  use: {
    baseURL: appUrl,
    backendMocksProxyUrl: proxyUrl,
  },
  webServer: [
    {
      command: "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
      url: `${proxyUrl}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node app/server.js",
      url: appUrl,
      reuseExistingServer: !process.env.CI,
      env: {
        PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: proxyUrl,
      },
    },
  ],
});
```

**In your app:** keep your existing start script; point `webServer` at it and set `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL`. Set `use.baseURL` yourself — Playwright does not infer it when `webServer` is an array.

**Check:** with only the proxy running, `curl -s http://127.0.0.1:4310/health` returns ok.

You can also run `npx @playwright-backend-mocks/proxy --host 127.0.0.1 --port 4310`.

## 2. Enable the Node agent

Call `startBackendMocks()` early in the app process (before outbound HTTP). With no proxy URL, it is a no-op.

```js
// app/server.js (sample)
import { startBackendMocks } from "@playwright-backend-mocks/node";

const agent = await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  token: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  clientId: "api-server",
});

// ... start your HTTP server ...

process.once("SIGTERM", async () => {
  await agent.stop();
});
```

**In your app:** run this once at process startup (API server, worker, etc.). Use a stable `clientId` if you have multiple Node processes.

**Check:** start proxy + app, then `curl -s http://127.0.0.1:4310/api/connections` should list an agent.

Install if needed:

```bash
npm install -D @playwright-backend-mocks/node @playwright-backend-mocks/proxy
```

## 3. Wire Playwright

Install the fixture package and import `test` / `expect` from it (or `mergeTests` with your existing fixtures).

```bash
npm install -D @playwright/test@1.62.1 @playwright-backend-mocks/playwright
```

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";
```

`backendMocksProxyUrl` in the config (step 1) is how the worker finds the proxy.

**Already have fixtures?**

```ts
// tests/fixtures.ts
import { mergeTests } from "@playwright/test";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";
import { test as appTest } from "./application-fixtures";

export const test = mergeTests(appTest, backendMocksTest);
export { expect } from "@playwright/test";
```

**Check:** run any test that uses the fixture; `GET /api/connections` should show a Playwright worker as well as the Node agent.

## 4. Write your first mock

Routes look like Playwright `page.route()`, but they target outbound Node requests.

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";

test("shows declined payment messaging", async ({ page, backendMocks }) => {
  await backendMocks.route(
    "https://payments.example.test/charges",
    async (route, request) => {
      expect(request.method()).toBe("POST");

      await route.fulfill({
        status: 402,
        json: { error: "card_declined" },
      });
    },
  );

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(page.getByText("Your card was declined")).toBeVisible();
});
```

In the sample app, Pay → `POST /api/pay` → the server calls `https://payments.example.test/charges`. The mock fulfills that outbound call; the UI shows the declined message.

**In your app:** match a real outbound URL your server hits, then drive the UI the same way you would with `page.route`.

```bash
npx playwright test
```

## Next steps

- Learn the three-process model in [Concepts](/guide/concepts).
- Choose matchers with [Matching requests](/guide/matching).
- Mock responses with [Mock responses](/guide/mock-responses).
- Inspect traffic with [Spying and waiting](/guide/spying-and-waiting).
