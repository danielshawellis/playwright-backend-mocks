# REST API

The proxy exposes a small read-only HTTP API under `/api/*` (plus `/health`). Use it from the [dashboard](/reference/dashboard), custom tooling, or an LLM agent.

**Tip for LLM agents:** copy and paste this whole page into your prompt so the model can inspect proxy state, write tests against observed traffic, or debug why a request was mocked vs passed through.

Base URL defaults to `http://127.0.0.1:4310` when the proxy is started with the usual CLI defaults.

All listed endpoints are **read-only** and safe to poll. CORS is enabled (`Access-Control-Allow-Origin: *`) so a browser UI on another origin (for example the dashboard on port `4311`) can call them.

## Endpoints

| Method    | Path                | Description                                  |
| --------- | ------------------- | -------------------------------------------- |
| `GET`     | `/health`           | Liveness + package / protocol versions       |
| `GET`     | `/api/history`      | In-memory request history (newest first)     |
| `GET`     | `/api/connections`  | Connected Node agents and Playwright workers |
| `OPTIONS` | `/health`, `/api/*` | CORS preflight                               |

Unmatched paths return `404` with `{ "error": "not_found" }`.

The WebSocket coordinator lives at `/ws` and is **not** part of this REST surface — see [Protocol](/reference/protocol).

## `GET /health`

```bash
curl -s http://127.0.0.1:4310/health
```

```json
{
  "ok": true,
  "version": "0.1.0",
  "protocolVersion": 1
}
```

## `GET /api/history`

Returns recent intercepted requests from the ring buffer (`--history-limit`, default `1000`).

```bash
curl -s http://127.0.0.1:4310/api/history
```

```json
{
  "entries": [
    {
      "id": "…",
      "timestamp": 1710000000000,
      "clientId": "api-server",
      "request": {
        "url": "https://payments.example.test/charges",
        "method": "POST",
        "headers": { "content-type": "application/json" },
        "bodyBase64": "…"
      },
      "outcome": {
        "kind": "mocked",
        "response": {
          "status": 402,
          "statusText": "Payment Required",
          "headers": { "content-type": "application/json" },
          "bodyBase64": "…"
        },
        "routeId": "…",
        "testId": "…"
      },
      "durationMs": 12,
      "testId": "…",
      "routeId": "…"
    }
  ]
}
```

### History outcomes

`outcome.kind` is one of:

| Kind          | Meaning                                              |
| ------------- | ---------------------------------------------------- |
| `pending`     | Matched / in flight                                  |
| `mocked`      | Handler fulfilled a response                         |
| `passthrough` | No route matched; Node continued to the real network |
| `continued`   | Handler called `continue`                            |
| `aborted`     | Handler aborted the request                          |
| `error`       | Ambiguity, disconnect, or other failure              |

## `GET /api/connections`

```bash
curl -s http://127.0.0.1:4310/api/connections
```

```json
{
  "nodeAgents": [{ "clientId": "api-server", "connectionId": "…" }],
  "playwrightWorkers": [
    {
      "clientId": "playwright-1",
      "connectionId": "…",
      "workerId": "…",
      "testCount": 1,
      "routeCount": 2
    }
  ]
}
```

## Example: inspect from a shell

```bash
# Is the proxy up?
curl -s http://127.0.0.1:4310/health

# Who is connected?
curl -s http://127.0.0.1:4310/api/connections | jq .

# What did agents send recently?
curl -s http://127.0.0.1:4310/api/history | jq '.entries[:5]'
```

## Related

- [Proxy CLI](/reference/proxy) — process that owns this API
- [Dashboard](/reference/dashboard) — optional Vue UI that consumes it
- [Inspecting requests](/guide/inspecting-requests) — in-test assertion APIs
