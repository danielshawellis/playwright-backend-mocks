# Abort and failures

Use `route.abort()` to make an outbound Node request fail like a network error.

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.abort("timedout");
});
```

`abort()` is terminal. The Node agent rejects the intercepted request, and `request.response()` resolves to `null`.

## Abort codes

The public route type accepts Playwright abort strings, but the current wire protocol carries this supported subset:

| Code | Default message |
| --- | --- |
| `failed` | `net::ERR_FAILED` |
| `aborted` | `net::ERR_ABORTED` |
| `timedout` | `net::ERR_TIMED_OUT` |
| `connectionrefused` | `net::ERR_CONNECTION_REFUSED` |
| `connectionreset` | `net::ERR_CONNECTION_RESET` |
| `namenotresolved` | `net::ERR_NAME_NOT_RESOLVED` |

Omitting the code is equivalent to `abort("failed")`.

::: tip
Unsupported Playwright abort strings are accepted by the TypeScript route API but collapse to `failed` on the wire.
:::

## Test user-visible failure handling

```ts
test("shows retry messaging when payments time out", async ({ page, backendMocks }) => {
  await backendMocks.route("https://payments.example.test/**", async (route) => {
    await route.abort("timedout");
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(page.getByText(/timed out|try again/i)).toBeVisible();
});
```

Different HTTP clients wrap network failures differently. Assert on your application behavior, not the internal error class, unless you are testing the agent itself.

## Handler failures

If a route handler throws, the fixture records the error and aborts the paused Node request with `failed` so your app does not hang.

```ts
await backendMocks.route("https://api.example.test/**", async () => {
  throw new Error("test setup failed");
});
```

Undrained errors fail fixture teardown as an `AggregateError`.

```ts
const errors = backendMocks.takeErrors();
expect(errors[0]?.message).toContain("test setup failed");
```

Use `takeErrors()` only when the test intentionally triggers the error path.

## Claim failures

| Failure | What happened |
| --- | --- |
| `ambiguous_route` | More than one test claimed the same request. |
| `claim_timeout` | A test with active routes did not answer a claim before the proxy timeout. |
| `disconnected` | The owning Playwright worker or Node agent disconnected while a request was active. |
| `internal` | The proxy could not complete coordination. |

See [Errors](/ops/errors) for the operational reference and [Troubleshooting](/guide/troubleshooting) for fixes.
