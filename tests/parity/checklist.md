# Oracle suite coverage checklist

Guaranteed API surface from [`research/rewrite-specification.md`](../../research/rewrite-specification.md) §4.
Scenarios adapted from Playwright’s network suite at research commit `15b1aec` and the public Route / Page / Request / Mock / WebSocketRoute API docs.

**Coverage analysis:** [`coverage-pass.md`](./coverage-pass.md) (updated after WebSocket + HTTP gap wave).

## In-scope surface

| API / behavior                                                                               | Spec file(s)                                            | Status  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------- |
| `route` intercept + fulfill JSON/status/headers/body                                         | `fulfill.spec.ts`                                       | covered |
| `fulfill` statusText / binary / Content-Length / contentType precedence                      | `fulfill.spec.ts`                                       | covered |
| `fulfill` from `route.fetch` / APIResponse + overrides                                       | `fetch.spec.ts`, `fulfill.spec.ts`                      | covered |
| `continue` (+ overrides, utf8, forbidden headers, redirect header/method semantics)          | `continue.spec.ts`                                      | covered |
| Same-protocol URL constraints (`continue` / `fetch` / `fallback`)                            | `continue.spec.ts`, `fetch.spec.ts`, `fallback.spec.ts` | covered |
| `abort` (+ documented codes, XHR)                                                            | `abort.spec.ts`                                         | covered |
| `fallback` LIFO / overrides / URL rematch                                                    | `fallback.spec.ts`                                      | covered |
| `route.fetch` (+ redirects, retries, CT defaults, headers `{}`, no HTTP-500 retry)           | `fetch.spec.ts`                                         | covered |
| `APIResponse` ok / json / dispose / statusText / body                                        | `fetch.spec.ts`                                         | covered |
| Matchers: glob / RegExp / predicate / URLPattern / entire-URL / escape / `*` baseURL / empty | `matchers.spec.ts`                                      | covered |
| `times` sequential + **concurrent** claim + `times: 0`                                       | `times.spec.ts`                                         | covered |
| Never-settle / throw-without-settle / fetch-only stall                                       | `lifecycle.spec.ts`                                     | covered |
| `unroute` / `unrouteAll` behaviors                                                           | `lifecycle.spec.ts`                                     | covered |
| Double-settle permutations                                                                   | `lifecycle.spec.ts`                                     | covered |
| Concurrent unlimited handlers                                                                | `lifecycle.spec.ts`                                     | covered |
| Passthrough                                                                                  | `passthrough.spec.ts`                                   | covered |
| `waitForRequest` / `waitForResponse` (+ future-only, AbortSignal)                            | `wait-for-*.spec.ts`                                    | covered |
| Request inspection (+ null postData, existingResponse, abort response)                       | `inspection.spec.ts`                                    | covered |
| `routeFromHAR` portable control flow (+ default notFound, fallback→handler)                  | `route-from-har.spec.ts`                                | covered |
| `routeWebSocket` / `WebSocketRoute`                                                          | `route-websocket.spec.ts`                               | covered |

## WebSocketRoute portable cases

| Behavior                                               | Status  |
| ------------------------------------------------------ | ------- |
| Full mock without server                               | covered |
| Empty handler opens mock                               | covered |
| `url()` / `protocols()` (+ string protocol arg)        | covered |
| Proactive `send` without inbound message               | covered |
| Text + binary `send` to page                           | covered |
| Binary frames from page into `onMessage`               | covered |
| Binary default-forward through `connectToServer`       | covered |
| `connectToServer` default bidirectional forward        | covered |
| Explicit pass-through `onMessage` both directions      | covered |
| Bidirectional block/modify matrix                      | covered |
| `onMessage` disables that direction’s auto-forward     | covered |
| Second `onMessage` replaces first                      | covered |
| `close()` / `close({code,reason})`                     | covered |
| `close` while connected closes page + upstream         | covered |
| Default close forwarding **both** ways                 | covered |
| `onClose` disables forward; manual re-forward works    | covered |
| Server-side `onClose` disables server→page close       | covered |
| `connectToServer` twice throws                         | covered |
| Glob / RegExp / predicate / newest-match / passthrough | covered |
| Host URL with no trailing slash                        | covered |
| Only sockets after registration (+ re-nav for inject)  | covered |
| Concurrent sockets isolated                            | covered |
| Upstream handshake failure                             | covered |
| Negotiated subprotocol pass-through                    | covered |
| Server-side `protocols()` mirrors page request         | covered |
| `unrouteAll` does not clear WS routes                  | covered |
| `baseURL` relative pattern (+ uppercase scheme)        | covered |
| `context.routeWebSocket` + page-over-context win       | covered |
| Pending async handler stays CONNECTING; `send` opens   | covered |

## routeFromHAR → routeFromJSON portable cases

| Behavior                                  | Status  |
| ----------------------------------------- | ------- |
| Method / body / header score / multipart  | covered |
| `notFound` abort / fallback / **default** | covered |
| Fallback → next route handler             | covered |
| Update / full / embed / abort markers     | covered |
| `unrouteAll` stops replay                 | covered |

## Intentional skips

| Topic                                                 | Reason                                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------------------- |
| CORS auto-headers, cookie jar, SW, navigation/favicon | Browser-only                                                                |
| WS frame navigation/detach close, page-closure races  | Browser lifecycle                                                           |
| DOM `binaryType` Blob vs ArrayBuffer object identity  | Client-specific; shared suite asserts bytes                                 |
| npm `ws` / non-global WebSocket constructors          | Step 2 divergence — `globalThis.WebSocket` only                             |
| HAR zip / attach / navigation HAR                     | Non-portable                                                                |
| Page vs context HTTP precedence                       | Product single `backendMocks` scope (HTTP); WS precedence covered in oracle |
| General `APIRequestContext` client                    | OOS except as `route.fetch` engine                                          |
| Resource timing / TLS                                 | Browser / TLS                                                               |

## Library-only (not in this suite)

`clientId`, cross-test `ambiguous_route`, proxy auth/disconnects, dashboard, control-plane WS recursion guards.
