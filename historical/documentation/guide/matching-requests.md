# Matching requests

Matchers decide which outbound Node requests your handler receives. Matching runs in the **Playwright worker**: the proxy broadcasts each Node request to every test with active routes, waits for all claim replies, then enforces 0 / 1 / >1 ownership. Serializable matcher metadata is still registered with the proxy for diagnostics and history filters.

## Matcher forms

```ts
type RouteUrlPredicate = (url: URL) => boolean;

type RouteMatcherInput =
  | string // URL glob
  | RegExp // URL regex
  | RouteUrlPredicate // Playwright-style predicate
  | {
      url?: string | RegExp | RouteUrlPredicate;
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

## Predicate functions

Predicate matchers receive a parsed `URL` (same shape as Playwright's `page.route` predicates) and run in the Playwright worker during claim evaluation:

```ts
await backendMocks.route(
  (url) => url.hostname === "api.example.test" && url.pathname.startsWith("/users"),
  async (route) => {
    await route.fulfill({ json: [] });
  },
);
```

Combine with method / `clientId` filters via the object form:

```ts
await backendMocks.route(
  {
    url: (url) => url.searchParams.get("debug") === "1",
    method: "GET",
  },
  handler,
);
```

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

If **two different tests** claim the same Node request:

1. The Node process receives an error (request fails).
2. Each claiming Playwright test receives a proxy error (message matches `/Ambiguous backend mock routing/i`).
3. Unless you drain it with `backendMocks.takeErrors()`, fixture teardown fails the test.

This is **cross-test** ownership failure — not “two handlers in one test.” Within one test, Playwright-style HTTP LIFO + `fallback` (and WebSocket newest-match) apply.

```ts
// Bad concurrent setup: Test A and Test B both route the same URL without isolation
// Fix: mutually exclusive matchers, clientId / process boundaries, or serialize those tests
```

Treat `ambiguous_route` as a signal to fix the suite architecture, not ambient flakiness.

## What is not supported

- Matching on arbitrary header predicates at route-registration time — use a URL predicate and/or inspect headers in the handler, then `continue` / `abort` as needed

For `waitForRequest` method filtering, pass `{ method }` in the options object — see [Inspecting requests](/guide/inspecting-requests).
