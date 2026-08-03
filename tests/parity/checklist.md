# Oracle suite coverage checklist

Guaranteed API surface from [`research/rewrite-specification.md`](../../research/rewrite-specification.md) §4.
Scenarios adapted from Playwright’s network suite at research commit `15b1aec` and the public Route / Page / Request / Mock API docs.

## In-scope surface

| API / behavior                                                                                       | Spec file(s)                            | Status  |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------- | ------- |
| `route` intercept + fulfill JSON/status/headers/body                                                 | `fulfill.spec.ts`                       | covered |
| `fulfill` buffer / path / json / status / defaults / MIME inference / coercion / 3xx / text patch    | `fulfill.spec.ts`                       | covered |
| `fulfill` from `route.fetch` / APIResponse + overrides                                               | `fetch.spec.ts`, `fulfill.spec.ts`      | covered |
| `continue` (+ url/method/headers/postData, JSON/binary/empty/long, forbidden Host, skip handlers)    | `continue.spec.ts`                      | covered |
| `abort` (+ all documented codes, distinguishable failures, XHR)                                      | `abort.spec.ts`                         | covered |
| `fallback` LIFO / async / no-chain / exception / overrides / binary / method dispatch / URL retarget | `fallback.spec.ts`                      | covered |
| `route.fetch` (+ timeout/0, maxRedirects, maxRetries, signal, overrides, gzip, APIResponse fields)   | `fetch.spec.ts`                         | covered |
| Matchers: glob / RegExp / predicate / URLPattern                                                     | `matchers.spec.ts`                      | covered |
| Glob edges (`?`, `*` vs `**`, `{a,b}`, invalid braces, encoding, baseURL, Disposable)                | `matchers.spec.ts`                      | covered |
| `times`                                                                                              | `times.spec.ts`                         | covered |
| `unroute` / `unroute(url)` / `unrouteAll({ wait\|ignoreErrors\|default })`                           | `lifecycle.spec.ts`                     | covered |
| Double-settle throws (fulfill/continue/abort permutations)                                           | `lifecycle.spec.ts`                     | covered |
| Stall until settle / pause until continue / concurrent                                               | `lifecycle.spec.ts`, `continue.spec.ts` | covered |
| Passthrough when no route matches                                                                    | `passthrough.spec.ts`                   | covered |
| `waitForRequest` (string/RegExp/predicate/timeout/0/signal)                                          | `wait-for-request.spec.ts`              | covered |
| Request inspection (postData/JSON/form-urlencoded/headers/response/failure/route.request)            | `inspection.spec.ts`                    | covered |
| `routeFromHAR` portable control flow (oracle for later `routeFromJSON`)                              | `route-from-har.spec.ts`                | covered |

## routeFromHAR → routeFromJSON portable cases

| Behavior                             | Status  |
| ------------------------------------ | ------- |
| Method match (GET/POST)              | covered |
| POST body disambiguation             | covered |
| Header disambiguation                | covered |
| `notFound: abort` / `fallback`       | covered |
| Bad HAR + fallback                   | covered |
| url filter glob / regex / predicate  | covered |
| Redirect following in cassette       | covered |
| Fallback overrides before HAR lookup | covered |
| `update: true` record + replay       | covered |
| `updateContent: embed`               | covered |
| `unrouteAll` stops replay            | covered |
| Wrong method does not reuse entry    | covered |

## Intentional skips (browser-only or out of scope)

| Playwright topic                                         | Reason                                               |
| -------------------------------------------------------- | ---------------------------------------------------- |
| CORS auto-headers on fulfill                             | Browser-network concern                              |
| Cookie jar / Set-Cookie redirect matrix                  | Browser-only                                         |
| Service workers / shared workers                         | Browser-only                                         |
| Navigation / main-frame / favicon / networkidle          | Browser-only                                         |
| `routeWebSocket`                                         | Out of v1 scope                                      |
| HAR zip / websocket HAR / navigation-after-HAR UI        | Non-portable                                         |
| Context vs page route precedence                         | Single `backendMocks` scope per test in library mode |
| `page.request` / `APIRequestContext` as a general client | Out of scope except as engine behind `route.fetch`   |
| Resource timing / transfer size / securityDetails        | Browser / TLS concerns                               |

## Library-only (not in this suite)

`clientId`, cross-test `ambiguous_route`, proxy auth/disconnects, dashboard — live in a separate suite in Step 2.
