# Getting started

Wire Playwright Backend Mocks into a Node app in four steps: proxy → Node agent → Playwright fixture → first mock.

## 0. Optional: scaffold the sample app

No existing app? Scaffold a tiny checkout demo and use it while you read the rest of this page:

```bash
npm create @playwright-backend-mocks@latest getting-started-demo
cd getting-started-demo
```

When prompted, accept installing dependencies and Chromium (or pass `--quiet`).

The sample is already wired for steps 1–4. Confirm it works:

```bash
npx playwright test
```

You should see one passing test (`shows declined payment messaging`). Keep this folder open and read on — each section below matches a file that is already in the sample. If you are adding the library to your own app instead, skip the scaffold and apply the same snippets to your project.

::: tip
Keep `@playwright-backend-mocks/playwright`, `@playwright-backend-mocks/node`, `@playwright-backend-mocks/proxy`, and `@playwright-backend-mocks/protocol` on the same version. Playwright pin: `@playwright/test@1.62.1`. Node.js `>=20`.
:::

## 1. Start the proxy

The proxy sits between Playwright and your Node process. Start it from Playwright `webServer` and pass the same URL to the fixture and the app.

**Sample file:** `playwright.config.ts`

```ts
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

**In your own app:** keep your existing start command in `webServer`, set `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL`, and set `use.baseURL` yourself — Playwright does not infer it when `webServer` is an array.

**Check:** with only the proxy running, `curl -s http://127.0.0.1:4310/health` returns ok. You can also run `npx @playwright-backend-mocks/proxy --host 127.0.0.1 --port 4310`.

## 2. Enable the Node agent

Call `startBackendMocks()` early in the app process (before outbound HTTP). With no proxy URL, it is a no-op.

**Sample file:** `app/server.js`

```js
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

**In your own app:** call this once at process startup. Use a stable `clientId` if you have multiple Node processes.

If you did not use the scaffold:

```bash
npm install -D @playwright-backend-mocks/node @playwright-backend-mocks/proxy
```

**Check:** start proxy + app, then `curl -s http://127.0.0.1:4310/api/connections` should list an agent.

## 3. Wire Playwright

Import `test` / `expect` from the Playwright package (or `mergeTests` with your existing fixtures).

**Sample file:** `tests/declined-card.spec.ts` (imports shown in step 4)

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";
```

`backendMocksProxyUrl` in the config (step 1) is how the worker finds the proxy.

If you did not use the scaffold:

```bash
npm install -D @playwright/test@1.62.1 @playwright-backend-mocks/playwright
```

**Already have fixtures?**

```ts
// tests/fixtures.ts
import { mergeTests } from "@playwright/test";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";
import { test as appTest } from "./application-fixtures";

export const test = mergeTests(appTest, backendMocksTest);
export { expect } from "@playwright/test";
```

**Check:** when a fixture test is running, `GET /api/connections` should show a Playwright worker as well as the Node agent.

## 4. Write your first mock

Routes look like Playwright `page.route()`, but they target outbound Node requests.

**Sample file:** `tests/declined-card.spec.ts`

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

**In your own app:** match a real outbound URL your server hits, then drive the UI the same way you would with `page.route`.

```bash
npx playwright test
```

## Next steps

- Learn the three-process model in [Concepts](/guide/concepts).
- Choose matchers with [Matching requests](/guide/matching).
- Mock responses with [Mock responses](/guide/mock-responses).
- Inspect traffic with [Spying and waiting](/guide/spying-and-waiting).
