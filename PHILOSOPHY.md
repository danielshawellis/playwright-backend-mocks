# Development Philosophy

How this repository is developed. This document is the developer’s north star. Product detail: [`SPECIFICATION.md`](./SPECIFICATION.md). Homepage framing: [`documentation/index.md`](./documentation/index.md), [`documentation/guide/why.md`](./documentation/guide/why.md).

Further development assertions follow. Start here.

---

## Intention

**Run the real app. Mock only the outside world.**

Good e2e tests cover the whole application — UI and server — and fake third parties at the boundary. In practice Playwright suites rarely do that: browser `page.route` cannot see outbound Node HTTP, so teams stub the server, hit real services, or plant test seams in app code.

This library makes the server half as easy as the browser half: a Playwright-shaped `backendMocks` API, nearly exact parity with Playwright interception, and no test litter in your Node.js code.

---

## 1. Playwright is the oracle

We practice test-driven development against **Playwright itself**.

Before (and while) implementing this library, we write a **complete** end-to-end suite against Playwright’s own network DX — for every API we intend to mirror: matching, fulfill / continue / fetch / abort, inspection and spying, record / replay, WebSockets, and the rest.

Completeness is the point. Happy paths are not enough. Edge cases, awkward semantics, and lesser-used options belong in the suite too. Sparse coverage defeats oracle TDD.

That suite is the developer-experience contract. It pins Playwright’s behavior in executable form. The same tests are reused as we implement the library: only the downstream actor changes (browser → Node). The library is done for a surface when those tests pass against it.

Scope the suite to the APIs we will develop analogously — not all of Playwright, but all of the contract we claim.

The living suite is [`tests/parity/`](./tests/parity/). Details: [`research/playwright-parity-tdd.md`](./research/playwright-parity-tdd.md).

---

## 2. One suite, two fixtures, switchable downstream

Parity tests drive a **downstream** process that talks to an **upstream** process (always Node).

| Mode    | Downstream                         | Routing API under test      |
| ------- | ---------------------------------- | --------------------------- |
| Oracle  | Browser                            | Playwright (`page.route`, …) |
| Library | Same downstream logic, hosted in Node | `backendMocks`              |

Share the downstream code. Put a **thin harness** in front so tests do not care which host is running. Upstream stays fixed. Specs stay fixed. Only the downstream host and routing handle switch.

Living layout: [`tests/parity/`](./tests/parity/), [`fixtures/downstream/`](./fixtures/downstream/), [`tests/parity/downstream.md`](./tests/parity/downstream.md).

---

## 3. Complete parity with Playwright interception

For HTTP (Ajax and outbound requests generally) and WebSockets, this library should work the same way as Playwright’s interception APIs — same semantics, same options, same awkward edges.

Exceptions are a **narrow, deliberate set**, not a soft “mostly like Playwright”:

- **Browser-only concerns** that have no Node analogue (e.g. the cookie jar, CORS auto-headers, navigation quirks).
- **Small library additions** required by Node / multi-process reality (e.g. `clientId` on matchers).

Outside that set: complete parity. Do not invent divergent behavior for convenience.

Boundary detail: [`research/rewrite-specification.md`](./research/rewrite-specification.md) §4.

---

## 4. Code tracks Playwright one-to-one

Because the DX is one-to-one, the implementation should stay as close as practical to Playwright’s.

Keep the analogous Playwright core beside you while coding. Align naming, layering, and control flow deliberately. Do not invent a parallel design where a Playwright-shaped one exists. Do not vendor Playwright source — reimplement against the pinned revision.

### Reference and divergence comments

Every module that mirrors Playwright must make the mapping obvious in source:

1. **Link the Playwright file(s).** At the top of the module (and on non-obvious local analogues), comment the exact GitHub blob URL(s) at the pinned Playwright SHA — path plus revision, not a floating `main` link. Example shape:

   ```ts
   // Playwright: https://github.com/microsoft/playwright/blob/<pinned-sha>/packages/playwright-core/src/client/network.ts
   ```

2. **Mark divergences in a searchable way.** Where we intentionally differ, use an all-caps `DIVERGENCE` comment (and close the span with `DIVERGENCE END` when it covers a block). State *what* differs and *why* in one or two lines:

   ```ts
   // DIVERGENCE: Playwright scopes routes to a page; we scope to Node + testId.
   // Fail loud on multi-test claim instead of page-local LIFO.
   ...
   // DIVERGENCE END
   ```

No silent drift. If the code is not following Playwright, the comment must say so. Pins and module map: [`research/playwright-network-parity.md`](./research/playwright-network-parity.md).

---

## 5. Concurrent tests must not share a route match

Playwright’s interception is scoped to a page (and thus to one test at a time). Ours is scoped to Node.js processes that often serve many tests concurrently.

If an outbound Node request (or WebSocket) matches route registrations from **two different tests**, fail loudly — do not guess an owner. That ambiguity is a test-architecture bug, not a silent race to paper over.

The intended developer experience is an architecture where this cannot (or virtually never) happen: isolate traffic per test, use matchers / `clientId` / process boundaries deliberately, and treat `ambiguous_route` as a signal to fix the setup rather than as ambient flakiness.
