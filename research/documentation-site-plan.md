# Documentation Site Plan (VitePress rewrite)

Plan for a clean VitePress documentation site for the rewritten library. Historical site lives at [`historical/documentation/`](../historical/documentation/) and is reference-only.

**Related sources of truth**

| Source | Role |
| ------ | ---- |
| [`PHILOSOPHY.md`](../PHILOSOPHY.md) | Product intention, architecture, parity rules |
| [`rewrite-specification.md`](./rewrite-specification.md) | In-scope APIs, divergences, WS caveats |
| [`tests/parity/`](../tests/parity/) | Executable DX contract |
| Playwright docs map (§9 below) | Structure to mirror for parity APIs |

---

## 1. Goals

1. **Ship a living docs site** at `documentation/` (new tree; not under `historical/`).
2. **Keep homepage content and wins** from the prototype: persuasive narrative, Mock/Spy/Modify/Abort code groups, architecture mermaid, compatibility story, getting-started CTA.
3. **Make content editable** — prefer Markdown over a monolithic Vue homepage.
4. **Mirror Playwright’s network docs IA** for every API we claim parity with.
5. **Communicate philosophy** as first-class product docs (not only a GitHub markdown file).
6. **Document product-only surfaces** clearly: `clientId`, multi-process, `ambiguous_route`, proxy/dashboard, WS global-only caveat.

Non-goals for v1 of the new site:

- Auto-generating API reference from TypeScript (nice later; hand-written Playwright-shaped pages first).
- Porting every historical recipe/reference page verbatim without rewriting for today’s API.
- Replacing Playwright’s own docs — we link out where browser-only guidance applies.

---

## 2. Historical site audit (what to keep / change)

### What worked

| Piece | Location | Keep? |
| ----- | -------- | ----- |
| Mermaid via ` ```mermaid ` fence → `MermaidDiagram.vue` | theme + markdown config | **Yes** — clean authoring in guides |
| Homepage Mock / Spy / Modify / Abort tabs | `HomeCodeGroup.vue` | **Yes in spirit** — prefer native VitePress `::: code-group` in Markdown |
| Homepage narrative + examples | `HomePage.vue` | **Keep content**, move into Markdown |
| Logo cloud / dashboard video | Vue components | **Yes as thin components** |
| Guide / recipes / reference split | sidebar | **Restructure** toward Playwright-shaped guides + product sections |
| Why / concepts / getting started | guide pages | **Yes**, rewrite against `PHILOSOPHY.md` + current packages |

### What was messy

1. **Homepage is almost entirely Vue.** `index.md` only holds hero frontmatter; body is injected via the `home-hero-after` slot into a large `HomePage.vue` with code strings in `<script setup>`. Hard to edit, hard to review in PRs, duplicates Markdown highlighting.
2. **Custom Shiki path** (`HighlightedCode.vue`) for homepage blocks instead of VitePress’s built-in highlighter / code groups.
3. **Content drift disclaimer** already present on why/concepts — expected after the rewrite; new site should track living packages.
4. **IA mixes** “how to use Playwright-like APIs”, “architecture concepts”, and “proxy REST/protocol” without a clear “parity guides vs product ops” boundary.
5. **WebSockets / HAR / fallback** under-documented relative to today’s rewritten surface.

### VitePress homepage options (decision)

VitePress supports **Markdown below `layout: home` frontmatter**, and now auto-styles that content (opt out with `markdownStyles: false`).

**Recommended hybrid:**

| Layer | Mechanism |
| ----- | --------- |
| Hero | YAML frontmatter (`hero.name` / `text` / `tagline` / `actions`) — keep the current messaging |
| Most homepage body | Markdown in `index.md` (headings, leads, fenced code, `::: code-group`, mermaid) |
| Special widgets only | Small Vue components imported in Markdown (`<LogoCloud />`, optional dashboard video) |

Do **not** recreate a 300-line `HomePage.vue` unless a section cannot be expressed in Markdown. Avoid `markdownStyles: false` unless a specific section needs a custom layout shell.

Native VitePress code groups:

````md
::: code-group

```ts [Mock]
await backendMocks.route(/* ... */);
```

```ts [Spy]
const pending = backendMocks.waitForRequest(/* ... */);
```

:::
````

That preserves the homepage win without a custom tab component. Keep a tiny `HomeCodeGroup` only if we need homepage-specific chrome that `::: code-group` cannot match.

---

## 3. Site layout on disk

```text
documentation/
  package.json                 # vitepress + mermaid (+ iconify if logo cloud kept)
  index.md                     # home: frontmatter hero + markdown body
  public/                      # logos, demo video, favicon
  .vitepress/
    config.ts
    theme/
      index.ts                 # extend default theme; register Mermaid + widgets
      custom.css
      components/
        MermaidDiagram.vue     # port from historical (proven)
        LogoCloud.vue          # optional, thin
        DashboardDemo.vue      # optional video/placeholder
  guide/
    getting-started.md
    philosophy.md              # why + intention (user-facing PHILOSOPHY)
    concepts.md
    network-mocking.md         # overview ~ Playwright Network + Mock APIs
    matching.md
    mock-responses.md          # fulfill
    modify-and-passthrough.md  # continue / fallback / fetch
    abort-and-failures.md
    spying-and-waiting.md      # waitForRequest/Response, requests()
    har.md                     # routeFromHAR
    websockets.md              # routeWebSocket + loud global-only caveat
    multi-process.md           # clientId, ambiguous_route
    configuration.md
    limitations.md
    troubleshooting.md
  recipes/
    compose-fixtures.md
    modify-upstream.md
    network-failures.md
    scope-by-client.md
    # add as needed: har-update, websocket-mock, etc.
  api/
    backend-mocks.md           # fixture surface
    route.md
    request.md
    response.md
    websocket-route.md
    node.md                    # startBackendMocks
    matchers.md
  ops/                         # product/ops (not Playwright-shaped)
    proxy.md
    rest-api.md
    dashboard.md               # if still shipping
    errors.md
    protocol.md                # advanced / contributors
