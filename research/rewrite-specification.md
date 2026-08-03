# Rewrite Specification: Oracle Suite → High-Parity Reimplementation

This document is the implementation plan for rewriting `@playwright-backend-mocks` against Playwright’s request-routing contract.

Supporting research (not the plan itself):

- [`playwright-parity-tdd.md`](./playwright-parity-tdd.md) — oracle-suite TDD strategy
- [`playwright-network-parity.md`](./playwright-network-parity.md) — Playwright interception structure, module mapping, intentional divergences
- [`playwright-network-tests.json`](./playwright-network-tests.json) — Playwright network test catalog (titles)

---

## 1. Intent

The current codebase is a **prototype**. It proved the architecture and the public DX. We will rewrite the library greenfield for:

1. A comprehensive executable contract tested first against Playwright itself.
2. High behavioral and structural parity with Playwright’s interception APIs, on top of the architecture already proven in the prototype.

Work proceeds in two steps. Step 1 produces the test suite. Step 2 implements the library until that suite passes in library mode.

---

## 2. Archive the prototype

Before greenfield work lands in the normal project paths:

1. Move the current implementation into `historical/` (at minimum: `packages/`, `tests/`, `fixtures/`).
2. Do **not** wire `historical/` into the workspace, build, lint, or CI.
3. Treat it as short-lived reference material; delete it once the rewrite no longer needs it.

Root config, `documentation/`, `research/`, and product docs may remain living. Update the workspace so only the new tree builds.

---

## 3. Architecture to preserve

The rewrite keeps the proven process split; it does not invent a new topology:

```text
Playwright test (backendMocks / route handlers)
        │ WebSocket
        ▼
Proxy (claim broadcast, ownership, history)
        │ WebSocket
        ▼
Node agent (@mswjs/interceptors HTTP + WebSocketInterceptor)
        → HTTP: pause / fulfill / continue / abort / upstream fetch
        → WS: connection bridge / connectToServer / ensureOpened / frames / close
```

Map layers to Playwright’s own split (see parity research §1–2 / §1b):

| Our package           | Playwright analogue                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------- |
| `packages/playwright` | Client `Route` / `RouteHandler` / `_onRoute` **and** `WebSocketRoute` / `_onWebSocketRoute` |
| `packages/proxy`      | Dispatchers + ownership (HTTP + sockets)                                                    |
| `packages/node`       | RouteDelegate + injected `webSocketMock` role (MSW bridge)                                  |
| `packages/protocol`   | Channel settle messages + WS lifecycle messages                                             |

Do **not** vendor Playwright source. Reimplement. Keep analogous paths documented next to modules for deliberate comparison. Pin the Playwright revision used as reference (below).

---

## 4. Parity boundary

### In scope (full parity)

Behavior for **already-intercepted** outbound HTTP **and** application WebSockets: matchers, handler orchestration, settle APIs, and inspection.

**HTTP**

- `route` / `unroute` / `unrouteAll`
- `fulfill` / `continue` / `abort` / `fallback` / `fetch`
- Matcher forms: glob, RegExp, predicate, URLPattern (plus our `method` / `clientId` object filters)
- LIFO registration, `times`, override accumulation across `fallback`
- Stall until settle; double-settle throws
- Glob semantics aligned with Playwright
- `waitForRequest` / `waitForResponse` and request/response inspection helpers that apply to this path
- `route.fetch` options that apply to fetching **the current intercepted request** upstream: overrides, timeout, redirect handling (`maxRedirects`), response body usability (including compression where Playwright’s route path exposes decoded bodies)
- `routeFromHAR` with near-complete Playwright parity (same HAR files, options, and matching/update control flow; browser-only HAR concerns such as zip attach / navigation rewrite remain out of scope)

**WebSockets** (same DX philosophy as Playwright `routeWebSocket` / `WebSocketRoute`)

- `routeWebSocket(matcher, handler)` with glob / RegExp / predicate / URLPattern matchers (plus our `clientId` filter where applicable)
- Newest matching handler only (no WS fallback chain — mirror Playwright)
- Full mock without upstream (`onMessage` / `send` / `close` / `onClose` / `url` / `protocols`)
- `connectToServer()` with default bidirectional forwarding
- Installing `onMessage` / `onClose` disables that direction’s auto-forward (handler must take over)
- Text and binary frames; concurrent sockets remain isolated
- Only sockets opened **after** registration are routed; unmatched passthrough

Feasibility for Step 2: **conditional yes** for Node apps using `globalThis.WebSocket` (Node ≥22 / Undici global), via `@mswjs/interceptors` `WebSocketInterceptor` plus a product-owned upstream bridge for Playwright-compatible open/close semantics. This stays on the roadmap even with incomplete client coverage — the ecosystem is moving toward the WHATWG / Undici global, so coverage of real codebases should improve over time. We are **not** counting on MSWJS to implement custom-client hooks (e.g. npm `ws`) soon; plan around global-only interception.

### Partial WebSocket support (Node) — plan this into docs from day one

HTTP and WebSocket support are **not** the same breadth:

