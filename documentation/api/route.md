# Route

`BackendRoute` is passed to HTTP route handlers. It controls the paused Node request.

```ts
await backendMocks.route("https://api.example.test/users", async (route, request) => {
  console.log(request.method(), request.url());
  await route.fulfill({ json: [] });
});
```

## `route.request()`

Returns the current [BackendRequest](/api/request).

```ts
await backendMocks.route("**/users", async (route) => {
  const request = route.request();
  expect(request.method()).toBe("GET");
  await route.continue();
});
```

## `route.fulfill(options?)`

Returns a mocked response to the Node app.

```ts
await route.fulfill({
  status: 200,
  headers: { "cache-control": "no-store" },
  json: { ok: true },
});
```

| Option | Type | Description |
| --- | --- | --- |
| `status` | `number` | HTTP status, default `200` or `response.status()`. |
| `headers` | `Record<string, string \| number \| boolean \| undefined>` | Response headers. Values are coerced to strings. |
| `body` | `string \| Buffer \| Uint8Array` | Raw body. |
| `json` | `unknown` | JSON body. Cannot be combined with `body`. |
| `contentType` | `string` | Sets `content-type`. |
| `path` | `string` | Reads a local file as the body. |
| `response` | `BackendResponse` | Base response from `route.fetch()`. |

## `route.continue(options?)`

Sends the request upstream and returns the upstream response to the app.

```ts
await route.continue({
  headers: {
    "x-test-run": "checkout",
  },
});
```

| Option | Type | Description |
| --- | --- | --- |
| `url` | `string` | Override URL. Protocol must match the original URL. |
| `method` | `string` | Override method. |
| `headers` | `Record<string, string \| undefined>` | Override headers; `undefined` deletes the header. |
| `postData` | `string \| Buffer \| Uint8Array \| object` | Override body. Objects are JSON-stringified. |

## `route.fallback(options?)`

Applies local overrides and continues to the next matching route handler in the same test.

```ts
await backendMocks.route("**/users", async (route) => {
  await route.fulfill({ json: [{ id: 1 }] });
});

await backendMocks.route("**/users", async (route) => {
  await route.fallback({
    headers: { "x-test": "1" },
  });
});
```

`fallback()` is not terminal. If no later handler settles the route, the request continues upstream.

## `route.fetch(options?)`

Performs an upstream request and returns a [BackendResponse](/api/response). It does not settle the route.

```ts
const upstream = await route.fetch({ timeout: 10_000 });
const body = (await upstream.json()) as { users: unknown[] };
await route.fulfill({ response: upstream, json: body });
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | original URL | Override upstream URL. Must be `http:` or `https:`. |
| `method` | `string` | original method | Override method. |
| `headers` | `Record<string, string \| undefined>` | original headers | Override headers. |
| `postData` | `string \| Buffer \| Uint8Array \| object` | original body | Override body. |
| `timeout` | `number` | `30000` | Milliseconds before rejecting; `0` disables the timeout. |
| `maxRedirects` | `number` | `20` | Maximum redirects; `0` disables following. |
| `maxRetries` | `number` | `0` | Retry reset-style network failures. |
| `signal` | `AbortSignal` | none | Cancel the fetch. |

## `route.abort(errorCode?)`

Fails the request with a network-style error.

```ts
await route.abort("timedout");
```

Supported protocol codes:

`failed`, `aborted`, `timedout`, `connectionrefused`, `connectionreset`, `namenotresolved`.

The public type also includes Playwright abort strings such as `accessdenied` and `blockedbyclient`; unsupported strings are mapped to `failed` on the wire.

## Terminal behavior

`fulfill()`, `continue()`, and `abort()` are terminal. `fallback()` and `fetch()` are not.

Calling a route action after the route has already been handled throws.
