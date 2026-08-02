# Compose fixtures

Most projects already have custom Playwright fixtures (authenticated `page`, API helpers, etc.). Compose them with `mergeTests` so `backendMocks` sits alongside your app fixtures.

```ts
// tests/application-fixtures.ts
import { test as base } from "@playwright/test";

export const test = base.extend<{ appBaseURL: string }>({
  appBaseURL: "http://127.0.0.1:3000",
});
```

```ts
// tests/fixtures.ts
import { mergeTests } from "@playwright/test";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";
import { test as appTest } from "./application-fixtures";

export const test = mergeTests(appTest, backendMocksTest);
export { expect } from "@playwright/test";
```

```ts
// tests/checkout.spec.ts
import { test, expect } from "./fixtures";

test("declined card", async ({ page, backendMocks, appBaseURL }) => {
  await backendMocks.route("https://payments.example.test/charges", async (route) => {
    await route.fulfill({ status: 402, json: { error: "card_declined" } });
  });

  await page.goto(`${appBaseURL}/checkout`);
  // …
});
```

## Typing config options

When you set `backendMocksProxyUrl` / `backendMocksToken` in config, pass the worker options type into `defineConfig`:

```ts
import { defineConfig } from "@playwright/test";
import type { BackendMocksWorkerOptions } from "@playwright-backend-mocks/playwright";

export default defineConfig<object, BackendMocksWorkerOptions>({
  use: {
    backendMocksProxyUrl: "http://127.0.0.1:4310",
  },
});
```

## No custom fixtures yet?

Import directly:

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";
```
