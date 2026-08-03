# Playwright Network API Parity Research

Research into Microsoft Playwright’s network request management implementation, and how closely `@playwright-backend-mocks` can mirror it given our proxy + WebSocket architecture.

**Playwright revision surveyed:** `15b1aec` (microsoft/playwright)  
**Companion artifact:** [`playwright-network-tests.json`](./playwright-network-tests.json) — machine-readable catalog of ~636 Playwright network-related test titles across 29 files.

---

## Verdict

**Yes — we can follow Playwright’s implementation extremely closely for the parts that matter to near-full parity**, and the existing WebSocket/proxy boundary already sits at the same conceptual seam Playwright uses between “paused request” and “user route handler.”

The practical strategy:

1. **Mirror Playwright’s client-side handler orchestration almost line-for-line** (`Route`, `RouteHandler`, `_onRoute` chaining, settle semantics, `fallback`, `times`, override accumulation).
2. **Treat our WebSocket protocol as Playwright’s ChannelOwner ↔ Dispatcher layer** (`request:matched` ≈ `route` event; `handler:result` ≈ `Route.fulfill|continue|abort`).
3. **Diverge only where product requirements force it** — notably: JSON cassettes instead of HAR, and loud multi-match failures instead of LIFO handler chaining across concurrent tests.
4. **Do not try to reuse Playwright source.** Keep analogous Playwright paths documented next to our modules so developers can diff behavior deliberately.

Our current v1 already mirrors the public DX for `route` / `unroute` / `fulfill` / `continue` / `fetch` / `abort` / `waitForRequest` / `requests` / `routeFromJSON`. The remaining parity work is mostly **subtle handler semantics** (`fallback`, `times`, LIFO order, unroute lifecycle, richer Request/Response APIs, abort-code completeness, glob fidelity) plus **parity-oriented tests adapted from Playwright’s suite**.

---

## 1. How Playwright structures network routing

Playwright is already a two-process RPC system. Network interception has a clean split:

```text
Browser (CDP Fetch / FF / WK / BiDi)
        │  RouteDelegate.abort / fulfill / continue
        ▼
server/network.Route   ← frames.requestStarted() creates Route + interceptor chain
        │
        ▼
PageDispatcher / BrowserContextDispatcher   (_requestInterceptor)
        │  channel event: 'route' { route }
        ▼
client Page / BrowserContext (_onRoute)
        │  RouteHandler.matches + handle()   ← USER CALLBACKS RUN HERE
        ▼
channel methods: Route.abort | continue | fulfill | redirectNavigationRequest
        ▼
RouteDispatcher → server Route → browser RouteDelegate
```

### Key source files

| Layer               | Path                                                                               | Role                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Client Route API    | `packages/playwright-core/src/client/network.ts`                                   | `Request`, `Response`, `Route`, `RouteHandler`, WebSocket route types              |
| Client registration | `.../client/page.ts`, `.../client/browserContext.ts`                               | `route` / `unroute` / `unrouteAll` / `routeFromHAR` / `routeWebSocket`, `_onRoute` |
| HAR replay          | `.../client/harRouter.ts`                                                          | HAR as a normal `route` handler                                                    |
| API fetch           | `.../client/fetch.ts`                                                              | `APIRequestContext`; used by `route.fetch()`                                       |
| Protocol types      | `.../client/channels.d.ts`                                                         | `RouteChannel`, request/response channels                                          |
| Server Route        | `.../server/network.ts`                                                            | Server `Route` / `RouteDelegate`, header override rules                            |
| Dispatchers         | `.../server/dispatchers/{page,browserContext,network}Dispatchers.ts`               | Coarse URL match → emit `route`; settle methods                                    |
| HAR backend         | `.../server/harBackend.ts`, `.../server/har/*`                                     | HAR open/lookup/record                                                             |
| URL matching        | `@isomorphic/urlMatch` (`urlMatches`, `globToRegexPattern`, serialize/deserialize) | Shared glob/regex/predicate matching                                               |
| Browser adapters    | `chromium/crNetworkManager.ts`, etc.                                               | Chromium abort-code map, Fetch interception                                        |

