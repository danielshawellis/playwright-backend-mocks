# Modify upstream responses

Use `route.fetch()` followed by `route.fulfill()` when the real upstream response is useful but you need to change part of it.

## Add data to a JSON response

```ts
test("shows an injected user", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.example.test/users", async (route) => {
    const upstream = await route.fetch();
    const users = (await upstream.json()) as Array<{ id: number; name: string }>;

    await route.fulfill({
      response: upstream,
      json: [...users, { id: 999, name: "Injected" }],
    });
  });

  await page.goto("/users");
  await expect(page.getByText("Injected")).toBeVisible();
});
```

`response` preserves upstream status and headers unless you override them.

## Force an error body but keep upstream headers

```ts
await backendMocks.route("https://api.example.test/invoices", async (route) => {
  const upstream = await route.fetch();

  await route.fulfill({
    response: upstream,
    status: 503,
    json: {
      error: "service_unavailable",
      retryAfterSeconds: 30,
    },
  });
});
```

## Fetch a different upstream

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const fixture = await route.fetch({
    url: "https://fixtures.example.test/users",
    headers: {
      authorization: "Bearer fixture-token",
    },
  });

  await route.fulfill({ response: fixture });
});
```

## `continue()` vs `fetch()`

| Goal | Use |
| --- | --- |
| Let the app receive the upstream response unchanged | `await route.continue()` |
| Rewrite the request and return upstream unchanged | `await route.continue(overrides)` |
| Inspect or transform the upstream response | `const response = await route.fetch(); await route.fulfill(...)` |
| Fetch upstream more than once inside handler logic | `route.fetch()` |

`route.fetch()` is not terminal. Always settle the route afterward.

See [Modify and passthrough](/guide/modify-and-passthrough).
