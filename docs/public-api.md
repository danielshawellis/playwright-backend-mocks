# Public API Plan

## Packages

| Package                                | Purpose                              | Publish                                          |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `@playwright-backend-mocks/protocol`   | Shared types, schemas, serialization | yes (internal consumers; also public for typing) |
| `@playwright-backend-mocks/proxy`      | Standalone proxy CLI + server        | yes                                              |
| `@playwright-backend-mocks/node`       | Node.js interception agent           | yes                                              |
| `@playwright-backend-mocks/playwright` | Playwright fixtures + routing API    | yes                                              |

All packages share the same version.

---

## `@playwright-backend-mocks/node`

### `startBackendMocks(options?)`

```ts
interface StartBackendMocksOptions {
  readonly proxyUrl?: string; // default: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL
  readonly clientId?: string; // default: `node-${process.pid}`
  readonly token?: string; // optional auth token
}

interface BackendMocksAgent {
  readonly clientId: string;
  stop(): Promise<void>;
}

function startBackendMocks(
  options?: StartBackendMocksOptions,
): Promise<BackendMocksAgent>;
```

Behavior:

- No-ops (returns a stopped agent) when `proxyUrl` is unset, so production code can call it unconditionally when desired.
- Connects over WebSocket, handshakes, installs `@mswjs/interceptors` node preset.
- Throws a clear error if the proxy is unreachable or rejects the handshake.
- If the proxy connection drops later, pending intercepted requests fail immediately with a clear error. There is no automatic reconnect in v1; restart the agent against a running proxy.
- On `stop()`, disposes interceptor and closes the socket.

Environment variable: `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL`.

Optional token: `PLAYWRIGHT_BACKEND_MOCKS_TOKEN`.

---

## `@playwright-backend-mocks/playwright`

### Fixture module

```ts
import { test, expect } from "@playwright-backend-mocks/playwright";
// or mergeTests with local fixtures
```

Fixtures / options:

```ts
type BackendMocksFixtures = {
  backendMocks: BackendMocks;
};

type BackendMocksWorkerOptions = {
  backendMocksProxyUrl: string;
  backendMocksToken: string | undefined;
};
```

`backendMocksProxyUrl` defaults to `process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` or `http://127.0.0.1:4310`.

### `BackendMocks`

```ts
interface BackendMocks {
  route(url: string | RegExp | RouteMatcherObject, handler: RouteHandler): Promise<void>;

  unroute(
    url?: string | RegExp | RouteMatcherObject,
    handler?: RouteHandler,
  ): Promise<void>;

  /** Wait for a matching request observed by the proxy. */
  waitForRequest(
    url: string | RegExp | RouteMatcherObject,
    options?: { timeout?: number; method?: string },
  ): Promise<BackendRequest>;

  /** Snapshot of requests observed during this test (optionally filtered). */
  requests(
    url?: string | RegExp | RouteMatcherObject,
  ): Promise<readonly BackendRequest[]>;
}
```

### Matchers

```ts
interface RouteMatcherObject {
  readonly url?: string | RegExp;
  readonly method?: string | readonly string[];
  readonly clientId?: string | readonly string[];
}
```

String matchers use Playwright-style globs (`*`, `**`). RegExp is serialized by `source` + `flags`.

### `Route` (handler argument)

```ts
type RouteHandler = (
  route: BackendRoute,
  request: BackendRequest,
) => Promise<void> | void;

interface BackendRoute {
  request(): BackendRequest;
  fulfill(options?: FulfillOptions): Promise<void>;
  continue(options?: ContinueOptions): Promise<void>;
  fetch(options?: FetchOptions): Promise<BackendResponse>;
  abort(errorCode?: BackendErrorCode): Promise<void>;
}

interface FulfillOptions {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer | Uint8Array;
  readonly json?: unknown;
  readonly contentType?: string;
  readonly path?: string; // read file and use as body
  readonly response?: BackendResponse; // from fetch()
}

interface ContinueOptions {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly postData?: string | Buffer | Uint8Array;
}

interface FetchOptions extends ContinueOptions {
  readonly timeout?: number;
}

type BackendErrorCode =
  | "failed"
  | "aborted"
  | "timedout"
  | "connectionrefused"
  | "connectionreset"
  | "namenotresolved";
```

### `BackendRequest` / `BackendResponse`

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

---

## `@playwright-backend-mocks/proxy`

### CLI

```bash
playwright-backend-mocks-proxy [options]
```

Options:

| Flag                | Default     | Description                                        |
| ------------------- | ----------- | -------------------------------------------------- |
| `--host`            | `127.0.0.1` | Bind host                                          |
| `--port`            | `4310`      | Bind port                                          |
| `--token`           | unset       | Optional shared secret                             |
| `--history-limit`   | `1000`      | In-memory history entries                          |
| `--heartbeat-ms`    | `15000`     | Ping interval                                      |
| `--idle-timeout-ms` | `60000`     | Disconnect idle sockets                            |
| `--log-level`       | `info`      | `silent` \| `error` \| `warn` \| `info` \| `debug` |

### HTTP endpoints

- `GET /health` → `{ ok: true, version, protocolVersion }`
- `GET /dashboard` → read-only HTML dashboard
- `GET /api/history` → JSON history
- `GET /api/connections` → connected agents/workers
- WebSocket at `/ws`

---

## Unsupported behavior (clear errors)

- Streaming request/response bodies
- Predicate-function matchers
- Application WebSocket / gRPC / raw sockets
- Traffic outside `@mswjs/interceptors` coverage
- Protocol version mismatches

---

## Configuration summary

| Consumer   | Config                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| Node app   | `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL`, optional `PLAYWRIGHT_BACKEND_MOCKS_TOKEN` |
| Playwright | `use.backendMocksProxyUrl` / env var                                            |
| Proxy CLI  | flags above                                                                     |