### Matching is two-phase

1. **Server / dispatcher (serializable patterns only):** string globs, RegExp, `URLPattern`. Function predicates cannot cross the channel — if any handler uses a function matcher, patterns become `[{ glob: '**/*' }]`.
2. **Client (precise):** `RouteHandler.matches` via `urlMatches()`, including function predicates. **User handlers only ever run on the client.**

This is the same split we already use: proxy stores serializable matcher metadata for diagnostics; **authoritative matching (including predicates) runs in Playwright workers** via claim broadcast.

### Handler orchestration (client)

From `Page._onRoute` / `BrowserContext._onRoute` and `RouteHandler`:

- Handlers are registered with `unshift` → **LIFO** (last registered runs first).
- Each handler must settle: `fulfill` / `continue` / `abort` report `handled=true`; `fallback` reports `handled=false` so the next handler runs.
- Unsettled handlers **stall forever** (browser request stays paused). There is no route-handler timeout.
- Double-settle throws `"Route is already handled!"`.
- `times` removes a handler after N invocations.
- Page handlers run first; unmatched/fallback chains into context handlers; final fallback continues to the network.
- `fallback(overrides)` mutates local request overrides and does **not** call the channel.
- `continue(overrides)` applies overrides and goes to the network, **skipping** remaining handlers.

### `Route` method semantics

| Method              | Terminal?  | Effect                                                                |
| ------------------- | ---------- | --------------------------------------------------------------------- |
| `fulfill(options)`  | yes        | Mock response via channel                                             |
| `continue(options)` | yes        | Send to network with overrides; skips other handlers                  |
| `abort(errorCode?)` | yes        | Fail with Chromium-like net error code                                |
| `fallback(options)` | no (chain) | Apply overrides locally; next matching handler                        |
| `fetch(options)`    | no         | `APIRequestContext._innerFetch` — **Node HTTP, bypasses page routes** |

`fulfill` supports `status`, `headers`, `body`, `json`, `contentType`, `path`, and `response` (from `fetch` / `APIResponse`, with `fetchResponseUid` body elision when on the same connection).

---

## 2. Does Playwright’s organization make our network boundary make sense?

**Yes. Playwright’s ChannelOwner ↔ Dispatcher seam is the natural place to map our proxy WebSocket protocol.**

| Playwright seam                                            | Our analogue                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| Browser / interceptor pauses request                       | `@mswjs/interceptors` pauses outbound Node request          |
| Server emits `route` event with Request + Route handle     | Proxy emits `request:matched` (after claim broadcast)       |
| User handler runs in Playwright client process             | User handler runs in Playwright worker (`backend-mocks.ts`) |
| Client calls `Route.fulfill\|continue\|abort` over channel | Worker sends `handler:result` over WebSocket                |
| Server applies decision via `RouteDelegate`                | Node agent applies `decision:*` via interceptor controller  |
| `route.fetch` → server `APIRequestContext` (Node HTTP)     | `decision:fetch` → Node agent native `fetch` with bypass    |

### Recommended mirroring strategy

Keep three layers that map almost 1:1 to Playwright:

```text
┌─────────────────────────────────────────────────────────────┐
│  packages/playwright  ≈  Playwright client/network.ts       │
│  Route / RouteHandler / _onRoute / fulfill/continue/abort   │
│  fallback chaining, times, unroute lifecycle                │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket (≈ Playwright channel)
┌────────────────────────────▼────────────────────────────────┐
│  packages/proxy       ≈  Playwright dispatchers + ownership │
│  claim broadcast, zero/one/many, pending map, history       │
│  (ownership rules DIFFER: we fail on many)                  │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket
┌────────────────────────────▼────────────────────────────────┐
│  packages/node        ≈  Playwright RouteDelegate / browser │
│  pause, fulfill, continue, abort, fetch-upstream            │
└─────────────────────────────────────────────────────────────┘
```

