# Observability System Plan (final)

Read-only observability for Playwright Backend Mocks: proxy REST API + Vue dashboard package. Documented for humans and local agents. **No MCP in v1.**

**Status:** implemented (see `packages/proxy`, `packages/dashboard`, `documentation/ops/observability.md`, `tests/library/specs/observability-*.spec.ts`).  
**Scope:** library-only (outside the parity oracle).

| Source | Role |
| ------ | ---- |
| [`PHILOSOPHY.md`](../PHILOSOPHY.md) | Architecture; observability is library-only |
| [`packages/proxy/`](../packages/proxy/) | Existing thin REST + HTTP history |
| [`documentation/ops/rest-api.md`](../documentation/ops/rest-api.md) | Living REST docs (to expand) |
| [`historical/packages/dashboard/`](../historical/packages/dashboard/) | CLI/SPA packaging reference only (not visual source of truth) |
| [`packages/playwright/src/fixtures.ts`](../packages/playwright/src/fixtures.ts) | Already sends `testInfo.title` + `testInfo.file` on `test:register` |

---

## 1. Decisions (locked)

| Topic | Decision |
| ----- | -------- |
| REST history path | `GET /api/history` only (no `/api/http`, no synonyms — never released) |
| Capture mode CLI | `--history-capture all \| handled \| none` (default **`all`**) |
| `handled` meaning | Traffic a test claimed/acted on: `fulfill` / `continue` / `abort` (and related errors while owned). **Not** passthrough. |
| HAR download | **HTTP only** via REST (+ dashboard button). No WebSocket HAR/export/download |
| WebSocket files | Skip any download or file-recording of WS traffic (Playwright does not meaningfully replay WS from HAR) |
| WebSocket live UI | **Keep** in-memory WS connections + event timelines in REST + dashboard (observe, don’t export) |
| MCP | **Skip for v1.** Document how local agents can use the REST API instead |
| Dashboard package | `@playwright-backend-mocks/dashboard` — separate published npm package |
| Test metadata | History entries include **`title`** and **`path`** (file path) when a test owns the traffic |
| Refresh | ~2s polling; auto-refresh **on by default**; toggle + manual Refresh button |
| Persistence | In-memory only; cleared when proxy exits |
| Mutations | None — observability never changes routing |

---

## 2. Architecture

```text
Playwright fixture ──ws──► Proxy ◄──ws── Node agent
                              │
                              ├── in-memory HTTP history
                              ├── in-memory WS connection timelines
                              └── REST /api/*  (read-only)
                                       ▲
                    ┌──────────────────┼──────────────────┐
                    │                                     │
         @…/dashboard (port 4311)              curl / local agents
         --proxy-url http://proxy             (paste REST docs)
```

Single source of truth: proxy memory. Dashboard is a thin Vue client. Agents use the same REST surface.

---

## 3. Proxy: capture, data model, REST, banner

### 3.1 CLI

```text
--history-capture <mode>   all | handled | none   (default: all)
--history-limit <n>        HTTP history ring size (existing; default 1000)
--ws-history-limit <n>     Max WS connections retained (new; default 200)
```

Per-connection WS event lists are capped (e.g. last 500 events) so frame spam cannot unbounded-grow memory.

| Mode | Stores |
| ---- | ------ |
| `all` | Every coordinated HTTP request + every WS connection/timeline |
| `handled` | Only entries owned/acted on by a test (HTTP: fulfill/continue/abort/owned-error; WS: matched by a test). Passthrough omitted |
| `none` | No history writes; health/connections still work |

### 3.2 HTTP history entry (enriched)

Keep id = `requestId`. Additive fields on today’s `HistoryEntry`:

| Field | Notes |
| ----- | ----- |
| `action` | `fulfill` \| `continue` \| `abort` \| `passthrough` \| `fetch` \| `error` \| `pending` |
| `title` | Playwright `testInfo.title` when owned |
| `path` | Playwright `testInfo.file` when owned (wire/API name: **`path`**, sourced from fixture `file`) |
| `testId` / `routeId` | Existing |
| `request` / outcome response | Existing serialization |
| `overrides` | When `continue` modified the request |
| `events` | Short timeline: observed → claimed → handler action → settled |
| `durationMs` / `timestamp` / `clientId` | Existing |

