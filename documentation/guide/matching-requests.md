# Matching requests

Matchers decide which outbound Node requests your handler receives. They must be **serializable** — no predicate functions — because matching runs in the proxy process.

## Matcher forms

```ts
type RouteMatcherInput =
  | string // URL glob
  | RegExp // URL regex
  | {
      url?: string | RegExp;
      method?: string | readonly string[];
      clientId?: string | readonly string[];
    };
```

## URL globs

String matchers use Playwright-style globs against the **full absolute URL**:

| Pattern | Meaning                                      |
| ------- | -------------------------------------------- |
| `*`     | Match within a single path segment (`[^/]*`) |
| `**`    | Match across segments (`.*`)                 |

```ts
await backendMocks.route("https://api.example.test/users", handler);
await backendMocks.route("https://api.example.test/users/*", handler);
await backendMocks.route("https://api.example.test/**", handler);
```

Exact string equality also matches (no wildcards needed).

## Regular expressions

```ts
await backendMocks.route(/\/users$/, async (route) => {
  await route.fulfill({ json: [] });
});
```

The regex is tested against the full request URL.

## Method filters

```ts
await backendMocks.route(
  { url: "https://api.example.test/echo", method: "POST" },
  async (route) => {
    await route.fulfill({ json: { mocked: true } });
  },
);
```

Methods are compared case-insensitively. Pass an array to allow multiple methods:

```ts
{ url: "https://api.example.test/items", method: ["GET", "HEAD"] }
```

A GET-only mock will not match POST to the same URL — the POST falls through to passthrough (or another route).

## clientId filters

When multiple Node agents connect, scope a route to one process:

```ts
await backendMocks.route(
  { url: "https://api.example.test/users", clientId: "job-worker" },
  async (route) => {
    await route.fulfill({ json: [{ id: 1, name: "WorkerOnly" }] });
  },
);
```

`clientId` is the value you passed to `startBackendMocks({ clientId })`. Arrays are supported.

See [Multiple processes](/guide/multiple-processes).

## Method- or client-only matchers

You can omit `url` and filter only by method and/or `clientId`:

```ts
await backendMocks.route({ method: "DELETE", clientId: "api-server" }, handler);
```

Use this carefully — broad matchers increase the chance of [ambiguous matches](#ambiguous-matches).

## Ambiguous matches

If **more than one** registered route matches a request:

1. The Node process receives an error (request fails).
2. Each affected Playwright test receives a proxy error (message matches `/Ambiguous backend mock routing/i`).
3. Unless you drain it with `backendMocks.takeErrors()`, fixture teardown fails the test.

```ts
// Too overlapping — both match /users
await backendMocks.route("https://api.example.test/users", handlerA);
await backendMocks.route(/users$/, handlerB);
```

Fix by narrowing URL patterns, adding `method` / `clientId`, or `unroute` before registering a replacement.

## What is not supported

- Predicate / function matchers (`(url) => boolean`) — not serializable across processes
- Matching on arbitrary header predicates in v1 — use the handler to inspect headers and `continue` / `abort` as needed

For `waitForRequest` method filtering, pass `{ method }` in the options object — see [Inspecting requests](/guide/inspecting-requests).
