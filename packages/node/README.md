# `@playwright-backend-mocks/node`

[![npm version](https://img.shields.io/npm/v/@playwright-backend-mocks/node.svg)](https://www.npmjs.com/package/@playwright-backend-mocks/node)
[![CI](https://github.com/danielshawellis/playwright-backend-mocks/actions/workflows/ci.yml/badge.svg)](https://github.com/danielshawellis/playwright-backend-mocks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/danielshawellis/playwright-backend-mocks/blob/main/LICENSE)
[![Node.js](https://img.shields.io/node/v/@playwright-backend-mocks/node.svg)](https://nodejs.org)

Node.js interception agent for [Playwright Backend Mocks](https://danielshawellis.github.io/playwright-backend-mocks/) — one startup call so Playwright can mock outbound HTTP (and `globalThis.WebSocket`) from your real app process.

**[Documentation](https://danielshawellis.github.io/playwright-backend-mocks/)** · **[Getting started](https://danielshawellis.github.io/playwright-backend-mocks/guide/getting-started)** · **[Node API](https://danielshawellis.github.io/playwright-backend-mocks/api/node)** · **[GitHub](https://github.com/danielshawellis/playwright-backend-mocks)**

## Run the real app. Mock only the outside world.

Good e2e tests cover your UI and your server — then fake Stripe, email, and every other third party at the boundary. Playwright can do the browser half. This library makes the server half just as easy.

Your UI and server stay real. Tests use `backendMocks.route()` for the outbound HTTP your Node process makes — the calls that never show up in the browser Network tab.

```ts
test("declined card shows an error", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.stripe.com/**", async (route) => {
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

## Role in the system

This package runs **inside your Node app**. Call `startBackendMocks()` once at startup. Under the hood it uses [`@mswjs/interceptors`](https://www.npmjs.com/package/@mswjs/interceptors) to pause outbound HTTP (and `globalThis.WebSocket`), then asks the [proxy](https://www.npmjs.com/package/@playwright-backend-mocks/proxy) what to do. You configure mocks in Playwright — no test-only branches, wrappers, or dependency-injection seams in application code.

| Process | Package | Responsibility |
| --- | --- | --- |
| Playwright worker | `@playwright-backend-mocks/playwright` | `backendMocks.route()`, matching, settle |
| Proxy coordinator | `@playwright-backend-mocks/proxy` | Claims, decisions, history, REST |
| **Node app** | **`@playwright-backend-mocks/node`** | Installs interceptors, applies proxy decisions |

When no proxy URL is set, the agent is a **no-op** — safe to leave in normal app startup.

## Install

```bash
npm install -D @playwright-backend-mocks/node \
  @playwright-backend-mocks/playwright \
  @playwright-backend-mocks/proxy
```

Keep the `@playwright-backend-mocks/*` packages on the same version.

## Enable the agent

```ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

if (process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL !== undefined) {
  await startBackendMocks({
    proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
    clientId: "api-server",
  });
}

// The rest of your app is unchanged — keep using fetch, http, axios, etc.
```

Because interception happens at the lowest level through `@mswjs/interceptors`, this works with virtually every Node HTTP client and the frameworks and SDKs built on top of them.

## How it works

1. **Start a proxy** — a small local process between your Node app and Playwright.
2. **Route Node HTTP through it** — this package catches outbound `fetch` / `http` / `https` (and WebSocket) calls.
3. **Control it from Playwright** — `backendMocks.route(...)` handlers decide fulfill / continue / abort.

When your app makes an outbound call:

1. `@mswjs/interceptors` pauses the request inside the Node process.
2. This agent forwards it to the [proxy](https://www.npmjs.com/package/@playwright-backend-mocks/proxy).
3. The proxy matches it against the owning test’s `backendMocks.route()` handlers.
4. The Playwright handler settles with `fulfill`, `continue`, or `abort`.
5. The decision returns to the app as a mocked or real response.

Unmatched requests pass through to the real network.

## Related packages

| Package | Role |
| --- | --- |
| [`@playwright-backend-mocks/playwright`](https://www.npmjs.com/package/@playwright-backend-mocks/playwright) | Playwright `backendMocks` fixture |
| [`@playwright-backend-mocks/proxy`](https://www.npmjs.com/package/@playwright-backend-mocks/proxy) | Coordinator + REST history API |
| [`@playwright-backend-mocks/dashboard`](https://www.npmjs.com/package/@playwright-backend-mocks/dashboard) | Optional read-only traffic UI |
| [`@playwright-backend-mocks/protocol`](https://www.npmjs.com/package/@playwright-backend-mocks/protocol) | Shared wire types (usually a transitive dependency) |

## License

MIT
