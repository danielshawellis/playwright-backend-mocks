# Oracle coverage pass — Playwright interception APIs

Date: 2026-08-03 (updated same day after WS + HTTP gap implementation)  
Pin: `@playwright/test@1.62.1` / research commit `15b1aec`  
Suite at latest green run: **238** browser-mode tests

**Status update:** WebSockets stay on the rewrite roadmap with **loud docs caveats** (HTTP ≈ all clients; WS = `globalThis.WebSocket` only — see rewrite-spec §4). Oracle `route-websocket.spec.ts` pins Playwright `WebSocketRoute` + injected `webSocketMock.ts` edge cases (62 WS cases). Remaining WS skips are only browser document-lifecycle (`_executionContextGone` / `page.close`).

This document is the methodical docs → implementation → suite comparison requested for Step 1. It invents no new product API; it inventories Playwright’s interception surface, maps our suite, and lists remaining gaps needed for near-complete behavioral parity (Ajax + WebSockets), excluding browser-only concerns (cookies, CORS auto-headers, navigation, service workers, favicon, TLS/timing).

---

## Method

1. **Public docs inventory** — Route, Page/BrowserContext `route`/`unroute`/`unrouteAll`/`routeFromHAR`/`routeWebSocket`, Request, APIResponse (as used by `route.fetch`), WebSocketRoute, Network/Mocking guides (glob rules, handler order, WS mocking).
2. **Rewrite-spec scope check** — [`research/rewrite-specification.md`](../../research/rewrite-specification.md) §4 in-scope vs out-of-scope.
3. **Suite map** — Every `tests/parity/specs/*.ts` test name vs inventory (covered / partial / missing).
4. **Source mine** — Playwright `v1.62.1` client `network.ts` / `page.ts` / `browserContext.ts`, isomorphic `urlMatch.ts`, server `network.ts` / `fetch.ts` / `harBackend.ts`, `WebSocketRoute` + injected mock, Playwright’s own `route-web-socket.spec.ts`.
5. **Edge-case brainstorm** — concurrency, timing, settlement, matcher edges, WS forwarding/close races.
6. **Gap ranking** — P0 (parity-breaking / untested contract), P1 (documented or source-backed edges), P2 (sharpening).

---

## Scope notes

| Topic                                                                                | Rewrite-spec today                   | This pass                                                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Ajax/HTTP route settle + matchers + times + wait + HAR→JSON control flow             | **In scope**                         | Keep / deepen                                                                                                                        |
| `routeWebSocket` / `WebSocketRoute`                                                  | Listed **out of scope**              | **User now wants full oracle coverage** — treat as new in-scope for the suite; update rewrite-spec when implementing                 |
| Cookie jar, CORS auto-headers, SW, navigation, favicon, HAR zip, resource timing/TLS | Out of scope                         | Remain skips                                                                                                                         |
| Page vs context route precedence                                                     | Product has one `backendMocks` scope | Still valuable as **oracle-only** pins if we ever expose dual scopes; not required for library parity if divergence stays documented |

---

## Executive verdict

The suite is strong on LIFO/`fallback`/`continue` distinction, sequential `times`, matcher basics, `route.fetch` redirects/retries/CT defaults, and HAR portable control flow.

It is **not** yet at “100% of interesting interception behavior.” Highest-risk holes:

1. **WebSocketRoute — zero coverage** (now required).
2. **`times` under concurrent matching requests** — reserved at invocation start in Playwright; sequential tests cannot catch claim races.
3. **Handler / settlement edge matrix** incomplete (never-settle, throw-after-fallback, abort-first double-settle, fetch-only stall).
4. **`fulfill` wire details** under-pinned (`statusText`, true binary, auto `Content-Length`, `contentType` vs header conflict).
5. **Waiting APIs** missing future-only semantics and `waitForResponse` AbortSignal.
6. Source-level edges (forbidden-header full list, `times <= 0`, empty matcher, header replacement vs merge, POST-only HAR body match, etc.) mostly untested.

Unlimited concurrent handlers **are** covered (`lifecycle`: `handles equal concurrent requests`). Limited `{ times: N }` concurrency is **not**.

---

