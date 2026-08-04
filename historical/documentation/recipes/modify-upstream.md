# Modify upstream responses

Sometimes you want the real upstream response with a small tweak — an extra field, a forced error shape, or a header change — without fully stubbing the payload.

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const upstream = await route.fetch();
  const users = upstream.json() as Array<{ id: number; name: string }>;
  users.push({ id: 100, name: "Injected" });

  await route.fulfill({
    response: upstream, // keep status / headers as a base
    json: users, // replace body
  });
});
```

## Fetch a different URL

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const upstream = await route.fetch({
    url: "https://api.example.test/echo",
    method: "POST",
    headers: { "content-type": "application/json" },
    postData: JSON.stringify({ from: "test" }),
  });

  await route.fulfill({
    status: 200,
    json: { fetched: upstream.json() },
  });
});
```

## continue vs fetch

| Goal                                                                        | Use                                     |
| --------------------------------------------------------------------------- | --------------------------------------- |
| Send (optionally rewritten) request upstream and return that response as-is | `continue(overrides?)`                  |
| Inspect / transform the upstream response in the test                       | `fetch(overrides?)` then `fulfill(...)` |

`fetch` never settles the route by itself — always finish with a terminal action.
