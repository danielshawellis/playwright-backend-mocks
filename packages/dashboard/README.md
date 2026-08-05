# `@playwright-backend-mocks/dashboard`

Optional read-only dashboard for [Playwright Backend Mocks](https://danielshawellis.github.io/playwright-backend-mocks/) — inspect HTTP and WebSocket traffic while your suite runs.

**[Documentation](https://danielshawellis.github.io/playwright-backend-mocks/)** · **[Dashboard ops](https://danielshawellis.github.io/playwright-backend-mocks/ops/dashboard)** · **[Observability](https://danielshawellis.github.io/playwright-backend-mocks/ops/observability)** · **[GitHub](https://github.com/danielshawellis/playwright-backend-mocks)**

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

While the [proxy](https://www.npmjs.com/package/@playwright-backend-mocks/proxy) is running, you can inspect that traffic — including which test owned it and what action it took — via this dashboard or the proxy REST API.

## Role in the system

This package is an **optional, separate process**: a Vue UI that talks to the proxy over its [REST API](https://danielshawellis.github.io/playwright-backend-mocks/ops/rest-api). It is **not** bundled with `@playwright-backend-mocks/proxy` — install it only when you want the UI.

| Piece | Package | Role |
| --- | --- | --- |
| Proxy + REST | `@playwright-backend-mocks/proxy` | Stores history; exposes `/api/*` |
| **Dashboard** | **`@playwright-backend-mocks/dashboard`** | Read-only UI pointed at the proxy |

Observability is read-only and in-memory. It never changes routing.

## Install

```bash
npm install -D @playwright-backend-mocks/dashboard
```

You also need a running proxy from [`@playwright-backend-mocks/proxy`](https://www.npmjs.com/package/@playwright-backend-mocks/proxy).

## CLI

Binary: `playwright-backend-mocks-dashboard`

```bash
playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310

playwright-backend-mocks-dashboard --host 127.0.0.1 --port 4311 \
  --proxy-url http://127.0.0.1:4310
```

Open `http://127.0.0.1:4311/`.

Useful proxy endpoints without the UI:

- `GET /api/history` — HTTP timeline
- `GET /api/ws` — WebSocket connections and events
- `GET /api/history/:id/har` — download one HTTP request as HAR

## Related packages

| Package | Role |
| --- | --- |
| [`@playwright-backend-mocks/proxy`](https://www.npmjs.com/package/@playwright-backend-mocks/proxy) | Coordinator + REST history API (required for this UI) |
| [`@playwright-backend-mocks/playwright`](https://www.npmjs.com/package/@playwright-backend-mocks/playwright) | Playwright `backendMocks` fixture |
| [`@playwright-backend-mocks/node`](https://www.npmjs.com/package/@playwright-backend-mocks/node) | Agent that intercepts outbound traffic in the app |
| [`@playwright-backend-mocks/protocol`](https://www.npmjs.com/package/@playwright-backend-mocks/protocol) | Shared wire types (usually a transitive dependency) |

## License

MIT
