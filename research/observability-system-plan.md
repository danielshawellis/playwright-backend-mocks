# Observability System Plan

Plan for a read-only observability stack: proxy REST API, Vue dashboard package, and MCP server — kept in sync, documented, and tested.

**Status:** planning (this document). Implementation follows in the same product track after open questions are resolved (defaults proposed below).

**Related sources of truth**

| Source | Role |
| ------ | ---- |
| [`PHILOSOPHY.md`](../PHILOSOPHY.md) | Architecture; observability is library-only (outside oracle) |
| [`packages/proxy/`](../packages/proxy/) | Existing thin REST + HTTP history ring buffer |
| [`documentation/ops/rest-api.md`](../documentation/ops/rest-api.md) | Living REST docs (to expand) |
| [`historical/packages/dashboard/`](../historical/packages/dashboard/) | Archived Vue dashboard (feature/CLI reference, not visual source of truth) |
| [`historical/tests/e2e/specs/observability.spec.ts`](../historical/tests/e2e/specs/observability.spec.ts) | Historical observability e2e template |
| [`research/playwright-parity-tdd.md`](./playwright-parity-tdd.md) | Dashboard / REST = library-only, not parity oracle |

---

## 0. Cleaned requirements (from speech dump)

### Intent

Add a **read-only observability system** so humans and LLM agents can inspect all HTTP and WebSocket traffic coordinated by the proxy, including which test owned it and what action that test took.

### Deliverables

1. **REST API** inside `@playwright-backend-mocks/proxy` — expand today’s thin surface into the canonical read model.
2. **Separate Vue dashboard package** (`@playwright-backend-mocks/dashboard`) — optional process users install and point at the proxy URL.
3. **MCP server package** (`@playwright-backend-mocks/mcp`) — tools/resources that mirror the REST API so LLMs can query the same data.
4. **Docs** for REST routes, MCP setup, dashboard install/run (including Playwright `webServer`), and HAR downloads.
5. **Intent testing strategy** for REST, MCP, and dashboard (prefer Playwright where clean).

### Behavioral constraints

| Constraint | Detail |
| ---------- | ------ |
| Read-only | Observability never changes routing, claims, or settle decisions |
| In-memory | Proxy stores history in memory; cleared when the proxy process exits |
| Startup UX | On proxy start, print clear URLs: Node/test connection URL **and** dashboard connection URL |
| Separate UIs | Distinct HTTP and WebSocket views (connections + event timelines for WS; request/response timeline for HTTP) |
| Per-entry detail | Owning test (when known), action taken (`fulfill` / `continue` / `abort` / `passthrough` / errors), and test-produced response when mocked/modified |
| Search / filter | Time range + string inclusion; rank URL matches above body/header/event matches |
| HAR download | Export captured traffic as HAR (HTTP; WS handling TBD — see open questions) |
| Dashboard style | Match VitePress docs look; reuse VitePress CSS variables / theme tokens so declarative styles can be shared |
| Dashboard packaging | Standalone CLI; fine to run as an extra Playwright `webServer` |

### Explicit non-goals (v1)

- Persisting history across proxy restarts
- Mutating routes / forcing fulfills from dashboard or MCP
- Bundling the dashboard into the proxy binary (keep process separation; historical e2e asserted proxy does **not** serve `/dashboard`)
- Parity-oracle coverage (this is library-only product surface)

---

## 1. Current state (baseline)

| Area | Today |
| ---- | ----- |
| REST | `GET /health`, `/api/history`, `/api/connections` — no query filters |
| HTTP history | Ring buffer (`--history-limit`, default 1000); outcomes: `pending` / `mocked` / `passthrough` / `continued` / `aborted` / `error` |
| WebSocket history | **None** in store or REST (control plane exists in protocol) |
| Action detail | Outcome kind only; no explicit handler action timeline; `continued` response rarely filled; `fetch` intermediates not recorded |
| Test identity | `testId` / `routeId` on entries; richer diagnostics exist on wire (`title`, `file`, …) but not in history |
| Startup banner | Single `listening on http://…` log line |
| Dashboard | Archived only; dark IBM Plex theme ≠ VitePress |
| MCP | Does not exist |
| Tests | No living observability suite; historical e2e is the template |