| Surface                    | Coverage intent                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Outbound **HTTP**          | Virtually every Node HTTP client we care about (via `@mswjs/interceptors` node preset / Undici / `http` / `https` / `fetch`)                                                                |
| Application **WebSockets** | **`globalThis.WebSocket` only** (WHATWG global). npm `ws`, other third-party clients, and constructors imported directly from Undici (bypassing the patched global) are **not** intercepted |

Why: MSW’s interceptor patches the **global** WebSocket constructor. Clients that never touch that global never enter the mock pipeline — they silently talk to the real network. That is a different failure mode than HTTP, where the interceptor surface already covers the common stacks.

**Documentation requirement (non-negotiable for shipping WS):** every public WebSocket doc page / guide section must open with a large, unavoidable caveat that:

1. We do **not** support all WebSocket clients (contrast with HTTP).
2. Supported path is `globalThis.WebSocket` / WHATWG-compatible global usage.
3. npm `ws` and direct-import constructors will bypass mocks unless/until a separate design lands.
4. A short “why” (global patch vs full transport rewrite) so readers do not assume silent parity with Playwright browser routing.

Do not bury this in a footnote. Readers who only skim WS docs must still see it.

### Out of scope

- General HTTP **initiation** APIs (`page.request` / `APIRequestContext` as a client)
- Browser-only concerns: CORS auto-headers, cookie jar, service workers, navigation/`networkidle`, resource timing, favicon quirks, HAR zip packaging / attach mode, websocket HAR frames, frame-navigation WS close, DOM `binaryType` object-identity quirks, etc.
- npm `ws` package clients and non-global WebSocket constructors (unless a future custom-client design lands)

### Required product divergences

| Topic                        | Behavior                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Multi-owner                  | If **two different tests** claim the same request/socket → fail loud (`ambiguous_route`) with diagnostics + docs link |
| Same test, multiple handlers | **Mirror Playwright**: HTTP LIFO + `fallback`; WS newest-match only (no fallback chain)                               |
| Record/replay format         | **`routeFromHAR`** — same API name and HAR files as Playwright (no JSON-cassette analogue)                            |
| Extra matchers               | Keep `method` / `clientId`                                                                                            |
| WS constructor surface       | Guarantee `globalThis.WebSocket` only; **loud docs** on every WS page for `ws` / direct-import bypass                 |

---

## 5. Step 1 — Oracle test suite

Write the parity suite **against stock Playwright only**. No imports from `@playwright-backend-mocks/*`.

### What this suite is for

This suite is the **developer contract** for the API surface in §4 (in scope). It is not an internal unit-test dump and not a smoke check.

- Test by **being the developer**: call the public routing APIs the way a careful Playwright user would; assert outcomes they would care about (status, body, headers, abort behavior, handler ordering, matcher rules, inspection helpers, record/replay control flow).
- Prefer broad, real end-to-end scenarios (downstream process → upstream fake) over mocks of our own stack.
- Specs should read like documentation: maximal public-API usage, minimal harness glue.
- Stock Playwright runner only. Everything local; no public internet.
- Encode **observed** Playwright behavior, including awkward edges. Surprises become parity targets unless listed as intentional divergences.

When the same suite later runs in backend mode, a failure means we broke (or have not yet met) a guarantee we intend to make to library users.

### How to build coverage (be comprehensive)

Target **extreme completeness** for the in-scope API — every meaningful behavior we will guarantee should have a test. Sparse coverage defeats the point of oracle TDD.

Practical approach:

1. Inventory the public surface we guarantee (§4) as a checklist.
2. Use Playwright’s **own** network/request-routing tests at the pinned commit as the primary source of scenarios. Read those specs in `microsoft/playwright` (e.g. `page-route`, fulfill/continue/fallback/intercept, unroute, wait-for-request, HAR replay). The title catalog in [`playwright-network-tests.json`](./playwright-network-tests.json) and the priority notes in the parity research are a map into that suite — not a substitute for reading the real tests.
3. Port/adapt every in-scope case that applies to Node outbound HTTP mocking. Skip only browser-only or out-of-scope items, and record each skip with a reason.
4. Fill any gaps in the checklist that Playwright’s suite does not exercise but our guaranteed API still requires.
5. Do not invent a parallel, thinner idea of the API. Comprehensiveness over clever minimalism.

Library-only behavior (`clientId`, cross-test ambiguity, proxy auth/disconnects, dashboard) lives in a **separate** suite — not the oracle.

### Pin

- Exact `@playwright/test` npm version (no floating `^` for the oracle).
- Matching `microsoft/playwright` commit SHA recorded in the suite config/README and [`playwright-network-parity.md`](./playwright-network-parity.md).
- Current pin: **`1.62.1`** (`26a9e47`). Historical network-test inventory JSON still keyed at `15b1aec` until regenerated.
- Bump only deliberately when updating both oracle and reference mapping.

### Fixtures

