# Node agent

Package: `@playwright-backend-mocks/node`

Install this in every Node process whose outbound HTTP you want to mock during Playwright runs.

## Exports

| Export                     | Kind     | Description                                   |
| -------------------------- | -------- | --------------------------------------------- |
| `startBackendMocks`        | function | Connect to the proxy and install interceptors |
| `StartBackendMocksOptions` | type     | Options bag                                   |
| `BackendMocksAgent`        | type     | Handle returned by `startBackendMocks`        |

## `startBackendMocks`

```ts
function startBackendMocks(
  options?: StartBackendMocksOptions,
): Promise<BackendMocksAgent>;

interface StartBackendMocksOptions {
  readonly proxyUrl?: string;
  readonly clientId?: string;
  readonly token?: string;
}

interface BackendMocksAgent {
  readonly clientId: string;
  stop(): Promise<void>;
}
```

### Options

| Option     | Default                                          | Description                                            |
| ---------- | ------------------------------------------------ | ------------------------------------------------------ |
| `proxyUrl` | `process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` | Proxy HTTP base URL. Empty / missing → **no-op agent** |
| `clientId` | `` `node-${process.pid}` ``                      | Stable ID for matchers and the dashboard               |
| `token`    | `process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN`     | Shared secret; must match proxy `--token` if set       |

### No-op behavior

When `proxyUrl` is undefined or `""`, the function resolves immediately with an agent whose `stop()` does nothing. Interceptors are **not** installed. This lets the same startup code run outside tests.

### Active behavior

1. Open a WebSocket to `{proxyUrl}/ws` and complete the handshake (`role: node`).
2. Install `@mswjs/interceptors` Node presets via `BatchInterceptor`.
3. On each outbound request (except traffic to the proxy itself), serialize the request, ask the proxy for a decision, and apply it.

### Decisions applied

| Decision    | Effect                                                                                 |
| ----------- | -------------------------------------------------------------------------------------- |
| passthrough | Request proceeds normally                                                              |
| fulfill     | Respond with the mocked response                                                       |
| continue    | Proceed, optionally with URL/method/headers/body overrides (via upstream fetch bypass) |
| abort       | Fail with `BackendMocksNetworkError` for the given code                                |
| fetch       | Perform upstream fetch (bypass), return result to the proxy for the Playwright handler |
| error       | Fail the request with the provided message                                             |

### `agent.stop()`

Removes interceptors, fails any in-flight mocked requests, and closes the WebSocket. Call this if your process outlives a test run and you need a clean shutdown; many e2e setups simply exit the process.

## Recommended integration

```ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

export async function startApp() {
  if (process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL !== undefined) {
    await startBackendMocks({
      proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
      clientId: "api-server",
    });
  }

  // …listen, etc.
}
```

Always pass a stable `clientId` when you have more than one process. See [Multiple processes](/guide/multiple-processes).

## Important behaviors

- **Bodies are buffered** in full before the proxy is consulted. Streaming bodies are not supported in v1.
- **No auto-reconnect.** If the WebSocket drops, pending requests fail with an actionable message; restart the agent against a running proxy.
- **Proxy URL traffic is skipped** so health checks / REST API fetches from the app don't recurse.
- **Upstream bypass** for `continue` overrides and `fetch` uses AsyncLocalStorage so those HTTP calls are not re-intercepted.
