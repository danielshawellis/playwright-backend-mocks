# Playwright Backend Mocks

**Run the real app. Mock only the outside world.**

Mock outbound HTTP/HTTPS (and `globalThis.WebSocket`) from Node.js application processes in Playwright tests — with a DX that matches Playwright’s browser interception APIs as closely as practical.

> **Rewrite in progress.** Living work is the Playwright oracle suite and rewrite plan. The old prototype (packages + VitePress site) is under [`historical/`](./historical/) and is **not** wired into the workspace.

**How we develop this repo:** [`PHILOSOPHY.md`](./PHILOSOPHY.md) · agent notes: [`AGENTS.md`](./AGENTS.md) · plan: [`research/rewrite-specification.md`](./research/rewrite-specification.md)

## Current status (Step 1)

The executable contract is the dual-mode parity suite in [`tests/parity/`](./tests/parity/):

```bash
pnpm install
pnpm --filter @playwright-backend-mocks/parity exec playwright install chromium
pnpm test          # browser oracle (Playwright-against-Playwright)
pnpm test:parity:node   # Node downstream smokes (library wiring is Step 2)
pnpm typecheck
pnpm lint
```

Step 2 reimplements the packages against that suite (starting with Playwright-aligned TypeScript / ESLint).

## Packages (Step 2 target)

| Package                                | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| `@playwright-backend-mocks/playwright` | Playwright fixtures (`backendMocks.route`, …) |
| `@playwright-backend-mocks/node`       | Node agent that installs interceptors         |
| `@playwright-backend-mocks/proxy`      | Standalone coordinator + REST API CLI         |
| `@playwright-backend-mocks/dashboard`  | Optional Vue dashboard (separate process)     |
| `@playwright-backend-mocks/protocol`   | Shared wire protocol (types + validators)     |

These are **not published from this tree yet**. Target DX below is what Step 2 is building toward (also reflected in the archived prototype under `historical/`).

## Target DX (after Step 2)

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

### Playwright config (sketch)

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

Optional dashboard (separate process) will consume the proxy REST API (`/api/history`, `/api/connections`).

## Design docs

| Doc | Role |
| --- | ---- |
| [`PHILOSOPHY.md`](./PHILOSOPHY.md) | High-level source of truth |
| [`AGENTS.md`](./AGENTS.md) | Agent entrypoint |
| [`research/`](./research) | Rewrite + parity research |
| [`tests/parity/`](./tests/parity/) | Living oracle suite |
| [`historical/`](./historical/) | Archived prototype + old VitePress site |

## License

MIT
