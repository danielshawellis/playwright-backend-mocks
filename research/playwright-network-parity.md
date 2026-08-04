# Playwright Network API Parity Research

Research into Microsoft Playwright’s network request **and WebSocket** management implementation, and how closely `@playwright-backend-mocks` can mirror it given our proxy + control-plane WebSocket architecture.

**High-level source of truth:** [`../PHILOSOPHY.md`](../PHILOSOPHY.md). This file is the deep dive / module map under that philosophy.

**Playwright pins:**

| Role                                                   | Value                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Oracle / implementation reference (`@playwright/test`) | **`1.62.1`** (`26a9e47` on `microsoft/playwright`)                                                      |
| Historical network-test inventory                      | `15b1aec` — [`playwright-network-tests.json`](./playwright-network-tests.json) (~636 titles / 29 files) |

Bump the oracle pin and this document together when refreshing against a newer Playwright. The inventory JSON may lag until regenerated.

**Companion oracle suite:** [`tests/parity/`](../tests/parity/) (Step 1 — green against stock Playwright; includes `route-websocket.spec.ts`).

**Prototype status:** living packages were archived to `historical/` after Step 1. Status notes below describe the **rewrite target** and what the prototype already proved, not a currently built tree.

---

## Verdict

**Yes — we can follow Playwright’s implementation extremely closely for HTTP routing and for `routeWebSocket` / `WebSocketRoute`**, and the control-plane WebSocket/proxy boundary already sits at the same conceptual seam Playwright uses between “paused traffic” and “user route handler.”

The practical strategy:

1. **Mirror Playwright’s client-side handler orchestration almost line-for-line** — HTTP: `Route` / `RouteHandler` / `_onRoute` (LIFO, `fallback`, `times`, settle). WebSocket: `WebSocketRoute` / `WebSocketRouteHandler` / `_onWebSocketRoute` (newest-match only, no fallback chain).
2. **Treat our control-plane WebSocket protocol as Playwright’s ChannelOwner ↔ Dispatcher layer** — HTTP: `request:matched` ≈ `route`; `handler:result` ≈ `fulfill|continue|abort`. WebSocket: socket lifecycle messages ≈ `webSocketRoute` channel events + `connect` / `ensureOpened` / `sendToPage|Server` / `closePage|Server`.
3. **Diverge only where product requirements force it** — loud multi-match failures across concurrent tests; within one test mirror Playwright (HTTP LIFO + `fallback`; WS newest-match). Record/replay uses **`routeFromHAR`**. App WS only via **`globalThis.WebSocket`** (loud docs).
4. **Do not try to reuse Playwright source.** Keep analogous Playwright paths documented next to our modules so developers can diff behavior deliberately.

The rewrite targets the public DX for `route` / `unroute` / `fulfill` / `continue` / `fetch` / `abort` / `waitForRequest` / `waitForResponse` / `requests` / `routeFromHAR` / **`routeWebSocket`**. Parity work is subtle handler semantics plus the oracle suite already adapted from Playwright’s tests (see rewrite-specification §4–5).

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

| Layer               | Path                                                                               | Role                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Client Route API    | `packages/playwright-core/src/client/network.ts`                                   | `Request`, `Response`, `Route`, `RouteHandler`, **`WebSocketRoute`**, **`WebSocketRouteHandler`**            |
| Client registration | `.../client/page.ts`, `.../client/browserContext.ts`                               | `route` / `unroute` / `unrouteAll` / `routeFromHAR` / **`routeWebSocket`**, `_onRoute` / `_onWebSocketRoute` |
| Injected WS mock    | `packages/injected/src/webSocketMock.ts`                                           | Replaces page `globalThis.WebSocket`; mock open / passthrough / connect / binary codec                       |
| WS route dispatcher | `.../server/dispatchers/webSocketRouteDispatcher.ts`                               | Binding bridge, pattern match, channel methods (`connect`, `ensureOpened`, send/close)                       |
| HAR replay          | `.../client/harRouter.ts`                                                          | HAR as a normal `route` handler                                                                              |
| API fetch           | `.../client/fetch.ts`                                                              | `APIRequestContext`; used by `route.fetch()`                                                                 |
| Protocol types      | `.../client/channels.d.ts`                                                         | `RouteChannel`, `WebSocketRouteChannel`, request/response channels                                           |
| Server Route        | `.../server/network.ts`                                                            | Server `Route` / `RouteDelegate`, header override rules                                                      |
| Dispatchers         | `.../server/dispatchers/{page,browserContext,network}Dispatchers.ts`               | Coarse URL match → emit `route`; settle methods                                                              |
| HAR backend         | `.../server/harBackend.ts`, `.../server/har/*`                                     | HAR open/lookup/record                                                                                       |
| URL matching        | `@isomorphic/urlMatch` (`urlMatches`, `globToRegexPattern`, serialize/deserialize) | Shared glob/regex/predicate matching; WS uses `urlMatches(..., webSocket=true)`                              |
| Browser adapters    | `chromium/crNetworkManager.ts`, etc.                                               | Chromium abort-code map, Fetch interception                                                                  |

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

