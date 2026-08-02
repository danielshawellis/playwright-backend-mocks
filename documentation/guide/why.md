# Why this library

Playwright already lets you mock **browser** network traffic with `page.route()`. Many real applications also make **server-side** HTTP calls — from an API process, a background worker, or a Next.js/Remix server component path — that never touch the browser.

Those outbound calls are invisible to Playwright's browser routing. Without a way to mock them, e2e tests either hit real third-party services or require brittle stubs wired into application code.

Playwright Backend Mocks closes that gap.

## What problem it solves

You want to write a Playwright test like:

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

…even when `https://payments.example.test/charges` is called by your **Node** process, not by the browser.

## Use cases

- **Third-party APIs** — payments, email, SMS, auth providers, analytics — without sandbox credentials or rate limits.
- **Failure paths** — timeouts, connection refused, DNS failures, and abort scenarios that are hard to reproduce against real services.
- **Deterministic e2e** — freeze response bodies and status codes so UI assertions stay stable.
- **Multi-process apps** — mock traffic from an API server and a worker independently with `clientId`.
- **Request assertions** — confirm your app actually called the right URL/method/body with `waitForRequest` / `requests`.

## Benefits

| Benefit                 | What you get                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Familiar DX             | Same `route` / `fulfill` / `continue` / `abort` shape as Playwright                          |
| Broad client coverage   | Intercepts via `@mswjs/interceptors` (Fetch, `node:http`/`https`, and clients built on them) |
| Test-scoped routes      | Mocks register and tear down with each test                                                  |
| Unmatched = passthrough | Only the routes you declare are mocked                                                       |
| Production-safe agent   | No proxy URL → agent does nothing                                                            |
| Debuggability           | Dashboard + history APIs show what happened across processes                                 |

## What it is not

- Not a replacement for Playwright browser `page.route()` — use both when you need browser **and** Node mocks.
- Not a general HTTP proxy for browsers or non-Node clients.
- Not an interceptor for WebSockets, gRPC, or raw TCP.

See [Limitations](/guide/limitations) for the full v1 boundary.