---

## 2. Architecture

```text
┌─────────────────────┐     REST (read-only)      ┌──────────────────────┐
│  Vue dashboard      │◄──────────────────────────►│                      │
│  @…/dashboard       │                            │  Proxy               │
│  (port 4311)        │                            │  @…/proxy            │
└─────────────────────┘                            │  • coordinator /ws   │
                                                   │  • HistoryStore      │
┌─────────────────────┐     same REST shape        │  • REST /api/*       │
│  MCP server         │◄──────────────────────────►│                      │
│  @…/mcp (stdio)     │   (HTTP client → proxy)    └──────────────────────┘
└─────────────────────┘
         ▲
         │ MCP tools/resources
         │
   LLM host (Cursor, etc.)
```

**Single source of truth:** in-memory stores inside the proxy. Dashboard and MCP are thin clients. Prefer shared TypeScript types from `@playwright-backend-mocks/protocol` (and small shared query helpers if needed) so REST, MCP, and dashboard stay aligned.

**MCP implementation (2026):** official TypeScript server package `@modelcontextprotocol/server` (v2), typically **stdio** transport for local IDE hosts. The MCP process takes `--proxy-url` (like the dashboard) and calls the REST API; it does not embed the coordinator.

---

## 3. Data model extensions

### 3.1 HTTP history (enrich existing `HistoryEntry`)

Keep the existing entry id = `requestId`. Add fields (additive, protocol schemas):

| Field | Purpose |
| ----- | ------- |
| `action` | Normalized handler/coordinator action: `fulfill` \| `continue` \| `abort` \| `passthrough` \| `fetch` \| `error` \| `pending` |
| `test` | Optional `{ testId, title?, file?, workerId? }` when claim/match provides it |
| `response` | Final response when known (mocked, or continued+upstream when we choose to capture) |
| `error` | Structured error for abort/error outcomes |
| `overrides` | Request overrides when `continue` modified the request |
| `events` | Optional short timeline: `observed` → `claimed` → `handler:*` → `settled` (enough for UI “what happened”) |

`outcome.kind` remains for backward compatibility with current docs/clients; `action` is the clearer UI/MCP label.

### 3.2 WebSocket history (new)

New store, separate from HTTP ring buffer (own limit flag or shared budget — default: shared `--history-limit` split by kind, or `--ws-history-limit`; **proposal:** separate `--ws-history-limit` defaulting to `200` connections, each with capped event list).

```ts
type WsConnectionEntry = {
  id: string;                 // socketId
  timestamp: number;          // connection open observed
  clientId: string;
  url: string;
  protocols?: string[];
  test?: { testId; title?; file?; workerId? };
  routeId?: string;
  outcome: "pending" | "matched" | "passthrough" | "error";
  action?: "connect" | "passthrough" | "error" | …;
  closedAt?: number;
  close?: { code?; reason?; wasClean };
  events: WsTimelineEvent[];  // bounded
};

type WsTimelineEvent = {
  id: string;
  timestamp: number;
  direction: "client" | "server" | "system";
  kind: "open" | "frame" | "close" | "error" | "handler";
  // frame payload summary + optional bodyBase64 / text
  // handler: what the test did (forward, drop, send, close, …)
};
```

Exact handler verbs follow whatever the living WS protocol already emits (`ws:*` messages in `packages/protocol`).

### 3.3 Search ranking

Shared search function used by REST and MCP (dashboard calls REST):

1. Filter by `from` / `to` (epoch ms) if provided.
2. If `q` empty → chronological (newest first).
3. If `q` set → case-insensitive inclusion across fields; **score**:
   - URL / WS URL match → highest
   - method / status / test title / testId → high
   - headers → medium
   - body / frame payload → lower
4. Return scored results; stable tie-break by timestamp desc.

---

## 4. REST API design (proxy)

Base URL default: `http://127.0.0.1:4310`. CORS remains open for local dashboard origins. All observability routes are **GET** (plus `OPTIONS` preflight). Read-only.