`outcome.kind` can remain for coarse filtering; UI prefers `action`.

**Fixture wiring:** already sends `title` + `file` on `test:register`. Proxy already stores them on the test record. Implementation work is denormalizing onto history when settling (map `file` → API field `path`). Optional later: `titlePath` for describe breadcrumbs — **not in v1** (explicit title + path only).

### 3.3 WebSocket live model (no export)

In-memory only; power dashboard + REST; **no download endpoint**.

```ts
type WsConnectionEntry = {
  id: string;            // socketId
  timestamp: number;
  clientId: string;
  url: string;
  title?: string;
  path?: string;
  testId?: string;
  routeId?: string;
  outcome: "pending" | "matched" | "passthrough" | "error";
  closedAt?: number;
  close?: { code?: number; reason?: string; wasClean: boolean };
  events: WsTimelineEvent[];  // bounded
};
```

Events: open / frames (both directions) / close / error / handler actions (forward, send, close, etc. as protocol already allows).

### 3.4 REST API

Base: `http://127.0.0.1:4310`. CORS open for local dashboard. Read-only `GET` + `OPTIONS`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/health` | Liveness / version / protocolVersion |
| `GET` | `/api/connections` | Node agents + Playwright workers |
| `GET` | `/api/history` | HTTP history. Query: `q`, `from`, `to`, `testId`, `clientId`, `action`, `limit`, `offset` |
| `GET` | `/api/history/:id` | Single HTTP entry + full detail/timeline |
| `GET` | `/api/ws` | Live WS connections (same filter query where applicable) |
| `GET` | `/api/ws/:id` | One connection + event timeline |
| `GET` | `/api/history/:id/har` | Single-entry HAR 1.2 for that HTTP request (for `routeFromHAR`) |

**Search ranking** (`q`): URL highest → method/status/title/path/testId → headers → body/frame payload. Time filter `from`/`to` (epoch ms). Newest-first when unscored.

No WS export routes.

### 3.5 Startup banner

On listen, print something like:

```text
playwright-backend-mocks proxy

  Connect Node / Playwright:  ws://127.0.0.1:4310/ws
  REST API:                   http://127.0.0.1:4310
  Dashboard:                  install @playwright-backend-mocks/dashboard
                              and point --proxy-url at http://127.0.0.1:4310
  History capture:            all
```

---

## 4. Dashboard package

### 4.1 Packaging

| Item | Value |
| ---- | ----- |
| Package | `@playwright-backend-mocks/dashboard` |
| Path | `packages/dashboard` |
| Bin | `playwright-backend-mocks-dashboard` |
| Flags | `--host` (default `127.0.0.1`), `--port` (default `4311`), `--proxy-url` (default `http://127.0.0.1:4310`) |
| Endpoints | `GET /` SPA, `GET /config.json` → `{ proxyUrl }`, `GET /health` |

Document optional Playwright `webServer` entry alongside the proxy.

### 4.2 Visual system

- VitePress default theme tokens (`--vp-c-bg`, `--vp-c-brand-1`, `--vp-c-text-*`, `--vp-c-divider`, `--vp-c-bg-soft`, danger/warning).
- Ship a small `vp-tokens.css` snapshot in the dashboard package (do not runtime-depend on VitePress).
- Light + dark via `prefers-color-scheme` (same token pairs).
- Typography/spacing should feel like the docs site, not the historical IBM Plex dark dashboard.
- Layout: app chrome (top bar + nav), not a marketing landing page. Still one clear composition per view — no dashboard-of-cards clutter.

### 4.3 UI structure (what it actually looks like)

