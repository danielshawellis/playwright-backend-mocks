# REST API

The proxy exposes a read-only HTTP API for observability. The default base URL is `http://127.0.0.1:4310`.

All endpoints listed here are safe to poll. CORS is enabled for API paths. `--token` authenticates the coordinator WebSocket only — bind the proxy to localhost (default) so history bodies stay local.

Overview and dashboard setup: [Observability](/ops/observability).

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness, version, and capture mode. |
| `GET` | `/api/history` | In-memory HTTP history (filterable). |
| `GET` | `/api/history/:id` | Single HTTP history entry. |
| `GET` | `/api/history/:id/har` | Download a single-entry HAR 1.2 when a response was recorded (for `routeFromHAR`). |
| `GET` | `/api/ws` | In-memory WebSocket connections (filterable). |
| `GET` | `/api/ws/:id` | Single WebSocket connection + event timeline. |
| `GET` | `/api/connections` | Connected Node agents and Playwright workers. |
| `OPTIONS` | API paths | CORS preflight. |

Unmatched paths return:

```json
{ "error": "not_found" }
```

The coordinator WebSocket is mounted at `/ws`, but it is not a REST API.

## Query parameters

Shared by `/api/history` and `/api/ws`:

| Param | Description |
| --- | --- |
| `q` | Case-insensitive string search. URL matches rank highest, then method/status/title/path/testId, then headers, then bodies/events. |
| `from` | Earliest timestamp (epoch ms). |
| `to` | Latest timestamp (epoch ms). |
| `testId` | Exact test id. |
| `clientId` | Exact Node `clientId`. |
| `action` | HTTP: history `action`. WS list: connection `outcome`. |
| `limit` | Max results. |
| `offset` | Skip first N results. |

## `GET /health`

```bash
curl -s http://127.0.0.1:4310/health
```

```json
{
  "ok": true,
  "version": "0.1.0",
  "protocolVersion": 3,
  "historyCapture": "all"
}
```

## `GET /api/connections`

```bash
curl -s http://127.0.0.1:4310/api/connections | jq .
```

```json
{
  "nodeAgents": [
    {
      "clientId": "api-server",
      "connectionId": "..."
    }
  ],
  "playwrightWorkers": [
    {
      "clientId": "playwright-...",
      "connectionId": "...",
      "workerId": "0",
      "testCount": 1,
      "routeCount": 2
    }
  ]
}
```

## `GET /api/history`

```bash
curl -s "http://127.0.0.1:4310/api/history?q=charges" | jq '.entries[:5]'
```

```json
{
  "entries": [
    {
      "id": "...",
      "timestamp": 1710000000000,
      "clientId": "api-server",
      "request": {
        "url": "https://payments.example.test/charges",
        "method": "POST",
        "headers": {
          "content-type": "application/json"
        },
        "bodyBase64": "..."
      },
      "outcome": {
        "kind": "mocked",
        "response": {
          "status": 402,
          "statusText": "",
          "headers": {
            "content-type": "application/json"
          },
          "bodyBase64": "...",
          "url": "https://payments.example.test/charges"
        },
        "routeId": "...",
        "testId": "..."
      },
      "action": "fulfill",
      "title": "declined card shows an error",
      "path": "/tests/pay.spec.ts",
      "durationMs": 12,
      "testId": "...",
      "routeId": "...",
      "events": [
        { "id": "...", "timestamp": 1710000000000, "kind": "observed" },
        { "id": "...", "timestamp": 1710000000012, "kind": "fulfill" }
      ]
    }
  ]
}
```

### History entry fields

| Field | Description |
| --- | --- |
| `id` | Request id. |
| `timestamp` | Milliseconds since epoch when the request was observed. |
| `clientId` | Node agent that made the request. |
| `request` | Serialized URL, method, headers, and base64 body. |
| `outcome` | Current or final outcome (`pending`, `mocked`, `passthrough`, `continued`, `aborted`, `error`). |
| `action` | Decision: `fulfill`, `continue`, `abort`, `passthrough`, `error`, or `pending`. |
| `title` | Playwright test title when a test owned the request. |
| `path` | Playwright test file path when a test owned the request. |
| `durationMs` | Present after the outcome settles (updated again when an upstream response arrives). |
| `testId` / `routeId` | Owning test/route when any. |
| `overrides` | Request overrides when `continue` modified the request. |
| `events` | Short timeline (`observed`, decision, `response`, `upstream_error`, …). |
| `redirectedFromId` / `redirectedToId` | Prior / next hop when continue or passthrough followed a redirect. |

### Request / response / no-response

Every retained HTTP entry answers three questions:

1. **Request** — always on `request`.
2. **What happened** — `action` (`passthrough`, `abort`, `fulfill`, `continue`, …).
3. **Response** — on `outcome.response` when there was one:
   - `fulfill` (`mocked`) — mock body from the handler
   - `continue` / `passthrough` — upstream body after Node settles (may arrive slightly after the decision)
   - `abort` / coordinator `error` — **no** response body (the app never received HTTP)

Redirect follows for continue/passthrough create **one history entry per hop**, linked with `redirectedFromId` / `redirectedToId`. Each hop has its own request and response (for example a `302` then a `200`).

History is stored in memory and capped by `--history-limit`. Capture mode is `--history-capture` (`all` \| `handled` \| `none`). See [Observability](/ops/observability#capture-modes).

## `GET /api/ws`

```bash
curl -s http://127.0.0.1:4310/api/ws | jq '.connections[:5]'
```

Each connection includes `url`, `outcome` (`pending` \| `matched` \| `passthrough` \| `error`), optional `title` / `path` / `testId`, and an `events` timeline (frames, handler actions, close).

There is **no** WebSocket HAR/export endpoint.

## `GET /api/history/:id/har`

```bash
curl -OJ "http://127.0.0.1:4310/api/history/<requestId>/har"
```

Returns a **single-entry** HAR 1.2 file for that HTTP request — suitable for Playwright / this library’s `routeFromHAR`. Redirect chains are exported one hop at a time (use `redirectedToId` to walk the chain). `redirectURL` is set from the hop’s `Location` header when present.

```ts
await backendMocks.routeFromHAR("./fixtures/charge.har", {
  url: "**/charges",
  update: false,
});
```

HAR is available only when a response was recorded on the entry (same rule as `historyResponse()`):

- **`fulfill`** (`outcome.kind === "mocked"`) — always
- **`continue`** / **`passthrough`** — only after Node attaches an upstream response (`request:response`)
- **`abort`** / **`error`** / **`pending`** — never

Otherwise the endpoint returns **409** `{ "error": "har_unavailable" }`. Unknown ids return `{ "error": "not_found" }` with status 404. There is no bulk HAR export and no WebSocket HAR export.

## Using this with coding agents

There is no MCP server. Paste this page (or [Observability](/ops/observability)) into a local agent’s context along with the proxy URL so it can inspect traffic while writing or running tests.

## Related

- [Observability](/ops/observability)
- [Dashboard](/ops/dashboard)
- [Proxy](/ops/proxy)
- [Troubleshooting](/guide/troubleshooting)