**Mirror closely:** client handler API + orchestration, message shapes for settle actions, Request/Response inspection helpers, glob matching algorithm, HAR-router _shape_ (as JSON router).

**Diverge here (intentionally):**

1. **Multi-match ownership** — Playwright chains handlers LIFO inside one page/context; we fail loud when >1 registered route matches (including across concurrent tests). Document + link to a docs page from the error.
2. **Cassette format** — `routeFromJSON` instead of `routeFromHAR`.
3. **No browser-specific concerns** — CORS auto-headers on fulfill, favicon abort, service workers, navigation redirects, cookie jar from browser store, `networkidle`, resource timing, disk-cache disable. Those are browser-network concerns; our traffic is Node outbound HTTP.
4. **Extra matchers we have that Playwright doesn’t** — `method` / `clientId` filters on the matcher object (valuable for multi-process suites).

---

## 3. How closely can we follow Playwright?

### High fidelity (practical near-parity)

These can and should look almost like Playwright’s client code, with settle actions crossing our WS instead of Playwright’s channel:

| Capability                                              | Playwright reference            | Our status            | Notes                                                                           |
| ------------------------------------------------------- | ------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `route(url, handler)`                                   | `page.ts` / `browserContext.ts` | ✅ present            | Add `times` option                                                              |
| Matcher: string glob / RegExp / predicate               | `urlMatch` + `RouteHandler`     | ✅ present            | Align glob algorithm with Playwright’s (`?` not special, brace groups, baseURL) |
| `unroute(url?, handler?)`                               | client                          | ✅ present            | Align equality + lifecycle                                                      |
| `fulfill` options                                       | `Route._innerFulfill`           | ✅ mostly             | Parity gaps: content-length auto, mime-from-path, richer statusText             |
| `continue` overrides                                    | `Route.continue`                | ✅ present            | Header forbid-list differs (browser-specific)                                   |
| `fetch` then fulfill                                    | `Route.fetch` + fulfill         | ✅ present            | Already bypasses interceptor (correct analogue of bypassing page routes)        |
| `abort(errorCode)`                                      | Chromium map                    | ⚠️ partial            | We support a subset; expand codes if desired                                    |
| Stall until settle                                      | `_startHandling`                | ✅ present            | Same failure mode if handler forgets to settle                                  |
| Double-settle throws                                    | `_checkNotHandled`              | ✅ present            | Message differs slightly                                                        |
| `waitForRequest`                                        | `page.waitForRequest`           | ✅ present            | Predicate/timeout/logging parity polish                                         |
| Request inspection (`url/method/headers/postData/json`) | `Request`                       | ✅ basic              | Missing: `headersArray`, `allHeaders`, `postDataJSON` form-urlencoded, etc.     |
| `routeFromHAR` DX                                       | `HarRouter`                     | ✅ as `routeFromJSON` | Intentional format divergence                                                   |
| Predicate evaluated on handler side                     | function → `**/*` server-side   | ✅ claim broadcast    | Already the right design                                                        |

### Medium fidelity (mirror semantics, different transport)

| Capability                                                           | Should we mirror?                                                | Divergence reason                                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `fallback()` + LIFO chaining                                         | **Yes, within a single test**                                    | Across tests we still must fail on multi-match; within one test, Playwright-style fallback chaining is desirable for parity |
| `times`                                                              | Yes                                                              | Pure client-side bookkeeping                                                                                                |
| `unrouteAll({ behavior })`                                           | Yes                                                              | Lifecycle parity with pending handlers                                                                                      |
| Handler exception → fall through                                     | Yes (Playwright falls through on exception during fallback path) | Confirm exact semantics when implementing                                                                                   |
| Override accumulation across `fallback`                              | Yes                                                              | Local mutation of request view before next handler                                                                          |
| APIRequestContext-level fetch options (`maxRedirects`, `maxRetries`) | Partial                                                          | Useful on `route.fetch`; not full `page.request` API                                                                        |

### Low fidelity / out of scope for this library

