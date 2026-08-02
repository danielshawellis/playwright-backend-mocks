# Mocking requests

Every matched request runs a route handler. The handler receives a `BackendRoute` and must **settle** with exactly one terminal action.

```ts
await backendMocks.route("https://api.example.test/users", async (route, request) => {
  // inspect request, then settle:
  await route.fulfill({ json: [{ id: 1 }] });
});
```

## Terminal actions

| Action       | Effect                                                    |
| ------------ | --------------------------------------------------------- |
| `fulfill()`  | Return a mocked response to the Node process              |
| `continue()` | Let the original (or overridden) request proceed upstream |
| `abort()`    | Fail the outbound request with a network-style error      |

`fetch()` is **not** terminal — it performs an upstream request and returns the response to your handler. You still must `fulfill`, `continue`, or `abort` afterward.

If the handler returns without settling, the library aborts the Node request and records an error that fails the test on fixture teardown.

Calling a second terminal action throws `"Backend route already settled"`.

## fulfill

Mock a complete response:

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.fulfill({
    status: 200,
    json: [{ id: 1, name: "Ada" }],
  });
});
```

### Options

| Option        | Description                                                            |
| ------------- | ---------------------------------------------------------------------- |
| `status`      | HTTP status (default `200`, or the status from `response` if provided) |
| `headers`     | Response headers (keys normalized to lowercase)                        |
| `json`        | JSON body; sets `content-type: application/json` if unset              |
| `body`        | Raw body (`string` \| `Buffer` \| `Uint8Array`)                        |
| `contentType` | Sets / overrides `content-type`                                        |
| `path`        | Read a local file and use its contents as the body                     |
| `response`    | Base response from `route.fetch()`, optionally overridden              |

`content-length` and `transfer-encoding` are stripped before the response is sent so body length stays consistent.

### Inspect the request before fulfilling

```ts
await backendMocks.route("https://api.example.test/charges", async (route, request) => {
  expect(request.method).toBe("POST");
  expect(request.json()).toEqual({ amount: 42 });

  await route.fulfill({
    status: 201,
    json: { id: "ch_mock", status: "mocked" },
  });
});
```

## continue

Pass the request through to the real upstream:

```ts
await backendMocks.route("https://api.example.test/**", async (route) => {
  await route.continue();
});
```

Or rewrite it first:

```ts
await route.continue({
  url: "https://api.example.test/v2/users",
  method: "POST",
  headers: { "x-test": "1" },
  postData: JSON.stringify({ overridden: true }),
});
```

| Option     | Description                           |
| ---------- | ------------------------------------- |
| `url`      | Override request URL                  |
| `method`   | Override HTTP method                  |
| `headers`  | Override / merge headers (normalized) |
| `postData` | Override body                         |

## fetch

Fetch upstream **without** settling the route, then decide what to return. Use this to spy on or modify real responses:

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const upstream = await route.fetch();
  const users = upstream.json() as Array<{ id: number; name: string }>;
  users.push({ id: 100, name: "Extra" });
  await route.fulfill({ response: upstream, json: users });
});
```

`fetch` accepts the same overrides as `continue`, plus:

| Option    | Default | Description                               |
| --------- | ------- | ----------------------------------------- |
| `timeout` | `30000` | Milliseconds before `route.fetch` rejects |

The upstream call bypasses the Node interceptor so it does not re-enter your mocks.

## abort

Fail the outbound request as a network error:

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.abort("timedout");
});
```

Supported codes: `failed` (default), `aborted`, `timedout`, `connectionrefused`, `connectionreset`, `namenotresolved`.

See [Errors](/reference/errors) for default messages and how they surface in the app.

## unroute

Remove routes mid-test to restore passthrough:

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.fulfill({ json: [{ id: 1 }] });
});

// later…
await backendMocks.unroute("https://api.example.test/users");
// or remove everything registered by this test:
await backendMocks.unroute();
```

- `unroute()` — remove all routes for this test
- `unroute(matcher)` — remove routes whose matcher serializes equal to `matcher`
- `unroute(matcher, handler)` — also require the same handler function reference

Routes are always cleared automatically when the test ends.