1. **Upstream fake** — local third-party HTTP server (status/body/header/echo variants).
2. **WebSocket upstream** — local WS server (echo, binary, subprotocols, close codes, handshake failure).
3. **Shared downstream core** — isomorphic `fixtures/downstream` helpers (`fetch` + `globalThis.WebSocket`) used by both hosts.
4. **Browser downstream host** — thin page that loads the shared modules (`window.trigger` / `window.connectWebSocket`) plus browser-only XHR.
5. **Node downstream host** — thin process that imports the same modules and exposes a **control-plane WebSocket** (`/control`) so the Playwright worker can drive long-lived app sockets (open/send/receive/close/info) and HTTP triggers inside the Node process. Step 2 enables `startBackendMocks` in this same process (`ENABLE_BACKEND_MOCKS=1`).

### Dual-mode harness

Use a **thin** dual-mode harness where the Playwright API and ours are nearly identical:

- `route` / settle methods / matchers / `times` / `unroute` / `unrouteAll` / `waitForRequest` / `waitForResponse` / fallback chaining
- **`routeFromHAR(file, options)`** — browser: `page.routeFromHAR`; node/Step 2: `backendMocks.routeFromHAR` (same HAR files and assertions)
- `trigger` / `openDownstreamSocket` — same shared downstream code; browser via `page.evaluate`, node via control-plane WS
- Mode switch via config/env: `PARITY_MODE=browser|node` (Step 2 wires mocks on the node path)

Rules:

- Harness adapts routing handle + how the downstream is driven. Assertions and shared downstream modules stay shared.
- Do **not** drive Node app WebSockets with one-shot HTTP helpers — long-lived sockets need the control plane.
- If the adapter grows clever, delete it and use two thin entrypoints instead.
- HAR zip packaging, navigation-after-HAR, cookie-jar HAR quirks, and other non-portable browser cases: omit from the suite (already intentional skips).

### Step 1 done when

- Checklist of the guaranteed API surface is covered (or each omission is explicitly justified).
- Browser-mode suite is green against pinned Playwright + shared upstream.
- Specs read like user code; harness glue stays thin.
- Suite has no dependency on this library.
- Intentional skip/divergence list is explicit for anything not ported from Playwright’s tests.

---

## 6. Step 2 — Reimplementation (TDD)

Switch the same suite to library mode and implement until green.

### What changes in node / library mode

| Piece         | Change                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------- |
| Routing API   | `page.route` / `routeFromHAR` / … → `backendMocks.route` / `routeFromHAR` / …               |
| Downstream    | Same shared modules; host swaps browser page → Node process + `startBackendMocks`           |
| Trigger       | Same `trigger` / `openDownstreamSocket`; transport swaps `page.evaluate` → control-plane WS |
| Record/replay | Same dual-mode HAR specs via harness `routeFromHAR`                                         |
| Runner        | Proxy + `PLAYWRIGHT_BACKEND_MOCKS_*` via Playwright config / `webServer`                    |

### What must not change

Upstream fake, assertion intent, scenario names/structure for dual-mode cases, public-API-only testing habit.

### Implementation approach

1. Add the thinnest skeleton that can load backend mode (protocol, proxy, node agent, playwright fixture wiring) so failures are product failures, not missing process glue.
2. Drive work from failing backend-mode cases.
3. Mirror Playwright client handler orchestration closely (`Route` / `RouteHandler`, fallback, times, LIFO, settle checks).
4. Keep proxy ownership rules: chain within one test; fail across tests.
5. Port glob matching and settle semantics deliberately from the pinned Playwright revision.
6. Do not implement a general request-initiation client.

### Step 2 done when

- Backend mode passes the oracle/parity suite for the in-scope surface (including `routeFromHAR`).
- Library-only suite covers multi-process / ambiguity / infra concerns.
- Module map and `PARITY` / `DIVERGE` notes exist for contributors.
- `historical/` can be deleted when no longer useful.

---

## 7. Testing layout (target)

```text
tests/
  parity/          # dual-mode oracle suite (browser | backend), including routeFromHAR
  library/         # clientId, cross-test ambiguity, disconnect, etc.
  unit/            # pure helpers as needed
  contract/        # wire protocol as needed
historical/        # frozen prototype (not in workspace)
```

Names can vary; the separation of concerns must not.

CI: run browser oracle against pinned Playwright; run backend parity against built packages; run library-only suite separately.

---

## 8. Order of work

1. Archive prototype → `historical/`; clear living package/test/fixture paths for greenfield use.
2. Pin Playwright; build upstream + browser harness; land Step 1 suite green in browser mode.
3. Extract thin dual-mode seam including `routeFromHAR` (same HAR files in both modes).
4. Scaffold Step 2 skeleton; enable backend mode (expect red).
5. Implement packages against failing cases until backend mode is green (HAR record/replay included).
6. Add library-only suite; remove `historical/` when finished.

---

## 9. Non-goals

- Reusing Playwright source files
- Parity with Playwright’s standalone HTTP client
- Perfect OS-level fidelity for every abort/network error code (accept codes; map sensibly on Node)
- Keeping the prototype integrated “just in case”