These are Playwright browser-network features. Near-full parity of _AJAX request management_ does **not** require them:

- `page.route` / `context.route` browser interception itself (we complement it)
- CORS auto-injection on fulfill
- Cookie / Set-Cookie / browser cookie jar on continue+redirect
- Service worker / shared worker / blob / data: URL quirks
- `networkidle`, resource timing, transfer sizes from browser
- Favicon auto-abort
- ~~`routeWebSocket` (app WebSockets are out of v1 scope; our WS is control-plane only)~~ **Now in scope** for `globalThis.WebSocket` (see rewrite-specification §4). Control-plane WS remains separate from application sockets. **Partial client coverage:** unlike HTTP (virtually all common clients), WS mocks only the WHATWG global — npm `ws` / direct Undici imports bypass. Product docs must call this out loudly on every WS page; we are not waiting on MSW custom-client support.
- HAR recording format, HAR zip attach mode, tracing HAR
- Global / context `APIRequestContext` as a general HTTP client (only needed as the engine behind `route.fetch`)

### Intentional product divergences (do not “fix” toward Playwright)

#### 1. `routeFromJSON` instead of `routeFromHAR`

Playwright’s `HarRouter` is a thin adapter: open HAR → on each route lookup → fulfill / abort / fallback / redirect navigation.

Our `routeFromJSON` should keep that **control-flow shape** (options: `url`, `update`, `notFound: 'abort'|'fallback'`) but persist JSON cassettes because they are a more natural representation of server-side request/response pairs.

Developer instruction: when changing `route-from-json.ts`, open Playwright’s `harRouter.ts` + `browsercontext-har.spec.ts` and match behavior except file format / entry schema.

#### 2. Fail loudly on multiple matching handlers

Playwright assumes one browser + one test’s handler list; LIFO + `fallback` resolves overlap.

We run a **shared server with concurrent tests**. Overlapping matchers across tests are a coordination hazard, not a chaining feature.

Rule to preserve:

- **Across tests / registrations that both claim the same request:** `ambiguous_route` → fail Node request + fail every affected Playwright test, with diagnostics and a docs link.
- **Within a single test:** we _can_ still offer Playwright-compatible LIFO + `fallback` among that test’s own handlers, as long as the proxy still sees a single owning test. Today the claim protocol returns all matching `routeId`s from a test; multi-match within one test currently also trips `ambiguous_route`. Parity work should decide:
  - **Option A (recommended):** within one `testId`, allow multiple matching routes and chain via `fallback` like Playwright; only fail when **more than one testId** claims the request.
  - **Option B:** keep failing on any >1 route match (stricter than Playwright even inside one test).

Option A gets closer to Playwright while preserving the concurrency safety property that actually matters.

Error messages should link to a documentation page explaining: serialize those tests, or make matchers mutually exclusive (URL / method / `clientId`).

---

## 4. Natural organizational system for developers

Proposed module alignment (not requiring Playwright code reuse — just side-by-side reference):

| Our module                                               | Playwright analogue                            | Mirror guidance                                                     |
| -------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `packages/playwright/src/types.ts`                       | `client/network.ts` public types + `api.Route` | Keep method names/options aligned                                   |
| `packages/playwright/src/backend-mocks.ts`               | `Route` + `RouteHandler` + `_onRoute`          | Extract a `RouteHandler` class; implement `fallback`, `times`, LIFO |
| `packages/playwright/src/match.ts` + `protocol/match.ts` | `@isomorphic/urlMatch`                         | Port Playwright glob algorithm; keep predicate-on-worker            |
| `packages/playwright/src/route-from-json.ts`             | `client/harRouter.ts`                          | Same options/control flow; JSON I/O instead of HAR                  |
| `packages/protocol/src/schemas.ts`                       | `channels.d.ts` Route settle messages          | Keep `fulfill/continue/abort/fetch` action shapes stable            |
| `packages/proxy/src/server.ts`                           | `*Dispatcher` + ownership                      | Our extra: claim broadcast + multi-test ambiguity                   |
| `packages/node/src/agent.ts`                             | `RouteDelegate` + server `fetch.ts`            | Apply decisions; upstream fetch with bypass                         |

