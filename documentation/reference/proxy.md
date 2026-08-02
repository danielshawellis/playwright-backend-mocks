# Proxy

Package: `@playwright-backend-mocks/proxy`

The proxy is the coordinator: it accepts WebSocket connections from Playwright workers and Node agents, matches routes, records history, and serves a read-only dashboard.

## CLI

Binary: `playwright-backend-mocks-proxy`

```bash
playwright-backend-mocks-proxy [options]
```

| Flag                     | Default     | Description                                        |
| ------------------------ | ----------- | -------------------------------------------------- |
| `--host <host>`          | `127.0.0.1` | Bind host                                          |
| `--port <port>`          | `4310`      | Bind port                                          |
| `--token <token>`        | _(none)_    | Optional shared handshake secret                   |
| `--history-limit <n>`    | `1000`      | In-memory history capacity                         |
| `--heartbeat-ms <ms>`    | `15000`     | Ping interval                                      |
| `--idle-timeout-ms <ms>` | `60000`     | Idle socket timeout                                |
| `--log-level <level>`    | `info`      | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `-h`, `--help`           |             | Print help                                         |

SIGINT / SIGTERM trigger a graceful `stop()`.

There are no subcommands — one process serves HTTP + WebSocket.

## Programmatic API

```ts
import {
  createProxyServer,
  createProxyConfig,
  DEFAULT_PROXY_CONFIG,
  type ProxyServer,
  type ProxyConfig,
  type LogLevel,
} from "@playwright-backend-mocks/proxy";

function createProxyServer(overrides?: Partial<ProxyConfig>): ProxyServer;
function createProxyConfig(overrides?: Partial<ProxyConfig>): ProxyConfig;

interface ProxyServer {
  readonly url: string;
  readonly config: ProxyConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ProxyConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string | undefined;
  readonly historyLimit: number;
  readonly heartbeatMs: number;
  readonly idleTimeoutMs: number;
  readonly logLevel: LogLevel;
}

type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
```

`createProxyServer` merges overrides into `DEFAULT_PROXY_CONFIG`. `server.url` is `http://{host}:{port}` after configuration (available before `start()`).

## HTTP endpoints

| Method | Path               | Description                              |
| ------ | ------------------ | ---------------------------------------- |
| `GET`  | `/health`          | `{ ok: true, version, protocolVersion }` |
| `GET`  | `/dashboard`       | Read-only HTML UI (polls every 2s)       |
| `GET`  | `/api/history`     | `{ entries: HistoryEntry[] }`            |
| `GET`  | `/api/connections` | `{ nodeAgents, playwrightWorkers }`      |
| WS     | `/ws`              | Protocol transport                       |
| \*     | other              | `404` `{ error: "not_found" }`           |

The dashboard shows connections and request history with JSON detail. It does **not** mutate routes or connections.

### History outcomes

Each history entry's `outcome.kind` is one of:

`mocked` · `passthrough` · `continued` · `aborted` · `error` · `pending`

## Matching rules (authoritative)

| Matches | Proxy behavior                                                                 |
| ------- | ------------------------------------------------------------------------------ |
| 0       | `decision:passthrough` to the Node agent                                       |
| 1       | `request:matched` to the owning Playwright connection                          |
| >1      | `decision:error` (`ambiguous_route`) to Node + `proxy:error` to affected tests |

Additional connection rules:

- Protocol version mismatch → `hello:error`, connection closed
- Token mismatch → `hello:error` `unauthorized`, connection closed
- Package version mismatch → warning only (keep packages aligned)
- Idle longer than `idleTimeoutMs` → socket terminated
- Playwright disconnect → its tests/routes unregister; in-flight requests fail as disconnected

## Typical Playwright webServer entry

```ts
{
  command: "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
  url: "http://127.0.0.1:4310/health",
  reuseExistingServer: !process.env.CI,
}
```
