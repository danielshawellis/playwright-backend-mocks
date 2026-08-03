# Oracle suite coverage checklist

Guaranteed API surface from [`research/rewrite-specification.md`](../../research/rewrite-specification.md) §4.
Scenarios adapted from Playwright’s network suite at research commit `15b1aec` and the public Route / Page / Request / Mock API docs.

**Latest thorough docs+source pass:** [`coverage-pass.md`](./coverage-pass.md) (2026-08-03). Use that document for gap ranking; this table is the living summary.

## In-scope surface

| API / behavior                                                                                      | Spec file(s)                                            | Status  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------- |
| `route` intercept + fulfill JSON/status/headers/body                                                | `fulfill.spec.ts`                                       | covered |
| `fulfill` buffer / path / json / status / defaults / MIME inference / coercion / 3xx / text patch   | `fulfill.spec.ts`                                       | partial |
| `fulfill` from `route.fetch` / APIResponse + overrides                                              | `fetch.spec.ts`, `fulfill.spec.ts`                      | covered |
| `continue` (+ url/method/headers/postData, JSON/binary/empty/long/utf8, forbidden headers)          | `continue.spec.ts`                                      | partial |
| `continue` / `fetch` / `fallback` same-protocol URL constraint                                      | `continue.spec.ts`, `fetch.spec.ts`, `fallback.spec.ts` | covered |
| `abort` (+ all documented codes, distinguishable failures, XHR)                                     | `abort.spec.ts`                                         | covered |
| `fallback` LIFO / async / no-chain / exception / overrides / binary / method / URL rematch          | `fallback.spec.ts`                                      | covered |
| `route.fetch` (+ timeout/0, maxRedirects, maxRetries, signal, overrides, gzip, CT defaults)         | `fetch.spec.ts`                                         | partial |
| `APIResponse` ok / json throw / dispose / statusText / headersArray / body                          | `fetch.spec.ts`                                         | partial |
| Matchers: glob / RegExp / predicate / URLPattern                                                    | `matchers.spec.ts`                                      | covered |
| Glob edges (`?`, `*` vs `**`, `{a,b}`, entire-URL, backslash escape, encoding, baseURL, Disposable) | `matchers.spec.ts`                                      | partial |
| `times` (sequential exhaust / LIFO / fallback consumes)                                             | `times.spec.ts`                                         | partial |
| `times` under concurrent matching requests                                                          | —                                                       | **gap** |
| Handler never-settle / throw-without-settle / fetch-only stall                                      | —                                                       | **gap** |
| `unroute` / `unroute(url)` / `unrouteAll({ wait\|ignoreErrors\|default })`                          | `lifecycle.spec.ts`                                     | partial |
| Double-settle throws (fulfill/continue/abort permutations)                                          | `lifecycle.spec.ts`                                     | partial |
| Stall until settle / pause until continue / concurrent unlimited handlers                           | `lifecycle.spec.ts`, `continue.spec.ts`                 | covered |
| Passthrough when no route matches                                                                   | `passthrough.spec.ts`                                   | covered |
| `waitForRequest` (string/RegExp/predicate/timeout/0/signal)                                         | `wait-for-request.spec.ts`                              | partial |
| `waitForResponse` (string/RegExp/predicate/timeout/0/continue)                                      | `wait-for-response.spec.ts`                             | partial |
| Waiting APIs are future-only; `waitForResponse` AbortSignal                                         | —                                                       | **gap** |
| Request inspection (postData/JSON/form/headers/response/failure/inspect-then-continue)              | `inspection.spec.ts`                                    | partial |
| `routeFromHAR` portable control flow (oracle for later `routeFromJSON`)                             | `route-from-har.spec.ts`                                | partial |
| `routeWebSocket` / `WebSocketRoute`                                                                 | —                                                       | **gap** |

## routeFromHAR → routeFromJSON portable cases

| Behavior                                  | Status  |
| ----------------------------------------- | ------- |
| Method match (GET/POST)                   | covered |
| POST body disambiguation                  | covered |
| Header disambiguation                     | covered |
| Most-matching-headers scoring             | covered |
| Multipart body match ignores boundary     | covered |
| `notFound: abort` / `fallback`            | covered |
| Default `notFound` when omitted           | **gap** |
| `notFound: fallback` → next route handler | **gap** |
| Bad HAR + fallback                        | covered |
| url filter glob / regex / predicate       | covered |
| Redirect following in cassette            | covered |
| Fallback overrides before HAR lookup      | covered |
| `update: true` record + replay            | covered |
| `updateMode: full` / `minimal`            | covered |
| `updateContent: embed`                    | covered |
| Record with url filter + overrides        | covered |
| Aborted update entries failure-marked     | covered |
| `unrouteAll` stops replay                 | covered |
| Wrong method does not reuse entry         | covered |

## Intentional skips (browser-only or out of scope)

| Playwright topic                                         | Reason                                               |
| -------------------------------------------------------- | ---------------------------------------------------- |
| CORS auto-headers on fulfill                             | Browser-network concern                              |
| Cookie jar / Set-Cookie redirect matrix                  | Browser-only                                         |
| Service workers / shared workers                         | Browser-only                                         |
| Navigation / main-frame / favicon / networkidle          | Browser-only                                         |
| HAR zip / websocket HAR / navigation-after-HAR UI        | Non-portable                                         |
| Context vs page route precedence                         | Single `backendMocks` scope per test in library mode |
| `page.request` / `APIRequestContext` as a general client | Out of scope except as engine behind `route.fetch`   |
| Resource timing / transfer size / securityDetails        | Browser / TLS concerns                               |

## Library-only (not in this suite)

`clientId`, cross-test `ambiguous_route`, proxy auth/disconnects, dashboard — live in a separate suite in Step 2.