Suggested developer checklist for every parity change:

1. Find the Playwright file/function in the table above.
2. Port behavior and subtle edge cases; name symbols similarly where practical (`_checkNotHandled`, `willExpire`, `_applyFallbackOverrides`).
3. Note divergences in a short comment block (`// PARITY: ...` / `// DIVERGE: ambiguous multi-test`).
4. Add or adapt a test from the Playwright catalog (below), rewritten against `backendMocks`.
5. Do **not** copy Playwright source files or license-entangled chunks; reimplement.

---

## 5. Public API surface to target for near-full parity

### Core (should match Playwright closely)

```ts
backendMocks.route(url, handler, options?: { times?: number })
backendMocks.unroute(url?, handler?)
backendMocks.unrouteAll(options?: { behavior?: 'wait' | 'ignoreErrors' | 'default' })

route.fulfill({ status, headers, body, json, contentType, path, response })
route.continue({ url, method, headers, postData })
route.fallback({ url, method, headers, postData })  // missing today
route.fetch({ ...continueOverrides, timeout, maxRedirects?, maxRetries? })
route.abort(errorCode?)
route.request()

backendMocks.waitForRequest(urlOrPredicate, options?)
backendMocks.requests(url?)   // library-specific spy helper (good)
backendMocks.routeFromJSON(path, { url?, update?, notFound? })
```

### Matcher forms

| Form                        | Playwright            | Us                                |
| --------------------------- | --------------------- | --------------------------------- |
| Glob string                 | ✅                    | ✅ (algorithm should be aligned)  |
| RegExp                      | ✅                    | ✅                                |
| `(url: URL) => boolean`     | ✅                    | ✅                                |
| `URLPattern`                | ✅                    | ❌ (optional later)               |
| `{ url, method, clientId }` | ❌ (PW uses URL only) | ✅ keep — multi-process necessity |

### Abort codes

Playwright documents: `aborted`, `accessdenied`, `addressunreachable`, `blockedbyclient`, `blockedbyresponse`, `connectionaborted`, `connectionclosed`, `connectionfailed`, `connectionrefused`, `connectionreset`, `internetdisconnected`, `namenotresolved`, `timedout`, `failed`.

We currently expose a smaller set (`failed`, `aborted`, `timedout`, `connectionrefused`, `connectionreset`, `namenotresolved`). Expanding the accepted codes (even if several map to the same Node error shape) improves API parity; perfect OS fidelity is already documented as out of scope.

---

## 6. Playwright test catalog (network request management)

Full machine-readable dump: [`research/playwright-network-tests.json`](./playwright-network-tests.json).

**Totals:** **29 files**, **~636** `test`/`it` titles (plus parameterized expansions for methods/status codes/algorithms).

### Files and counts