### 4.1 Retain / extend

| Method | Path | Notes |
| ------ | ---- | ----- |
| `GET` | `/health` | Add optional `observability: true` or document existing fields; keep `ok`, `version`, `protocolVersion` |
| `GET` | `/api/connections` | Enrich with active WS socket counts if cheap; keep node/playwright lists |

### 4.2 HTTP

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/http` | List HTTP history (alias or replace `/api/history` — see open Q). Query: `q`, `from`, `to`, `testId`, `clientId`, `action`, `limit`, `offset` |
| `GET` | `/api/http/:id` | Single entry + full timeline/detail |
| `GET` | `/api/history` | **Deprecated alias** of `/api/http` for one release, or keep as synonym |

### 4.3 WebSockets

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/ws` | List WS connections. Same filter query params where applicable |
| `GET` | `/api/ws/:id` | Connection detail + event timeline |
| `GET` | `/api/ws/:id/events` | Events only (optional if detail is enough); supports `q`, `from`, `to` |

### 4.4 Export

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/export/har` | HAR 1.2 for HTTP entries (filterable by same query params) |
| `GET` | `/api/export/ws` | JSON export of WS connections + events (if HAR is HTTP-only) |

Content-Disposition filenames like `playwright-backend-mocks-YYYYMMDD.har`.

### 4.5 Startup banner

On listen, print a short block (not only one log line), e.g.:

```text
playwright-backend-mocks proxy

  Connect Node / Playwright:  ws://127.0.0.1:4310/ws
  REST API:                   http://127.0.0.1:4310
  Dashboard (separate pkg):   point @playwright-backend-mocks/dashboard at
                              http://127.0.0.1:4310
```

Exact wording TBD; must include **test/proxy connection URL** and **dashboard→proxy URL**.

---

## 5. Dashboard package

### 5.1 Package

- Path: `packages/dashboard`
- Name: `@playwright-backend-mocks/dashboard`
- Bin: `playwright-backend-mocks-dashboard`
- Flags (from historical, keep): `--host`, `--port` (default `4311`), `--proxy-url` (default `http://127.0.0.1:4310`)
- Serves SPA + `/config.json` `{ proxyUrl }` + `/health`

### 5.2 UI information architecture

Separate primary views (routes under the SPA; package is not mounted on the proxy):

| Route | Purpose |
| ----- | ------- |
| `/` | Lightweight overview: connection counts, recent activity, links |
| `/http` | HTTP timeline + search/time filters + detail drawer |
| `/ws` | WS connection list + per-connection event timeline + search |

Per HTTP row: method, URL, status/outcome, test label, action, duration, timestamp.  
Detail: request/response headers & bodies, action, owning test, overrides, timeline events.  
Per WS connection: URL, test, outcome, open/close; detail = bidirectional event timeline.  
Toolbar: search box, time range, HAR/export download buttons.

Polling every ~2s is fine for v1 (no SSE required). Live refresh must not reset selection/scroll awkwardly.

### 5.3 Styling (VitePress-aligned)

- Use VitePress CSS variables (`--vp-c-bg`, `--vp-c-brand-1`, `--vp-c-text-1`, `--vp-c-divider`, `--vp-c-bg-soft`, danger/warning tokens, etc.).
- Prefer extracting a small shared token file (e.g. `packages/dashboard/src/styles/vp-tokens.css` modeled on VitePress default theme vars + this repo’s `documentation/.vitepress/theme/custom.css` accents) so the same declarative CSS can be dropped into docs demos later.
- Support light + dark via `prefers-color-scheme` or a simple toggle using the same token pairs VitePress uses.
- Do **not** revive the historical IBM Plex dark dashboard as the visual system.

### 5.4 Playwright `webServer` docs snippet

Document dual webServer: proxy + dashboard (historical docs already have this pattern).

---

## 6. MCP server package

### 6.1 Package