## Coverage by surface

Legend: **yes** = meaningful pin · **partial** = API touched but important branch missing · **no** = absent · **skip** = intentional browser/OOS

### Matchers / glob

| Behavior                                                                                   | Status     | Where / notes             |
| ------------------------------------------------------------------------------------------ | ---------- | ------------------------- |
| Glob / RegExp / predicate / URLPattern                                                     | yes        | `matchers.spec.ts`        |
| Entire-URL match; `*` vs `**`; literal `?`; braces; backslash escape; invalid braces throw | yes        | `matchers.spec.ts`        |
| `baseURL` relative string                                                                  | yes        | relative `/users`         |
| Strings starting with `*` skip `baseURL` resolution                                        | no         | Source: `resolveGlobBase` |
| Opaque schemes (`about:`, `data:`, `file:`) skip baseURL                                   | skip/maybe | Low value for Node HTTP   |
| Empty / `undefined` matcher = match all                                                    | no         | Source: `urlMatches`      |
| `/g` RegExp `lastIndex` reset between requests                                             | no         | Source: `urlMatches`      |
| Predicate throw leaves request stalled                                                     | no         | Source                    |
| Character classes literal (`[0-9]`)                                                        | no         | Docs/source               |
| Encoded path                                                                               | partial    | `%20` only                |

### Handler orchestration

| Behavior                                                                | Status           | Where / notes                          |
| ----------------------------------------------------------------------- | ---------------- | -------------------------------------- |
| LIFO registration                                                       | yes              | `fallback.spec.ts`                     |
| Async LIFO                                                              | yes              | same                                   |
| `continue` skips remaining handlers                                     | yes              | `continue.spec.ts`                     |
| `fallback` chains; final → network                                      | yes              | `fallback.spec.ts`                     |
| `fulfill`/`abort` terminate chain                                       | yes              | `fallback.spec.ts`                     |
| Unlimited handler concurrency                                           | yes              | `lifecycle` concurrent equal requests  |
| Snapshot of handlers per request (late register doesn’t join in-flight) | no               | Source: `_onRoute`                     |
| Removed handler skipped mid-chain via live membership                   | partial          | `unrouteAll wait` proves later removed |
| Handler never settles → indefinite stall                                | no               | Critical contract                      |
| Handler throw / reject without settle                                   | no               | Uncaught; request remains paused       |
| `fallback()` then throw blocks lower handlers                           | no               | Source: `_handleInternal`              |
| Page before context routes                                              | skip/oracle-only | Product single scope                   |
| Favicon auto-abort / SW / cache disable                                 | skip             | Browser-only                           |

### `times`

| Behavior                                                           | Status | Where / notes                                                                                |
| ------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------- |
| Sequential exhaust                                                 | yes    | `times.spec.ts`                                                                              |
| Async still consumes                                               | yes    | sequential                                                                                   |
| Fallback consumes                                                  | yes    |                                                                                              |
| Stacked LIFO after exhaust                                         | yes    |                                                                                              |
| **Concurrent two requests + `{times:1}` → exactly one invocation** | **no** | **P0** — `handledCount` increments at start; handler removed when `willExpire` before invoke |
| Concurrent `{times:2}` with 3 in flight                            | no     | P0                                                                                           |
| `times <= 0` still runs once / `NaN` never expires                 | no     | Source quirk — pin observed                                                                  |
| Failures/stalls still consume count                                | no     |                                                                                              |

### `unroute` / `unrouteAll`

| Behavior                                            | Status  | Where / notes                                                                   |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| unroute(url, handler) / unroute(url) / unrouteAll   | yes     | `lifecycle`                                                                     |
| wait / ignoreErrors / default timing                | partial | ignoreErrors suppression not rigorously trapped; default error behavior vacuous |
| Disposable dispose                                  | yes     | `matchers`                                                                      |
| wait deadlock if called from active handler         | no      | Source                                                                          |
| Removing last interceptor force-continues in-flight | no      | Source: `removeHandler`                                                         |
| Unknown handler / structural regex equality         | no      |                                                                                 |
| `unrouteAll` does **not** clear WebSocket routes    | no      | WS suite must pin                                                               |

