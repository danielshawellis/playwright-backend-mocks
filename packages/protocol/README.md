# `@playwright-backend-mocks/protocol`

[![npm version](https://img.shields.io/npm/v/@playwright-backend-mocks/protocol.svg)](https://www.npmjs.com/package/@playwright-backend-mocks/protocol)
[![CI](https://github.com/danielshawellis/playwright-backend-mocks/actions/workflows/ci.yml/badge.svg)](https://github.com/danielshawellis/playwright-backend-mocks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/danielshawellis/playwright-backend-mocks/blob/main/LICENSE)
[![Node.js](https://img.shields.io/node/v/@playwright-backend-mocks/protocol.svg)](https://nodejs.org)

Shared wire types and validators for [Playwright Backend Mocks](https://danielshawellis.github.io/playwright-backend-mocks/).

**[Documentation](https://danielshawellis.github.io/playwright-backend-mocks/)** · **[Concepts](https://danielshawellis.github.io/playwright-backend-mocks/guide/concepts)** · **[GitHub](https://github.com/danielshawellis/playwright-backend-mocks)**

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

Three processes cooperate: a Playwright fixture, a proxy coordinator, and a Node agent that uses [`@mswjs/interceptors`](https://www.npmjs.com/package/@mswjs/interceptors). Unmatched requests pass through; with no proxy URL the Node agent is a no-op.

## Role in the system

This package holds the **shared protocol**: message shapes, Zod validators, URL/matcher helpers, and encoding used on the WebSocket control plane between Playwright, the proxy, and Node.

Most applications **do not import this package directly**. Install [`@playwright-backend-mocks/playwright`](https://www.npmjs.com/package/@playwright-backend-mocks/playwright), [`node`](https://www.npmjs.com/package/@playwright-backend-mocks/node), and [`proxy`](https://www.npmjs.com/package/@playwright-backend-mocks/proxy) instead — they depend on `protocol` and keep versions aligned.

| Process | Package | Responsibility |
| --- | --- | --- |
| Playwright worker | `@playwright-backend-mocks/playwright` | `backendMocks.route()`, matching, settle |
| Proxy coordinator | `@playwright-backend-mocks/proxy` | Claims, decisions, history, REST |
| Node app | `@playwright-backend-mocks/node` | Intercepts outbound HTTP / WebSocket |
| **Shared** | **`@playwright-backend-mocks/protocol`** | Wire types + validators |

## Install

You usually get this transitively. To depend on it explicitly:

```bash
npm install @playwright-backend-mocks/protocol
```

Keep it on the **same version** as the other `@playwright-backend-mocks/*` packages in your tree.

## Related packages

| Package | Role |
| --- | --- |
| [`@playwright-backend-mocks/playwright`](https://www.npmjs.com/package/@playwright-backend-mocks/playwright) | Playwright `backendMocks` fixture |
| [`@playwright-backend-mocks/node`](https://www.npmjs.com/package/@playwright-backend-mocks/node) | Agent that intercepts outbound traffic in the app |
| [`@playwright-backend-mocks/proxy`](https://www.npmjs.com/package/@playwright-backend-mocks/proxy) | Coordinator + REST history API |
| [`@playwright-backend-mocks/dashboard`](https://www.npmjs.com/package/@playwright-backend-mocks/dashboard) | Optional read-only traffic UI |

## License

MIT
