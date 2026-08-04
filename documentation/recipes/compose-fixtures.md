# Compose fixtures

Most projects already have Playwright fixtures for authentication, app URLs, seeded users, or API helpers. Compose those fixtures with `@playwright-backend-mocks/playwright`.

## App fixtures

```ts
// tests/application-fixtures.ts
import { test as base } from "@playwright/test";

type AppFixtures = {
  appBaseURL: string;
};

export const test = base.extend<AppFixtures>({
  appBaseURL: "http://127.0.0.1:3000",
});
```

## Merge with backend mocks

```ts
// tests/fixtures.ts
import { mergeTests } from "@playwright/test";
import { test as backendMocksTest } from "@playwright-backend-mocks/playwright";
import { test as appTest } from "./application-fixtures";

export const test = mergeTests(appTest, backendMocksTest);
export { expect } from "@playwright/test";
```

## Use in tests

```ts
// tests/checkout.spec.ts
import { test, expect } from "./fixtures";

test("declined card", async ({ page, backendMocks, appBaseURL }) => {
  await backendMocks.route("https://payments.example.test/charges", async (route) => {
    await route.fulfill({
      status: 402,
      json: { error: "card_declined" },
    });
  });

  await page.goto(`${appBaseURL}/checkout`);
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(page.getByText("Your card was declined")).toBeVisible();
});
```

## Type Playwright config options

```ts
// playwright.config.ts
import { defineConfig } from "@playwright/test";
import type { BackendMocksWorkerOptions } from "@playwright-backend-mocks/playwright";

export default defineConfig<object, BackendMocksWorkerOptions>({
  use: {
    backendMocksProxyUrl: "http://127.0.0.1:4310",
    backendMocksToken: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  },
});
```

## No app fixtures yet

Import directly from the package:

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";
```

See [Getting started](/guide/getting-started).
