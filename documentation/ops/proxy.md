# Proxy

Package: `@playwright-backend-mocks/proxy`

The proxy coordinates WebSocket connections from Playwright workers and Node agents. It owns route claims, request decisions, in-memory history, and the read-only REST API.

## CLI

Binary:

```bash
playwright-backend-mocks-proxy [options]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--host <host>` | `127.0.0.1` | Bind host. |
| `--port <port>` | `4310` | Bind port. |
| `--token <token>` | none | Optional shared connection token. |
| `--history-limit <n>` | `1000` | Number of recent HTTP history entries retained in memory. |
| `--ws-history-limit <n>` | `200` | Number of recent WebSocket connections retained in memory. |
| `--history-capture <mode>` | `all` | `all`, `handled` (test-acted only), or `none`. |
| `--heartbeat-ms <ms>` | `15000` | WebSocket ping interval. |
| `--idle-timeout-ms <ms>` | `60000` | Idle socket disconnect timeout. |
| `--claim-timeout-ms <ms>` | `5000` | How long to wait for Playwright route claim replies. |
| `--log-level <level>` | `info` | `silent`, `error`, `warn`, `info`, or `debug`. |
| `-h`, `--help` | | Print help. |

On startup the proxy prints the Node/Playwright WebSocket URL, REST base URL, and how to point the [dashboard](/ops/dashboard) at the proxy. See [Observability](/ops/observability).

The process handles `SIGINT` and `SIGTERM` by stopping the server.

## Playwright `webServer`

```ts
{
  command:
    "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310 --claim-timeout-ms 5000",
  url: "http://127.0.0.1:4310/health",
  reuseExistingServer: !process.env.CI,
}
```

## Programmatic API

```ts
import {
  createProxyServer,
  createProxyConfig,
  DEFAULT_PROXY_CONFIG,
  type ProxyConfig,
  type ProxyServer,
} from "@playwright-backend-mocks/proxy";

const server = createProxyServer({
  port: 4310,
  logLevel: "debug",
});

await server.start();
console.log(server.url);
await server.stop();
```

## `ProxyConfig`

```ts
type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

type HistoryCaptureMode = "all" | "handled" | "none";

interface ProxyConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string | undefined;
  readonly historyLimit: number;
  readonly wsHistoryLimit: number;
  readonly historyCapture: HistoryCaptureMode;
  readonly heartbeatMs: number;
  readonly idleTimeoutMs: number;
  readonly claimTimeoutMs: number;
  readonly logLevel: LogLevel;
}
```

`createProxyServer()` merges overrides into `DEFAULT_PROXY_CONFIG`.

## HTTP endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Liveness plus package and protocol versions. |
| `GET` | `/api/history` | Recent HTTP history (filterable). |
| `GET` | `/api/history/:id` | One history entry. |
| `GET` | `/api/history/:id/har` | Single-request HAR 1.2 (for `routeFromHAR`). |
| `GET` | `/api/ws` | Recent WebSocket connections (filterable). |
| `GET` | `/api/ws/:id` | One WebSocket connection + event timeline. |
| `GET` | `/api/connections` | Connected Node agents and Playwright workers. |
| `OPTIONS` | API paths | CORS preflight. |
| WebSocket | `/ws` | Internal coordinator transport (`--token` protects this; REST is local/read-only). |

See [REST API](/ops/rest-api) and [Observability](/ops/observability).

## Ownership rules

For every HTTP request or `globalThis.WebSocket` connection:

| Claim result | Proxy decision |
| --- | --- |
| No test claims | Passthrough. |
| Exactly one test claims | Send the request/socket to that test's Playwright worker. |
| More than one test claims | Fail with `ambiguous_route`. |
| A test does not answer before timeout | Fail with `claim_timeout`. |

Within one test, HTTP handler order is handled by the fixture: newest-first, with `fallback()` continuing the chain.