### `Route.abort`

| Behavior                              | Status  | Notes           |
| ------------------------------------- | ------- | --------------- |
| Default + all documented codes        | yes     | `abort.spec.ts` |
| Distinguishable failure text (sample) | partial | not full matrix |
| XHR                                   | yes     |                 |

### `Route.continue`

| Behavior                                                         | Status  | Notes                                                    |
| ---------------------------------------------------------------- | ------- | -------------------------------------------------------- |
| url/method/headers/postData matrix                               | yes     | string/binary/utf8/empty/json/long                       |
| Same-protocol throw + stall after failed settle                  | yes     | observed                                                 |
| Forbidden Host/Cookie/Content-Length/trailer                     | yes     |                                                          |
| Full forbidden list (`sec-*`, `proxy-*`, …)                      | no      | Source list                                              |
| Headers = **replacement** not merge (omit drops allowed headers) | no      | Source: `applyHeadersOverrides`                          |
| Header coercion to string                                        | no      | fulfill has it; continue doesn’t                         |
| Headers persist across redirects                                 | no      | Docs claim; test currently covers **fetch** not continue |
| method/postData not carried to redirect hops                     | partial | URL only                                                 |
| postData `false`/`0`/`null` truthiness ignore on fallback path   | no      | Source `_applyFallbackOverrides`                         |

### `Route.fallback`

| Behavior                                       | Status | Notes                  |
| ---------------------------------------------- | ------ | ---------------------- |
| Overrides + rematch observed runtime           | yes    | docs vs reality pinned |
| Protocol change does not throw (stalls)        | yes    | docs vs reality        |
| Empty postData string                          | no     |                        |
| Does not auto-set Content-Type for JSON object | no     | unlike `route.fetch`   |

### `Route.fetch` / APIResponse

| Behavior                                                        | Status  | Notes                                                              |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Overrides, timeout, signal, maxRedirects, maxRetries ECONNRESET | yes     |                                                                    |
| CT defaults for object vs non-object postData                   | yes     |                                                                    |
| Does not settle route; fetch-only stalls                        | no      |                                                                    |
| Does not recurse into page routes                               | yes     | implied                                                            |
| Explicit `headers: {}` discards inherited request headers       | no      | Source                                                             |
| maxRetries does **not** retry HTTP 500                          | no      | Docs                                                               |
| Only ECONNRESET retried (not EPIPE)                             | no      | Source                                                             |
| Redirect method rewrite 301/302/303 vs 307/308                  | no      | Source                                                             |
| deflate/brotli decode                                           | no      | gzip yes                                                           |
| APIResponse ok/json/dispose/statusText/headersArray/body        | partial | shallow on statusText/body equality; ok boundaries 199/300 missing |
| `failOnStatusCode`                                              | skip    | APIRequestContext option, not Route.fetch surface                  |

### `Route.fulfill`

| Behavior                                              | Status | Notes                |
| ----------------------------------------------------- | ------ | -------------------- |
| status/headers/contentType/body/json/path/response    | yes    | broad                |
| Derived `statusText` exact                            | no     |                      |
| True binary `0x00–0xff`                               | no     | Buffer test is ASCII |
| Auto Content-Length                                   | no     |                      |
| `contentType` vs `headers['content-type']` precedence | no     |                      |
| `json` + `body` conflict throws                       | no     | Source               |
| `json` + `path` allowed (file bytes, JSON CT)         | no     | Source               |
| `status: 0` → 200 truthiness                          | no     | Source quirk         |
| CORS auto headers                                     | skip   | Browser-only         |

### Request inspection

| Behavior                                             | Status  | Notes                      |
| ---------------------------------------------------- | ------- | -------------------------- |
| url/method/headers/postData/JSON/form/buffer         | yes     |                            |
| response after fulfill/continue; failure after abort | yes     |                            |
| `response()` null after failure                      | no      |                            |
| `existingResponse()`                                 | no      | Added 1.59                 |
| redirectedFrom/To on real Ajax redirect chain        | no      | null-without-redirect only |
| postData null when no body                           | no      |                            |
| headersArray casing/duplicates                       | partial |                            |

### Waiting

