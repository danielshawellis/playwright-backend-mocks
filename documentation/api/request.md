# Request

`BackendRequest` represents an outbound Node HTTP request observed by the proxy.

::: warning
Request accessors are methods. Use `request.method()`, `request.url()`, `request.headers()`, and `request.postDataJSON()`, not properties.
:::

## Common accessors

| Method / property | Type | Description |
| --- | --- | --- |
| `request.url()` | `string` | Current request URL, including fallback overrides. |
| `request.method()` | `string` | Current HTTP method. |
| `request.headers()` | `Record<string, string>` | Current headers. |
| `request.allHeaders()` | `Promise<Record<string, string>>` | Same header set, async for Playwright parity. |
| `request.headersArray()` | `Promise<Array<{ name: string; value: string }>>` | Headers as name/value pairs. |
| `request.headerValue(name)` | `Promise<string \| null>` | Case-insensitive header lookup. |
| `request.postData()` | `string \| null` | UTF-8 request body. |
| `request.postDataBuffer()` | `Buffer \| null` | Raw request body. |
| `request.postDataJSON()` | `unknown` | Parsed JSON or form data object. |
| `request.clientId` | `string` | Node agent that made the request. |

```ts
await backendMocks.route("**/charges", async (route, request) => {
  expect(request.method()).toBe("POST");
  expect(await request.headerValue("content-type")).toContain("application/json");
  expect(request.postDataJSON()).toEqual({ amount: 2000 });
  expect(request.clientId).toBe("api-server");

  await route.fulfill({ status: 201, json: { id: "ch_mock" } });
});
```

## Body parsing

`postDataJSON()` behaves like Playwright:

| Body / content type | Result |
| --- | --- |
| No body | `null` |
| `application/x-www-form-urlencoded` | Object built from `URLSearchParams` entries. |
| Other body | `JSON.parse(request.postData())`. |
| Invalid JSON | Throws. |

```ts
const payload = request.postDataJSON() as { amount: number };
```

## Response links

| Method | Type | Description |
| --- | --- | --- |
| `request.response()` | `Promise<BackendResponse \| null>` | Resolves when the request settles, or `null` for abort/failure. |
| `request.existingResponse()` | `BackendResponse \| null` | Immediate response if already available. |
| `request.redirectedFrom()` | `BackendRequest \| null` | Previous request in a redirect chain. |
| `request.redirectedTo()` | `BackendRequest \| null` | Next request in a redirect chain. |
| `request.failure()` | `{ errorText: string } \| null` | Currently returns `null` for the backend request object. |

```ts
const response = await request.response();
expect(response?.status()).toBe(200);
```

## Browser-only stubs

These methods exist for Playwright shape compatibility.

| Method | Backend behavior |
| --- | --- |
| `request.resourceType()` | Returns `"other"`. |
| `request.frame()` | Throws because backend requests have no frame. |
| `request.serviceWorker()` | Returns `null`. |
| `request.isNavigationRequest()` | Returns `false`. |
| `request.timing()` | Returns stable placeholder timing values. |
| `request.sizes()` | Returns placeholder sizes. |

## Types

```ts
interface BackendRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  allHeaders(): Promise<Record<string, string>>;
  headersArray(): Promise<Array<{ name: string; value: string }>>;
  headerValue(name: string): Promise<string | null>;
  postData(): string | null;
  postDataBuffer(): Buffer | null;
  postDataJSON(): unknown;
  response(): Promise<BackendResponse | null>;
  existingResponse(): BackendResponse | null;
  readonly clientId: string;
}
```