#### Shell (every page)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│  Playwright Backend Mocks          [ HTTP ]  [ WebSockets ]  [ Connections ]
│  proxy http://127.0.0.1:4310                                                 │
│                                                                              │
│  [🔍 Search…………]  [From time] [To time]   ☑ Auto-refresh   [Refresh]  [⬇ HAR] │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Brand** in the top bar (product name), not buried.
- Primary nav: three destinations — **HTTP**, **WebSockets**, **Connections**.
- Shared toolbar on HTTP/WS: search, optional time range, auto-refresh checkbox (**checked by default**), Refresh button.
- **Download HAR** on the selected HTTP detail (single request, for `routeFromHAR`). Not on WS.
- Proxy URL shown subtly in the header (from `/config.json`).
- Connection error banner if proxy unreachable.

Auto-refresh: while checked, poll ~2s. Refresh always runs one fetch. Polling must **not** clear selection or jump scroll if the selected id still exists; if it disappeared, clear selection gently.

Default route: **`/http`** (the main job). `/` redirects there.

---

#### View A — HTTP (`/http`)

Master–detail, full width:

```text
┌──────────────────────────── timeline (≈55%) ─────────────┬── detail (≈45%) ──┐
│ Time     Action   Method  Status  URL              Test   │  GET /charges      │
│ 12:01:03 fulfill  POST    402     …/charges        pay…   │  fulfill · 14ms    │
│ 12:01:02 continue GET     200     …/prices         pay…   │                    │
│ 12:01:01 passthrough GET  200     …/health         —      │  Test              │
│ …                                                         │  title: declined…  │
│                                                           │  path: …/pay.spec  │
│                                                           │  testId: …         │
│                                                           │                    │
│                                                           │  Request           │
│                                                           │  headers / body    │
│                                                           │                    │
│                                                           │  Response          │
│                                                           │  headers / body    │
│                                                           │                    │
│                                                           │  Timeline          │
│                                                           │  • observed        │
│                                                           │  • claimed         │
│                                                           │  • fulfill         │
└───────────────────────────────────────────────────────────┴────────────────────┘
```

**Timeline columns (compact):**

| Column | Content |
| ------ | ------- |
| Time | Relative or `HH:mm:ss.SSS` |
| Action | Pill: fulfill / continue / abort / passthrough / pending / error |
| Method | `GET` / `POST` / … |
| Status | Response status when known; `—` if none; abort/error codes surfaced |
| URL | Truncated, full in title tooltip |
| Test | `title` if present, else `—` |

Row click selects. Selected row highlighted with brand-soft background (not a heavy card).

**Detail panel sections (stacked, one job each):**

1. **Summary** — method + URL, action pill, duration, clientId  
2. **Test** — title, path, testId, routeId (omit section if unowned)  
3. **Request** — headers table + body (pretty JSON when possible, else text/base64 notice)  
4. **Response** — status, headers, body (when mocked or when we captured upstream)  
5. **Overrides** — only if `continue` changed the request  
6. **Timeline** — ordered events for this request  

Empty states: “No requests yet” / “No matches for this search”.

HAR control downloads the selected request via `GET /api/history/:id/har`.
Copy icons copy URL and full history JSON (HTTP + WebSockets).

---

#### View B — WebSockets (`/ws`)

Same shell; **no HAR button**.

```text
┌────────── connections (≈35%) ──────────┬────── event timeline (≈65%) ──────────┐
│ ● wss://…/socket          matched      │  Connection wss://…/socket              │
│   pay declined · pay.spec.ts           │  matched · title · path                 │
│ ○ wss://…/other           passthrough  │                                         │
│   —                                    │  12:01:03.100  →  client  {"sub":…}     │
│                                        │  12:01:03.140  ←  server  {"ok":true}   │
│                                        │  12:01:04.002  •  handler forward       │
│                                        │  12:01:10.500  •  close 1000            │
└────────────────────────────────────────┴─────────────────────────────────────────┘
```

**Left list:** each socket — URL, outcome pill, test title/path one-liner, open/closed hint.  
**Right:** bidirectional timeline for the selected socket (direction arrows, payload preview, expand for full frame). Search filters connections and, when a connection is selected, can also highlight matching events.

No download. Copy-payload affordance on a single event is nice-to-have, not required for v1.

---

#### View C — Connections (`/connections`)

Simple two-column list (not cards-as-content):

- **Node agents** — `clientId`, connection id  
- **Playwright workers** — `clientId`, workerId, testCount, routeCount  