```

Package name suggestion: keep product title **Playwright Backend Mocks**; packages remain `@playwright-backend-mocks/*`.

Wire into the monorepo with a root script (e.g. `docs:dev` / `docs:build`) and a `documentation` workspace package. Do not wire `historical/documentation`.

---

## 4. Information architecture (sidebar)

Mirror Playwright’s mental model: **Guides for workflows**, **API for class-shaped reference**, plus our product layers.

### Nav

- Guide
- API
- Recipes
- GitHub

### Sidebar: Guide

**Introduction**

1. Getting started
2. Philosophy (why this library)
3. Concepts (three processes, claim/settle, passthrough)

**Mocking Node HTTP** (Playwright-parity surface)

4. Network mocking overview
5. Matching requests
6. Mocking responses (`fulfill`)
7. Passthrough & modification (`continue` / `fallback` / `fetch`)
8. Aborting & simulating failures
9. Spying & waiting
10. Record & replay (HAR)

**WebSockets**

11. Mocking WebSockets *(lead with global-only caveat — rewrite-spec §4)*

**Product / ops**

12. Multiple processes & `clientId`
13. Configuration
14. Limitations & divergences
15. Troubleshooting

### Sidebar: API

- `backendMocks` (fixture)
- `Route`
- `Request`
- `Response`
- `WebSocketRoute`
- Matchers & options
- `startBackendMocks` (Node)
- Worker options / config types

### Sidebar: Recipes

Short, task-oriented pages (compose fixtures, patch upstream JSON, fail payments, isolate by `clientId`, HAR update loop, WS mock chat, etc.).

### Sidebar: Operations (optional top-level or under Guide)

Proxy CLI, REST history/connections, dashboard, error codes, protocol (contributor-facing; can stay collapsed).

---

## 5. Content plan by page

### 5.1 Homepage (`index.md`)

**Keep** the historical section arc (copy can be lightly edited):

1. Hero — “Run the real app. Mock only the outside world.”
2. Intro example — Stripe decline / checkout
3. Familiar API — code group: Mock | Spy | Modify | Abort
4. Node setup — `startBackendMocks` no-op without proxy URL
5. Compatibility — logo cloud (HTTP clients / frameworks)
6. Architecture — three pillars + mermaid sequence
7. Observability — dashboard demo (if still productized; otherwise REST history)
8. CTA — Get started / Philosophy

Hero stays in frontmatter. Body in Markdown. Philosophy link should point at `/guide/philosophy`, not only GitHub `PHILOSOPHY.md`.

### 5.2 Getting started

Update historical four-step flow against **today’s** packages:

1. Start proxy (`webServer` + health URL)
2. `startBackendMocks` in app (`clientId`, env-gated)
3. Compose / import Playwright fixture
4. First `backendMocks.route` + `fulfill`

Prereqs: Node 20+, pinned Playwright line matching the library. Mention WS only as a later guide (avoid burying the HTTP happy path). Link Concepts + Limitations.

### 5.3 Philosophy

User-facing synthesis of [`PHILOSOPHY.md`](../PHILOSOPHY.md):

- Intention: real app, mock outside world
- Why Playwright alone is not enough for Node outbound traffic
- Architecture sketch (mermaid)
- Playwright-as-oracle / complete parity (narrow exceptions)
- Concurrent tests must not share a route match (`ambiguous_route`)
- Link to development docs for contributors; this page is for adopters

Historical `why.md` is a good draft; rewrite so it does not say the site “may lag the rewrite.”

### 5.4 Concepts

Three roles, packages table, route lifecycle, claim outcomes (0 / 1 / >1 tests), passthrough default, worker vs test scope. Include WebSocket as a second path with the same proxy topology.

### 5.5 Parity guides ↔ Playwright pages

Each guide should:

- Teach the **same workflows** as Playwright’s Network / Mock APIs docs
- Use `backendMocks` instead of `page` / `context`
- Call out **divergences** in a short callout (`clientId`, no cookie jar, WS global-only, etc.)
- Link the matching Playwright URL for readers who already know the browser API

| Our guide | Primary Playwright sources |
| --------- | -------------------------- |
| Network mocking overview | [Network](https://playwright.dev/docs/network), [Mock APIs](https://playwright.dev/docs/mock) |
| Matching | Network (globs), Route / Page.route API |
| Mock responses | Mock APIs + [Route.fulfill](https://playwright.dev/docs/api/class-route) |
| Modify / passthrough | Network + Route.continue / fallback / fetch |
| Abort / failures | Network abort + [Emulation offline](https://playwright.dev/docs/emulation) (analog notes) |
| Spying & waiting | Network + [Events](https://playwright.dev/docs/events) + waitForRequest/Response |
| HAR | Mock APIs `routeFromHAR` + HAR options on Page/Context |
| WebSockets | Mock APIs WS section + [WebSocketRoute](https://playwright.dev/docs/api/class-websocketroute) |

### 5.6 API reference pages

Playwright-shaped: one page per class-like surface, with method tables and examples. Prefer documenting **guaranteed** methods from `packages/playwright/src/types.ts` / Node exports — not aspirational APIs.

Document intentional divergences next to the method (same spirit as `DIVERGENCE` in source).

Out of scope for API docs (per rewrite spec): `page.request` / `APIRequestContext` as a general client, cookie jar, service workers, navigation quirks.

### 5.7 Limitations

Must cover:

- Browser-only concerns with no Node analogue
- WebSocket: **`globalThis.WebSocket` only** (loud; also on the WS guide)
- Cross-test `ambiguous_route`
- Interception surface of `@mswjs/interceptors`
- HAR gaps called out in rewrite-spec (zip attach / navigation rewrite, etc.)

---

## 6. Mermaid (site-wide, Markdown-native)

### Does VitePress include Mermaid?

**No.** VitePress has no built-in Mermaid renderer. An [official-support request](https://github.com/vuejs/vitepress/issues/5222) is still open (as of mid-2026); maintainers have pushed back mainly because `mermaid` is a large dependency. Expect to bring our own integration for the foreseeable future.

### Community option

The most common third-party path is [`vitepress-plugin-mermaid`](https://github.com/emersonbottero/vitepress-plugin-mermaid) (`withMermaid(...)` wrapper + fenced ` ```mermaid ` blocks). It is popular enough, but has had pnpm / Vite `optimizeDeps` friction in the wild, and it is another moving dependency on top of VitePress + Mermaid.

### Recommended approach: small first-party fence → Vue component

We already solved the authoring UX we want in the historical site, and it is **already reusable on every Markdown page**:

1. **Markdown-it fence override** in `.vitepress/config.ts` — when `token.info === "mermaid"`, emit `<MermaidDiagram code="..." />` instead of a code block.
2. **`MermaidDiagram.vue`** — client-side `mermaid.render`, listens to VitePress `isDark`, shows a readable error if a diagram fails.
3. **Authors write ordinary fences anywhere:**

   ````md
   ```mermaid
   sequenceDiagram
     participant App
     participant Proxy
     App->>Proxy: claim
   ```
   ````

Historical proof points: `guide/concepts.md`, `guide/why.md`, plus the homepage (which also passed diagram source into the same component). No per-page imports required once the component is registered in `enhanceApp`.

**Why prefer first-party over the plugin for this repo**

| | First-party (port historical) | `vitepress-plugin-mermaid` |
| - | ----------------------------- | -------------------------- |
| Authoring | Same ` ```mermaid ` fences | Same |
| Dark/light | Full control (we already tune themeVariables) | Auto “dark in name” heuristic |
| Dependencies | Just `mermaid` | Plugin + `mermaid` (+ occasional Vite alias workarounds) |
| Proven here | Yes | Not yet |
| Size / ownership | Tiny (~config hook + one Vue SFC) | External maintenance |

**Decision:** Phase A ports the historical Mermaid integration into the new `documentation/` theme as the **standard site capability**. Do not use ad-hoc `<MermaidDiagram>` only on the homepage; the fence path is the product.

Optional later: if VitePress ships official/peer Mermaid support, delete our fence hook and keep the Markdown unchanged.

### Implementation checklist (Mermaid)

1. Depend on `mermaid` in the docs package (dynamic `import()` so it stays out of the critical path where possible).
2. Port `MermaidDiagram.vue` + fence override from `historical/documentation/.vitepress/`.
3. Register the component globally in the theme.
4. Port/adapt CSS for diagram centering and error state.
5. Smoke-test: at least one diagram on the homepage and one on a guide page; toggle dark mode; break a diagram deliberately and confirm the page still renders with an error message.
6. Document the authoring rule once in a short internal note (or docs README): “use ` ```mermaid ` fences; do not paste SVG.”

Homepage may still pass a string prop into `<MermaidDiagram>` if a Vue-only section needs it, but Markdown fences are the default everywhere else.

---

## 7. Theme & authoring conventions

### Keep from historical

1. **Mermaid** — see §6 (site-wide fence → `MermaidDiagram`).
2. **Local search**, `cleanUrls`, `lastUpdated`, edit links (point at `documentation/:path`).
3. **Outline** levels 2–3.

### Prefer native VitePress

1. `::: code-group` for tabbed examples (homepage + guides).
2. `::: tip` / `::: warning` / `::: danger` for caveats (especially WS and `ambiguous_route`).
3. Markdown homepage body instead of slot-injected mega-component.
4. Built-in syntax highlighting (drop homepage-only Shiki wrapper unless filename chrome is worth a tiny component).

### CSS

Port and simplify `custom.css` for homepage sections. Avoid rebuilding the whole visual system in the first PR — content structure first, polish second. Respect existing brand (logo SVG at repo root) rather than inventing a new aesthetic stack.

### Components allowed on day one

| Component | Why |
| --------- | --- |
| `MermaidDiagram.vue` | Site-wide Mermaid via Markdown fences (§6) |
| `LogoCloud.vue` | Homepage compatibility strip |
| `DashboardDemo.vue` | Optional media; skip if dashboard not shipping yet |

No `HomePage.vue` mega-component.

---

## 8. Implementation phases

### Phase A — Scaffold (no full content rewrite)

1. Add `documentation/` VitePress package + root scripts.
2. Port theme: site-wide Mermaid fence integration (§6), minimal CSS, logo.
3. Homepage: frontmatter hero + Markdown port of historical sections (code-group native).
4. Stub sidebar pages with titles + “TODO” one-liners so IA is reviewable.
5. CI job or script for `vitepress build`.

### Phase B — Core narrative

1. Getting started (accurate for rewrite packages).
2. Philosophy + Concepts.
3. Limitations / divergences.
4. Configuration + multi-process.

### Phase C — Playwright-parity guides + API

1. Write guides in the Network / Mock APIs order (§5.5).
2. Write API pages for `backendMocks`, Route, Request, Response, WebSocketRoute, Node agent.
3. Cross-link Playwright URLs and our parity suite where helpful (“behavior pinned by `tests/parity`”).

### Phase D — Recipes + ops

1. Port/update high-value recipes.
2. Proxy / REST / errors; dashboard only if still a product surface.
3. Trim or omit protocol docs from primary nav (link from ops/advanced).

### Phase E — Polish

1. Dashboard demo asset if applicable.
2. Edit-link / base URL / deployment (GitHub Pages or equivalent).
3. Pass over homepage against design rules when doing visual polish (brand-first hero, etc.).

---

## 9. Playwright documentation map (research)

Verified against `https://playwright.dev/docs/` (stable docs). Playwright’s surface is larger than ours; we mirror only pages relevant to interception parity.

### 9.1 Guide pages

| URL | Description | Key APIs / concepts |
| --- | ----------- | ------------------- |
| https://playwright.dev/docs/network | Main networking guide: monitor, mock, modify, abort, wait, globs, WS observe, service-worker notes | `page.route`, `browserContext.route`, `fulfill` / `continue` / `abort` / `fetch`, wait/on request/response, globs, `websocket` events |
| https://playwright.dev/docs/mock | Tutorial-style mocking: mock/patch APIs, HAR record/replay, CLI HAR, WebSocket mocking | `route.fulfill`, `route.fetch` + patch, `routeFromHAR`, HAR update/strict, `routeWebSocket` / `WebSocketRoute` |
| https://playwright.dev/docs/api-testing | API testing from Node/UI tests; shared request context; routing with `request.fetch` | `APIRequestContext`, `page.request`, fulfill from fetched response |
| https://playwright.dev/docs/service-workers | How SWs interact with routing/events; blocking SWs for predictable mocks | `serviceWorkers: 'block'`, SW-owned requests *(mostly out of scope for us)* |
| https://playwright.dev/docs/emulation | Includes offline / network failure emulation via config | `offline: true` |
| https://playwright.dev/docs/events | Listening/waiting patterns including request spies | `waitForRequest`, `on('request')`, listener cleanup |
| https://playwright.dev/docs/test-use-options | Test config for headers, auth, proxy, offline, SW | `extraHTTPHeaders`, `offline`, `proxy`, … |
| https://playwright.dev/docs/test-assertions | Polling / API response assertions | `expect.poll`, `toBeOK()` |

### 9.2 API reference pages

| URL | Description | Key APIs / concepts |
| --- | ----------- | ------------------- |
| https://playwright.dev/docs/api/class-route | Route settle object | `abort`, `continue`, `fallback`, `fetch`, `fulfill`, `request`, handler order |
| https://playwright.dev/docs/api/class-page | Page-scoped routing, HAR, WS route, waits, events | `route`, `routeFromHAR`, `routeWebSocket`, `unroute`, `unrouteAll`, `waitForRequest` / `waitForResponse` |
| https://playwright.dev/docs/api/class-browsercontext | Context-scoped routing across pages | same route/HAR/WS family + `setOffline` |
| https://playwright.dev/docs/api/class-request | Request inspection model | url/method/headers/postData, resourceType, failure, redirects, timing |
| https://playwright.dev/docs/api/class-response | Browser response inspection | status/headers/body/json, `fromServiceWorker`, … |
| https://playwright.dev/docs/api/class-websocketroute | WS mock/intercept handle | `connectToServer`, `onMessage`, `send`, `close`, … |
| https://playwright.dev/docs/api/class-websocket | WS observation (frames/events) | `framesent` / `framereceived`, `waitForEvent` |
| https://playwright.dev/docs/api/class-apirequestcontext | Programmatic HTTP client used with fetch/fulfill patterns | `fetch` / `get` / `post`, … *(initiation client mostly out of scope)* |
| https://playwright.dev/docs/api/class-apirequest | Factory for API request contexts | `newContext` |
| https://playwright.dev/docs/api/class-apiresponse | Response from APIRequestContext / route.fetch | status/body/json/dispose |
| https://playwright.dev/docs/api/class-browser | Context creation incl. `recordHar` | HAR recording options |
| https://playwright.dev/docs/api/class-browsertype | Persistent context + `recordHar` | HAR options |
| https://playwright.dev/docs/api/class-tracing | `startHar` / `stopHar` | HAR via tracing |
| https://playwright.dev/docs/api/class-testoptions | Config knobs for network-ish behavior | offline, proxy, headers, SW |
| https://playwright.dev/docs/api/class-apiresponseassertions | `expect(response).toBeOK()` | assertions |

### 9.3 Adjacent pages

| URL | Notes |
| --- | ----- |
| https://playwright.dev/docs/test-cli | CLI; HAR save recipes live mainly on Mock APIs |
| https://playwright.dev/docs/test-components | Mentions `page.route` + blocking SWs |
| https://playwright.dev/docs/release-notes | Version history only |

### 9.4 Mapping Playwright IA → our site

Playwright splits **Network** (broad guide) vs **Mock APIs** (tutorial + HAR + WS). We should:

1. Provide one **overview** that combines “observe / match / settle” (our Concepts + Network mocking overview).
2. Split deep guides by **action** (fulfill / continue-fetch / abort / spy / HAR / WS) — easier to maintain and closer to how people scan Mock APIs.
3. Keep **API class pages** parallel to Route / Request / Response / WebSocketRoute, namespaced under `backendMocks`.
4. Add **product pages** Playwright does not need: Node agent, proxy ownership, `clientId`, `ambiguous_route`.
5. Treat Playwright **API testing / APIRequestContext** pages as adjacent only where we document `route.fetch` + fulfill-from-response — not as a general HTTP client docs section.
6. Treat **service worker** docs as explicit non-goals / limitations links.

---

## 10. Current library surface to document (checklist)

From `packages/playwright` + Node agent (rewrite):

**HTTP**

- [x] `route` / `unroute` / `unrouteAll`
- [x] `fulfill` / `continue` / `abort` / `fallback` / `fetch`
- [x] Matchers: glob, RegExp, predicate, URLPattern; object `{ url, method, clientId }`
- [x] `times`, LIFO + fallback overrides
- [x] `waitForRequest` / `waitForResponse`
- [x] `requests()` history helper
- [x] `routeFromHAR` (+ update / notFound / updateMode / updateContent)
- [x] Request / Response inspection helpers used by the oracle

**WebSockets**

- [x] `routeWebSocket` + `WebSocketRoute` (`onMessage` / `send` / `close` / `connectToServer` / …)
- [ ] Docs must lead with global-only caveat

**Product**

- [x] `startBackendMocks` / proxy URL no-op
- [x] `clientId`
- [x] `ambiguous_route` / `takeErrors`
- [x] Proxy history / connections REST (as applicable)
- [ ] Dashboard — document only if still shipped in rewrite

---

## 11. Open decisions (resolve during Phase A/B)

1. **Package / site base path** — GitHub Pages base, custom domain, or docs package path.
2. **Dashboard** — first-class homepage section vs ops-only vs deferred.
3. **API reference generation** — hand-written v1 vs typedoc later.
4. **Contributor vs user docs** — keep `PHILOSOPHY.md` / `research/*` in-repo for agents; site pages are the user-facing layer (can deep-link to GitHub for contributors).
5. **Naming of philosophy page** — `philosophy.md` vs `why.md` (recommend `philosophy` to align with repo vocabulary; “Why” can be the H1).

---

## 12. Success criteria

- Homepage content is mostly Markdown-editable; special UI is isolated components.
- Mermaid works site-wide from ordinary ` ```mermaid ` fences (homepage + guides), with dark/light re-render.
- Code groups work on homepage and in guides without a one-off highlighter stack.
- Getting started runs against the rewritten packages.
- Philosophy/intention is a primary nav page, consistent with `PHILOSOPHY.md`.
- Every in-scope parity API has a guide section and an API reference entry, structured like Playwright’s network docs.
- WS and other divergences are impossible to miss.
- `historical/documentation` remains archive-only.
