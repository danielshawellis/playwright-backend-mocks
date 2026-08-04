# Matchers

Matchers are used by `route()`, `requests()`, and route ownership. Waiters use a related but smaller matcher shape.

## Route matcher types

```ts
type RouteUrl = string | RegExp | ((url: URL) => boolean) | URLPattern;

interface RouteMatcherObject {
  readonly url?: RouteUrl;
  readonly method?: string | readonly string[];
  readonly clientId?: string | readonly string[];
}

type RouteMatcherInput = RouteUrl | RouteMatcherObject;
```

## Forms

| Form | Matches |
| --- | --- |
| `string` | Playwright-style glob against the full URL. |
| `RegExp` | Full URL string. |
| `(url: URL) => boolean` | Parsed URL object. |
| `URLPattern` | URLPattern test against the URL. |
| `{ url, method, clientId }` | URL matcher plus method and Node process filters. |

## Glob string

```ts
await backendMocks.route("https://api.example.test/**", handler);
```

`*` matches inside a single path segment. `**` matches across path separators.

## RegExp

```ts
await backendMocks.route(/\/users\/\d+$/, handler);
```

The regular expression is reset and tested against the full URL.

## Predicate

```ts
await backendMocks.route(
  (url) => url.hostname === "api.example.test" && url.pathname === "/users",
  handler,
);
```

Predicates run in the Playwright worker during claim evaluation.

## URLPattern

```ts
await backendMocks.route(
  new URLPattern("https://api.example.test/users/:id"),
  handler,
);
```

The implementation accepts native `URLPattern` objects and compatible polyfill objects with `test`, `pathname`, and `hostname` fields.

## Object filters

```ts
await backendMocks.route(
  {
    url: "https://api.example.test/charges",
    method: "POST",
    clientId: "api-server",
  },
  handler,
);
```

| Field | Type | Description |
| --- | --- | --- |
| `url` | `RouteUrl` | Optional URL matcher. Omit to match all URLs. |
| `method` | `string \| readonly string[]` | Case-insensitive HTTP method filter. |
| `clientId` | `string \| readonly string[]` | Node agent identity filter. |

## Waiter matchers

```ts
type WaitForRequestMatcher =
  | string
  | RegExp
  | ((request: BackendRequest) => boolean | Promise<boolean>);

type WaitForResponseMatcher =
  | string
  | RegExp
  | ((response: BackendResponse) => boolean | Promise<boolean>);
```

Waiters do not accept object matchers. Use a predicate for method, status, header, or `clientId` filtering.

```ts
await backendMocks.waitForRequest(
  (request) => request.method() === "POST" && request.clientId === "api-server",
);
```

## Cross-test ownership

Serialized matcher metadata is registered with the proxy, but authoritative matching for predicates and `URLPattern` happens in the Playwright worker. If two different tests claim one request, the proxy emits `ambiguous_route`.

See [Matching requests](/guide/matching).