## 1b. How Playwright structures WebSocket routing

Application WebSockets are a **separate stack** from HTTP `Route`. Playwright does not use CDP Fetch for them. Instead it patches the page’s `WebSocket` constructor and bridges events over an exposed binding into a `WebSocketRoute` channel object.

```text
Page: new WebSocket(url, protocols?)
        │
        ▼
injected webSocketMock.ts   ← replaces globalThis.WebSocket
        │  binding onCreate { id, url, protocols }
        ▼
WebSocketRouteDispatcher
        │  coarse pattern match (glob/regex) OR passthrough
        │  channel event: 'webSocketRoute' { webSocketRoute }
        ▼
client Page / BrowserContext (_onWebSocketRoute)
        │  WebSocketRouteHandler.matches  ← newest match only (unshift + find)
        │  handler(ws) then ws._afterHandle()
        ▼
channel: connect | ensureOpened | sendToPage | sendToServer | closePage | closeServer
        ▼
injected mock: _apiConnect / _apiEnsureOpened / _apiSend* / _apiClose*
```

### Why this matters for us

Playwright’s WS path is already “mock the WHATWG constructor, run handlers in the client, apply decisions on the socket side.” That is exactly the shape Node can take with `@mswjs/interceptors` `WebSocketInterceptor` (global patch) + our proxy claim broadcast + a Playwright-shaped `WebSocketRoute` in the worker.

Control-plane sockets (proxy ↔ node ↔ playwright fixture) stay on the `ws` npm package and must **not** enter the app-WS mock pipeline. That is naturally satisfied today: agents import `WebSocket` from `ws`, not `globalThis.WebSocket`.

### Handler selection (different from HTTP)

From `Page._onWebSocketRoute` / `BrowserContext._onWebSocketRoute` and `WebSocketRouteHandler`:

- Handlers registered with `unshift` → list is LIFO-ordered.
- Selection is **`handlers.find(matches)`** — **newest matching handler wins**. There is **no** WS `fallback` chain.
- If no page handler matches, the event falls through to context handlers; if still none, Playwright calls `connectToServer()` (real upstream).
- `page.unrouteAll()` / `context.unrouteAll()` clear **HTTP** routes (and HAR routers) only — **they do not remove WebSocket routes**. Oracle pins this.
- Only sockets constructed **after** `routeWebSocket` registration are intercepted (init script / interceptor already installed; unmatched → passthrough).
- String globs are validated eagerly at registration in 1.62.x (`resolveGlobToRegexPattern`); invalid patterns throw at `routeWebSocket()` time.
- Function / non-serializable matchers expand server patterns to `[{ glob: '**/*' }]` (same two-phase idea as HTTP).

### `WebSocketRoute` method semantics (Playwright 1.62.1)

The page-side route is what the user handler receives. `connectToServer()` returns a **server-side** route object with the same surface except `connectToServer` throws.

| Method / behavior                 | Side        | Effect                                                                                     |
| --------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `url()`                           | both        | Absolute `ws:` / `wss:` URL (http(s) constructor inputs rewritten)                         |
| `protocols()`                     | both        | Requested subprotocols as `string[]` (empty if none)                                       |
| `onMessage(cb)`                   | page        | Handles page→… frames; **disables** auto-forward page→server                               |
| `onMessage(cb)`                   | server      | Handles server→… frames; **disables** auto-forward server→page                             |
| `onClose(cb)`                     | page/server | Handles that side’s close; **disables** default close forwarding that direction            |
| `send(data)`                      | page        | Deliver to page socket; **forces mock open** if still `CONNECTING`                         |
| `send(data)`                      | server      | Deliver to upstream; buffers while upstream still `CONNECTING`                             |
| `close({ code?, reason? })`       | page        | Close page socket (`wasClean: true` from API); may forward unless `onClose` installed      |
| `close(...)`                      | server      | Close upstream (or short-circuit mock close if never connected)                            |
| `connectToServer()`               | page only   | Once; marks connected; asks mock to open real `NativeWebSocket`; returns server-side route |
| `_afterHandle()` / `ensureOpened` | internal    | After handler resolves: if never connected, pretend open (mock path)                       |

Defaults that surprise people:

1. **No upstream until `connectToServer()`** — empty handler still opens a mocked socket.
2. **Installing `onMessage` / `onClose` takes over that direction** — you must forward manually if you still want the other peer to see traffic.
3. **Second `onMessage` replaces the first** (does not stack).
4. **`onMessage` callbacks are not awaited** — async handlers do not block the next frame.
5. **Mock protocol negotiation:** first requested protocol; `extensions` left empty.
6. **Binary:** channel carries `{ message, isBase64 }`; TypedArray encoding must honor `byteOffset` / `byteLength`; Blob → `arrayBuffer` then base64.
7. **Page `send` while `CONNECTING` throws**; API `route.send` during a pending async handler forces open first.
8. **Close codes:** page `close` accepts `1000` or `3000–4999` only (DOMException otherwise).

### Injected mock ↔ dispatcher payload types

From `webSocketMock.ts` / `WebSocketRouteDispatcher` (names to mirror in our protocol):

| Direction | Payload                                    | Meaning                                       |
| --------- | ------------------------------------------ | --------------------------------------------- |
| page → PW | `onCreate`                                 | Socket constructed (`id`, `url`, `protocols`) |
| page → PW | `onMessageFromPage` / `onClosePage`        | Page peer traffic                             |
| page → PW | `onMessageFromServer` / `onCloseServer`    | Upstream peer traffic (after connect)         |
| PW → page | `connect` / `passthrough` / `ensureOpened` | Open real socket, bypass mock, or mock-open   |
| PW → page | `sendToPage` / `sendToServer`              | Inject frames                                 |
| PW → page | `closePage` / `closeServer`                | Close either peer                             |

Pattern mismatch at dispatcher → immediate `passthrough` (real socket, no user handler).

### Playwright’s own WS tests vs our oracle

| Source                                       | Count | Notes                                              |
| -------------------------------------------- | ----: | -------------------------------------------------- |
| `tests/library/route-web-socket.spec.ts`     |   ~25 | Playwright’s library suite                         |
| `tests/parity/specs/route-websocket.spec.ts` |   ~67 | Our portable oracle (source-driven edges included) |
| `tests/library/har-websocket.spec.ts`        |   ~12 | **Out of scope** (HAR + WS frames)                 |

Oracle skips browser document-lifecycle cases (`_executionContextGone` / navigation / `page.close` races) and page-vs-context dual-scope precedence (product is single `backendMocks` scope). See [`tests/parity/checklist.md`](../tests/parity/checklist.md).

---

## 2. Does Playwright’s organization make our network boundary make sense?

**Yes. Playwright’s ChannelOwner ↔ Dispatcher seam is the natural place to map our control-plane WebSocket protocol — for HTTP routes and for application WebSockets.**

| Playwright seam                                                 | Our analogue                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Browser / interceptor pauses request                            | `@mswjs/interceptors` pauses outbound Node HTTP request                      |
| Injected `WebSocket` mock owns the page socket                  | `WebSocketInterceptor` + product open/close bridge on `globalThis.WebSocket` |
| Server emits `route` with Request + Route handle                | Proxy emits `request:matched` (after claim broadcast)                        |
| Server emits `webSocketRoute` with WebSocketRoute handle        | Proxy emits socket claim / `ws:matched` (after claim broadcast)              |
| User handler runs in Playwright client process                  | User handler runs in Playwright worker                                       |
| Client calls `Route.fulfill\|continue\|abort` over channel      | Worker sends `handler:result` over control-plane WebSocket                   |
| Client calls WS `connect` / `send*` / `close*` / `ensureOpened` | Worker sends matching `ws:*` control messages                                |
| Server applies decision via `RouteDelegate`                     | Node agent applies `decision:*` via HTTP interceptor controller              |
| Injected mock applies WS API requests                           | Node agent applies `ws:*` via interceptor client/server connections          |
| `route.fetch` → server `APIRequestContext` (Node HTTP)          | `decision:fetch` → Node agent native `fetch` with bypass                     |

### Recommended mirroring strategy

Keep three layers that map almost 1:1 to Playwright for **both** HTTP and app WebSockets:

```text
┌──────────────────────────────────────────────────────────────┐
│  packages/playwright  ≈  client/network.ts                   │
│  HTTP: Route / RouteHandler / _onRoute / fallback / times    │
│  WS:   WebSocketRoute / WebSocketRouteHandler / newest-match │
└────────────────────────────┬─────────────────────────────────┘
                             │ control-plane WebSocket (≈ PW channel)
┌────────────────────────────▼─────────────────────────────────┐
│  packages/proxy       ≈  *Dispatcher + ownership             │
│  claim broadcast for requests AND sockets; history           │
│  (ownership DIFFER: fail when >1 testId claims)              │
└────────────────────────────┬─────────────────────────────────┘
                             │ control-plane WebSocket
┌────────────────────────────▼─────────────────────────────────┐
│  packages/node        ≈  RouteDelegate + webSocketMock       │
│  HTTP: pause / fulfill / continue / abort / fetch-upstream   │
│  WS:   WebSocketInterceptor + ensureOpened/connect bridge    │
└──────────────────────────────────────────────────────────────┘
```

