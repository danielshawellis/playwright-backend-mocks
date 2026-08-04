# Troubleshooting

Use this page when a mock does not fire, a request hangs, or teardown fails.

## The route does not match

Check the proxy history:

```bash
curl -s http://127.0.0.1:4310/api/history | jq '.entries[-10:]'
```

Look at:

- `request.url`
- `request.method`
- `clientId`
- `outcome.kind`

Common fixes:

| Symptom | Fix |
| --- | --- |
| Outcome is `passthrough` | Narrow or correct the matcher; remember glob strings match the full URL. |
| Method differs | Use `{ url, method: "POST" }` or a waiter predicate. |
| Wrong process | Add `clientId` to the matcher. |
| Predicate did not run as expected | Log or assert inside the predicate; it receives a `URL`, not a request. |

## `ambiguous_route`

`ambiguous_route` means more than one test claimed the same Node request.

Fix the test architecture:

- Add `clientId` filters.
- Add method filters.
- Include test-specific tenant, user, or correlation data in the upstream URL.
- Isolate app processes per worker or per test.
- Mark unavoidable shared tests as serial.

Use `backendMocks.takeErrors()` only in tests that intentionally assert ambiguity behavior.

## `claim_timeout`

The proxy sent a claim to tests with active routes, but not every expected test answered before `--claim-timeout-ms`.

Check:

- The Playwright worker is still connected: `GET /api/connections`.
- The test did not block the event loop.
- The proxy `--claim-timeout-ms` value is high enough for your environment.
- The worker did not crash before unregistering routes.

## The app says the proxy disconnected

The Node agent fails pending requests if it loses the proxy connection.

Check:

```bash
curl -s http://127.0.0.1:4310/health
curl -s http://127.0.0.1:4310/api/connections | jq .
```

Make sure:

- The proxy `webServer` starts before the app process.
- `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` matches `backendMocksProxyUrl`.
- `PLAYWRIGHT_BACKEND_MOCKS_TOKEN` matches `backendMocksToken` and `--token`, if set.
- The proxy idle timeout is not too low for your suite.

## A waiter times out

`waitForRequest()` and `waitForResponse()` are future-only. Register the waiter before the UI action.

```ts
const pending = backendMocks.waitForRequest("**/charges");

await page.getByRole("button", { name: "Pay" }).click();

const request = await pending;
```

If you need method filtering, use a predicate:

```ts
await backendMocks.waitForRequest(
  (request) => request.method() === "POST" && request.url().endsWith("/charges"),
  { timeout: 10_000 },
);
```

::: warning
Waiter options are `{ timeout?, signal? }` only. `{ method }` is not an option.
:::

## Teardown fails with `AggregateError`

The fixture throws remaining proxy or handler errors after the test body.

Read the error messages. If the failure is expected:

```ts
const errors = backendMocks.takeErrors();
expect(errors[0]?.message).toMatch(/Ambiguous backend mock routing/);
```

If it is unexpected, fix the handler or route ownership instead of draining it.

## `route.fetch()` times out

By default, `route.fetch()` rejects after `30000` ms.

```ts
const response = await route.fetch({ timeout: 60_000 });
```

Pass `timeout: 0` to disable the deadline. You can also pass `signal` to cancel explicitly.

## WebSocket route does not fire

::: danger
Only `globalThis.WebSocket` is intercepted. If your app imports `WebSocket` from `ws`, `routeWebSocket()` will not see it.
:::

Also check that you registered `routeWebSocket()` before the app opens the socket, and that your URL matcher uses `ws:` or `wss:` semantics.

## Useful commands

```bash
curl -s http://127.0.0.1:4310/health | jq .
curl -s http://127.0.0.1:4310/api/connections | jq .
curl -s http://127.0.0.1:4310/api/history | jq '.entries[-20:]'
```

See [Proxy operations](/ops/proxy), [REST API](/ops/rest-api), and [Errors](/ops/errors).
