# Oracle suite coverage checklist

Guaranteed API surface from [`research/rewrite-specification.md`](../../research/rewrite-specification.md) §4.
Scenarios adapted from Playwright’s network suite at research commit `15b1aec` and the public Route / Page / Request / Mock / WebSocketRoute API docs.

**Source fine-tooth pass:** [`source-coverage-pass.md`](./source-coverage-pass.md) (322 green).

## In-scope surface

| API / behavior                                                                               | Spec file(s)                                            | Status  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------- |
| `route` intercept + fulfill JSON/status/headers/body                                         | `fulfill.spec.ts`                                       | covered |
| `fulfill` statusText / binary / Content-Length / contentType precedence                      | `fulfill.spec.ts`, `source-edges.spec.ts`               | covered |
| `fulfill` from `route.fetch` / APIResponse + overrides                                       | `fetch.spec.ts`, `fulfill.spec.ts`                      | covered |
| `continue` (+ overrides, utf8, forbidden headers, redirect header/method semantics)          | `continue.spec.ts`, `source-edges.spec.ts`              | covered |
| Same-protocol URL constraints (`continue` / `fetch` / `fallback`)                            | `continue.spec.ts`, `fetch.spec.ts`, `fallback.spec.ts` | covered |
| `abort` (+ documented codes accepted; distinguishable failure text)                          | `abort.spec.ts`                                         | covered |
| `fallback` LIFO / overrides / URL rematch                                                    | `fallback.spec.ts`, `source-edges.spec.ts`              | covered |
| `route.fetch` (+ redirects 301–308, retries, CT, gzip/br/deflate, Auth strip)                | `fetch.spec.ts`, `source-edges.spec.ts`                 | covered |
| `APIResponse` ok / json / dispose / statusText / body                                        | `fetch.spec.ts`                                         | covered |
| Matchers: glob / RegExp / predicate / URLPattern / entire-URL / escape / `*` baseURL / empty | `matchers.spec.ts`, `source-edges.spec.ts`              | covered |
| `times` sequential + concurrent claim + `0` / `-1` / `NaN`                                   | `times.spec.ts`                                         | covered |
| Never-settle / throw-without-settle / fetch-only stall / snapshot / force-continue           | `lifecycle.spec.ts`, `source-edges.spec.ts`             | covered |
| `unroute` / `unrouteAll` behaviors (+ RegExp structural equality)                            | `lifecycle.spec.ts`, `source-edges.spec.ts`             | covered |
| Double-settle permutations                                                                   | `lifecycle.spec.ts`                                     | covered |
| Concurrent unlimited handlers                                                                | `lifecycle.spec.ts`                                     | covered |
| Passthrough                                                                                  | `passthrough.spec.ts`                                   | covered |
| `waitForRequest` / `waitForResponse` (+ future-only, AbortSignal)                            | `wait-for-*.spec.ts`                                    | covered |
| Request inspection (+ null postData, existingResponse, abort response)                       | `inspection.spec.ts`                                    | covered |
| `routeFromHAR` portable control flow (+ body-match gate, redirects, status -1, harness seam) | `route-from-har.spec.ts`, `source-edges.spec.ts`        | covered |
| `routeWebSocket` / `WebSocketRoute`                                                          | `route-websocket.spec.ts`                               | covered |
| Source-backed edge matrix (headers replace, falsey postData, status 0, HAR cycle, …)         | `source-edges.spec.ts`                                  | covered |

## WebSocketRoute portable cases

| Behavior                                               | Status  |
| ------------------------------------------------------ | ------- |
| Full mock without server                               | covered |
| Empty handler opens mock                               | covered |
| `url()` / `protocols()` (+ string / empty / array)     | covered |
| Proactive `send` without inbound message               | covered |
| Text + binary `send` to page                           | covered |
| Binary / Blob frames from page into `onMessage`        | covered |
| Binary default-forward through `connectToServer`       | covered |
| `connectToServer` default bidirectional forward        | covered |
| Server inject + local respond without upstream         | covered |
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
| Only sockets after registration                        | covered |
| Concurrent sockets isolated                            | covered |
| Upstream handshake failure                             | covered |
| Negotiated subprotocol pass-through                    | covered |
| Server-side `protocols()` mirrors page request         | covered |
| `unrouteAll` does not clear WS routes                  | covered |
| `baseURL` relative pattern (+ uppercase scheme)        | covered |
| Pending async handler stays CONNECTING; `send` opens   | covered |
| Mock selects first protocol / empty extensions         | covered |
| Server-side `connectToServer` throws                   | covered |
| Page send CONNECTING/CLOSED throws; close code rules   | covered |
| TypedArray `byteOffset`/`byteLength` slicing           | covered |
| Absolute `http→ws` constructor URL rewrite             | covered |
| Predicate miss → passthrough                           | covered |
| Invalid glob throws at registration                    | covered |
| `URLPattern` matcher                                   | covered |
| Buffer `server.send` while upstream CONNECTING         | covered |
| `onMessage` not awaited (async non-blocking)           | covered |
| Empty-string matcher matches all                       | covered |
| Second `route.close` no-op / close while CONNECTING    | covered |
| String protocol arg / unclean `wasClean=false`         | covered |
| Handler throw → stays CONNECTING                       | covered |
| Upstream handshake dispatches page `error`             | covered |
| `binaryType` change after connect                      | covered |
| `route.send` after close does not throw                | covered |

## routeFromHAR portable cases

(Oracle pins real HAR. Step 2 keeps `routeFromHAR` via the harness seam — see rewrite-spec §4 and [`source-coverage-pass.md`](./source-coverage-pass.md).)

| Behavior                                  | Status  |
| ----------------------------------------- | ------- |
| Method / body / header score / multipart  | covered |
| `notFound` abort / fallback / **default** | covered |
| Fallback → next route handler             | covered |
| Update / abort markers                    | covered |
| `unrouteAll` stops replay                 | covered |

## Intentional skips / removed from oracle

| Topic                                                    | Reason                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| CORS auto-headers, cookie jar, SW, navigation/favicon    | Browser-only                                                |
| WS frame navigation/detach close                         | Browser document lifecycle; no Node WebSocketRoute analogue |
| WS page-closure send races                               | Browser `page.close()` lifecycle                            |
| Page vs context HTTP/WS dual scope                       | Product single `backendMocks` scope                         |
| XHR transport matrix                                     | No Node analogue                                            |
| `request.resourceType` / `frame` / `isNavigationRequest` | Browser request model only                                  |
| Relative WS URL via `document.baseURI`                   | Node requires absolute (or `http→ws`) URLs                  |
| HAR `updateContent` / `updateMode: full` storage shape   | HAR-format specific; portable `update: true` remains        |
| npm `ws` / non-global WebSocket constructors             | Step 2 divergence — `globalThis.WebSocket` only             |
| General `APIRequestContext` client                       | OOS except as `route.fetch` engine                          |
| Resource timing / TLS                                    | Browser / TLS                                               |

## Library-only (not in this suite)

`clientId`, cross-test `ambiguous_route`, proxy auth/disconnects, dashboard, control-plane WS recursion guards.