**Mirror closely:** client handler API + orchestration (HTTP and WS), settle / socket message shapes, Request/Response helpers, glob matching (`webSocket=true` where required), **HAR / `routeFromHAR`**, **`WebSocketRoute` DX**.

**Diverge here (intentionally):**

1. **Multi-match ownership** — fail loud when **two different tests** claim the same request/socket. Within one test, mirror Playwright (HTTP LIFO + `fallback`; WS newest-match only).
2. **No browser-specific concerns** — CORS auto-headers, favicon abort, service workers, navigation redirects, cookie jar, `networkidle`, resource timing, HAR zip attach, frame-navigation WS close, DOM `binaryType` object-identity quirks.
3. **Extra matchers** — `method` / `clientId` filters on matcher objects (multi-process necessity).
4. **Partial WS client coverage** — only `globalThis.WebSocket` (see §3 and rewrite-spec §4). Loud docs on every WS page.

---

## 3. How closely can we follow Playwright?

### High fidelity (practical near-parity)

These can and should look almost like Playwright’s client code, with settle / socket actions crossing our control-plane WS instead of Playwright’s channel.

Status column = rewrite target (prototype proof lives under `historical/`).

| Capability                                             | Playwright reference              | Rewrite target | Notes                                                             |
| ------------------------------------------------------ | --------------------------------- | -------------- | ----------------------------------------------------------------- |
| `route(url, handler)`                                  | `page.ts` / `browserContext.ts`   | yes            | Include `times`                                                   |
| Matcher: glob / RegExp / predicate / `URLPattern`      | `urlMatch` + `RouteHandler`       | yes            | Align glob (`?` literal, braces, baseURL); keep claim broadcast   |
| `unroute` / `unrouteAll({ behavior })`                 | client                            | yes            | HTTP lifecycle; **WS routes must not be cleared by `unrouteAll`** |
| `fulfill` / `continue` / `abort` / `fetch`             | `Route`                           | yes            | Expand abort codes; header forbid-list differs (browser-specific) |
| Stall until settle / double-settle throws              | `_startHandling`                  | yes            | Same failure mode if handler forgets to settle                    |
| `waitForRequest` / `waitForResponse`                   | page APIs                         | yes            |                                                                   |
| Request inspection                                     | `Request`                         | yes            | Port transport-agnostic helpers                                   |
| `routeFromHAR`                                         | `HarRouter`                       | yes            | Same API + HAR files; skip zip/navigation-only quirks             |
| **`routeWebSocket` + `WebSocketRoute`**                | `network.ts` + `webSocketMock.ts` | yes            | Newest-match; mock/connect/forward/close; see §1b                 |
| WS matchers (glob / RegExp / predicate / `URLPattern`) | `WebSocketRouteHandler`           | yes            | `urlMatches(..., webSocket=true)`; eager invalid-glob throw       |
| WS binary + protocols + ensureOpened timing            | injected mock                     | yes            | Product bridge over MSW (see §3b)                                 |

### Medium fidelity (mirror semantics, different transport)

| Capability                                                           | Should we mirror?             | Divergence reason                                                                  |
| -------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| HTTP `fallback()` + LIFO chaining                                    | **Yes, within a single test** | Across tests fail on multi-owner; within one test Playwright chaining is desirable |
| `times`                                                              | Yes                           | Pure client-side bookkeeping                                                       |
| Handler exception → fall through (HTTP fallback path)                | Yes                           | Confirm exact semantics when implementing                                          |
| Override accumulation across `fallback`                              | Yes                           | Local mutation before next handler                                                 |
| APIRequestContext-level fetch options (`maxRedirects`, `maxRetries`) | Partial                       | Useful on `route.fetch`; not full `page.request` API                               |
| WS auto-forward ↔ MSW `preventDefault`                               | Yes (semantic)                | Different primitive; map in the Node bridge                                        |

### Low fidelity / out of scope for this library

These are Playwright browser-network features. Near-full parity of Node outbound HTTP **and** `globalThis.WebSocket` does **not** require them:

