# Configuration

## Environment variables

| Variable                             | Used by                                                                | Purpose                                                  |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` | Node agent (required to enable); Playwright fixture (optional default) | HTTP base URL of the proxy, e.g. `http://127.0.0.1:4310` |
| `PLAYWRIGHT_BACKEND_MOCKS_TOKEN`     | Node agent, Playwright fixture, proxy `--token`                        | Optional shared secret for WebSocket handshake           |

### Node agent

Without `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` (and without passing `proxyUrl` in options), `startBackendMocks()` returns a no-op agent. That is the production-safe default.

### Playwright fixture defaults

| Option                 | Default                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `backendMocksProxyUrl` | `process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` ?? `"http://127.0.0.1:4310"` |
| `backendMocksToken`    | `process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN`                                  |

Override in Playwright config:

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

## Proxy CLI

```bash
playwright-backend-mocks-proxy [options]
```

| Flag                     | Default     | Description                                        |
| ------------------------ | ----------- | -------------------------------------------------- |
| `--host <host>`          | `127.0.0.1` | Bind address                                       |
| `--port <port>`          | `4310`      | Bind port                                          |
| `--token <token>`        | _(none)_    | Require this token on handshake                    |
| `--history-limit <n>`    | `1000`      | Max in-memory history entries                      |
| `--heartbeat-ms <ms>`    | `15000`     | WebSocket ping interval                            |
| `--idle-timeout-ms <ms>` | `60000`     | Disconnect idle sockets                            |
| `--log-level <level>`    | `info`      | `silent` \| `error` \| `warn` \| `info` \| `debug` |
| `-h`, `--help`           |             | Show help                                          |

Recommended Playwright wiring:

```ts
{
  command: "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
  url: "http://127.0.0.1:4310/health",
  reuseExistingServer: !process.env.CI,
}
```

## Optional auth token

Use a token in CI or shared machines so stray processes cannot join the proxy:

```bash
playwright-backend-mocks-proxy --token secret
```

```ts
// playwright.config.ts
use: {
  backendMocksProxyUrl: proxyUrl,
  backendMocksToken: "secret",
}

// app env
PLAYWRIGHT_BACKEND_MOCKS_TOKEN=secret
```

All three sides (proxy, Playwright, Node) must agree. Mismatch → handshake `unauthorized` and the connection closes.

## Programmatic proxy

For custom runners or embedding:

```ts
import { createProxyServer } from "@playwright-backend-mocks/proxy";

const server = createProxyServer({ port: 4310, logLevel: "warn" });
await server.start();
// server.url → "http://127.0.0.1:4310"
await server.stop();
```

See [Proxy reference](/reference/proxy).

## Version alignment

- **Protocol version** must match across packages (handshake fails otherwise).
- **Package versions** should stay lockstep; skew logs a warning but may still connect.

Install / bump `@playwright-backend-mocks/*` together.
