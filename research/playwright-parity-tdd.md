# Playwright Parity via Oracle-Suite TDD

## Goal

Achieve near-complete behavioral parity with Playwright’s browser request-routing APIs (`page.route` / `context.route`, fulfill / continue / fetch / abort, matchers, unroute, inspection / spying, and HAR-style record-replay) for **outbound Node.js HTTP**, without inventing a divergent DX.

The strategy: **write the parity suite against Playwright itself first**, then switch the same suite onto this library with only a thin adapter change.

## Why this works

Playwright Backend Mocks is intentionally shaped like Playwright’s Ajax-routing API. That means Playwright can act as the **behavioral oracle**:

1. Playwright already defines the expected developer contract.
2. A suite that passes against Playwright documents “correct” behavior in executable form.
3. Once that suite exists, the library’s job is to make the same assertions pass when the _downstream_ actor changes from browser → Node server.

This is TDD with an external reference implementation, not TDD against imagined behavior.

## Core metaphor: same topology, swapped downstream

Both phases share the same abstract shape:

```text
Test author
  → routing API  (page.route  OR  backendMocks.route)
  → downstream process that issues HTTP
  → upstream fake server
```

| Role                        | Phase A (Playwright oracle)                                                              | Phase B (this library)                                             |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Routing API under test      | `page.route` / `context.route` / `routeFromHAR`                                          | `backendMocks.route` / `routeFromJSON`                             |
| Downstream (issues HTTP)    | Browser page / Ajax code                                                                 | Node app process (`fetch`, `node:http`, …) via `startBackendMocks` |
| Upstream (fake third party) | Same fake upstream server                                                                | Same fake upstream server                                          |
| What the test drives        | Browser actions that trigger Ajax                                                        | App endpoints that trigger outbound HTTP                           |
| What must stay stable       | Assertions about status, body, headers, abort, spy counts, cassette files, matcher rules | Same assertions                                                    |

The upstream fake is reused. The test intent is reused. Only the downstream host and the routing handle change.

```text
Phase A                         Phase B
───────                         ───────
Playwright test                 Playwright test
     │                               │
page.route(...)                 backendMocks.route(...)
     │                               │
Browser (Ajax)                  Node app (outbound HTTP)
     │                               │
Upstream fake  ───────────────► Upstream fake
```

## Phase A — Playwright oracle suite

Write tests **only against Playwright**, with none of this library involved.

### Fixture pieces

1. **Upstream fake**  
   A small local HTTP server representing third-party APIs (`/users`, `/charges`, echo endpoints, status/header variants, etc.). Reuse or evolve the existing `fixtures/upstream` idea.

2. **Downstream browser harness**  
   A minimal page (or pages) that can issue Ajax/`fetch`/XHR to the upstream on demand — e.g. buttons or query-driven routes like “GET /users”, “POST /charges with body”. This is the browser analogue of today’s `/via/fetch/...` fixture app.

3. **Playwright tests**  
   Specs that:
   - call `page.route` / `context.route` (and related APIs) using the public Playwright surface
   - trigger the browser harness
   - assert outcomes exactly as a careful Playwright user would

### Coverage target (parity surface)

Aim for a suite that is “fairly complete” for the APIs we intend to mirror:

- **Terminal actions:** `fulfill` (status / headers / body / json / path / response), `continue` (with overrides), `abort` (error codes)
- **Non-terminal:** `fetch` then modify / re-fulfill
- **Matchers:** glob, RegExp, predicate; method filters where applicable
- **Lifecycle:** `unroute`, handler ordering / last-registered-wins (or whatever Playwright’s actual rule is — the oracle suite locks it down), multiple handlers
- **Passthrough:** no route → real upstream
- **Inspection / spying:** `waitForRequest`, request lists / counts / bodies as exposed by Playwright patterns we choose to mirror
- **Record / replay:** `routeFromHAR` (or the closest Playwright primitive); later map to `routeFromJSON`
- **Failure modes:** no handler action, abort defaults, missing HAR/cassette entries, `notFound` behavior

The suite should encode **observed Playwright behavior**, including awkward edges. If Playwright does something surprising, that surprise becomes the parity target (or an explicit documented intentional difference — see below).

### Success criteria for Phase A

- Suite is green against stock Playwright + browser + shared upstream.
- Specs read like documentation: little harness glue, maximal public-API usage.
- No imports from `@playwright-backend-mocks/*`.

## Phase B — thin switchover onto this library

Change as little as possible so the same scenarios now exercise the library.

### What changes

| Piece                  | Change                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Import / fixture       | `page` routing → `backendMocks` from `@playwright-backend-mocks/playwright`                                             |
| Downstream             | Browser harness → Node fixture app(s) that call `startBackendMocks` (existing `fixtures/api-server` / `worker` pattern) |
| Trigger helper         | “click / evaluate fetch in page” → `callVia(request, transport, path)` (or a shared helper with two backends)           |
| Record/replay API name | `routeFromHAR` → `routeFromJSON` where that is the intentional analogue                                                 |
| Runner wiring          | Add proxy + Node env vars (`PLAYWRIGHT_BACKEND_MOCKS_*`) via Playwright `webServer` / config                            |

