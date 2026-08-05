# Limitations

The library is intentionally Playwright-shaped, but the living implementation has a few boundaries.

## WebSocket interception

::: danger
WebSocket interception only supports application code that uses `globalThis.WebSocket`. It does not intercept npm `ws` clients or framework-specific socket implementations that bypass `globalThis.WebSocket`.
:::

See [WebSockets](/guide/websockets).

## Browser-only request concepts

Backend requests do not have a browser frame, service worker, navigation lifecycle, or browser resource type.

| API | Backend behavior |
| --- | --- |
| `request.frame()` | Throws because there is no frame. |
| `request.serviceWorker()` | Returns `null`. |
| `request.isNavigationRequest()` | Returns `false`. |
| `request.resourceType()` | Returns `"other"`. |
| `request.timing()` | Returns stable placeholder timing values. |
| `request.sizes()` | Returns placeholder sizes. |

## HAR support

Plain `.har` files are supported. Playwright-style sibling `_file` body attachments are supported for `updateContent: "attach"`.

Zip HAR archives are not supported.

## Protocol abort codes

The route API accepts Playwright abort strings, but the wire protocol supports this subset:

`failed`, `aborted`, `timedout`, `connectionrefused`, `connectionreset`, `namenotresolved`.

Unsupported strings collapse to `failed`.

## Matching scope

Route matching supports glob string, `RegExp`, predicate, `URLPattern`, and object filters `{ url, method, clientId }`.

There is no route registration filter for arbitrary headers. Inspect headers in the handler and then call `fulfill()`, `continue()`, `fallback()`, or `abort()`.

## Waiter options

`waitForRequest()` and `waitForResponse()` accept `{ timeout?, signal? }` only. Use predicates for method, status, header, body, or `clientId` filtering.

```ts
await backendMocks.waitForRequest(
  (request) => request.method() === "POST" && request.clientId === "api-server",
);
```

## Cross-test ownership

Cross-test collisions are not resolved by priority. They fail with `ambiguous_route`.

Within one test:

- HTTP routes are newest-first and can use `fallback()`.
- WebSocket routes use the newest matching handler only.

Across tests:

- More than one claiming test is an error.

## Shipping packages

The living package set is:

- `@playwright-backend-mocks/playwright`
- `@playwright-backend-mocks/node`
- `@playwright-backend-mocks/proxy`
- `@playwright-backend-mocks/protocol`

Observability history is in-memory only (cleared when the proxy exits). WebSocket traffic can be inspected live via REST/dashboard but is not exported as HAR. There is no MCP server — local agents should use the [REST API](/ops/rest-api) directly (see [Observability](/ops/observability)).

## Node and Playwright versions

The packages require Node.js `>=20`. The Playwright peer dependency is pinned to `@playwright/test@1.62.1`.
