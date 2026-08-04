# Response

`BackendResponse` represents a fulfilled, continued, passthrough, fetched, or waited-for HTTP response.

::: warning
Response accessors are methods. Use `response.status()` and `await response.json()`, not `response.status` or `response.json`.
:::

## Accessors

| Method / property | Type | Description |
| --- | --- | --- |
| `response.ok()` | `boolean` | `true` for status `200` through `299`. |
| `response.url()` | `string` | Final response URL. |
| `response.status()` | `number` | HTTP status. |
| `response.statusText()` | `string` | HTTP status text. |
| `response.headers()` | `Record<string, string>` | Response headers. |
| `response.headersArray()` | `Array<{ name: string; value: string }>` | Headers as name/value pairs. |
| `response.headerValue(name)` | `string \| null` | Case-insensitive header lookup. |
| `response.body()` | `Promise<Buffer>` | Body buffer. |
| `response.text()` | `Promise<string>` | UTF-8 body text. |
| `response.json()` | `Promise<unknown>` | JSON-parsed body. |
| `response.request()` | `BackendRequest` | Request associated with the response. |
| `response.dispose()` | `Promise<void>` | Marks the response body as disposed. |
| `response.bodyBuffer` | `Buffer` | Buffered body for `fulfill({ response })` helpers. |

## From `route.fetch()`

```ts
await backendMocks.route("https://api.example.test/users", async (route) => {
  const response = await route.fetch();

  expect(response.ok()).toBe(true);
  expect(response.status()).toBe(200);

  const users = (await response.json()) as Array<{ id: number; name: string }>;
  await route.fulfill({
    response,
    json: users.filter((user) => user.id !== 0),
  });
});
```

## From `waitForResponse()`

```ts
const pending = backendMocks.waitForResponse(
  (response) => response.url().endsWith("/charges") && response.status() === 201,
);

await page.getByRole("button", { name: "Pay" }).click();

const response = await pending;
expect(await response.json()).toEqual({ id: "ch_123" });
```

## Dispose

`dispose()` mirrors Playwright's API response shape. After disposal, `body()`, `text()`, and `json()` throw.

```ts
const response = await route.fetch();
const body = await response.json();
await response.dispose();
```

Do not dispose a response before passing it to `route.fulfill({ response })`; fulfilling with a disposed response throws.

## Types

```ts
interface BackendResponse {
  ok(): boolean;
  url(): string;
  status(): number;
  statusText(): string;
  headers(): Record<string, string>;
  headersArray(): Array<{ name: string; value: string }>;
  headerValue(name: string): string | null;
  body(): Promise<Buffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  request(): BackendRequest;
  dispose(): Promise<void>;
  readonly bodyBuffer: Buffer;
}
```
