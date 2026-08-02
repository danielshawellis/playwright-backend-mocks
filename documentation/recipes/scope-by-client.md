# Scope by clientId

When an API server and a worker both call the same upstream URL, mock only one of them.

## Setup

```ts
// API process
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  clientId: "api-server",
});

// Worker process
await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  clientId: "job-worker",
});
```

## Test

```ts
test("worker gets a special user list", async ({ request, backendMocks }) => {
  await backendMocks.route(
    {
      url: "https://api.example.test/users",
      clientId: "job-worker",
    },
    async (route) => {
      await route.fulfill({
        json: [{ id: 3, name: "WorkerOnly" }],
      });
    },
  );

  // API server → real upstream (passthrough)
  // Worker → mocked response
});
```

## Assert which process called

```ts
const seen = await backendMocks.waitForRequest("https://api.example.test/users");
expect(seen.clientId).toBe("job-worker");
```

Without a `clientId` filter, a single route matches **every** connected agent — which is often what you want for shared third-party mocks, and often what you don't want when processes must diverge.
