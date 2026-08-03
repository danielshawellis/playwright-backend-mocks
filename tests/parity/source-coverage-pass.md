# Source-backed coverage pass — Playwright ↔ oracle

Date: 2026-08-03  
Pin: `@playwright/test@1.62.1` / research commit `15b1aec`  
Suite at this pass: **322** browser-mode tests (all green)

Goal: near-complete coverage of Playwright **network interception** and **WebSocketRoute** branches that are analogous to the Node library rewrite (`route` / `fallback` / `continue` / `fulfill` / `abort` / `fetch` / `times` / matchers / **`routeFromHAR`** / `routeWebSocket` for `globalThis.WebSocket`).

---

## Method

1. Map Playwright modules analogous to the library: client `network.ts` (`Route`, `RouteHandler`, `WebSocketRoute`), `page.ts` / `browserContext.ts` `_onRoute`, isomorphic `urlMatch.ts`, server `network.ts` / `fetch.ts` / `harBackend.ts`, injected `webSocketMock.ts`.
2. Walk every meaningful branch (truthiness, forbidden headers, redirect rewrite, HAR body match gate, WS open/close/error, etc.).
3. Diff against `tests/parity/specs/*.ts` + checklist.
4. Fill gaps that map to Node library behavior; document intentional skips.
5. Re-run `pnpm test:parity` to green.

---

## Verdict

**Ready to merge Step 1 (oracle suite).** In-scope Playwright branches for the analogous surface are pinned.

**Product record/replay decision:** `backendMocks.routeFromHAR` with Playwright HAR file parity (not JSON cassettes). See rewrite-specification §4.

---

## Covered (including straggler fill)

| Area             | Behavior                                                                                                                       | Spec                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Handler snapshot | Late-registered handler does not join in-flight chain                                                                          | `source-edges`                      |
| Unroute          | Force-continue on default; wait after `continue()`+async work                                                                  | `source-edges`                      |
| Compression      | gzip / brotli / deflate                                                                                                        | `fetch`, `source-edges`             |
| Redirect matrix  | POST→301–308; content-\* drop; Auth strip/preserve                                                                             | `source-edges`                      |
| Retries          | POST body reuse; negative `maxRetries`; exhaustion                                                                             | `source-edges`                      |
| Fulfill          | `json`+`path`; empty CL; unknown MIME; disposed `APIResponse`                                                                  | `source-edges`                      |
| Continue         | Non-string headers; empty url/method ignored; `proxy-*`/`sec-*`; `x-http-method-override` TRACE vs allowed                     | `source-edges`                      |
| HAR              | Body-match gate; status -1 stall; 302/307 method rewrite; relative Location; reuse/omit url/cycle                              | `source-edges`, `route-from-har`    |
| Times / matchers | `-1` / `NaN`; literal `[0-9]`; braces; sticky `/y`; uppercase HTTP baseURL                                                     | `times`, `matchers`, `source-edges` |
| Inspection       | Invalid `postDataJSON`; `redirectedFrom` / `redirectedTo`                                                                      | `inspection`                        |
| Waiters          | Glob + async predicate                                                                                                         | `wait-for-*`                        |
| Fetch            | String under exact `application/json` JSON-stringified; `APIResponse.ok` 200–299; exact binary `body()`                        | `source-edges`                      |
| WebSocket        | Unclean close; handler/predicate throw; page `error`; `binaryType` change; send-after-close; CLOSING; Blob-vs-text async order | `route-websocket`                   |

---

## Residual (intentionally tiny / low value)

| Gap                                          | Notes                      |
| -------------------------------------------- | -------------------------- |
| Malformed compressed streams                 | Error-path sharpening only |
| Invalid redirect `Location`                  | Error-path sharpening      |
| HAR multipart candidate missing boundary     | Narrow `harBackend` branch |
| HAR set-cookie `\n` join                     | Header join quirk          |
| EPIPE non-retry                              | Fixture-unstable           |
| WS `MessageEvent.origin` / long close reason | Browser event-shape polish |
| `context.routeFromHAR` dual registration     | Product is single-scope    |

### Intentional skips

Frames, navigation, SW, cookies, CORS auto-headers, page/context dual HTTP/WS scope, XHR/`resourceType`, `isNavigationRequest`, favicon, HAR zip packaging, general `APIRequestContext` client, npm `ws` / non-`globalThis.WebSocket`, relative WS via `document.baseURI`, page-closure / frame-detach WS races.

---

## Dual-mode harness readiness

**Product decision:** full HAR parity (`backendMocks.routeFromHAR`), not JSON cassettes.

The dual-mode seam exposes:

- `route` / `unroute` / `unrouteAll`
- **`routeFromHAR(file, options)`** → browser: `page.routeFromHAR`; Step 2: `backendMocks.routeFromHAR`
- **`routeWebSocket(url, handler)`** → browser: `page.routeWebSocket`; Step 2: `backendMocks.routeWebSocket`
- `trigger` / `openDownstreamSocket` / `waitForRequest` / `waitForResponse`
- `withIsolatedDownstream` for HAR update flush / custom `baseURL`

Specs call harness fixtures only. Upstream is always Node; downstream outbound code is always `fixtures/downstream`.

Step 2 switchover:

1. Implement `backendMocks.*` with Playwright-compatible options.
2. In `harness.ts`, replace the backend `notWired` throws with those APIs.
3. Existing dual-mode specs (including HAR + WebSocket) run with the same assertions.
4. HAR `update: true` uses `withIsolatedDownstream` so browser context close flushes recordings; node mode will flush on dispose.

---

## Module → suite map

| Playwright module                                                | Oracle coverage                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Route` settle (`fulfill`/`continue`/`fallback`/`abort`/`fetch`) | **strong** — `fulfill`, `continue`, `fallback`, `abort`, `fetch`, `lifecycle`, `source-edges` |
| `RouteHandler` LIFO / times / snapshot / throw                   | **strong** — `fallback`, `times`, `lifecycle`, `source-edges`                                 |
| `urlMatch` / glob / RegExp / predicate / URLPattern              | **strong** — `matchers`, `source-edges`                                                       |
| server `fetch` redirects / retries / decompress                  | **strong** — `fetch`, `source-edges`                                                          |
| `harBackend` match / notFound / update / redirects               | **strong** — `route-from-har`, `source-edges`                                                 |
| `WebSocketRoute` + `webSocketMock`                               | **strong** — `route-websocket`                                                                |

---

## How to re-verify

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:parity
```