Purpose: confirm the proxy is wired. Secondary to HTTP/WS.

---

#### Motion / polish (light)

- Soft fade/slide when switching HTTP ↔ WS ↔ Connections  
- Selected-row background transition  
- Action pills: stable colors (fulfill=brand/success, continue=neutral, abort/error=danger, passthrough=muted, pending=warning)  
Avoid glow, purple gradients, emoji, and dense stat strips.

### 4.4 What we are not building in the UI

- Editing routes or replaying traffic from the UI  
- WS file download / HAR-with-websockets  
- Persistence, login, multi-proxy switcher  
- MCP panel  
- Heavy charts or “dashboard metrics” tiles in the first viewport  

---

## 5. Documentation

| Doc | Work |
| --- | ---- |
| `documentation/ops/rest-api.md` | Full routes, query params, schemas, HAR export, capture modes |
| `documentation/ops/proxy.md` | `--history-capture`, WS history limit, startup banner |
| `documentation/ops/dashboard.md` | **New** — install, CLI, `webServer`, UI overview, styling note |
| `documentation/guide/troubleshooting.md` | Link “inspect traffic” → dashboard/REST |
| `documentation/guide/limitations.md` | Remove “no dashboard”; note in-memory + no WS export + no MCP |
| Sidebar / index | Link new ops pages |

### 5.1 Teaching local agents (instead of MCP)

Add a short section (on REST page and/or dashboard page), roughly:

> **Using this with coding agents.** There is no MCP server in v1. If a local agent is writing or running tests against this proxy, give it the REST API docs (this page) and the proxy base URL (default `http://127.0.0.1:4310`). The agent can `GET /api/history`, `/api/ws`, and `/api/history/:id/har` to see what tests intercepted — same data as the dashboard.

Keep that practical and short — not a second product.

---

## 6. Testing strategy (Playwright, `tests/library`)

Observability is library-only → **not** in `tests/parity`.

| Surface | Approach |
| ------- | -------- |
| REST | Playwright `request` against proxy; drive traffic via existing library helpers / fixtures |
| Dashboard | Playwright UI tests: proxy + dashboard `webServer`; assert nav, filters, auto-refresh toggle, HAR download link, HTTP detail, WS timeline smoke |
| Capture modes | Assert `handled` omits passthrough; `none` leaves history empty |

Suggested files:

```text
tests/library/specs/observability/
  rest-history.spec.ts
  rest-ws.spec.ts
  rest-har.spec.ts
  rest-capture-modes.spec.ts
  dashboard.spec.ts
```

---

## 7. Implementation phases

1. **Protocol + proxy store** — enrich HTTP history (`action`, `title`, `path`, events); WS connection store; `--history-capture`; search helpers; HAR export.  
2. **REST + startup banner** — routes above; update `ops/rest-api.md` / `proxy.md`.  
3. **Dashboard package** — Vue app as specified; VitePress tokens; docs + `webServer` recipe; agent tip.  
4. **Library tests** — REST + dashboard.  
5. **Docs polish** — limitations, troubleshooting, sidebar.

---

## 8. Success criteria

1. Proxy banner shows Node/Playwright WS URL, REST URL, and how to point the dashboard.  
2. `--history-capture all|handled|none` behaves as specified.  
3. `/api/history` lists/filters/searches HTTP with action + title + path.  
4. `/api/ws` exposes live WS timelines (no export).  
5. `/api/history/:id/har` downloads a single-entry HTTP HAR for `routeFromHAR`.  
6. Dashboard package installs separately, defaults auto-refresh on, has Refresh + HAR on HTTP view, separate HTTP/WS/Connections views, VitePress-like styling.  
7. Docs explain REST for humans and local agents; no MCP package.  
8. Library Playwright tests cover REST + dashboard smoke.

---

## 9. Explicit non-goals (v1)

- MCP server  
- WebSocket HAR / any WS download or file recording  
- Persisting history across proxy restarts  
- Mutating traffic from dashboard/REST  
- Bundling dashboard into the proxy process  
- Parity-oracle coverage  
- `titlePath` describe breadcrumbs (title + path only)