- Path: `packages/mcp`
- Name: `@playwright-backend-mocks/mcp`
- Bin: `playwright-backend-mocks-mcp`
- Deps: `@modelcontextprotocol/server` (v2), HTTP client to proxy
- Config: `--proxy-url` / `PBM_PROXY_URL`

### 6.2 Surface (mirror REST)

**Tools** (preferred for filtered queries):

| Tool | Maps to |
| ---- | ------- |
| `get_health` | `GET /health` |
| `list_connections` | `GET /api/connections` |
| `list_http` | `GET /api/http` (+ filters) |
| `get_http` | `GET /api/http/:id` |
| `list_ws` | `GET /api/ws` |
| `get_ws` | `GET /api/ws/:id` |
| `search` | unified search across HTTP + WS with ranking |
| `export_har` | `GET /api/export/har` (return path or inline text; prefer text/base64 in tool result for agent use) |

**Resources** (optional, URI templates):

- `pbm://health`
- `pbm://http/{id}`
- `pbm://ws/{id}`

No write tools.

### 6.3 Host setup docs

Document Cursor / generic MCP config:

```json
{
  "mcpServers": {
    "playwright-backend-mocks": {
      "command": "npx",
      "args": ["-y", "@playwright-backend-mocks/mcp", "--proxy-url", "http://127.0.0.1:4310"]
    }
  }
}
```

Note: MCP is useless unless the proxy is running; docs should say so clearly.

---

## 7. Instrumentation work in the proxy

To feed the richer model:

1. On HTTP `request:start` → create pending HTTP entry (+ timeline event).
2. On claim/match → attach `test` metadata from claim diagnostics when available.
3. On `handler:result` → record `action` (`fulfill` / `continue` / `abort` / `fetch`) and payloads (response, overrides, errorCode).
4. On passthrough / errors / cancel → settle entry accordingly.
5. On WS `ws:connection` → create WS entry; append frame/close/handler events from existing relay path; bound per-connection event lists.
6. Wire list/get/search/export handlers in the HTTP server module (keep coordinator logic separate from serialization).

Careful: observability must remain side-effect free w.r.t. claims and timing (no extra awaits on the hot path beyond in-memory pushes).

---

## 8. Documentation plan

| Doc | Action |
| --- | ------ |
| `documentation/ops/rest-api.md` | Full route reference, query params, schemas, HAR export |
| `documentation/ops/proxy.md` | Startup banner, new flags, history limits for WS |
| `documentation/ops/dashboard.md` | **New** — install, CLI, `webServer`, VitePress-style note |
| `documentation/ops/mcp.md` | **New** — install, stdio config, tool/resource list, proxy dependency |
| `documentation/guide/troubleshooting.md` | Link observability for “what did my test do?” |
| `documentation/index.md` / sidebar | Add ops entries |
| `documentation/guide/limitations.md` | Remove “no dashboard package”; note in-memory + read-only |

Keep REST and MCP docs structurally parallel (same resource names / filters).

---

## 9. Testing strategy

Observability is **library-only** → live under `tests/library` (not `tests/parity`). Prefer **one Playwright runner** for consistency.

### 9.1 REST API — Playwright `request` (recommended)

Playwright’s APIRequestContext is already how historical observability tests hit the proxy. Clean and sufficient:

- Start proxy via `webServer` or `withProxy()` helper (existing library pattern).
- Drive traffic with Node agent + Playwright fixture (or library harness).
- Assert `/api/http`, filters, ranking, `/api/ws`, HAR shape, CORS, health.

No need for a second test framework.

### 9.2 MCP server — Playwright-orchestrated process tests (recommended)

Keep Playwright as the runner; treat MCP as a subprocess:

1. Start proxy (+ generate traffic) in the test.
2. Spawn `playwright-backend-mocks-mcp` with stdio **or** (cleaner) import the tool-registration module and invoke handlers in-process with a fake/proxy URL.
3. Prefer **in-process tool handler tests** for determinism + **one smoke stdio handshake** if cheap.

Alternative if stdio plumbing is awkward: thin unit/integration tests with Node `node:test` only for MCP framing — but default remains Playwright so CI stays one platform.

Do **not** try to drive MCP through a real LLM host in CI.

