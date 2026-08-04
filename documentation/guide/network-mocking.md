# Network mocking

Use `backendMocks` to mock, inspect, modify, or fail outbound network calls made by your Node application while a Playwright test drives the real UI.

```ts
test("checkout handles a declined payment", async ({ page, backendMocks }) => {
  await backendMocks.route("https://payments.example.test/charges", async (route) => {
    await route.fulfill({
      status: 402,
      json: { error: "card_declined" },
    });
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText("Your card was declined")).toBeVisible();
});
```

## The core APIs

| API | Use it to |
| --- | --- |
| `route(matcher, handler, options?)` | Intercept matching Node requests. |
| `unroute(matcher?, handler?)` | Remove one or more HTTP routes. |
| `unrouteAll(options?)` | Remove all HTTP routes for the test. |
| `routeFromHAR(file, options?)` | Replay or record Playwright-style HAR files. |
| `routeWebSocket(url, handler)` | Intercept `globalThis.WebSocket` connections. |
| `waitForRequest(matcher, options?)` | Wait for a future outbound request. |
| `waitForResponse(matcher, options?)` | Wait for a future outbound response. |
| `requests(matcher?)` | Read observed requests for the test. |
| `takeErrors()` | Drain proxy errors intentionally triggered by the test. |

## What a route handler can do

| Method | Terminal | Description |
| --- | --- | --- |
| `route.fulfill(options?)` | Yes | Return a mocked response. |
| `route.continue(options?)` | Yes | Send the request upstream, optionally with overrides. |
| `route.abort(errorCode?)` | Yes | Fail the request with a network-style error. |
| `route.fallback(options?)` | No | Apply local overrides and pass to the next matching handler. |
| `route.fetch(options?)` | No | Fetch upstream from the handler, then decide what to return. |

`route.fetch()` does not settle the route. Finish with `fulfill`, `continue`, or `abort`.

## Inspect requests and responses

Request and response accessors are methods, like Playwright:

```ts
await backendMocks.route("https://api.example.test/users", async (route, request) => {
  expect(request.method()).toBe("POST");
  expect(request.url()).toContain("/users");
  expect(request.postDataJSON()).toEqual({ name: "Ada" });

  const upstream = await route.fetch();
  expect(upstream.status()).toBe(200);

  const body = (await upstream.json()) as { users: unknown[] };
  await route.fulfill({ response: upstream, json: body });
});
```

Use `response.status()` and `await response.json()` on the response returned by `route.fetch()` or `waitForResponse()`.

## Passthrough by default

Unmatched requests continue to the real network. This keeps setup small, but it also means a missing route can hit a real third-party service.

::: tip
While authoring tests, inspect `GET /api/history` on the proxy to confirm which requests were mocked, continued, aborted, or passed through.
:::

## Typical workflows

| Goal | Page |
| --- | --- |
| Choose glob, RegExp, predicate, URLPattern, method, or `clientId` matching | [Matching requests](/guide/matching) |
| Return hard-coded JSON, a file, or a fetched response | [Mock responses](/guide/mock-responses) |
| Rewrite upstream requests or modify upstream responses | [Modify and passthrough](/guide/modify-and-passthrough) |
| Simulate network errors | [Abort and failures](/guide/abort-and-failures) |
| Assert your app sent a request | [Spying and waiting](/guide/spying-and-waiting) |
| Record/replay HAR | [HAR](/guide/har) |
