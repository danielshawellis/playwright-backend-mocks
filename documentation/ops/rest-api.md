# REST API

The proxy exposes a small read-only HTTP API for diagnostics. The default base URL is `http://127.0.0.1:4310`.

All endpoints listed here are safe to poll. CORS is enabled for API paths.

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness and version information. |
| `GET` | `/api/history` | In-memory request history, newest first. |
| `GET` | `/api/connections` | Connected Node agents and Playwright workers. |
| `OPTIONS` | `/health`, `/api/history`, `/api/connections` | CORS preflight. |

Unmatched paths return:

```json
{ "error": "not_found" }
```

The coordinator WebSocket is mounted at `/ws`, but it is not a REST API.

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
curl -s http://127.0.0.1:4310/api/history | jq '.entries[:5]'
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
      "durationMs": 12,
      "testId": "...",
      "routeId": "..."
    }
  ]
}
```

## History entry shape

| Field | Description |
| --- | --- |
| `id` | Request id. |
| `timestamp` | Milliseconds since epoch when the request was observed. |
| `clientId` | Node agent that made the request. |
| `request` | Serialized URL, method, headers, and base64 body. |
| `outcome` | Current or final outcome. |
| `durationMs` | Present after the outcome settles. |
| `testId` | Owning test, when any. |
| `routeId` | Owning route, when any. |

## History outcomes

| `outcome.kind` | Meaning |
| --- | --- |
| `pending` | The request is currently being coordinated or handled. |
| `mocked` | A handler fulfilled a response. |
| `passthrough` | No route claimed the request. |
| `continued` | A handler called `continue()`. |
| `aborted` | A handler called `abort()`. |
| `error` | Ambiguity, disconnect, claim timeout, or another coordination failure. |

History is stored in memory and capped by `--history-limit`.

## Related

- [Proxy](/ops/proxy)
- [Troubleshooting](/guide/troubleshooting)
- [Spying and waiting](/guide/spying-and-waiting)
