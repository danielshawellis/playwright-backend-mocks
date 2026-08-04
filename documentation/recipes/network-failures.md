# Network failures

Use `route.abort()` to exercise application error handling without flaky real network conditions.

## Simulate a timeout

```ts
test("shows retry copy when payments time out", async ({ page, backendMocks }) => {
  await backendMocks.route("https://payments.example.test/**", async (route) => {
    await route.abort("timedout");
  });

  await page.goto("/checkout");
  await page.getByRole("button", { name: "Pay" }).click();

  await expect(page.getByText(/timed out|try again/i)).toBeVisible();
});
```

## Simulate DNS failure

```ts
await backendMocks.route("https://api.example.test/**", async (route) => {
  await route.abort("namenotresolved");
});
```

## Available protocol codes

| Code | Default message |
| --- | --- |
| `failed` | `net::ERR_FAILED` |
| `aborted` | `net::ERR_ABORTED` |
| `timedout` | `net::ERR_TIMED_OUT` |
| `connectionrefused` | `net::ERR_CONNECTION_REFUSED` |
| `connectionreset` | `net::ERR_CONNECTION_RESET` |
| `namenotresolved` | `net::ERR_NAME_NOT_RESOLVED` |

Omitting the code is equivalent to `abort("failed")`.

## Fail only one request

Use `times` when only the next call should fail.

```ts
await backendMocks.route(
  "https://api.example.test/reports",
  async (route) => {
    await route.abort("connectionreset");
  },
  { times: 1 },
);
```

Later calls match older handlers or pass through.

## Assert the app behavior

Different HTTP clients expose network failures differently. Prefer user-visible assertions:

```ts
await expect(page.getByRole("alert")).toContainText("Please try again");
```

See [Abort and failures](/guide/abort-and-failures) and [Errors](/ops/errors).
