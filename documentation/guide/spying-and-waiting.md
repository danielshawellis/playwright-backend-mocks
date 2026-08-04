# Spying and waiting

Use `waitForRequest()`, `waitForResponse()`, and `requests()` to assert that your server made the expected outbound calls.

## Wait for a request

Register the waiter before the UI action that triggers the backend call.

```ts
const chargeRequest = backendMocks.waitForRequest(
  (request) =>
    request.method() === "POST" &&
    request.url() === "https://payments.example.test/charges",
);

await page.goto("/checkout");
await page.getByRole("button", { name: "Pay" }).click();

const request = await chargeRequest;
expect(request.postDataJSON()).toEqual({
  amount: 2000,
  currency: "usd",
});
```

`waitForRequest()` observes future Node requests, including passthrough traffic reported by the proxy.

## Wait for a response

```ts
const chargeResponse = backendMocks.waitForResponse(
  (response) =>
    response.url() === "https://payments.example.test/charges" &&
    response.status() === 201,
);

await page.getByRole("button", { name: "Pay" }).click();

const response = await chargeResponse;
expect(await response.json()).toEqual({ id: "ch_123", status: "succeeded" });
```

`waitForResponse()` is future-only. Responses for requests that started before the waiter was registered do not satisfy it.

## Waiter matchers

| Matcher | Example |
| --- | --- |
| Glob string | `"https://api.example.test/**"` |
| `RegExp` | `/\/charges$/` |
| Predicate | `(request) => request.method() === "POST"` |

Request predicates receive `BackendRequest`. Response predicates receive `BackendResponse`.

## Options

`waitForRequest()` and `waitForResponse()` accept the same options.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `timeout` | `number` | `30000` | Milliseconds before rejecting. `0` waits forever. |
| `signal` | `AbortSignal` | none | Cancels the waiter. |

::: warning
Options are `{ timeout?, signal? }` only. There is no `{ method }` option. Use a predicate when you need method filtering.
:::

## Abort a waiter

```ts
const controller = new AbortController();
const pending = backendMocks.waitForRequest("**/slow", {
  signal: controller.signal,
});

controller.abort("No longer needed");
await expect(pending).rejects.toThrow("No longer needed");
```

## Read observed requests

`requests()` returns the requests observed by this test so far. Pass a normal route matcher to filter.

```ts
const all = await backendMocks.requests();
const charges = await backendMocks.requests({
  url: "https://payments.example.test/charges",
  method: "POST",
});

expect(charges).toHaveLength(1);
expect(charges[0]!.clientId).toBe("api-server");
```

Request accessors are methods:

```ts
const [request] = await backendMocks.requests("**/charges");

expect(request!.url()).toContain("/charges");
expect(request!.method()).toBe("POST");
expect(request!.headers()["content-type"]).toContain("application/json");
```

## Drain expected proxy errors

```ts
const errors = backendMocks.takeErrors();
expect(errors.map((error) => error.message)).toContainEqual(
  expect.stringMatching(/Ambiguous backend mock routing/),
);
```

Any errors left after the test body fail fixture teardown. Do not drain unexpected errors.

## Global debugging

For process-wide history outside one test, use the proxy REST API:

```bash
curl http://127.0.0.1:4310/api/history
```

See [REST API](/ops/rest-api).
