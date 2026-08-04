# Mock responses

Use `route.fulfill()` to return a complete mocked response to the Node app.

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.fulfill({
    status: 200,
    json: [{ id: 1, name: "Ada" }],
  });
});
```

`fulfill()` is terminal. After it resolves, the route is handled and no later handler runs.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `status` | `number` | `200`, or `response.status()` | HTTP status. `0` becomes `200`, matching Playwright. |
| `headers` | `Record<string, string \| number \| boolean \| undefined>` | `{}` or `response.headers()` | Response headers. Values are stringified; `undefined` is dropped. |
| `body` | `string \| Buffer \| Uint8Array` | none | Raw response body. |
| `json` | `unknown` | none | JSON-serializes the body and defaults `content-type` to `application/json`. |
| `contentType` | `string` | inferred | Sets or overrides `content-type`. |
| `path` | `string` | none | Reads a local file for the body and infers common content types. |
| `response` | `BackendResponse` | none | Uses a response from `route.fetch()` as the base. |

::: warning
Specify either `body` or `json`, not both. The route throws if both are present.
:::

## JSON

```ts
await backendMocks.route("https://api.example.test/profile", async (route) => {
  await route.fulfill({
    status: 200,
    json: {
      id: "user-1",
      plan: "enterprise",
    },
  });
});
```

`json` sets `content-type: application/json` unless you pass `contentType`.

## Raw body and headers

```ts
await backendMocks.route("https://api.example.test/export.csv", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "text/csv",
    headers: {
      "cache-control": "no-store",
    },
    body: "id,name\n1,Ada\n",
  });
});
```

Header keys are normalized to lowercase before sending. `transfer-encoding` is dropped, and `content-length` is calculated if you do not provide it.

## File bodies

```ts
await backendMocks.route("https://assets.example.test/logo.svg", async (route) => {
  await route.fulfill({
    path: "tests/fixtures/logo.svg",
  });
});
```

Common extensions such as `.json`, `.txt`, `.html`, `.css`, `.js`, `.png`, `.jpg`, `.svg`, `.webp`, `.pdf`, and `.xml` get matching content types. Unknown extensions use `application/octet-stream`.

## Use an upstream response as a base

Fetch the real response, then override the parts you need.

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const upstream = await route.fetch();
  const users = (await upstream.json()) as Array<{ id: number; name: string }>;

  await route.fulfill({
    response: upstream,
    json: [...users, { id: 999, name: "Injected" }],
  });
});
```

When `response` is provided:

- `status` defaults to `response.status()`.
- `headers` defaults to `response.headers()`.
- `statusText` and URL are preserved internally.
- If you do not pass `body`, `json`, or `path`, the fetched response body is reused.

Call `await upstream.dispose()` only after you are done using it; fulfilling with a disposed response throws.

## Inspect before fulfilling

```ts
await backendMocks.route("https://payments.example.test/charges", async (route, request) => {
  expect(request.method()).toBe("POST");
  expect(request.postDataJSON()).toEqual({ amount: 2000, currency: "usd" });

  await route.fulfill({
    status: 201,
    json: { id: "ch_mock", status: "succeeded" },
  });
});
```

See the full [Route API](/api/route) and [Response API](/api/response).