| Behavior                                                  | Status | Notes   |
| --------------------------------------------------------- | ------ | ------- |
| waitForRequest string/regex/predicate/timeout/0/signal    | yes    |         |
| waitForResponse string/regex/predicate/timeout/0/continue | yes    |         |
| **Future-only** (past request does not match)             | **no** | P0      |
| waitForResponse AbortSignal                               | no     | in 1.62 |
| Glob wait matcher; async predicate; multiple waiters      | no     |         |

### `routeFromHAR` (oracle for `routeFromJSON`)

| Behavior                                                             | Status | Notes                                          |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------- |
| Method/body/header score/multipart/redirect/update/full/abort marker | yes    | strong                                         |
| Default `notFound` omit = abort                                      | no     | test passes `"abort"` explicitly despite title |
| `notFound: fallback` → **next route handler**                        | no     | only network                                   |
| No url filter = all requests                                         | no     |                                                |
| POST body matching only for POST; missing body permissive            | no     | Source                                         |
| HAR entry reusable (not consumed)                                    | no     |                                                |
| Redirect cycle throws                                                | no     |                                                |
| Context.routeFromHAR                                                 | no     | page only                                      |
| Zip / attach / navigation HAR                                        | skip   | non-portable                                   |

### WebSocketRoute / `routeWebSocket` — oracle largely complete

Portable/oracle targets adapted from docs + `tests/library/route-web-socket.spec.ts` + source. See [`checklist.md`](./checklist.md) WebSocketRoute table for current status.

| Behavior                                                                        | Priority | Oracle                        |
| ------------------------------------------------------------------------------- | -------- | ----------------------------- |
| Full mock without `connectToServer` (auto-open)                                 | P0       | yes                           |
| Text + binary (`blob` / `arraybuffer`) page messages                            | P0       | yes                           |
| `connectToServer` + default bidirectional forwarding                            | P0       | yes                           |
| `onMessage` on page side disables page→server auto-forward                      | P0       | yes                           |
| `onMessage` on server side disables server→page auto-forward                    | P0       | yes                           |
| Manual block/modify both directions                                             | P0       | yes                           |
| `onMessage` replace (second call wins)                                          | P1       | yes                           |
| Default close forwarding both ways                                              | P0       | yes                           |
| `onClose` disables default close forwarding (+ manual re-forward)               | P0       | yes                           |
| `close()` / `close({ code, reason })` / close while connected                   | P0       | yes                           |
| `url()` / `protocols()` (empty + string/array + server-side mirror)             | P0       | yes                           |
| Negotiated subprotocol pass-through                                             | P0       | yes                           |
| Matcher: glob, regex, predicate, baseURL (+ scheme casing), no trailing slash   | P0       | yes                           |
| Passthrough when no WS route matches                                            | P0       | yes                           |
| Only sockets created **after** registration                                     | P0       | yes                           |
| Empty handler still opens mock                                                  | P1       | yes                           |
| `connectToServer` twice throws                                                  | P1       | yes                           |
| Concurrent routed sockets isolated                                              | P0       | yes                           |
| Context.routeWebSocket + page-over-context precedence                           | P1       | yes                           |
| `unrouteAll` does not remove WS routes                                          | P1       | yes                           |
| Upstream handshake failure with connectToServer                                 | P1       | yes                           |
| Pending handler CONNECTING; `send` forces open                                  | P1       | yes                           |
| Mock first-protocol / empty extensions; server `connectToServer` throws         | P1       | yes                           |
| Page send/close validation (CONNECTING/CLOSED/close codes)                      | P1       | yes                           |
| `binaryType=blob`; Blob async reorder; TypedArray byteOffset slicing            | P1       | yes                           |
| Relative URL + `http→ws` rewrite                                                | P1       | yes                           |
| Predicate catch-all + auto-passthrough; empty matcher; invalid glob; URLPattern | P1       | yes                           |
| Buffer `server.send` during upstream CONNECTING; `onMessage` not awaited        | P1       | yes                           |
| Frame navigation/detach close                                                   | skip     | skip (browser lifecycle only) |
| Page-closure send races                                                         | skip     | skip (browser lifecycle only) |

---