### 9.3 Dashboard — Playwright UI tests (recommended)

- `webServer`: proxy + dashboard.
- Generate known HTTP + WS traffic.
- Assert filters, dual views, detail panes, export link/download.
- Reuse patterns from `historical/tests/e2e/specs/observability.spec.ts`, but target VitePress-styled UI selectors.

### 9.4 Suggested layout

```text
tests/library/specs/observability/
  rest-http.spec.ts
  rest-ws.spec.ts
  rest-har.spec.ts
  mcp-tools.spec.ts
  dashboard.spec.ts
```

---

## 10. Implementation phases (single product PR track)

Prefer one coherent PR series (or one large PR if manageable). Suggested commits/phases:

1. **Protocol + proxy store** — enrich HTTP history; add WS history; search helpers; export HAR.
2. **REST routes + startup banner** — document in `ops/rest-api.md` / `proxy.md`.
3. **Dashboard package** — Vue app + CLI + VitePress tokens; docs.
4. **MCP package** — tools over REST; docs.
5. **Library tests** — REST / MCP / dashboard.
6. **Polish** — sidebar links, limitations, README pointers.

---

## 11. Open questions (with proposed defaults)

Answer these before or during implementation; defaults apply if no preference.

| # | Question | Proposed default |
| - | -------- | ---------------- |
| Q1 | Keep `/api/history` forever as synonym of `/api/http`, or deprecate? | Keep as synonym (no breakage). |
| Q2 | Capture upstream response bodies for `continue` / passthrough? | Yes when Node reports `request:response` / equivalent; may increase memory — still capped by history limit. |
| Q3 | How to export WebSockets given HAR 1.2 is HTTP-centric? | HAR for HTTP only; separate `GET /api/export/ws` JSON. Optional zip later. |
| Q4 | MCP transport: stdio only, or also Streamable HTTP? | **stdio only** for v1 (IDE hosts). |
| Q5 | Should MCP live inside the proxy process? | **No** — separate package calling REST (matches dashboard; simpler lifecycle). |
| Q6 | Dashboard SPA base path: `/` or `/dashboard`? | SPA at `/` on port 4311; proxy never serves UI. (Speech “slash dashboard” = package/`packages/dashboard`.) |
| Q7 | Include Playwright test **title/file** in history? | **Yes** when available from claim/match diagnostics. |
| Q8 | Live updates: polling vs SSE? | **Polling ~2s** v1; design REST so SSE can be added later without schema break. |
| Q9 | Auth on REST when `--token` is set? | v1: REST stays local-open (current behavior); document that token protects `/ws` only. Revisit later. |
| Q10 | Shared search package vs inline in proxy? | Implement search in proxy; MCP/dashboard call REST (no third package). |
| Q11 | This planning PR vs full implementation in one PR? | **This document lands first**; implementation PR(s) follow once defaults/questions are accepted. |

---

## 12. Success criteria

1. Proxy startup prints Node/Playwright connect URL and dashboard proxy URL.
2. REST can list/filter/search HTTP and WS traffic with test ownership and action detail.
3. HAR download works for HTTP history.
4. Dashboard package installs separately, connects via `--proxy-url`, shows HTTP and WS views with search/time filters, VitePress-like styling.
5. MCP tools mirror REST; documented for Cursor-style hosts.
6. Library Playwright tests cover REST, MCP tool handlers, and dashboard smoke/UI.
7. Docs under `documentation/ops/` are complete and cross-linked.

---

## 13. Risks / watch items

| Risk | Mitigation |
| ---- | ---------- |
| Memory growth from bodies + WS frames | Caps on history entries, per-socket events, and optional body truncation in list views (full body on get-by-id) |
| Hot-path overhead | In-memory append only; no disk; no blocking network from observability |
| Schema churn vs historical clients | Additive fields; keep `/api/history` |
| VitePress token drift | Vendor a snapshot of tokens into the dashboard package rather than importing VitePress at runtime |
| MCP SDK v1 vs v2 | Target `@modelcontextprotocol/server` v2; pin version in package.json |
