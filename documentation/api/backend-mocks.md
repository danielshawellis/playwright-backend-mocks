# backendMocks

The `backendMocks` fixture is the Playwright-facing API for routing outbound Node traffic.

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";

test("mocks a backend call", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.example.test/users", async (route) => {
    await route.fulfill({ json: [{ id: 1, name: "Ada" }] });
  });

  await page.goto("/users");
});
```

## Fixture exports

```ts
export { test, expect } from "@playwright-backend-mocks/playwright";
```

The package also exports TypeScript types such as `BackendMocks`, `BackendRoute`, `BackendRequest`, `BackendResponse`, `RouteMatcherInput`, and `BackendMocksWorkerOptions`.

## `backendMocks.route(matcher, handler, options?)`

Registers an HTTP route for this test.

```ts
await backendMocks.route(
  { url: "https://api.example.test/charges", method: "POST" },
  async (route, request) => {
    expect(request.postDataJSON()).toEqual({ amount: 2000 });
    await route.fulfill({ status: 201, json: { id: "ch_mock" } });
  },
  { times: 1 },
);
```

| Parameter | Type | Description |
| --- | --- | --- |
| `matcher` | `RouteMatcherInput` | Glob, `RegExp`, predicate, `URLPattern`, or `{ url, method, clientId }`. |
| `handler` | `(route, request) => Promise<void> \| void` | Runs in the Playwright worker when this test owns the request. |
| `options.times` | `number` | Automatically unregister after this many handled matches. |

HTTP routes are newest-first within one test. Use `route.fallback()` to continue to the next matching route.

## `backendMocks.unroute(matcher?, handler?)`

Removes HTTP routes from this test.

```ts
const handler = async (route: BackendRoute) => {
  await route.fulfill({ json: [] });
};

await backendMocks.route("**/users", handler);
await backendMocks.unroute("**/users", handler);
```

| Call | Effect |
| --- | --- |
| `unroute()` | Remove all HTTP routes for this test. |
| `unroute(matcher)` | Remove routes whose matcher is equal to `matcher`. |
| `unroute(matcher, handler)` | Remove routes matching both the matcher and handler reference. |

## `backendMocks.unrouteAll(options?)`

Removes all HTTP routes for this test.

```ts
await backendMocks.unrouteAll({ behavior: "wait" });
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `behavior` | `"default" \| "wait" \| "ignoreErrors"` | `"default"` | How to treat active route handler invocations. |

`"default"` force-continues in-flight HTTP routes. `"wait"` waits for active handlers. `"ignoreErrors"` suppresses errors from active handlers.

::: warning
`unrouteAll()` removes HTTP routes only. WebSocket routes survive it.
:::

## `backendMocks.routeFromHAR(file, options?)`

Registers HAR replay or recording as an HTTP route.

```ts
await backendMocks.routeFromHAR("tests/fixtures/api.har", {
  url: "https://api.example.test/**",
  notFound: "fallback",
});
```

See [HAR](/guide/har).

## `backendMocks.routeWebSocket(url, handler)`

Registers a WebSocket route.

::: danger
WebSocket interception only supports app code using `globalThis.WebSocket`.
:::

```ts
await backendMocks.routeWebSocket("wss://events.example.test/socket", async (ws) => {
  ws.send("hello from test");
});
```

See [WebSocketRoute](/api/websocket-route).

## `backendMocks.waitForRequest(matcher, options?)`

Waits for a future outbound request.

```ts
const request = await backendMocks.waitForRequest(
  (request) => request.method() === "POST" && request.url().endsWith("/charges"),
  { timeout: 10_000 },
);
```

| Option | Type | Default |
| --- | --- | --- |
| `timeout` | `number` | `30000` |
| `signal` | `AbortSignal` | none |

## `backendMocks.waitForResponse(matcher, options?)`

Waits for a future outbound response.

```ts
const response = await backendMocks.waitForResponse(
  (response) => response.url().endsWith("/charges") && response.status() === 201,
);

expect(await response.json()).toEqual({ id: "ch_123" });
```

Options are `{ timeout?, signal? }`.

## `backendMocks.requests(matcher?)`

Returns observed requests for this test, optionally filtered by a normal route matcher.

```ts
const requests = await backendMocks.requests({
  url: "**/charges",
  method: "POST",
});

expect(requests[0]!.clientId).toBe("api-server");
```

## `backendMocks.takeErrors()`

Returns and clears proxy/handler errors recorded for this test.

```ts
const errors = backendMocks.takeErrors();
expect(errors[0]?.message).toMatch(/Ambiguous backend mock routing/);
```

Any remaining errors fail fixture teardown.
