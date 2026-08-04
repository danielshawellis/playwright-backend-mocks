# Modify and passthrough

Use `continue()`, `fallback()`, and `fetch()` when a request should reach the real upstream service, with or without changes.

## Choose the right method

| Method | Terminal | Use it when |
| --- | --- | --- |
| `route.continue(options?)` | Yes | You want the app to receive the real upstream response as-is. |
| `route.fallback(options?)` | No | You want the next matching handler in the same test to see the request. |
| `route.fetch(options?)` | No | You want to inspect or transform the upstream response before fulfilling. |

Unmatched requests also pass through automatically.

## Continue upstream

```ts
await backendMocks.route("https://api.example.test/**", async (route) => {
  await route.continue();
});
```

`continue()` is useful when you want to observe a request through `waitForRequest()` or proxy history while still hitting the real service.

## Continue with overrides

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.continue({
    url: "https://staging-api.example.test/users",
    method: "POST",
    headers: {
      "x-test-run": "checkout",
    },
    postData: { seeded: true },
  });
});
```

### Continue options

| Option | Type | Description |
| --- | --- | --- |
| `url` | `string` | Override the request URL. The protocol must match the original URL. |
| `method` | `string` | Override the HTTP method. |
| `headers` | `Record<string, string \| undefined>` | Override request headers; `undefined` deletes that header. |
| `postData` | `string \| Buffer \| Uint8Array \| object` | Override the request body. Objects are JSON-stringified. |

Forbidden browser-style headers such as `host`, `cookie`, `content-length`, `connection`, `origin`, `referer`, `sec-*`, and `proxy-*` are restored from the original request where applicable.

## Fallback to another handler

`fallback()` applies local request overrides, then lets the next matching handler run.

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.fulfill({ json: [{ id: 1, name: "Base" }] });
});

await backendMocks.route("https://api.example.test/users", async (route, request) => {
  if (request.headers()["x-use-base"] === "1") {
    await route.fallback({
      headers: {
        ...request.headers(),
        "x-seen-by-first-handler": "1",
      },
    });
    return;
  }

  await route.fulfill({ json: [{ id: 2, name: "Newest" }] });
});
```

HTTP routes are newest-first. In this example, the second route runs first and can fall back to the first route.

## Fetch then modify

`fetch()` performs an upstream request from the handler without settling the route.

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const upstream = await route.fetch();
  const users = (await upstream.json()) as Array<{ id: number; name: string }>;

  await route.fulfill({
    response: upstream,
    json: [...users, { id: 999, name: "Injected by test" }],
  });
});
```

### Fetch options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | original URL | Upstream URL for the fetch. Must be `http:` or `https:`. |
| `method` | `string` | original method | Upstream method. |
| `headers` | `Record<string, string \| undefined>` | original headers | Request headers; `undefined` values are dropped. |
| `postData` | `string \| Buffer \| Uint8Array \| object` | original body | Request body. Objects get JSON content-type defaults. |
| `timeout` | `number` | `30000` | Milliseconds before the fetch rejects. `0` disables the timeout. |
| `maxRedirects` | `number` | `20` | Maximum redirects. `0` means do not follow redirects. |
| `maxRetries` | `number` | `0` | Retries for reset-style network failures. |
| `signal` | `AbortSignal` | none | Cancels the fetch promise. |

`fetch()` bypasses the Node interceptor so it does not re-enter your backend mock routes.

## Rewriting one upstream to another

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const response = await route.fetch({
    url: "https://fixtures.example.test/users",
    headers: {
      authorization: "Bearer test-token",
    },
  });

  await route.fulfill({ response });
});
```

## Related pages

- [Mock responses](/guide/mock-responses)
- [Spying and waiting](/guide/spying-and-waiting)
- [Route API](/api/route)
