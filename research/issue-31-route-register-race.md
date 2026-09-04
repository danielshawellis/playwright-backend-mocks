# Issue 31: `route()` can resolve before the proxy has the route

Plan for regression-testing and fixing [issue #31](https://github.com/danielshawellis/playwright-backend-mocks/issues/31). This is the implementation plan for that bug; [`PHILOSOPHY.md`](../PHILOSOPHY.md) still wins on conflict.

**Status:** plan only (no code change yet). Execute in the order below: failing tests first, then the Playwright-shaped ack, then defense-in-depth.

---

## 1. What the bug is

`backendMocks.route()` is **not ready when its promise resolves**. The Playwright worker already has the handler in its local `routes` array, but the proxy decides whether to run a claim from **its own** `routes` map. That map is updated by a fire-and-forget `route:register`. If the Node app makes an outbound call in that gap, the proxy treats the request as unmatched and **passthroughs to the real network**.

Seen in CI as flaky e2e on `@playwright-backend-mocks/*` `0.1.6`: first attempt talks to the real third party (~20s, 401 / timeout), retry passes in ~1s once the route exists. Consuming app: [atkpilot1/smallplanevalue](https://github.com/atkpilot1/smallplanevalue) (Nitro/Nuxt, one worker, Anthropic via Vercel AI SDK).

This is **not** a matcher bug. The glob matches. Headers / API keys are not part of matching. When the mock hits, fixtures are returned and the key is never used. When it misses, the real host sees whatever key the process has.

```text
Playwright worker                         Proxy                         Node agent
─────────────────                         ─────                         ──────────
routes.unshift(handler)   ──ready locally──►
connection.send(route:register)  ──in flight──►  (not in routes map yet)
await route() resolves  ←──too early────────────────────────────────────
test clicks / app fetch  ────────────────────────────────────────────► request:start
                                          expectedTestIds.size === 0
                                          decision:passthrough  ────► real HTTPS
                                          (later) apply route:register
```

WebSocket frames on **one** connection are FIFO. That does not help: `route:register` and `request:start` travel on **different** sockets. The proxy can process the Node message first.

---

## 2. Why the code does this

Confirmed in the living tree (not just the issue write-up).

### Worker sends and returns immediately

[`packages/playwright/src/backend-mocks.ts`](../packages/playwright/src/backend-mocks.ts) `route()` / `routeWebSocket()`:

1. `unshift` onto the worker-local handler list (Playwright LIFO).
2. `connection.send({ type: "route:register", ... })` with no ack.
3. The `async` function returns.

`unroute` / `unrouteAll` / `dispose()` are the same pattern for `route:unregister` and `test:unregister`.

[`packages/playwright/src/fixtures.ts`](../packages/playwright/src/fixtures.ts) sends `test:register` and yields `backendMocks` without waiting. Parity node wiring ([`tests/parity/node-routing.ts`](../tests/parity/node-routing.ts) `createNodeMocksForTest`) is identical.

[`packages/playwright/src/connection.ts`](../packages/playwright/src/connection.ts) `send()` is fire-and-forget except for the `hello` handshake (the one place we already wait).

### Proxy passthroughs before asking the worker

[`packages/proxy/src/server.ts`](../packages/proxy/src/server.ts) `handleRequestStart`:

1. Build `expectedTestIds` **only** from the proxy `routes` map (skip a route if `tests.get(route.testId)` is missing).
2. If that set is empty → `decision:passthrough` immediately. **Never** sends `request:claim`.
3. Worker-local handlers are irrelevant because they were never asked.

The same empty-map fast path exists for WebSockets (`handleWsConnection` → `ws:passthrough`).

A **later** passthrough when claim results come back empty (`matches.length === 0`) is correct for a true non-match. The empty-`expectedTestIds` path is the race.

### Second hole: teardown + SDK retries

`dispose()` sends `test:unregister` without waiting. The proxy deletes the test and all of its routes (`handleTestUnregister`).

- Requests **already** attributed to that test get `decision:error` (`Test ended while a backend mock request was pending`). That path is fine.
- **New** outbound calls that start after unregister (AI SDK: 3 attempts, several seconds) see `expectedTestIds.size === 0` and passthrough. Those show up in server logs between tests.

### Why most tests still pass

The gap is typically a millisecond. `beforeEach` + a UI click is usually slower than the proxy applying `route:register`. Under CI load, or when the app fires HTTP immediately, the first attempt leaks. Playwright then retries the test and the route is already there.

---

## 3. Scope for this issue

The issue lists four suggested fixes. They are not the same size or the same kind of change.

| # | Suggestion | Kind | Recommendation |
| --- | --- | --- | --- |
| **1** | `route()` / `test:register` / unroute wait for proxy ack | Playwright parity (`page.route` is ready when the promise resolves) | **P0 — this issue** |
| **2** | Do not passthrough solely because the proxy route map is empty | Multi-process defense in depth (`DIVERGENCE`) | **P0 — this issue**, narrowly (see §6) |
| **3** | Fail-closed unmatched policy (`backendMocksUnmatched: 'passthrough' \| 'abort'`) | New product API, not required to close the race | **Follow-up issue** — makes leftover races fail the test instead of hitting Stripe/Anthropic |
| **4** | Hold in-flight SDK retries across teardown | Related teardown leak | **P1 in this issue** if cheap once acks exist; otherwise follow-up |

**Done when:** after `await backendMocks.route(...)` (and `routeWebSocket`), a matching Node request must not passthrough because the proxy map lagged the worker. Same for `await unroute` / fixture teardown vs the proxy map. History for those leaked calls must not show `outcome.kind: "passthrough"` when a handler was already registered locally.

**Not done when:** we have only added a fail-closed option, or only documented the race. The consumer flake is a readiness bug, not a missing CI abort policy.

---

## 4. Regression tests first (TDD)

Philosophy: write the failing tests, watch them fail for the right reason, then implement. Do **not** start with protocol or proxy edits.

Two suites, two jobs:

| Suite | Job | Why it belongs there |
| --- | --- | --- |
| [`tests/library/`](../tests/library/) | Deterministic race against the **proxy + protocol** | Playwright has no proxy. Forcing `route:register` to lag `request:start` is a library-only topology. |
| [`tests/parity/`](../tests/parity/) | DX contract: `await route()` then immediate downstream HTTP | Oracle already passes (`page.route` waits). Node mode is what currently flakes. |

Do not try to make the parity suite inject proxy delays. That would break browser mode.

### 4.1 Library: delayed `route:register` (the red test that proves the race)

Add `tests/library/specs/route-register-race.spec.ts`.

**Hook (test-only, not CLI):** a `Partial<ProxyConfig>` delay such as `routeRegisterDelayMs` (and `wsRouteRegisterDelayMs` if we share the same handler) applied **after** the WebSocket frame is received and **before** `handleRouteRegister` mutates `routes`. Do not put this on the public CLI. If we do not want it on `ProxyConfig` long-term, a `createProxyServer` test override or an internal `Symbol` is fine — keep it out of user docs.

**HTTP case (consumer pattern):**

1. Start proxy with `routeRegisterDelayMs` large enough to be deterministic (e.g. 50–100ms) and small enough not to slow the file.
2. Real Node agent (`startBackendMocks`) + real `createBackendMocks` (not only `TestSocket`).
3. `await backendMocks.route("https://api.example.test/**", fulfill 200 + json)`.
4. Immediately `fetch("https://api.example.test/v1")` with **no** extra `setTimeout`.
5. Assert status 200 and fixture body.
6. `GET /api/history` (or the in-memory REST helper already used in observability specs): the matching entry’s `outcome.kind` is **not** `"passthrough"`.

Today this fails: `route()` returns before the delayed register runs, `fetch` hits the empty-map path, history is passthrough (or the real network if the URL is live). After the ack fix, `route()` does not resolve until the delayed register + ack, so the fetch starts against a populated map.

**In-flight-during-await case (defense in depth):**

```ts
const registered = mocks.route("https://api.example.test/**", fulfill);
const pending = fetch("https://api.example.test/v1"); // before await
await registered;
const response = await pending;
```

Ack-only does **not** necessarily pass this: the worker already `unshift`ed, but the proxy may still have an empty map when `request:start` arrives. §6 is what makes this green. Keep the test even if we implement §6 in the same PR — it is the reason §6 exists.

**Wire-level `TestSocket` variant:** seed the worker-local matcher, send `test:register`, send `request:start` **before** `route:register`, assert today’s `decision:passthrough`. After §6, the proxy must either wait or claim instead of passthrough. Useful because it does not depend on `createBackendMocks`. Extend `TestSocket` if we need “local route without sending” (today `send()` always writes the socket).

**WebSocket:** same delay + `routeWebSocket` + immediate `new WebSocket(...)`. Empty-map path is `ws:passthrough`.

**Unregister symmetry:** `await unroute(...)` then fetch must hit upstream (parity already covers the DX). With a delay on `handleRouteUnregister`, a library test should assert we do **not** still fulfill after `unroute()` resolved.

**Teardown (P1):** after `dispose()` / `test:unregister`, a new `fetch` from the same agent must not be a silent passthrough to a live third party **if** we take the P1 behavior in §7. If P1 is deferred, skip this test or assert current documented behavior explicitly so we do not pretend it is fixed.

### 4.2 Parity: `await route()` then immediate trigger

Add a case to [`tests/parity/specs/lifecycle.spec.ts`](../tests/parity/specs/lifecycle.spec.ts) (or a small sibling spec):

```ts
await route(`${UPSTREAM}/users`, async (r) => {
  await r.fulfill({ status: 200, body: "intercepted" });
});
const result = await trigger("/users"); // no sleep
expect(result.raw).toBe("intercepted");
```

Browser mode: documents Playwright’s contract (already true). Node mode: fails today under delay/load; after P0 it must be stable. This is **not** a substitute for 4.1 — it can pass by luck without a delay hook.

Mirror for `routeWebSocket` in the WS lifecycle specs if there is an equivalent “register then immediately open” gap.

### 4.3 What not to use as the regression

- [`tests/library/specs/https-cdn-passthrough.spec.ts`](../tests/library/specs/https-cdn-passthrough.spec.ts) **intentionally** passthroughs `api.anthropic.com` with **no** route (401 JSON smoke). Do not change it to fulfill. The consumer flake is “had a route that was not ready,” not “passthrough HTTPS is broken.”
- Tests that only assert “the call failed.” Passthrough 401 and `fulfill({ status: 500 })` look the same to the app. The regression must assert **mock ran** (body / header / history `outcome`).

### 4.4 Red run before implementing

1. Land the tests (and the delay hook if needed) in a commit that does **not** yet change routing.
2. `pnpm test:library` — the delayed-register HTTP test must fail (passthrough or timeout), not skip.
3. `pnpm test:parity:node:full` — the immediate-trigger case may flake or fail; record the failure mode.
4. Only then implement §5–§7.

---

## 5. P0 fix: wait for proxy ack (Playwright-shaped)

`page.route()` is ready when the promise resolves because CDP interception is enabled before return. `backendMocks.route()` must be the same: the proxy has applied the registration.

### 5.1 Protocol

Bump [`packages/protocol/src/version.ts`](../packages/protocol/src/version.ts) `PROTOCOL_VERSION` **2 → 3**. New clients will wait for acks that v2 proxies never send; hanging with a timeout would reintroduce the race. Packages are released together — a protocol bump is the honest break.

Add proxy → client messages (names can vary; keep them boring and specific):

| Direction | Type | Correlate with |
| --- | --- | --- |
| proxy → Playwright | `route:registered` | `routeId` |
| proxy → Playwright | `route:unregistered` | `routeId` and/or `testId` (match the unregister payload) |
| proxy → Playwright | `test:registered` | `testId` |
| proxy → Playwright | `test:unregistered` | `testId` |

Register the waiter **before** `socket.send` so a fast ack cannot be missed. Timeout: reuse `claimTimeoutMs` or a dedicated `ackTimeoutMs` (same order of magnitude as claim timeout). If the ack never arrives, fail the `route()` / fixture setup promise — do not proceed as if registered.

`hello` already shows the wait pattern in `connection.ts`. Prefer a small `sendAndWait` on `PlaywrightProxyConnection` rather than duplicating waiter logic in every API.

### 5.2 Fixture and APIs that must wait

| Call | Wait for |
| --- | --- |
| Fixture `test:register` (and `createNodeMocksForTest`) | `test:registered` **before** yielding `backendMocks` |
| `route()` / `routeWebSocket()` / `routeFromHAR()` (via `route()`) | `route:registered` |
| `unroute()` / `unrouteAll()` | every corresponding `route:unregistered` |
| `dispose()` | `route:unregister` + `test:unregister` acks |

Same-socket FIFO means if we only waited on `route:registered`, a prior `test:register` on that connection would already have been applied. Still ack `test:register` in the fixture: the fixture currently yields mocks before **any** register is applied, and teardown/observability assume the test exists.

`dispose()` is currently sync (`BackendMocksController.dispose(): void`) while the fixture calls it without `await`. Make dispose async and `await` it in the fixture and in `disposeNodeMocks`.

### 5.3 Proxy handlers

`handleRouteRegister` / `handleRouteUnregister` / `handleTestRegister` / `handleTestUnregister` apply the map mutation **then** send the ack. Ack after the mutation is visible to `handleRequestStart` on the same event-loop turn.

No Node-agent changes for P0. Node already waits on `decision:*`.

### 5.4 `DIVERGENCE` comments

Waiting for a coordinator ack has no Playwright source analogue (Playwright talks to a browser, not a third process). Mark the wait in `backend-mocks.ts` / `fixtures.ts` / `connection.ts` with `DIVERGENCE` / `DIVERGENCE END`: Playwright’s `page.route` is ready on return because interception is installed in-process/CDP; we ack through the proxy so the **DX** matches.

---

## 6. P0 defense: empty proxy map is not “no owner”

Ack closes the consumer pattern (`await route()` then click). It does **not** close traffic that starts **during** `await route()`: the worker has already `unshift`ed, the ack is in flight, and `request:start` can still see an empty `routes` map.

**Do not** broadcast `request:claim` to every Playwright TCP connection whenever the map is empty. A connection with no active `backendMocks` (between tests) will not answer; `collectClaims` would sit until `claimTimeoutMs` (default 5s) instead of passthrough.

**Do this instead:** if `routes` is empty but `tests` is not, treat those test ids as `expectedTestIds` and broadcast `request:claim` to **those tests’** Playwright connections.

- During `await route()`: the fixture has already registered the test (once §5 is in), the worker-local list has the handler, the proxy map may not. The worker answers the claim → fulfill.
- During a test that never calls `route()`: extra claim RTT on every unmatched Node request, then `matches.length === 0` → passthrough. That is the same cost tests **with** any route already pay today (claims are not pre-filtered by URL). Acceptable. Document in troubleshooting if anyone profiles “first-party HTTP got slower in tests that only import the fixture.”
- Between tests (`tests` empty): keep immediate passthrough. Do not wait for the next `test:register` here — that is §7.

Apply the same rule to WebSocket claims.

**Do not** add a blanket “grace sleep then passthrough” on every unmatched request. That would delay legitimate passthrough (first-party HTTP, CDN smokes) on every call.

Mark this `DIVERGENCE`: Playwright never has a coordinator cache that can lag the handler list. We claim from the worker when the cache is empty but a test is live so a 1ms race cannot become a live HTTP call.

---

## 7. P1: teardown and new requests after unregister

After `test:unregister`:

- Keep aborting pending requests already attributed to that test (already implemented).
- **New** `request:start` with empty `tests` + empty `routes` still passthroughs today.

Once dispose **awaits** unregister ack, the next test’s `test:register` is less likely to overlap, but SDK retries can outlive the test by seconds.

Minimum P1 (same PR if the tests are small):

1. Await unregister acks in `dispose()` (already in §5.2).
2. Library test: delayed `test:unregister` + a fetch that started **before** dispose still gets `decision:error`, not passthrough.
3. Document that retries **started after** the test ends are unmatched traffic (passthrough unless follow-up fail-closed).

Optional P1 (only if it stays small): if a Node connection had a request owned by a test that just unregistered, do not immediate-passthrough further requests from that `clientId` until the next `test:register` **or** a short cap (well under `claimTimeoutMs`). This is easy to get wrong (stuck requests, delayed first-party HTTP). Prefer a follow-up unless the library test is obvious and the timeout is explicit on `ProxyConfig`.

---

## 8. Follow-up (not required to close #31): fail-closed unmatched

Passthrough-by-default is correct for local first-party HTTP (Supabase, the app’s own origin). It is unsafe for Stripe / Anthropic when a mock **should** have run.

A fixture option such as:

```ts
use: { backendMocksUnmatched: "passthrough" | "abort" }
```

or a per-host list is a **product addition** (`DIVERGENCE`, `clientId`-class). It needs docs, defaults that do not break oracle passthrough specs, and a decision about WebSockets. Track as a separate issue. It is a safety net, not the fix for “`route()` was not ready.”

---

## 9. Implementation order

1. **Red:** library delayed-register spec (+ TestSocket variant) + parity immediate-trigger case + delay hook.
2. **Protocol v3** + proxy acks after map mutation.
3. **`sendAndWait`** + `route` / `routeWebSocket` / `unroute` / fixture `test:register` / async `dispose`.
4. **Empty-map-but-tests-live claim** (HTTP + WS).
5. **Green:** library + `pnpm test:parity:browser` + `pnpm test:parity:node:full` + `pnpm typecheck` / `pnpm lint`.
6. **Docs:** [`documentation/guide/concepts.md`](../documentation/guide/concepts.md) (route is ready when `await` resolves), [`documentation/guide/troubleshooting.md`](../documentation/guide/troubleshooting.md) (passthrough no longer means “matcher missed” only — also check history timestamps vs `route()`), [`documentation/api/backend-mocks.md`](../documentation/api/backend-mocks.md) if we document readiness. Protocol README / version if we mention v3 anywhere public.
7. **P1 teardown tests** if still in this PR.

Keep diffs close to Playwright. New wait helpers live next to `connection.ts` / fixture setup, not a new coordinator abstraction.

---

## 10. Verification matrix

After the implementation PR (not this plan PR):

| Check | Command / assertion |
| --- | --- |
| Library race specs | `pnpm test:library` — delayed register + in-flight-during-await + WS analogue |
| Existing library | Same command — disconnect, ambiguous, clientId, wire passthrough, observability must stay green |
| Oracle | `pnpm test:parity:browser` |
| Library mode oracle | `pnpm test:parity:node:full` |
| Types / lint | `pnpm typecheck` and `pnpm lint` |
| History | Race tests assert `outcome.kind !== "passthrough"` (fulfill/abort/error as appropriate) |
| Intentional passthrough | `https-cdn-passthrough` and parity `passthrough.spec.ts` still reach real/upstream when **no** route exists |
| `ambiguous_route` | Still loud when two **tests** claim; empty-map claim must not invent a second owner |

No browser UI in this bug; evidence is test output + REST history, not a dashboard walkthrough (observability must keep recording the new outcomes, not change routing — [`research/observability-system-plan.md`](./observability-system-plan.md)).

---

## 11. Risks

- **Protocol bump:** mixed 0.1.6 Playwright package + new proxy (or the reverse) will fail hello with `protocol_mismatch`. That is desired. Release the workspace packages together.
- **Claim RTT for tests that never `route()`:** §6. Watch library and parity passthrough timings; do not add a sleep.
- **Ack timeout vs hung proxy:** `route()` should throw with a clear message (worker id / routeId), not hang the test until Playwright’s 30s timeout with no hint.
- **`TestSocket` helpers:** every library spec that sends `route:register` may need to tolerate (or wait for) acks if the proxy always sends them. Update `TestSocket` to ignore unknown types or auto-ack-wait so existing specs do not flake on extra messages.
- **Do not** treat `https-cdn-passthrough` 401 as a mock miss.

---

## 12. Suggested commit split (implementation PR)

1. `test: add delayed route:register race coverage for issue 31`
2. `feat: ack route and test registration on the proxy protocol`
3. `fix: claim from live tests when the proxy route map is empty`
4. `docs: document backendMocks.route readiness`

Keep the plan doc in this file; do not duplicate it into `PHILOSOPHY.md`. If implementation drifts, update **this** file.