- `page.route` / `context.route` browser interception itself (we complement it)
- CORS auto-injection on fulfill
- Cookie / Set-Cookie / browser cookie jar on continue+redirect
- Service worker / shared worker / blob / data: URL quirks
- `networkidle`, resource timing, transfer sizes from browser
- Favicon auto-abort
- Frame-navigation / detach / `page.close` WebSocket lifecycle (`_executionContextGone`)
- Page vs context dual-scope HTTP/WS precedence (single `backendMocks` scope)
- HAR zip attach mode / tracing HAR packaging / **websocket HAR frames** (plain `.har` HTTP record/replay **is** in scope)
- Global / context `APIRequestContext` as a general HTTP client (only needed as the engine behind `route.fetch`)
- npm `ws` / non-global WebSocket constructors (unless a future custom-client design lands)

### 3b. MSW `WebSocketInterceptor` ↔ Playwright semantic bridge

Step 2 feasibility (rewrite-spec §4) is **conditional yes** via `@mswjs/interceptors` `WebSocketInterceptor` plus a **product-owned bridge**. Raw MSW defaults are not Playwright-shaped:

| Topic                   | Playwright                                                              | MSW default                                                     | Bridge requirement                                                                    |
| ----------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Default mock            | No upstream until `connectToServer()`                                   | No upstream when a `connection` listener exists                 | OK — always install a listener                                                        |
| Open timing             | Stay `CONNECTING` until handler `_afterHandle` / `send` / real `onopen` | Auto-open after the `connection` listener promise resolves      | **Hold open** until the Playwright worker handler settles; early-open on `sendToPage` |
| `connectToServer`       | Page opens on real upstream `onopen`                                    | Listener may finish before real open; override still auto-opens | Gate mock open when connected; open on server `open`                                  |
| Forward control         | `onMessage` disables auto-forward                                       | `preventDefault` on message events                              | Map `onMessage` ↔ preventDefault + manual send                                        |
| Close forward           | `onClose` disables                                                      | `preventDefault` on close                                       | Same mapping                                                                          |
| Passthrough             | unmatched → `_apiPassThrough`                                           | no listeners → `server.connect()`                               | Unmatched claim → passthrough path                                                    |
| Client surface          | browser `WebSocket`                                                     | **`globalThis.WebSocket` only**                                 | Loud docs; skip npm `ws`                                                              |
| Control-plane recursion | N/A                                                                     | Patches global only                                             | Agents use `ws` package → naturally safe                                              |

Do **not** count on MSW adding custom-client hooks soon. Plan around global-only interception; document the gap on every public WS page.

### Intentional product divergences (do not “fix” toward Playwright)

#### 1. `routeFromHAR` — full format parity (not JSON)

Playwright’s `HarRouter` is a thin adapter: open HAR → on each route lookup → fulfill / abort / fallback / follow redirects in-lookup.

**Product decision:** implement `backendMocks.routeFromHAR` with the same options and HAR file format as Playwright (`url`, `update`, `updateMode`, `updateContent`, `notFound`). Node traffic will not populate browser-only HAR fields; matching/update control flow should otherwise match. Developer instruction: when changing the HAR router, open Playwright’s `harRouter.ts` / `harBackend.ts` + `browsercontext-har.spec.ts` and match behavior; omit only zip/navigation-specific paths.

#### 2. Fail loudly on multiple matching owners (HTTP and WebSocket)

Playwright assumes one browser + one test’s handler list; HTTP uses LIFO + `fallback`, WS uses newest-match.

We run a **shared server with concurrent tests**. Overlapping matchers across tests are a coordination hazard, not a chaining feature.

Rule to preserve:

- **Across tests / registrations that both claim the same request or socket:** `ambiguous_route` → fail the Node traffic + fail every affected Playwright test, with diagnostics and a docs link.
- **Within a single test (recommended Option A):**
  - **HTTP:** allow multiple matching routes and chain via `fallback` like Playwright; only fail when **more than one `testId`** claims the request.
  - **WebSocket:** newest matching handler wins (no fallback chain) — same as Playwright.
- **Option B** (stricter): fail on any >1 route match even inside one test — not recommended; fights the oracle.

Error messages should link to a documentation page explaining: serialize those tests, or make matchers mutually exclusive (URL / method / `clientId`).

---

## 4. Natural organizational system for developers

Proposed module alignment (not requiring Playwright code reuse — just side-by-side reference):

