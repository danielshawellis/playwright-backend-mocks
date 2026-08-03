# Source-backed coverage pass — Playwright ↔ oracle

Date: 2026-08-03  
Pin: `@playwright/test@1.62.1` / research commit `15b1aec`  
Suite at this pass: **299** browser-mode tests (all green)

Goal: near-complete coverage of Playwright **network interception** and **WebSocketRoute** branches that are analogous to the Node library rewrite (`route` / `fallback` / `continue` / `fulfill` / `abort` / `fetch` / `times` / matchers / `routeFromHAR→routeFromJSON` / `routeWebSocket` for `globalThis.WebSocket`).

---

## Method

1. Map Playwright modules analogous to the library: client `network.ts` (`Route`, `RouteHandler`, `WebSocketRoute`), `page.ts` / `browserContext.ts` `_onRoute`, isomorphic `urlMatch.ts`, server `network.ts` / `fetch.ts` / `harBackend.ts`, injected `webSocketMock.ts`.
2. Walk every meaningful branch (truthiness, forbidden headers, redirect rewrite, HAR body match gate, WS open/close/error, etc.).
3. Diff against `tests/parity/specs/*.ts` + checklist.
4. Fill gaps that map to Node library behavior; document intentional skips.
5. Re-run `pnpm test:parity` to green.

---

## Verdict

**Ready to merge Step 1 (oracle suite)** for the analogous Playwright surface, with residual P2 sharpening listed below — not merge blockers for the oracle contract.

Coverage of in-scope Playwright branches is **very high**. Remaining holes are sharpening (status-text tables, waiter globs, HAR relative Location, etc.), not missing core control-flow.

---

## Covered this pass (newly pinned)

| Area              | Behavior                                                                                                                                                                                                         | Spec                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Handler snapshot  | Late-registered handler does not join in-flight chain                                                                                                                                                            | `source-edges`            |
| Unroute           | `unrouteAll({behavior:'default'})` force-continues in-flight request                                                                                                                                             | `source-edges`            |
| Compression       | `route.fetch` decodes brotli + deflate (gzip already covered)                                                                                                                                                    | `source-edges` + upstream |
| Redirect matrix   | POST→301/302/303 → GET empty; 307/308 preserve; content-\* drop; Auth strip cross-origin / preserve same-origin                                                                                                  | `source-edges`            |
| Retries           | POST body reused after ECONNRESET; negative `maxRetries` rejected                                                                                                                                                | `source-edges`            |
| Fulfill           | `json`+`path` (path bytes, JSON CT); empty body no auto CL; unknown ext → octet-stream                                                                                                                           | `source-edges`            |
| Continue/fallback | Non-string header values reject; empty-string fallback postData; `proxy-*`/`sec-*` forbidden                                                                                                                     | `source-edges`            |
| Unroute RegExp    | Structural equality (source+flags); different flags leave handler                                                                                                                                                | `source-edges`            |
| HAR body gate     | PUT ignores body; bodyless POST vs entry with postData; POST with body vs entry without postData                                                                                                                 | `source-edges`            |
| Times             | `times: -1` once; `times: NaN` never expires                                                                                                                                                                     | `times`                   |
| Matchers          | Literal `[0-9]`; nested `{`; unmatched `}`; uppercase HTTP baseURL                                                                                                                                               | `matchers`                |
| WebSocket         | Second `close` no-op; close while CONNECTING; string protocol; unclean `wasClean=false`; handler throw → CONNECTING; page `error` on handshake fail; `binaryType` change after connect; `route.send` after close | `route-websocket`         |
| Earlier edges     | Header replace; falsey postData; status 0; selective unroute; `/g` lastIndex; predicate throw; HTTP predicate miss; `/**/`; continue object postData; HAR reuse / omit url / redirect cycle                      | `source-edges`            |

---

## Remaining gaps (not blocking merge)

### P1 (worth a follow-up if aiming for literal 100% branch coverage)

| Gap                                                                      | Playwright branch               | Why deferred                                                                |
| ------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------- |
| `unrouteAll({behavior:'wait'})` waits after `continue()` then async work | `RouteHandler` settlement       | Existing wait test covers barrier-before-settle; sharpen later              |
| Disposed `APIResponse` passed to `fulfill`                               | server `Route.fulfill`          | Niche error path                                                            |
| `status: -1` HAR exact stall (not abort-or-stall)                        | `HarRouter._handle`             | Current abort-marker test is looser                                         |
| HAR in-lookup redirect method rewrite (302/303/307)                      | `harBackend._harFindResponse`   | Fetch redirect matrix covers library-relevant rewrite; HAR copy is separate |
| Relative HAR `Location` resolution                                       | `new URL(location, currentUrl)` | Absolute Locations covered                                                  |
| Redirect chain `redirectedFrom` / `redirectedTo`                         | Request links                   | Inspection surface; low library risk                                        |
| Invalid `postDataJSON()`                                                 | Request                         | Error-message pin                                                           |
| Waiter glob + async predicate                                            | `waitForRequest/Response`       | Sync predicate + string/RegExp covered                                      |
| WS predicate throw                                                       | Separate from HTTP              | HTTP predicate throw pinned; WS path similar                                |
| Immediate `CLOSING` after page `close()`                                 | injected mock                   | Eventual close covered                                                      |
| Blob-then-text message ordering                                          | `messageToData`                 | Subtle race; P2-adjacent                                                    |

### P2 (sharpening)

- Empty URL/method overrides ignored (truthiness)
- Sticky RegExp reset (same branch as `/g`)
- Invalid redirect Location / malformed compressed streams
- `APIResponse.ok()` 199/200/299/300 boundaries; exact binary `body()`
- String `postData` under exact `application/json` → JSON-stringified
- HAR multipart candidate missing boundary; set-cookie `\n` join
- WS `MessageEvent.origin` / ready-state constants / long close reasons
- `x-http-method-override: TRACE` forbidden-value branch
- Retry exhaustion after all attempts; EPIPE non-retry

### Intentional skips (do not add)

Frames, navigation, SW, cookies, CORS auto-headers, page/context dual HTTP/WS scope, XHR vs fetch `resourceType`, `isNavigationRequest`, favicon, HAR zip, general `APIRequestContext` client, npm `ws` / non-`globalThis.WebSocket`, relative WS via `document.baseURI`, page-closure / frame-detach WS races.

---

## Module → suite map (analogous surface)

| Playwright module                                                | Oracle coverage                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Route` settle (`fulfill`/`continue`/`fallback`/`abort`/`fetch`) | **strong** — `fulfill`, `continue`, `fallback`, `abort`, `fetch`, `lifecycle`, `source-edges` |
| `RouteHandler` LIFO / times / snapshot / throw                   | **strong** — `fallback`, `times`, `lifecycle`, `source-edges`                                 |
| `urlMatch` / glob / RegExp / predicate / URLPattern              | **strong** — `matchers`, `source-edges`                                                       |
| server `fetch` redirects / retries / decompress                  | **strong** — `fetch`, `source-edges`                                                          |
| `harBackend` match / notFound / update control flow              | **strong** — `route-from-har`, `source-edges`                                                 |
| `WebSocketRoute` + `webSocketMock`                               | **strong** — `route-websocket` (64 cases)                                                     |

---

## How to re-verify

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test:parity
```

Expect **299 passed**.
