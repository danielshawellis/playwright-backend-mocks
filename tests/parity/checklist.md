# Oracle suite coverage checklist

Guaranteed API surface from [`research/rewrite-specification.md`](../../research/rewrite-specification.md) §4.
Scenarios adapted from Playwright’s network suite at research commit `15b1aec`.

## In-scope surface

| API / behavior                                                          | Spec file(s)                       | Status             |
| ----------------------------------------------------------------------- | ---------------------------------- | ------------------ |
| `route` intercept + fulfill JSON/status/headers/body                    | `fulfill.spec.ts`                  | covered            |
| `fulfill` buffer / path / json / status codes                           | `fulfill.spec.ts`                  | covered            |
| `fulfill` from `route.fetch` / APIResponse + overrides                  | `fetch.spec.ts`, `fulfill.spec.ts` | covered            |
| `continue` (+ url/method/headers/postData overrides)                    | `continue.spec.ts`                 | covered            |
| `abort` (+ documented error codes)                                      | `abort.spec.ts`                    | covered            |
| `fallback` LIFO chaining / no-chain on fulfill                          | abort                              | `fallback.spec.ts` | covered |
| `fallback` override accumulation                                        | `fallback.spec.ts`                 | covered            |
| `route.fetch` (+ timeout, maxRedirects, overrides)                      | `fetch.spec.ts`                    | covered            |
| Matchers: glob / RegExp / predicate                                     | `matchers.spec.ts`                 | covered            |
| Glob edges (`?` literal, invalid / unbalanced braces)                   | `matchers.spec.ts`                 | covered            |
| `times`                                                                 | `times.spec.ts`                    | covered            |
| `unroute` / `unrouteAll({ behavior })`                                  | `lifecycle.spec.ts`                | covered            |
| Double-settle throws                                                    | `lifecycle.spec.ts`                | covered            |
| Stall until settle / pause until continue                               | `lifecycle.spec.ts`                | covered            |
| Passthrough when no route matches                                       | `passthrough.spec.ts`              | covered            |
| Equal / concurrent requests                                             | `lifecycle.spec.ts`                | covered            |
| Large postData                                                          | `continue.spec.ts`                 | covered            |
| `waitForRequest`                                                        | `wait-for-request.spec.ts`         | covered            |
| Request inspection (url/method/headers/postData/json)                   | `inspection.spec.ts`               | covered            |
| `routeFromHAR` portable control flow (oracle for later `routeFromJSON`) | `route-from-har.spec.ts`           | covered            |

## Intentional skips (browser-only or out of scope)

Recorded so Step 2 does not silently inherit them.

| Playwright topic                                         | Reason                                               |
| -------------------------------------------------------- | ---------------------------------------------------- |
| CORS auto-headers on fulfill                             | Browser-network concern                              |
| Cookie jar / Set-Cookie redirect matrix                  | Browser-only                                         |
| Service workers / shared workers                         | Browser-only                                         |
| Navigation / main-frame / favicon / networkidle          | Browser-only                                         |
| `routeWebSocket`                                         | Out of v1 scope                                      |
| HAR zip / websocket HAR / navigation-after-HAR           | Non-portable; omit from initial suite                |
| Context vs page route precedence                         | Single `backendMocks` scope per test in library mode |
| `page.request` / `APIRequestContext` as a general client | Out of scope except as engine behind `route.fetch`   |
| Resource timing / transfer size                          | Browser-only                                         |

## Library-only (not in this suite)

`clientId`, cross-test `ambiguous_route`, proxy auth/disconnects, dashboard — live in a separate suite in Step 2.