| Our module                                                   | Playwright analogue                                   | Mirror guidance                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/playwright/src/types.ts`                           | `client/network.ts` public types + `api.Route`        | Keep method names/options aligned                                                |
| `packages/playwright/src/backend-mocks.ts`                   | `Route` + `RouteHandler` + `_onRoute`                 | Extract a `RouteHandler` class; implement `fallback`, `times`, LIFO              |
| `packages/playwright/src/websocket-route.ts` (name flexible) | `WebSocketRoute` + `WebSocketRouteHandler`            | Port nearly line-for-line from PW 1.62.1 `network.ts`; newest-match only         |
| `packages/playwright/src/match.ts` + `protocol/match.ts`     | `@isomorphic/urlMatch`                                | Port glob algorithm; WS uses `webSocket=true`; keep predicate-on-worker          |
| `packages/playwright/src/route-from-har.ts`                  | `client/harRouter.ts` + `server/harBackend.ts`        | Same options/control flow and HAR file I/O                                       |
| `packages/protocol/src/schemas.ts`                           | `channels.d.ts` Route + **WebSocketRoute** messages   | HTTP settle actions + socket lifecycle (`connect` / `ensureOpened` / send/close) |
| `packages/proxy/src/server.ts`                               | `*Dispatcher` + `WebSocketRouteDispatcher` ownership  | Claim broadcast for requests **and** sockets; multi-test ambiguity               |
| `packages/node/src/agent.ts`                                 | `RouteDelegate` + server `fetch.ts`                   | Apply HTTP decisions; upstream fetch with bypass                                 |
| `packages/node` WS bridge (module TBD)                       | `injected/webSocketMock.ts` + dispatcher API requests | `WebSocketInterceptor` + product open/close/forward bridge                       |

Suggested developer checklist for every parity change:

1. Find the Playwright file/function in the table above.
2. Port behavior and subtle edge cases; name symbols similarly where practical (`_checkNotHandled`, `willExpire`, `_applyFallbackOverrides`).
3. Note intentional differences with searchable `DIVERGENCE` / `DIVERGENCE END` comments (see [`../PHILOSOPHY.md`](../PHILOSOPHY.md) §4); keep pinned Playwright GitHub blob URLs on mirrored modules.
4. Add or adapt a test from the Playwright catalog (below), rewritten against `backendMocks`.
5. Do **not** copy Playwright source files or license-entangled chunks; reimplement.

---

## 5. Public API surface to target for near-full parity

### Core (should match Playwright closely)

```ts
backendMocks.route(url, handler, options?: { times?: number })
backendMocks.unroute(url?, handler?)
backendMocks.unrouteAll(options?: { behavior?: 'wait' | 'ignoreErrors' | 'default' })
// NOTE: unrouteAll must NOT clear WebSocket routes (Playwright quirk; oracle pins this)

route.fulfill({ status, headers, body, json, contentType, path, response })
route.continue({ url, method, headers, postData })
route.fallback({ url, method, headers, postData })
route.fetch({ ...continueOverrides, timeout, maxRedirects?, maxRetries? })
route.abort(errorCode?)
route.request()

backendMocks.waitForRequest(urlOrPredicate, options?)
backendMocks.waitForResponse(urlOrPredicate, options?)
backendMocks.requests(url?)   // library-specific spy helper (good)
backendMocks.routeFromHAR(path, { url?, update?, updateMode?, updateContent?, notFound? })

