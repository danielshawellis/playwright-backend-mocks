# Node agent

The Node package installs interceptors in the real app process and connects them to the proxy.

```ts
import { startBackendMocks } from "@playwright-backend-mocks/node";

const agent = await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  token: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  clientId: "api-server",
});
```

## `startBackendMocks(options?)`

```ts
function startBackendMocks(
  options?: StartBackendMocksOptions,
): Promise<BackendMocksAgent>;
```

Starts the HTTP interceptor and WebSocket bridge when a proxy URL is configured.

When `proxyUrl` is missing or empty, it returns a no-op agent. This makes it safe to call from normal app startup code.

## Options

```ts
interface StartBackendMocksOptions {
  readonly proxyUrl?: string;
  readonly clientId?: string;
  readonly token?: string;
}
```

| Option | Default | Description |
| --- | --- | --- |
| `proxyUrl` | `process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` | Proxy base URL. Missing or empty means no-op. |
| `clientId` | `node-${process.pid}` | Process identity used in matchers, history, and diagnostics. |
| `token` | `process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN` | Optional shared token for the proxy handshake. |

## Return value

```ts
interface BackendMocksAgent {
  readonly clientId: string;
  stop(): Promise<void>;
}
```

`stop()` disposes the interceptors, closes the WebSocket bridge, fails pending requests, and closes the proxy connection.

```ts
const agent = await startBackendMocks({ clientId: "api-server" });

process.once("SIGTERM", async () => {
  await agent.stop();
});
```

## What is intercepted

The agent uses `@mswjs/interceptors` with the Node preset to catch outbound HTTP(S) from common Node clients and frameworks.

It also installs the WebSocket bridge for `globalThis.WebSocket`.

::: danger
Only `globalThis.WebSocket` is intercepted for app WebSockets. npm `ws` clients are not intercepted.
:::

The agent does not intercept traffic to the proxy itself.

## Request settlement

When a Node request is intercepted:

1. The agent serializes the request and sends it to the proxy.
2. The proxy chooses passthrough, a test-owned route, or an error.
3. The agent applies the decision:
   - `fulfill` returns the mocked response.
   - `continue` sends the request upstream and returns the response.
   - `abort` rejects with a network-style error.
   - `passthrough` sends the original request upstream.

`route.fetch()` also runs through the agent, but uses an internal bypass so the upstream fetch does not re-enter the mock pipeline.

## Redirect behavior

For `continue()` and passthrough settlement, the agent follows redirects and reports response observations so `waitForResponse()` and redirect links can work like Playwright.

## Related

- [Getting started](/guide/getting-started)
- [Multiple processes](/guide/multi-process)
- [Configuration](/guide/configuration)