| File                                                        | ~Tests | Focus                                                            |
| ----------------------------------------------------------- | -----: | ---------------------------------------------------------------- |
| `tests/page/page-route.spec.ts`                             |     52 | Intercept, abort, CORS, redirects, times, chaining               |
| `tests/page/page-request-fulfill.spec.ts`                   |     24 | `route.fulfill`                                                  |
| `tests/page/page-request-continue.spec.ts`                  |     39 | `route.continue` (+ postData)                                    |
| `tests/page/page-request-fallback.spec.ts`                  |     14 | `route.fallback` chaining                                        |
| `tests/page/page-request-intercept.spec.ts`                 |     15 | `route.fetch` + fulfill                                          |
| `tests/page/interception.spec.ts`                           |     14 | Glob/regex, workers, cache                                       |
| `tests/page/page-wait-for-request.spec.ts`                  |      8 | `waitForRequest`                                                 |
| `tests/page/page-wait-for-response.spec.ts`                 |      8 | `waitForResponse` (browser; lower priority for us)               |
| `tests/page/page-event-request.spec.ts`                     |     16 | Request events                                                   |
| `tests/page/page-event-network.spec.ts`                     |      7 | Event ordering                                                   |
| `tests/page/page-network-request.spec.ts`                   |     29 | Request object API                                               |
| `tests/page/page-network-response.spec.ts`                  |     26 | Response object API                                              |
| `tests/page/page-network-idle.spec.ts`                      |     14 | `networkidle` (N/A for us)                                       |
| `tests/page/page-network-sizes.spec.ts`                     |     12 | Sizes (mostly N/A)                                               |
| `tests/page/network-post-data.spec.ts`                      |      6 | postData edge cases                                              |
| `tests/library/browsercontext-route.spec.ts`                |     20 | context.route + precedence                                       |
| `tests/library/unroute-behavior.spec.ts`                    |     16 | unroute / unrouteAll lifecycle                                   |
| `tests/library/route-web-socket.spec.ts`                    |     25 | `routeWebSocket` — **now in oracle** (`route-websocket.spec.ts`) |
| `tests/library/har.spec.ts`                                 |     63 | HAR recording                                                    |
| `tests/library/har-websocket.spec.ts`                       |     12 | HAR + WS                                                         |
| `tests/library/browsercontext-har.spec.ts`                  |     33 | `routeFromHAR` replay/update                                     |
| `tests/library/browsercontext-network-event.spec.ts`        |      7 | Context events                                                   |
| `tests/library/browsercontext-fetch.spec.ts`                |     87 | APIRequestContext                                                |
| `tests/library/browsercontext-fetch-algorithms.spec.ts`     |     15 | gzip/deflate/br                                                  |
| `tests/library/browsercontext-fetch-happy-eyeballs.spec.ts` |      4 | IPv6                                                             |
| `tests/library/global-fetch.spec.ts`                        |     49 | Global request                                                   |
| `tests/library/global-fetch-cookie.spec.ts`                 |     20 | Cookie jar                                                       |
| `tests/library/fetch-proxy.spec.ts`                         |      6 | Fetch via proxy                                                  |
| `tests/library/resource-timing.spec.ts`                     |      5 | Resource timing (N/A)                                            |

### Priority subsets for _our_ parity suite

Port/adapt these first (behavior that applies to Node outbound HTTP mocking):

**P0 — handler core**

- From `page-route.spec.ts`: intercept, unroute, abort (+ custom codes), pause until continue, equal requests, times, async times, double-settle throws, large postData.
- From `page-request-fulfill.spec.ts`: status/body/json/path/buffer, fulfill from fetch + overrides, multiple set-cookie-equivalent headers, gzip readback if relevant.
- From `page-request-continue.spec.ts`: amend headers/method/url/postData, binary/utf8/longer postData, empty body override. Skip browser cookie/CORS/Host-redirect cases.
- From `page-request-fallback.spec.ts`: entire file (once `fallback` exists) — chaining, amend overrides, fulfill/abort do not chain.
- From `page-request-intercept.spec.ts`: fetch + fulfill, timeout, url/postData override, empty body.
- From `interception.spec.ts`: glob, unbalanced braces throw, regex, invalid glob throw.
- From `unroute-behavior.spec.ts`: unrouteAll wait/ignoreErrors; no auto-continue of in-flight on teardown where applicable.
- From `browsercontext-har.spec.ts` → rewrite against `routeFromJSON`: method match, default abort, `notFound: fallback`, url/regex filter, update mode, postData match, unroute stops cassette route.

**P1 — inspection / waiting**

- `page-wait-for-request.spec.ts` (all)
- Request/postData tests from `page-network-request.spec.ts` / `network-post-data.spec.ts` that are transport-agnostic

**P2 — nice-to-have APIRequestContext behaviors used only by `route.fetch`**

- timeout, maxRedirects, compression handling from fetch specs

**Skip (browser-only)**

- CORS, service workers, favicon, networkidle, resource timing, HAR zip/websocket HAR, browser cookie jar redirect matrix, context vs page route precedence (we have a single `backendMocks` scope per test), npm `ws` / non-global WebSocket constructors

