# Inspecting requests

Beyond fulfilling responses, you often need to assert that your app **made** the right outbound call.

## BackendRequest

Handlers and spy APIs expose the same request shape:

```ts
interface BackendRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly postData: string | null;
  readonly postDataBuffer: Buffer | null;
  readonly clientId: string;
  json(): unknown; // JSON.parse(postData), or null if no body
}
```

Headers are normalized to lowercase keys.

## waitForRequest

Wait until a matching request has been dispatched to this test:

```ts
const pending = backendMocks.waitForRequest("https://api.example.test/charges", {
  method: "POST",
  timeout: 10_000, // default 30_000
});

await page.getByRole("button", { name: "Pay" }).click();

const seen = await pending;
expect(seen.json()).toEqual({ amount: 99 });
expect(seen.clientId).toBe("api-server");
```

Only requests that **matched a route owned by this test** are observed. Passthrough traffic does not appear here — use the [proxy dashboard / history API](/reference/proxy#http-endpoints) for global visibility.

## requests

Return all observed requests for this test so far, optionally filtered:

```ts
const all = await backendMocks.requests();
const charges = await backendMocks.requests("https://api.example.test/charges");
```

## takeErrors

Drain proxy errors recorded for the current test (ambiguity, disconnect notifications, handler failures surfaced via `proxy:error`):

```ts
const errors = backendMocks.takeErrors();
expect(errors[0]?.message).toMatch(/Ambiguous backend mock routing/i);
```

Any errors **not** drained are thrown as an `AggregateError` during fixture teardown. Use `takeErrors()` when a test intentionally triggers a failure mode.

## Dashboard and history

For a process-wide view while debugging:

- UI: `http://127.0.0.1:4310/dashboard`
- JSON: `GET /api/history`, `GET /api/connections`

History outcomes include `mocked`, `passthrough`, `continued`, `aborted`, `error`, and `pending`. History is in-memory and capped by `--history-limit` (default 1000).
