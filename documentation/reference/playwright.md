# Playwright fixture

Package: `@playwright-backend-mocks/playwright`

Peer dependency: `@playwright/test` ≥ 1.40.

## Exports

| Export                      | Kind     | Description                                              |
| --------------------------- | -------- | -------------------------------------------------------- |
| `test`                      | value    | Playwright `test` extended with `backendMocks`           |
| `expect`                    | value    | Re-export of `@playwright/test`'s `expect`               |
| `toSerializedMatcher`       | function | Convert a public matcher to the wire `SerializedMatcher` |
| `BackendMocksFixtures`      | type     | `{ backendMocks: BackendMocks }`                         |
| `BackendMocksWorkerOptions` | type     | Config `use` options                                     |
| `BackendMocks`              | type     | Fixture API                                              |
| `BackendRoute`              | type     | Per-request route handle                                 |
| `BackendRequest`            | type     | Observed / handler request                               |
| `BackendResponse`           | type     | Response from `route.fetch()`                            |
| `RouteHandler`              | type     | `(route, request) => void \| Promise<void>`              |
| `RouteMatcherInput`         | type     | Matcher union                                            |
| `RouteMatcherObject`        | type     | Object matcher shape                                     |
| `FulfillOptions`            | type     | `route.fulfill` options                                  |
| `ContinueOptions`           | type     | `route.continue` options                                 |
| `FetchOptions`              | type     | `route.fetch` options                                    |

## Worker options

```ts
type BackendMocksWorkerOptions = {
  backendMocksProxyUrl: string;
  backendMocksToken: string | undefined;
};
```

| Option                 | Scope  | Default                                                                       |
| ---------------------- | ------ | ----------------------------------------------------------------------------- |
| `backendMocksProxyUrl` | worker | `process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` ?? `"http://127.0.0.1:4310"` |
| `backendMocksToken`    | worker | `process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN`                                  |

Set via Playwright config `use` (see [Configuration](/guide/configuration)).

## Fixture lifecycle

1. **Worker start** — open one WebSocket to the proxy (`role: playwright`).
2. **Test start** — register a unique `testId`; create `backendMocks`.
3. **Test end** — dispose routes/test registration; throw `AggregateError` if undrained proxy errors remain.
4. **Worker end** — close the WebSocket.

## `backendMocks`

```ts
interface BackendMocks {
  route(url: RouteMatcherInput, handler: RouteHandler): Promise<void>;
  unroute(url?: RouteMatcherInput, handler?: RouteHandler): Promise<void>;
  waitForRequest(
    url: RouteMatcherInput,
    options?: { timeout?: number; method?: string },
  ): Promise<BackendRequest>;
  requests(url?: RouteMatcherInput): Promise<readonly BackendRequest[]>;
  takeErrors(): Error[];
}
```

### `route(matcher, handler)`

Register a test-scoped route. The matcher is serialized and sent to the proxy. When a single match occurs, `handler` runs in the Playwright worker.

The handler **must** settle with `fulfill`, `continue`, or `abort`. See [Mocking requests](/guide/mocking-requests).

### `unroute(matcher?, handler?)`

| Call                        | Effect                                          |
| --------------------------- | ----------------------------------------------- |
| `unroute()`                 | Unregister all routes for this test             |
| `unroute(matcher)`          | Unregister routes with equal serialized matcher |
| `unroute(matcher, handler)` | Also require the same handler reference         |

### `waitForRequest(matcher, options?)`

Poll observed matched requests until one matches (default timeout 30s, poll every 25ms). Optional `method` is applied as an additional method filter when serializing the matcher.

Throws if the timeout elapses.

### `requests(matcher?)`

Snapshot of matched requests observed so far for this test. With a matcher, filters the list.

### `takeErrors()`

Return and clear proxy errors for this test. Remaining errors still fail teardown if not drained.

## `BackendRoute`

```ts
interface BackendRoute {
  request(): BackendRequest;
  fulfill(options?: FulfillOptions): Promise<void>;
  continue(options?: ContinueOptions): Promise<void>;
  fetch(options?: FetchOptions): Promise<BackendResponse>;
  abort(errorCode?: BackendErrorCode): Promise<void>;
}
```

| Method               | Terminal? | Description                                          |
| -------------------- | --------- | ---------------------------------------------------- |
| `request()`          | no        | Same request passed as the handler's second argument |
| `fulfill(options?)`  | yes       | Mocked response to Node                              |
| `continue(options?)` | yes       | Proceed upstream (optional overrides)                |
| `fetch(options?)`    | **no**    | Upstream fetch; handler must still settle            |
| `abort(errorCode?)`  | yes       | Fail Node request; default `"failed"`                |

Second terminal call → throws `"Backend route already settled"`.

## Option types

### `FulfillOptions`

```ts
interface FulfillOptions {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer | Uint8Array;
  readonly json?: unknown;
  readonly contentType?: string;
  readonly path?: string;
  readonly response?: BackendResponse;
}
```

### `ContinueOptions`

```ts
interface ContinueOptions {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly postData?: string | Buffer | Uint8Array;
}
```

### `FetchOptions`

```ts
interface FetchOptions extends ContinueOptions {
  readonly timeout?: number; // default 30_000
}
```

## Request / response types

```ts
interface BackendRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly postData: string | null;
  readonly postDataBuffer: Buffer | null;
  readonly clientId: string;
  json(): unknown;
}

interface BackendResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  text(): string;
  json(): unknown;
}
```

## Matchers

```ts
type RouteUrl = string | RegExp;

interface RouteMatcherObject {
  readonly url?: RouteUrl;
  readonly method?: string | readonly string[];
  readonly clientId?: string | readonly string[];
}

type RouteMatcherInput = RouteUrl | RouteMatcherObject;

type RouteHandler = (
  route: BackendRoute,
  request: BackendRequest,
) => Promise<void> | void;
```

### `toSerializedMatcher(input, methodFilter?)`

```ts
function toSerializedMatcher(
  input: RouteMatcherInput,
  methodFilter?: string,
): SerializedMatcher;
```

- `string` → `{ urlGlob }`
- `RegExp` → `{ urlRegex: { source, flags } }`
- object → optional URL + `methods` + `clientIds`
- `methodFilter` adds a methods constraint when the input itself has none (used by `waitForRequest`)

Usually only needed for advanced tooling; the fixture calls this for you.