backendMocks.routeWebSocket(url, handler)
// handler receives WebSocketRoute:
ws.url()
ws.protocols()
ws.onMessage(cb)          // page→… ; disables auto-forward that direction
ws.onClose(cb)            // disables auto-close-forward that direction
ws.send(data)             // to page; forces open if still CONNECTING
ws.close({ code?, reason? })
const server = ws.connectToServer()  // once; server-side route
server.onMessage / onClose / send / close / url / protocols
// server.connectToServer() throws
```

### Matcher forms

| Form                        | Playwright            | Us                                                         |
| --------------------------- | --------------------- | ---------------------------------------------------------- |
| Glob string                 | ✅                    | ✅ (algorithm should be aligned)                           |
| RegExp                      | ✅                    | ✅                                                         |
| `(url: URL) => boolean`     | ✅                    | ✅                                                         |
| `URLPattern`                | ✅                    | ✅ (in rewrite-spec §4)                                    |
| `{ url, method, clientId }` | ❌ (PW uses URL only) | ✅ keep — multi-process necessity (WS: `url` + `clientId`) |

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
- From `browsercontext-har.spec.ts` → dual-mode `routeFromHAR`: method match, default abort, `notFound: fallback`, url/regex filter, update mode, postData match, unroute stops HAR replay.

**P1 — inspection / waiting**

- `page-wait-for-request.spec.ts` (all)
- Request/postData tests from `page-network-request.spec.ts` / `network-post-data.spec.ts` that are transport-agnostic

**P2 — nice-to-have APIRequestContext behaviors used only by `route.fetch`**

- timeout, maxRedirects, compression handling from fetch specs

**P0 — WebSocketRoute (already in oracle)**

- Full mock / empty handler open / `url`+`protocols` / proactive `send`
- `connectToServer` default forward; `onMessage`/`onClose` disable + manual re-forward
- Newest-match; glob/RegExp/predicate/`URLPattern`; passthrough; registration timing
- Binary/Blob/TypedArray; close codes; ensureOpened vs send-during-CONNECTING
- `unrouteAll` does not clear WS routes; concurrent isolation; handshake failure

**Skip (browser-only / intentional)**

- CORS, service workers, favicon, networkidle, resource timing, HAR zip/**websocket HAR**, browser cookie jar redirect matrix, context vs page route precedence (single `backendMocks` scope), npm `ws` / non-global WebSocket constructors, frame-navigation WS close

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
<summary><code>browsercontext-har.spec.ts</code> (33) — dual-mode routeFromHAR</summary>

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

### HTTP

1. **LIFO registration + fallback chaining** (within one owner).
2. **`fulfill` / `continue` / `abort` terminate; `fallback` does not.**
3. **`times` expiration** removes handler before/around last invocation; patterns/registrations update.
4. **Double settlement throws.**
5. **Overrides from `fallback`/`continue`** change what subsequent handlers / the network see for url/method/headers/postData.
6. **Glob rules:** `*` segment-local, `**` cross-segment; `?` is literal (not a wildcard); unbalanced `{a,b}` braces throw at `route()` time.
7. **Function predicates** force broad interception server-side; precise match client-side — distributed equivalent via claims.
8. **`route.fetch` bypasses other route handlers** — interceptor bypass / direct `fetch` is correct.
9. **Unroute lifecycle:** optional wait for in-flight handlers; `ignoreErrors` swallows late exceptions; closing should not hang forever on pending handlers.
10. **HAR `notFound`:** default abort; `fallback` continues; `update: true` records instead of replaying.
11. **Cancelled/disconnected requests** must not throw confusingly in handlers after teardown.

### WebSocket

1. **Newest matching handler only** — no WS fallback chain (`find` after `unshift`).
2. **Default = full mock** — no upstream until `connectToServer()`; empty handler still opens.
3. **`_afterHandle` / `ensureOpened`** — after the (possibly async) handler, mock-open if never connected; stay `CONNECTING` until then.
4. **`send` during pending handler** forces the page socket open; page-side `WebSocket.send` while `CONNECTING` still throws.
5. **`onMessage` / `onClose` disable that direction’s auto-forward**; second `onMessage` replaces the first; handlers are not awaited.
6. **`connectToServer` twice throws**; server-side `connectToServer` throws.
7. **`unrouteAll` does not clear WS routes.**
8. **Only sockets after registration** are routed; unmatched → passthrough (real upstream).
9. **Binary codec:** base64 over the wire; TypedArray must slice `byteOffset`/`byteLength`; Blob → ArrayBuffer.
10. **Mock protocol:** first requested subprotocol; empty `extensions`; http(s) constructor URLs rewrite to ws(s).
11. **Close codes:** `1000` or `3000–4999`; default close forwards both ways until `onClose` takes over.
12. **Concurrent sockets** remain isolated by id.

---

## 8. Draft control-plane protocol for application WebSockets

HTTP already maps cleanly to pause → claim → `handler:result` → `decision:*`. App WebSockets need a **session-oriented** companion (names illustrative — finalize in `packages/protocol` during Step 2):

**Node → Proxy → Playwright**

| Message                           | Payload (conceptual)                     | Playwright analogue   |
| --------------------------------- | ---------------------------------------- | --------------------- |
| `ws:connection`                   | `{ socketId, url, protocols, clientId }` | binding `onCreate`    |
| `ws:messageFromPage`              | `{ socketId, data, isBase64 }`           | `onMessageFromPage`   |
| `ws:messageFromServer`            | `{ socketId, data, isBase64 }`           | `onMessageFromServer` |
| `ws:closePage` / `ws:closeServer` | `{ socketId, code?, reason?, wasClean }` | close bindings        |

**Playwright → Proxy → Node**

| Message                             | Meaning                                      | Playwright analogue           |
| ----------------------------------- | -------------------------------------------- | ----------------------------- |
| claim / `ws:matched`                | Own the socket for one test’s newest handler | `_onWebSocketRoute`           |
| `ws:passthrough`                    | No handler — real upstream                   | dispatcher `passthrough`      |
| `ws:connect`                        | `connectToServer()`                          | channel `connect`             |
| `ws:ensureOpened`                   | Mock open after handler                      | channel `ensureOpened`        |
| `ws:sendToPage` / `ws:sendToServer` | Inject frames                                | `sendToPage` / `sendToServer` |
| `ws:closePage` / `ws:closeServer`   | Close either peer                            | `closePage` / `closeServer`   |

**Registration:** `route:register` with `kind: 'websocket'` (or dedicated `wsRoute:register`). Must survive `unrouteAll`. Across `testId`s, multi-claim → `ambiguous_route` (same as HTTP). Within one `testId`, newest WS handler wins.

---

## 9. Mapping architecture onto this plan

What the prototype already proved (now under `historical/`):

- Thin Node agent, thin Playwright fixture, fat proxy coordinator.
- Claim broadcast so predicates stay in workers.
- Settle actions as protocol messages; `fetch` upstream in the Node process.
- Ambiguous multi-owner failure with diagnostics.
- Control-plane sockets via npm `ws` (safe beside a future global WS interceptor).

What Step 1 already locked (living `tests/parity/`):

- Browser oracle for HTTP routing, `routeFromHAR`, and **`routeWebSocket`** (~67 WS cases).
- Shared downstream + Node control-plane host for long-lived app sockets.
- Explicit skips for browser-only / npm `ws` / dual-scope cases.

What Step 2 must implement:

1. Playwright-like `Route` / `RouteHandler` (fallback, times, LIFO, overrides) and **`WebSocketRoute` / `WebSocketRouteHandler`**.
2. Option A for multi-match within one test (HTTP chain; WS newest-match); fail across `testId`s.
3. Port Playwright glob matching (`webSocket=true` where needed).
4. `unrouteAll({ behavior })` for HTTP only; leave WS routes.
5. `WebSocketInterceptor` + product bridge for ensureOpened / connect open races / send-during-CONNECTING.
6. Protocol messages from §8; proxy claim path + history for sockets.
7. Dual-mode harness already has `openDownstreamSocket` — wire `backendMocks.routeWebSocket` in node mode.
8. Loud docs banners on every WS page (rewrite-spec §4).
9. Stable docs URLs in `ambiguous_route` errors.

---

## 10. Direct answers to the research questions

**How does Playwright handle HTTP routing?**  
Client registers handlers; server enables interception with coarse patterns; each paused request becomes a channel `route` event; client runs handlers LIFO with fulfill/continue/abort/fallback/fetch; settle calls return over the channel to a browser `RouteDelegate`.

**How does Playwright handle WebSocket routing?**  
An init script replaces `globalThis.WebSocket` with a mock; construction notifies a binding; a dispatcher emits `webSocketRoute`; the client runs the newest matching handler; channel methods drive connect / mock-open / send / close on the injected mock. Default is full mock; `connectToServer()` opts into real upstream with auto-forward until `onMessage`/`onClose` take over.

**Is there a natural organizational system for our network boundary?**  
Yes — Playwright’s client/server channel boundary. Our control-plane WebSocket is that boundary. Node agents play `RouteDelegate` for HTTP and the injected-mock role for app WebSockets (`WebSocketInterceptor` + bridge).

**Could we closely match Playwright and diverge in special places?**  
Yes. Mirror client handler orchestration, settle APIs, `routeFromHAR`, and `WebSocketRoute` almost exactly; diverge on (1) multi-test ambiguous match failures, (2) browser-only concerns, (3) WS client surface limited to `globalThis.WebSocket`.

**Should developers keep Playwright code alongside as a reference?**  
Yes — external reference at the oracle pin (`1.62.1` / `26a9e47`), with module-mapping instructions in this doc. Do not vendor Playwright source; reimplement with deliberate naming/structure alignment.

---

## Appendix A — Playwright abort error codes (for API parity)

From `docs/src/api/class-route.md`:

`aborted`, `accessdenied`, `addressunreachable`, `blockedbyclient`, `blockedbyresponse`, `connectionaborted`, `connectionclosed`, `connectionfailed`, `connectionrefused`, `connectionreset`, `internetdisconnected`, `namenotresolved`, `timedout`, `failed` (default).

## Appendix B — Related docs in Playwright

- `docs/src/network.md` — mocking, modify/abort, glob patterns, WebSockets
- `docs/src/mock.md` — mock APIs, HAR mocking
- `docs/src/api/class-route.md` — Route methods
- `docs/src/api/class-websocketroute.md` — **in-scope DX** for rewrite (`routeWebSocket` / `WebSocketRoute`)

## Appendix C — Oracle / historical coverage

- **Living oracle:** [`tests/parity/`](../tests/parity/) — HTTP + HAR + WebSocketRoute against stock Playwright 1.62.1; checklist in `tests/parity/checklist.md`.
- **Historical prototype e2e** (`historical/tests/`): glob/RegExp/predicate/method/clientId, unroute, ambiguous failure, fulfill/continue/fetch/abort matrix, waitForRequest/requests, disconnect/auth, observability. Useful reference while Step 2 lands; not the contract.
