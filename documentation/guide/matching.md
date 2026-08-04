# Matching requests

Matchers decide which outbound Node requests a route handler receives. Matching is evaluated in the Playwright worker so predicates and `URLPattern` objects can run locally.

## Matcher forms

```ts
type RouteUrl = string | RegExp | ((url: URL) => boolean) | URLPattern;

type RouteMatcherInput =
  | RouteUrl
  | {
      url?: RouteUrl;
      method?: string | readonly string[];
      clientId?: string | readonly string[];
    };
```

| Form | Example |
| --- | --- |
| Glob string | `"https://api.example.test/**"` |
| `RegExp` | `/\/users\/\d+$/` |
| Predicate | `(url) => url.hostname === "api.example.test"` |
| `URLPattern` | `new URLPattern("https://api.example.test/users/:id")` |
| Object | `{ url: "**/charges", method: "POST", clientId: "api-server" }` |

## Glob strings

String matchers use Playwright-style globs against the full absolute URL.

```ts
await backendMocks.route("https://api.example.test/users", handler);
await backendMocks.route("https://api.example.test/users/*", handler);
await backendMocks.route("https://api.example.test/**", handler);
```

| Pattern | Meaning |
| --- | --- |
| `*` | Match within one path segment. |
| `**` | Match across path separators. |
| `{a,b}` | Match one alternative. |

Relative globs resolve against the Playwright `baseURL` where that option is available to the fixture internals.

## Regular expressions

Regex matchers test the full URL string.

```ts
await backendMocks.route(/\/v1\/users\?active=true$/, async (route) => {
  await route.fulfill({ json: [] });
});
```

## Predicates

Predicate matchers receive a parsed `URL`.

```ts
await backendMocks.route(
  (url) =>
    url.hostname === "api.example.test" &&
    url.pathname.startsWith("/users") &&
    url.searchParams.get("preview") === "1",
  async (route) => {
    await route.fulfill({ json: [{ id: 1, name: "Preview" }] });
  },
);
```

Use the object form to combine a predicate with method or `clientId` filters:

```ts
await backendMocks.route(
  {
    url: (url) => url.pathname === "/charges",
    method: "POST",
    clientId: "api-server",
  },
  async (route) => {
    await route.fulfill({ status: 201, json: { id: "ch_test" } });
  },
);
```

## URLPattern

`URLPattern` works when the runtime provides it or when you install a compatible polyfill.

```ts
await backendMocks.route(
  new URLPattern("https://api.example.test/users/:id"),
  async (route, request) => {
    const id = new URL(request.url()).pathname.split("/").at(-1);
    await route.fulfill({ json: { id, name: "Mock User" } });
  },
);
```

## Method filters

Methods are compared case-insensitively. A method filter can be one string or an array.

```ts
await backendMocks.route(
  { url: "https://api.example.test/users", method: ["POST", "PUT"] },
  async (route) => {
    await route.fulfill({ status: 201, json: { ok: true } });
  },
);
```

## clientId filters

`clientId` identifies the Node agent that reported the request.

```ts
await backendMocks.route(
  { url: "https://api.example.test/jobs", clientId: "job-worker" },
  async (route) => {
    await route.fulfill({ json: [{ id: "job-1" }] });
  },
);
```

Arrays are supported:

```ts
await backendMocks.route(
  { url: "**/metrics", clientId: ["api-server", "job-worker"] },
  async (route) => {
    await route.abort("failed");
  },
);
```

See [Scope by clientId](/recipes/scope-by-client).

## Broad matchers

You can omit `url` and filter only by method or `clientId`.

```ts
await backendMocks.route({ method: "DELETE", clientId: "api-server" }, handler);
```

Use broad matchers carefully. They make cross-test collisions more likely.

## Cross-test ambiguity

If two different tests claim the same request, the proxy fails loud with `ambiguous_route`.

```ts
// Test A and Test B running at the same time:
await backendMocks.route("https://api.example.test/**", handler);
```

Fix ambiguity with narrower URL patterns, method filters, `clientId`, isolated app processes, or serial execution for tests that intentionally share backend traffic.

Within one test, multiple matching HTTP routes are fine: newest runs first, and `route.fallback()` moves to the next matching handler.

## Waiter matchers

`waitForRequest()` and `waitForResponse()` accept a glob string, `RegExp`, or predicate.

```ts
const request = await backendMocks.waitForRequest(
  (request) => request.method() === "POST" && request.url().endsWith("/charges"),
  { timeout: 10_000 },
);
```

::: warning
`waitForRequest` options are `{ timeout?, signal? }` only. There is no `{ method }` option. Filter method inside the predicate.
:::
