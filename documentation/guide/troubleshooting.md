# Troubleshooting

## Mocks never fire (real upstream is hit)

1. Confirm the proxy is up: `GET http://127.0.0.1:4310/health` → `{ ok: true, … }`.
2. Confirm the app has `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` set and called `startBackendMocks`.
3. Open `/dashboard` — do you see your Node `clientId` under connections?
4. Check the matcher: globs/regex match the **full absolute URL**, including scheme and host.
5. Check method / `clientId` filters — a GET-only route will not catch POST.
6. Look at history: `passthrough` means no route matched; `mocked` means one did.

## Handler error: finished without fulfill/continue/abort

Every matched handler must call a terminal action. If you use `route.fetch()`, you still need `fulfill` / `continue` / `abort` afterward.

## Ambiguous backend mock routing

Two or more routes matched the same request. Narrow matchers, `unroute` before re-registering, or scope with `clientId` / `method`. Drain intentional cases with `takeErrors()`.

## Lost connection to the proxy

The Node agent does not auto-reconnect. Ensure the proxy `webServer` starts before the app, and that the app isn't starting agents against a stale URL. Restart the app process after bringing the proxy back.

## unauthorized / hello errors

- Token mismatch between proxy `--token`, Playwright `backendMocksToken`, and Node `PLAYWRIGHT_BACKEND_MOCKS_TOKEN`.
- Protocol version mismatch — upgrade all `@playwright-backend-mocks/*` packages together.

## Test failed on teardown with AggregateError

Proxy errors (ambiguity, disconnect, handler failures) were left undrained. Either fix the underlying issue or call `backendMocks.takeErrors()` when the test expects them.

## Dashboard shows no history

History only records traffic that went through a connected agent. Generate a request after both Playwright and Node are connected. Remember the ring buffer may have rotated past old entries (`--history-limit`).

## Works locally, fails in CI

- `reuseExistingServer: !process.env.CI` — CI should always start a fresh proxy.
- Bind to `127.0.0.1` unless you intentionally need another interface.
- Ensure app `webServer.env` forwards `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` (and token if used).
- Prefer serial workers when parallel route collisions are hard to eliminate.
