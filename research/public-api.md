# Public API Plan

Aligned with [`rewrite-specification.md`](./rewrite-specification.md) §4 and the living oracle in [`tests/parity/`](../tests/parity/).

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
- Connects over WebSocket, handshakes, installs `@mswjs/interceptors` node preset **and** `WebSocketInterceptor` for application sockets.
- Throws a clear error if the proxy is unreachable or rejects the handshake.
- If the proxy connection drops later, pending intercepted requests/sockets fail immediately with a clear error. There is no automatic reconnect in v1; restart the agent against a running proxy.
- On `stop()`, disposes interceptors and closes the socket.
- **App WebSocket caveat:** only `globalThis.WebSocket` is intercepted (not npm `ws` / direct Undici imports). See rewrite-specification §4.

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
  route(
    url: string | RegExp | ((url: URL) => boolean) | URLPattern | RouteMatcherObject,
    handler: RouteHandler,
    options?: { times?: number },
  ): Promise<{ [Symbol.dispose](): void }>;

  unroute(
    url?: string | RegExp | RouteMatcherObject,
    handler?: RouteHandler,
  ): Promise<void>;

  unrouteAll(options?: { behavior?: "wait" | "ignoreErrors" | "default" }): Promise<void>;

  /**
   * Playwright-compatible HAR record/replay.
   * Same HAR files / options as `page.routeFromHAR`
   * (`url`, `update`, `updateMode`, `updateContent`, `notFound`).
   */
  routeFromHAR(
    file: string,
    options?: {
      url?: string | RegExp | ((url: URL) => boolean);
      update?: boolean;
      updateMode?: "full" | "minimal";
      updateContent?: "embed" | "attach";
      notFound?: "abort" | "fallback";
    },
  ): Promise<void>;

  /**
   * Playwright-compatible WebSocket routing (`routeWebSocket` / `WebSocketRoute`).
   * Intercepts only `globalThis.WebSocket` in Node (loud docs required).
   * Not cleared by `unrouteAll` (matches Playwright).
   */
  routeWebSocket(
    url: string | RegExp | ((url: URL) => boolean) | URLPattern | RouteMatcherObject,
    handler: (ws: WebSocketRoute) => void | Promise<void>,
  ): Promise<void>;

  waitForRequest(
    url: string | RegExp | ((request: BackendRequest) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<BackendRequest>;

  waitForResponse(
    url: string | RegExp | ((response: BackendResponse) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<BackendResponse>;

  /** Snapshot of requests observed during this test (optionally filtered). */
  requests(
    url?: string | RegExp | RouteMatcherObject,
  ): Promise<readonly BackendRequest[]>;
}
```

### Matchers

```ts
interface RouteMatcherObject {
  readonly url?: string | RegExp | ((url: URL) => boolean) | URLPattern;
  readonly method?: string | readonly string[];
  readonly clientId?: string | readonly string[];
}
```

String matchers use Playwright-style globs (`*`, `**`). RegExp is serialized by `source` + `flags`. Predicates stay in the Playwright worker (claim broadcast).

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
  fallback(options?: ContinueOptions): Promise<void>;
  fetch(options?: FetchOptions): Promise<BackendResponse>;
  abort(errorCode?: BackendErrorCode): Promise<void>;
}

interface FulfillOptions {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer | Uint8Array;
  readonly json?: unknown;
  readonly contentType?: string;
  readonly path?: string;
  readonly response?: BackendResponse;
}

interface ContinueOptions {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly postData?: string | Buffer | Uint8Array | object;
}

interface FetchOptions extends ContinueOptions {
  readonly timeout?: number;
  readonly maxRedirects?: number;
  readonly maxRetries?: number;
}

type BackendErrorCode =
  | "failed"
  | "aborted"
  | "accessdenied"
  | "addressunreachable"
  | "blockedbyclient"
  | "blockedbyresponse"
  | "connectionaborted"
  | "connectionclosed"
  | "connectionfailed"
  | "connectionrefused"
  | "connectionreset"
  | "internetdisconnected"
  | "namenotresolved"
  | "timedout";
```

### `WebSocketRoute`

Mirrors Playwright’s `WebSocketRoute`:

```ts
interface WebSocketRoute {
  url(): string;
  protocols(): string[];
  connectToServer(): WebSocketRoute;
  send(message: string | Buffer): void;
  close(options?: { code?: number; reason?: string }): Promise<void>;
  onMessage(handler: (message: string | Buffer) => void): void;
  onClose(handler: (code?: number, reason?: string) => void): void;
}
```

Newest matching WS handler wins (no fallback chain). Installing `onMessage` / `onClose` disables that direction’s auto-forward after `connectToServer()`.

### `BackendRequest` / `BackendResponse`

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
  readonly clientId: string;
  failure(): { errorText: string } | null;
  response(): Promise<BackendResponse | null>;
  // Redirect chain helpers where the library observes them:
  redirectedFrom(): BackendRequest | null;
  redirectedTo(): BackendRequest | null;
}

interface BackendResponse {
  url(): string;
  status(): number;
  statusText(): string;
  ok(): boolean;
  headers(): Record<string, string>;
  headersArray(): Array<{ name: string; value: string }>;
  body(): Promise<Buffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  dispose(): Promise<void>;
}
```

Exact helper surface should track the oracle (`tests/parity/specs/inspection.spec.ts`, `fetch.spec.ts`) during Step 2.

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
- `GET /api/history` → JSON history
- `GET /api/connections` → connected agents/workers
- WebSocket at `/ws`
- Dashboard UI is a separate optional package/process (`@playwright-backend-mocks/dashboard`)

---

## Unsupported behavior (clear errors)

- Streaming request/response bodies
- gRPC / raw TCP sockets
- Application WebSockets **not** created via `globalThis.WebSocket` (npm `ws`, direct Undici imports, etc.) — bypass mocks; document loudly
- Other traffic outside `@mswjs/interceptors` coverage
- Protocol version mismatches

---

## Configuration summary

| Consumer   | Config                                                                          |
| ---------- | ------------------------------------------------------------------------------- |
| Node app   | `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL`, optional `PLAYWRIGHT_BACKEND_MOCKS_TOKEN` |
| Playwright | `use.backendMocksProxyUrl` / env var                                            |
| Proxy CLI  | flags above                                                                     |