### Complete title listing

Every extracted title is in `playwright-network-tests.json`. Highlights of the densest “must-mirror” files:

<details>
<summary><code>page-route.spec.ts</code> (52)</summary>

- should intercept @smoke
- should unroute
- should not support ? in glob pattern
- should work when POST is redirected with 302
- should work when header manipulation headers with redirect
- should be able to remove headers
- should contain referer header
- should properly return navigation response when URL has cookies
- should not override cookie header
- should show custom HTTP headers
- should work with redirect inside sync XHR
- should pause intercepted XHR until continue
- should pause intercepted fetch request until continue
- should work with custom referer headers
- should be abortable
- should be abortable with custom error codes
- should not throw if request was cancelled by the page
- should send referer
- should fail navigation when aborting main resource
- should not work with redirects
- should chain fallback w/ dynamic URL
- should work with redirects for subresources
- should work with equal requests
- should navigate to dataURL and not fire dataURL requests
- should be able to fetch dataURL and not fire dataURL requests
- should navigate to URL with hash and and fire requests without hash
- should work with encoded server
- should work with badly encoded server
- should work with encoded server - 2
- should not throw "Invalid Interception Id" if the request was cancelled
- should intercept main resource during cross-process navigation
- should fulfill with redirect status
- should not fulfill with redirect status
- should support cors with GET
- should add Access-Control-Allow-Origin by default when fulfill
- should allow null origin for about:blank
- should respect cors overrides
- should not auto-intercept non-preflight OPTIONS without network interception
- should not auto-intercept non-preflight OPTIONS with network interception
- should support cors with POST
- should support cors with credentials
- should reject cors with disallowed credentials
- should support cors for different methods
- should support the times parameter with route matching
- should work if handler with times parameter was removed from another handler
- should support async handler w/ times
- should contain raw request header
- should contain raw response header
- should contain raw response header after fulfill
- route.${method} should throw if called twice
- should intercept when postData is more than 1MB
- should be able to intercept every navigation to a page controlled by service worker

</details>

<details>
<summary><code>page-request-fallback.spec.ts</code> (14) — critical once fallback lands</summary>

- should work
- should fall back
- should fall back async
- should not chain fulfill
- should not chain abort
- should fall back after exception
- should chain once
- should amend HTTP headers
- should delete header with undefined value
- should amend method
- should override request url
- should amend post data / binary post data / json post data

</details>

<details>
<summary><code>browsercontext-har.spec.ts</code> (33) — adapt to routeFromJSON</summary>

- should context.routeFromHAR, matching the method and following redirects
- should page.routeFromHAR, matching the method and following redirects
- fallback:continue should continue when not found in har
- by default should abort requests not found in har
- fallback:continue should continue requests on bad har
- should only handle requests matching url filter
- should only context.routeFromHAR requests matching url filter
- should only page.routeFromHAR requests matching url filter
- should apply overrides before routing from har
- should support regex filter
- newPage should fulfill from har, matching the method and following redirects
- should change document URL after redirected navigation (+ click/back/forward/reload variants)
- should fulfill from har with content in a file
- should round-trip har.zip / extracted zip / postData
- should record overridden requests to har
- should disambiguate by header
- should update har.zip for context / page / options / extracted
- should ignore boundary when matching multipart/form-data body
- should record single/multiple set-cookie headers
- page.unrouteAll / context.unrouteAll should stop routeFromHAR
- should ignore aborted requests

</details>

(Remaining files’ full titles are in the JSON catalog.)

---

## 7. Subtle Playwright semantics a parity implementation must get right

