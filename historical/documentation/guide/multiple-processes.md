# Multiple processes

Real apps often have more than one Node process under test — an API server, a queue worker, a separate BFF. Each process that makes outbound HTTP should run its own agent with a distinct `clientId`.

## Assign stable client IDs

```ts
// api-server
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  clientId: "api-server",
});

// worker
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  clientId: "job-worker",
});
```

If you omit `clientId`, the default is `node-${process.pid}`, which changes every run and is awkward for matchers.

## Scope routes with clientId

```ts
await backendMocks.route(
  { url: "https://api.example.test/users", clientId: "job-worker" },
  async (route) => {
    await route.fulfill({ json: [{ id: 1, name: "WorkerOnly" }] });
  },
);
```

Requests from `api-server` to the same URL will **not** match this route (passthrough or another route applies).

## Playwright webServer for each process

Start every process under test with the proxy URL (and optional token) in its environment:

```ts
webServer: [
  {
    command: "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
    url: "http://127.0.0.1:4310/health",
  },
  {
    command: "npm run start:api",
    url: "http://127.0.0.1:3000/health",
    env: {
      PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: "http://127.0.0.1:4310",
    },
  },
  {
    command: "npm run start:worker",
    url: "http://127.0.0.1:3001/health",
    env: {
      PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL: "http://127.0.0.1:4310",
    },
  },
],
```

Confirm both agents appear under **Connections** via `GET /api/connections` or the optional dashboard.

## Concurrent Playwright tests

Routes from different tests can collide if they match the same outbound request. Strategies:

1. Prefer mutually exclusive matchers (`clientId`, method, unique URL prefixes).
2. Run sensitive suites with fewer workers / serial mode when isolation is hard.
3. Treat `ambiguous_route` (two tests claiming the same traffic) as a setup bug — tighten matchers / isolation; don't ignore it.

Each Playwright **worker** opens one connection to the proxy; each **test** registers its own routes on that connection.
