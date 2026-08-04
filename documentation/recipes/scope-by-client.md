# Scope by clientId

Use `clientId` when more than one Node process can make the same outbound request.

## Start agents with stable names

```ts
// API server
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  clientId: "api-server",
});
```

```ts
// Background worker
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  clientId: "job-worker",
});
```

## Mock only the worker

```ts
test("worker receives a special job payload", async ({ backendMocks }) => {
  await backendMocks.route(
    {
      url: "https://api.example.test/jobs",
      clientId: "job-worker",
    },
    async (route) => {
      await route.fulfill({
        json: [{ id: "job-1", priority: "high" }],
      });
    },
  );

  // Trigger behavior that makes both API server and worker run.
  // Only job-worker requests to /jobs are mocked by this route.
});
```

## Assert which process called

```ts
const request = await backendMocks.waitForRequest(
  (request) =>
    request.clientId === "job-worker" &&
    request.url() === "https://api.example.test/jobs",
);

expect(request.method()).toBe("GET");
```

## Match several processes

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

## Avoid ambiguity

Without a `clientId` filter, a route can match every connected Node agent. That is useful for shared third-party mocks, but risky when multiple tests run concurrently against shared app processes.

Prefer specific matchers for singleton backend traffic:

```ts
await backendMocks.route(
  {
    url: "https://payments.example.test/charges",
    method: "POST",
    clientId: "api-server",
  },
  async (route) => {
    await route.fulfill({ status: 201, json: { id: "ch_mock" } });
  },
);
```

See [Multiple processes](/guide/multi-process) and [Matching requests](/guide/matching).
