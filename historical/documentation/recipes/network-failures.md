# Simulate network failures

Exercise how your app handles outbound failures without flaky network conditions.

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  await route.abort("timedout");
});
```

## Available codes

| Code                | Default message               |
| ------------------- | ----------------------------- |
| `failed`            | `net::ERR_FAILED`             |
| `aborted`           | `net::ERR_ABORTED`            |
| `timedout`          | `net::ERR_TIMED_OUT`          |
| `connectionrefused` | `net::ERR_CONNECTION_REFUSED` |
| `connectionreset`   | `net::ERR_CONNECTION_RESET`   |
| `namenotresolved`   | `net::ERR_NAME_NOT_RESOLVED`  |

Omitting the code is equivalent to `abort("failed")`.

## What the app sees

The Node agent rejects the outbound call with a `BackendMocksNetworkError` (or a Fetch/`http` error wrapping that failure, depending on the client). Your application code should already handle request failures — assert on the UI or API error path those handlers produce.

```ts
test("shows timeout messaging", async ({ page, backendMocks }) => {
  await backendMocks.route("https://api.example.test/**", async (route) => {
    await route.abort("timedout");
  });

  await page.goto("/settings");
  await expect(page.getByText(/timed out|try again/i)).toBeVisible();
});
```

See [Errors reference](/reference/errors).