### What must not change

- Upstream fake implementation and URLs (as much as practical)
- Assertion bodies (status, headers, JSON shapes, abort outcomes, cassette/file expectations)
- Scenario names and narrative structure of the suite
- The habit of testing through the public DX only

### Adapter seam (keep it tiny)

Introduce a **thin dual-mode harness**, not a second parallel suite:

```ts
// Conceptual — name TBD
const { route, trigger, downstreamKind } = createParityHarness(mode);
// mode: "playwright-browser" | "backend-mocks"
```

Ideally the mode switch is config/env (e.g. `PARITY_MODE=browser|backend`) so the same files run in both phases. The harness may adapt:

- `route(...)` → `page.route` or `backendMocks.route`
- `trigger("GET", "/users")` → browser action or `callVia`
- optional: `routeFromRecording(path, opts)` → HAR vs JSON

If a dual-mode harness starts doing gymnastics, prefer **copy the suite once and apply a mechanical diff** over clever abstraction. The point is parity confidence, not a framework-in-a-framework.

## How this supports TDD going forward

Once Phase B is wired:

1. **Add a failing oracle case in browser mode** for a Playwright behavior you want to support next (or add it already knowing Playwright passes it).
2. **Run the same case in backend mode** — it fails until the library matches.
3. Implement the smallest library change that turns the backend-mode case green.
4. Keep both modes green in CI where practical (browser oracle as regression guard; backend mode as product suite).

For features Playwright does not have (e.g. `clientId` multi-process routing), keep them in a **library-only** sibling suite. Do not force them into the oracle suite.

## Intentional differences (document, don’t paper over)

Parity is “near complete,” not identical runtime semantics. The plan should maintain an explicit diff list, for example:

| Topic                      | Playwright (browser)      | This library (Node)             | Policy                                                |
| -------------------------- | ------------------------- | ------------------------------- | ----------------------------------------------------- |
| Target traffic             | Browser → network         | Node process → network          | By design                                             |
| Recording format           | HAR (`routeFromHAR`)      | JSON cassette (`routeFromJSON`) | Analogue; shared suite maps via adapter               |
| Multi-process / `clientId` | N/A (single page/context) | Supported                       | Library-only tests                                    |
| Transport matrix           | Browser fetch/XHR         | Node `fetch` / `http` / …       | Same scenarios, loop transports in backend mode       |
| Some abort / error codes   | Browser-specific          | Node client-specific mapping    | Document mapping; assert library’s published contract |

When backend mode cannot match Playwright, either:

- narrow the oracle assertion to the shared contract, or
- skip/mark that case in backend mode with a linked intentional-difference note,

…but do **not** silently weaken assertions.

## Relationship to existing tests

This plan complements, rather than replaces, the current pyramid:

| Layer                         | Role after this plan                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| `tests/unit`                  | Combinatorial helpers (matchers, body encoding, cassette parse)                         |
| `tests/contract`              | Wire protocol serialize/parse                                                           |
| Existing `tests/e2e`          | Full cross-process product confidence (proxy, agents, dashboard, security)              |
| **New parity / oracle suite** | Executable Playwright DX contract; browser mode = oracle, backend mode = product parity |

Existing e2e already follows “test the library by being its user.” The parity suite makes that stricter: **Playwright itself becomes the reference for what the user experience should be.**

Keep both if useful:

- Parity suite: API behavior vs Playwright
- Broader e2e: multi-process, proxy auth, disconnects, dashboard — topics outside browser `page.route`

## Simplicity constraints

Aligned with the project’s testing philosophy:

- Prefer broad, real tests over mocks of our own stack.
- Specs should look like user code; harness glue stays thin.
- No custom test runner — stock Playwright.
- Dual-mode adapter stays boring; if it grows smarts, delete it and maintain two thin entrypoints instead.
- Everything local; no public internet.
- Prefer built package outputs when running backend mode (same as today’s e2e).

## Suggested rollout

1. **Inventory** Playwright APIs/behaviors we claim to mirror; turn into a checklist.
2. **Build Phase A** oracle suite + browser harness + shared upstream; get it green.
3. **Extract trigger/route helpers** only where duplication hurts.
4. **Add Phase B mode** (Node downstream + `backendMocks`); expect many failures — that backlog _is_ the TDD queue.
5. **Drive library work** from failing parity cases; keep intentional-difference list honest.
6. **CI:** run browser oracle always; run backend parity on built packages; keep separate library-only e2e for non-Playwright concerns.

## One-sentence summary

Write a complete Playwright-against-Playwright request-routing suite with a fake upstream and a browser downstream, then switch the downstream to a Node app and the routing API to `backendMocks`, keeping assertions and upstream fixed, so Playwright itself becomes the oracle for developer-contract TDD.
