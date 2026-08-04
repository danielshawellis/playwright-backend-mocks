# Configuration

Configuration lives in three places: the proxy process, the Playwright fixture, and the Node agent.

## Environment variables

| Variable | Used by | Description |
| --- | --- | --- |
| `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` | Node agent, Playwright fixture default | Proxy base URL, for example `http://127.0.0.1:4310`. |
| `PLAYWRIGHT_BACKEND_MOCKS_TOKEN` | Node agent, Playwright fixture default | Optional shared token for proxy WebSocket handshakes. |

When the Node agent has no proxy URL, `startBackendMocks()` is a no-op.

## Playwright fixture options

```ts
import { defineConfig } from "@playwright/test";
import type { BackendMocksWorkerOptions } from "@playwright-backend-mocks/playwright";

export default defineConfig<object, BackendMocksWorkerOptions>({
  use: {
    backendMocksProxyUrl: "http://127.0.0.1:4310",
    backendMocksToken: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  },
});
```

| Option | Type | Default |
| --- | --- | --- |
| `backendMocksProxyUrl` | `string` | `process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL ?? "http://127.0.0.1:4310"` |
| `backendMocksToken` | `string \| undefined` | `process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN` |

## Node agent options

```ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

const agent = await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  token: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  clientId: "api-server",
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `proxyUrl` | `string` | `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` | Proxy base URL. If missing or empty, the agent is a no-op. |
| `clientId` | `string` | `node-${process.pid}` | Stable process identity for matching and diagnostics. |
| `token` | `string` | `PLAYWRIGHT_BACKEND_MOCKS_TOKEN` | Shared token for the proxy handshake. |

## Proxy CLI options

```bash
playwright-backend-mocks-proxy \
  --host 127.0.0.1 \
  --port 4310 \
  --claim-timeout-ms 5000
```

| Flag | Default | Description |
| --- | --- | --- |
| `--host <host>` | `127.0.0.1` | Bind host. |
| `--port <port>` | `4310` | Bind port. |
| `--token <token>` | none | Optional shared connection token. |
| `--history-limit <n>` | `1000` | In-memory history entry limit. |
| `--heartbeat-ms <ms>` | `15000` | WebSocket ping interval. |
| `--idle-timeout-ms <ms>` | `60000` | Disconnect idle sockets after this many milliseconds. |
| `--claim-timeout-ms <ms>` | `5000` | Wait time for Playwright tests to answer a route claim. |
| `--log-level <level>` | `info` | `silent`, `error`, `warn`, `info`, or `debug`. |
| `-h`, `--help` | | Print help. |

## Programmatic proxy

```ts
import { createProxyServer } from "@playwright-backend-mocks/proxy";

const server = createProxyServer({
  port: 4310,
  claimTimeoutMs: 5000,
  logLevel: "info",
});

await server.start();
console.log(server.url);
```

See [Proxy operations](/ops/proxy).
