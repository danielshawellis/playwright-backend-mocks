# Playwright Backend Mocks

Mock outbound HTTP/HTTPS requests made by Node.js application processes from Playwright tests.

The experience mirrors Playwright’s browser-side `route()` API, while interception runs inside your Node processes via [`@mswjs/interceptors`](https://github.com/mswjs/interceptors).

## Packages

| Package                                | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| `@playwright-backend-mocks/playwright` | Playwright fixtures (`backendMocks.route`, …) |
| `@playwright-backend-mocks/node`       | Node agent that installs interceptors         |
| `@playwright-backend-mocks/proxy`      | Standalone coordinator + dashboard CLI        |
| `@playwright-backend-mocks/protocol`   | Shared wire protocol (types + validators)     |

## Quick start

### 1. Start the proxy (usually via Playwright `webServer`)

```bash
playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310
```

### 2. Enable the Node agent in your app

```ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

if (process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL !== undefined) {
  await startBackendMocks({
    proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
    clientId: "api-server",
  });
}
```

### 3. Compose the Playwright fixture

```ts
import { mergeTests } from "@playwright/test";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";
import { test as appTest } from "./application-fixtures";

export const test = mergeTests(appTest, backendMocksTest);
export { expect } from "@playwright/test";
```

### 4. Mock backend traffic in a test

```ts
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

## Playwright config

```ts
import { defineConfig } from "@playwright/test";

const proxyUrl = "http://127.0.0.1:4310";

export default defineConfig({
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

## Dashboard

Open `http://127.0.0.1:4310/dashboard` while the proxy is running for a read-only view of connections and request history.

## Design docs

See [`docs/`](./docs) for research notes, the public API plan, protocol plan, and technical plan. The product intent is described in [`SPECIFICATION.md`](./SPECIFICATION.md).

Published documentation lives in [`documentation/`](./documentation) (VitePress) and deploys to GitHub Pages at [danielshawellis.github.io/playwright-backend-mocks-msw](https://danielshawellis.github.io/playwright-backend-mocks-msw/).

## Development

```bash
pnpm install
pnpm build
pnpm test
```

### Documentation site

```bash
pnpm docs:dev      # local preview
pnpm docs:build    # production build
pnpm docs:preview  # serve the production build
```

## License

MIT