## Edge cases from Playwright source (must pin if in contract)

These are easy to miss from docs alone:

1. **`times` reserved at invocation start** — concurrent matches cannot both get `{times:1}`.
2. **Handlers are concurrent** — no mutex; overlapping awaits are normal.
3. **Settlement ≠ callback done** — `unrouteAll({wait})` waits for callback completion even after `continue`.
4. **Failed `continue` protocol check** — marks handled; fulfill/abort reject; request stalls.
5. **`fallback` protocol check weaker than `continue`** — no throw; stalls.
6. **Forbidden headers silently restored** — cannot add/delete forbidden names.
7. **Continue headers replace, then restore forbidden** — omitting an allowed header drops it.
8. **Fallback body truthiness** — `0`/`false`/`null` ignored; `""`/empty Buffer apply; no CT inference.
9. **Fetch `headers: {}`** replaces inherited headers entirely.
10. **maxRetries = ECONNRESET only**; retries include POST.
11. **HAR failed entries (`status: -1`)** matched but never fulfilled → stall (already partially covered).
12. **HAR POST body match only when method is POST**; multipart strips boundaries then compares text.
13. **WS: no handler chain** — first matching newest handler only; no `fallback`.
14. **WS: installing `onMessage` cuts that direction’s auto-forward permanently until replaced.**
15. **WS mock without connect**: handler return opens; pending handler can leave CONNECTING; `send` forces open.

---

## Ranked gap backlog (implement next)

### P0 — required for claimed completeness

1. **WebSocket oracle suite** + local WS fixture (echo/binary/close/protocols/upstream).
2. **Concurrent `times`** matrix (`1` and `2`, with fulfill and fallback).
3. **Never-settle stall**; **fetch-only stall**; **handler throw without settle**.
4. **Future-only** `waitForRequest` / `waitForResponse`; `waitForResponse` AbortSignal.
5. **`fulfill`**: exact statusText, true binary, auto Content-Length, contentType vs header conflict.
6. **Continue headers across redirects** (not fetch); method/postData not carried.
7. **Double-settle** abort-first and terminal→fallback permutations.

### P1

8. Handler snapshot / late-register-during-in-flight; fallback-then-throw.
9. Full forbidden-header sample; header replacement semantics; continue header coercion.
10. `times <= 0` / NaN observed behavior; consume-on-throw.
11. `maxRetries` ignores HTTP 500; empty/buffer fetch postData; `headers: {}`.
12. Request `existingResponse`, response-null-after-abort, redirect chain links, null postData.
13. HAR default notFound omit; fallback to next handler; entry reuse; POST-only body match.
14. Matcher: empty pattern, `*` baseURL skip, `/g` lastIndex, character-class literal.
15. WS: context routing, precedence, connect twice, empty handler, unrouteAll independence.

### P2

16. Sharpen APIResponse boundaries; deflate/brotli; redirect method rewrite; Blob WS races.
17. unroute wait-from-inside-handler deadlock; ignoreErrors error trap.

### Remain skips

Cookies / Set-Cookie redirect matrix, CORS auto-headers, SW, navigation/favicon/popup first request, HTTP cache disable, HAR zip/attach, resource timing/TLS, page-close lifecycle cleanup nuances.

---

## Suggested implementation order

1. HTTP P0 edge specs (`times` concurrency, settlement stalls, wait future-only, fulfill wire, continue redirects, double-settle remainder) — no new fixtures beyond small upstream tweaks.
2. Update rewrite-spec §4 to move WebSockets **in scope for the oracle** (library Step 2 decision can stay deferred, but oracle must exist).
3. Add `fixtures/ws-upstream` (or extend upstream) + `route-websocket.spec.ts` porting Playwright’s library WS tests that are transport-agnostic enough for our harness.
4. Refresh [`checklist.md`](./checklist.md) from this pass; keep skips explicit.

---

## Checklist honesty corrections

Current [`checklist.md`](./checklist.md) marks several rows “covered” that are only **partial** under this pass (`times`, fulfill MIME/binary, wait APIs, continue redirect headers, HAR default notFound). After the next implementation wave, re-mark rows using the definitions above (yes / partial / skip).
