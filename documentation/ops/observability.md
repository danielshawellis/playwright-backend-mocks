# Observability

Playwright Backend Mocks can show you the HTTP and WebSocket traffic your Node app sends while tests run — which test owned it, and what that test did (`fulfill`, `continue`, `abort`, or passthrough).

Observability is **read-only** and **in-memory**. History lives in the proxy process and clears when the proxy stops. It never changes routing.

## Pieces

| Piece | Package | Role |
| --- | --- | --- |
| Proxy + REST | `@playwright-backend-mocks/proxy` | Stores history; exposes the [REST API](/ops/rest-api) |
| Dashboard | `@playwright-backend-mocks/dashboard` | Optional Vue UI pointed at the proxy |

There is no MCP server. Local coding agents can use the same REST API (see below).

## Quick start

```bash
# terminal 1 — proxy (prints connect + REST URLs on startup)
playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310

# terminal 2 — dashboard (optional)
playwright-backend-mocks-dashboard --host 127.0.0.1 --port 4311 \
  --proxy-url http://127.0.0.1:4310
```

Open `http://127.0.0.1:4311/`. The dashboard polls the proxy every 2 seconds when auto-refresh is on (default).

### Playwright `webServer`

Running both as Playwright web servers is a good default:

```ts
webServer: [
  {
    command: "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
    url: "http://127.0.0.1:4310/health",
    reuseExistingServer: !process.env.CI,
  },
  {
    command:
      "playwright-backend-mocks-dashboard --host 127.0.0.1 --port 4311 --proxy-url http://127.0.0.1:4310",
    url: "http://127.0.0.1:4311/health",
    reuseExistingServer: !process.env.CI,
  },
  // …your app under test
];
```

## What you can see

- **HTTP** — timeline of requests/responses; action; owning test **title** and **path**; request/response bodies; continue overrides; short per-request timeline
- **WebSockets** — each connection, outcome (matched / passthrough / error), and a bidirectional event timeline (live only — no WS file download)
- **`ambiguous_route`** — history records the competing tests; the dashboard shows a clear callout and links to [troubleshooting](/guide/troubleshooting#ambiguous_route)
- **Connections** — connected Node agents and Playwright workers

### HAR download (single request → `routeFromHAR`)

Export one HTTP request as a HAR file, then replay it with `routeFromHAR`:

```bash
curl -OJ "http://127.0.0.1:4310/api/history/<requestId>/har"
```

In the dashboard, select a request and use the download control in the detail panel. HAR export is **HTTP only** (one entry per file). There is no WebSocket HAR download.

## Capture modes

Control how much the proxy stores:

```bash
playwright-backend-mocks-proxy --history-capture all      # default
playwright-backend-mocks-proxy --history-capture handled  # only test-acted traffic
playwright-backend-mocks-proxy --history-capture none
```

| Mode | Keeps |
| --- | --- |
| `all` | Every coordinated HTTP request and WebSocket connection |
| `handled` | Only traffic a test claimed/acted on (`fulfill` / `continue` / `abort`, matched sockets, errors). Passthrough omitted |
| `none` | Nothing in history (health/connections still work) |

Related flags: `--history-limit` (HTTP ring size), `--ws-history-limit` (WebSocket connection ring size). See [Proxy](/ops/proxy).

## Using this with coding agents

There is no MCP package. If a local agent is writing or running tests against this proxy, give it:

1. The [REST API](/ops/rest-api) documentation (this site’s REST page), and
2. The proxy base URL (default `http://127.0.0.1:4310`).

The agent can then call `GET /api/history`, `GET /api/ws`, and `GET /api/history/:id/har` to inspect what tests intercepted — the same data the dashboard shows. The dashboard also has small copy controls for URLs and full history JSON. Dropping the REST page into the agent’s context is usually enough.

## Related

- [Dashboard](/ops/dashboard)
- [REST API](/ops/rest-api)
- [Proxy](/ops/proxy)
- [Spying and waiting](/guide/spying-and-waiting)