1. **LIFO registration + fallback chaining** (within one owner).
2. **`fulfill` / `continue` / `abort` terminate; `fallback` does not.**
3. **`times` expiration** removes handler before/around last invocation; patterns/registrations update.
4. **Double settlement throws.**
5. **Overrides from `fallback`/`continue`** change what subsequent handlers / the network see for url/method/headers/postData.
6. **Glob rules:** `*` segment-local, `**` cross-segment; `?` is literal (not a wildcard); unbalanced `{a,b}` braces throw at `route()` time.
7. **Function predicates** force broad interception server-side; precise match client-side — we already do the distributed equivalent via claims.
8. **`route.fetch` bypasses other route handlers** — our interceptor bypass / direct `fetch` is correct.
9. **Unroute lifecycle:** optional wait for in-flight handlers; `ignoreErrors` swallows late exceptions; closing should not hang forever on pending handlers.
10. **HAR/JSON notFound:** default abort; `fallback` continues; `update: true` records instead of replaying.
11. **Cancelled/disconnected requests** must not throw confusingly in handlers after teardown.

---

## 8. Mapping our current architecture onto this plan

What we already got right:

- Thin Node agent, thin Playwright fixture, fat proxy coordinator.
- Claim broadcast so predicates stay in workers (same constraint as Playwright’s non-serializable matchers).
- Settle actions as protocol messages.
- `fetch` as non-terminal with upstream performed in the Node process.
- Ambiguous multi-owner failure with diagnostics.
- `routeFromJSON` as HAR-shaped DX.

What to change for near-full parity (implementation follow-ups, not done in this research):

1. Extract Playwright-like `Route` / `RouteHandler` in `packages/playwright` (fallback, times, LIFO, override accumulation).
2. Decide Option A vs B for multi-match **within one test**; recommend Option A.
3. Port Playwright glob matching more faithfully into `protocol/match.ts`.
4. Add `unrouteAll({ behavior })`.
5. Expand abort codes and Request/Response helpers.
6. Build a `tests/parity/` (or expand e2e) suite adapted from the P0 Playwright titles above.
7. Document the “mirror Playwright; diverge here” rules for contributors (this file + short pointers in module headers).
8. Ensure ambiguous-route errors include a stable docs URL (matching-requests / concurrent-tests page).

---

## 9. Direct answers to the research questions

**How does Playwright handle this?**  
Client registers handlers; server enables interception with coarse patterns; each paused request becomes a channel `route` event; client runs handlers LIFO with fulfill/continue/abort/fallback/fetch; settle calls return over the channel to a browser `RouteDelegate`.

**Is there a natural organizational system for our network boundary?**  
Yes — Playwright’s existing client/server channel boundary. Our proxy WebSocket is that boundary, with Node agents playing the role of the browser/RouteDelegate.

**Could we closely match Playwright and diverge in special places?**  
Yes. Mirror client handler orchestration and settle APIs almost exactly; diverge on (1) JSON vs HAR, (2) multi-test ambiguous match failures, (3) browser-only concerns we should not pretend to implement.

**Should developers keep Playwright code alongside as a reference?**  
Yes — as an external reference (pinned commit), with module-mapping instructions in this doc. Do not vendor Playwright source into the repo; reimplement with deliberate naming/structure alignment.

---

## Appendix A — Playwright abort error codes (for API parity)

From `docs/src/api/class-route.md`:

`aborted`, `accessdenied`, `addressunreachable`, `blockedbyclient`, `blockedbyresponse`, `connectionaborted`, `connectionclosed`, `connectionfailed`, `connectionrefused`, `connectionreset`, `internetdisconnected`, `namenotresolved`, `timedout`, `failed` (default).

## Appendix B — Related docs in Playwright

- `docs/src/network.md` — mocking, modify/abort, glob patterns, WebSockets
- `docs/src/mock.md` — mock APIs, HAR mocking
- `docs/src/api/class-route.md` — Route methods
- `docs/src/api/class-websocketroute.md` — out of scope for v1 app traffic

## Appendix C — Our existing e2e coverage (baseline)

Already covered in this repo (not Playwright’s suite): glob/RegExp/predicate/method/clientId matching, unroute, ambiguous failure, fulfill/continue/fetch/abort matrix across transports, waitForRequest/requests, routeFromJSON record/replay, disconnect/auth, observability. These are the right foundation; parity work extends them with Playwright’s subtler handler-chain and matching tests.
