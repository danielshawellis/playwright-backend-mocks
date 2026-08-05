# Playwright Backend Mocks

**Run the real app. Mock only the outside world.**

Mock outbound HTTP/HTTPS (and `globalThis.WebSocket`) from Node.js application processes in Playwright tests — with a DX that matches Playwright’s browser interception APIs as closely as practical.

**Docs:** [`documentation/`](./documentation/) (VitePress) · [live site](https://danielshawellis.github.io/playwright-backend-mocks/) (GitHub Pages on `main`)  
**Publish:** npm packages from `main` via OIDC trusted publishing — see [`PUBLISHING.md`](./PUBLISHING.md)  
**How we develop this repo:** [`PHILOSOPHY.md`](./PHILOSOPHY.md) · agent notes: [`AGENTS.md`](./AGENTS.md) · plan: [`research/rewrite-specification.md`](./research/rewrite-specification.md)

> The archived prototype (including the old docs site) lives under [`historical/`](./historical/) and is **not** wired into the workspace.

## Current status (Step 2 — oracle green in both modes)

The executable contract is the dual-mode parity suite in [`tests/parity/`](./tests/parity/). Living packages under [`packages/`](./packages/) implement that contract in library mode (`PARITY_MODE=node`).

| Suite | Result |
| --- | --- |
| Browser oracle (`pnpm test`) | **319 passed**, 5 skipped |
| Full node oracle (`pnpm test:parity:node:full`) | **319 passed**, 5 skipped |
| Library-only (`pnpm test:library`) | `clientId`, cross-test `ambiguous_route`, disconnect / auth, observability REST + dashboard |

Module map: [`packages/MODULE_MAP.md`](./packages/MODULE_MAP.md). `historical/` remains reference-only until deleted.

```bash
pnpm install
pnpm build
pnpm --filter @playwright-backend-mocks/parity exec playwright install chromium
pnpm test                 # browser oracle (Playwright-against-Playwright)
pnpm test:parity:node     # Node passthrough smokes (+ library agent)
pnpm test:parity:node:fulfill   # dual-mode routing gate (one fulfill case)
pnpm test:parity:node:full      # full oracle in node mode
pnpm test:library               # clientId / ambiguity / disconnect / observability
pnpm typecheck
pnpm lint
pnpm docs:dev             # VitePress docs locally
pnpm docs:build           # static site → documentation/.vitepress/dist
```

## Packages

| Package | Description |
| --- | --- |
| [`@playwright-backend-mocks/playwright`](./packages/playwright/README.md) | Playwright fixtures (`backendMocks.route`, …) |
| [`@playwright-backend-mocks/node`](./packages/node/README.md) | Node agent that installs interceptors |
| [`@playwright-backend-mocks/proxy`](./packages/proxy/README.md) | Standalone coordinator + REST API CLI |
| [`@playwright-backend-mocks/protocol`](./packages/protocol/README.md) | Shared wire protocol (types + validators) |
| [`@playwright-backend-mocks/dashboard`](./packages/dashboard/README.md) | Optional read-only observability UI |

Docs: [Observability](./documentation/ops/observability.md). Releases: [`PUBLISHING.md`](./PUBLISHING.md).

## Target DX

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

Inspect traffic while debugging via the proxy REST API (`/health`, `/api/history`, `/api/history/:id/har`, `/api/ws`, `/api/connections`) or the optional dashboard. See [Observability](./documentation/ops/observability.md).

## Design docs

| Doc                                | Role                                    |
| ---------------------------------- | --------------------------------------- |
| [`documentation/`](./documentation/) | User-facing VitePress site            |
| [`PHILOSOPHY.md`](./PHILOSOPHY.md) | High-level source of truth              |
| [`AGENTS.md`](./AGENTS.md)         | Agent entrypoint                        |
| [`research/`](./research)          | Rewrite + parity + docs-site + observability research |
| [`tests/parity/`](./tests/parity/) | Living dual-mode oracle suite           |
| [`tests/library/`](./tests/library/) | Library-only (clientId / ambiguity / disconnect / observability) |
| [`packages/MODULE_MAP.md`](./packages/MODULE_MAP.md) | Living package → Playwright file map |
| [`historical/`](./historical/)     | Archived prototype + old VitePress site |

## License

MIT
