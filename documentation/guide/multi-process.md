# Multiple processes

One proxy can coordinate multiple Node agents. Give each app process a stable `clientId` so tests can scope routes and debug traffic.

## Start one agent per process

```ts
// API server process
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  token: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  clientId: "api-server",
});
```

```ts
// Worker process
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  token: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  clientId: "job-worker",
});
```

If you omit `clientId`, the agent defaults to `node-${process.pid}`.

## Scope routes by process

```ts
await backendMocks.route(
  {
    url: "https://api.example.test/jobs",
    clientId: "job-worker",
  },
  async (route) => {
    await route.fulfill({ json: [{ id: "job-1" }] });
  },
);
```

The same URL called by `api-server` does not match that route and can pass through or match another route.

## Match multiple processes

```ts
await backendMocks.route(
  {
    url: "https://metrics.example.test/**",
    clientId: ["api-server", "job-worker"],
  },
  async (route) => {
    await route.continue();
  },
);
```

## Avoid cross-test ownership collisions

The proxy asks all tests with active routes whether they claim each Node request. If two different tests claim the same request, the request fails with `ambiguous_route`.

Use one or more of these approaches:

| Approach | Example |
| --- | --- |
| Stable `clientId` filters | `{ url: "**/jobs", clientId: "job-worker" }` |
| Method filters | `{ url: "**/charges", method: "POST" }` |
| Per-test tenant data in URLs | `/tenant/${testInfo.testId}/...` |
| Isolated app processes | Start a Node app per worker or per test. |
| Serial groups | Use for intentionally shared singleton traffic. |

::: danger
Do not treat `ambiguous_route` as random flakiness. It means the suite allowed two tests to own the same backend request.
:::

## Inspect connected processes

```bash
curl -s http://127.0.0.1:4310/api/connections | jq .
```

The response lists `nodeAgents` with `clientId` and `connectionId`, plus Playwright workers and route counts.

## Stop agents cleanly

`startBackendMocks()` returns a handle:

```ts
const agent = await startBackendMocks({ clientId: "api-server" });

process.once("SIGTERM", async () => {
  await agent.stop();
});
```

Stopping disposes HTTP interceptors, the WebSocket bridge, pending requests, and the proxy connection.

See [Scope by clientId](/recipes/scope-by-client) for a focused recipe.
