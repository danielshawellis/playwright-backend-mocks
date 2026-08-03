# Protocol Plan

Canonical definitions live in `@playwright-backend-mocks/protocol`. This document describes the wire contract.

## Transport

- WebSocket over the proxy HTTP server (`/ws`)
- Text frames containing JSON messages
- Every message is runtime-validated with Zod before handling

## Versioning

```ts
PROTOCOL_VERSION = 1;
```

Handshake includes:

- `protocolVersion` (integer)
- `packageVersion` (semver string)
- `role` (`"node"` | `"playwright"`)

Incompatible `protocolVersion` → close with actionable error. Mismatched package versions produce a warning in logs but are allowed when protocol versions match.

## Connection roles

| Role         | Purpose                                    |
| ------------ | ------------------------------------------ |
| `node`       | Application process with interceptor       |
| `playwright` | Playwright worker executing route handlers |

Optional `token` in handshake must match proxy `--token` when configured.

## Envelope

Every message:

```ts
{
  type: string; // discriminant
  // ...type-specific fields
}
```

IDs are UUID v4 strings.

---

## Handshake

### Client → Proxy: `hello`

```ts
{
  type: "hello";
  protocolVersion: number;
  packageVersion: string;
  role: "node" | "playwright";
  clientId?: string;       // required for node (or assigned)
  workerId?: string;       // playwright worker id
  token?: string;
}
```

### Proxy → Client: `hello:ok` | `hello:error`

```ts
{
  type: "hello:ok";
  connectionId: string;
  protocolVersion: number;
  packageVersion: string;
  clientId: string;
}

{
  type: "hello:error";
  code: "protocol_mismatch" | "unauthorized" | "invalid_hello";
  message: string;
}
```

---

## Heartbeat

```ts
{
  type: "ping";
  at: number;
}
{
  type: "pong";
  at: number;
}
```

Either side may ping. Missing pong within idle timeout disconnects the socket.

---

## Node → Proxy

### `request:start`

```ts
{
  type: "request:start";
  requestId: string;
  clientId: string;
  request: SerializedRequest;
}
```

### `request:cancel`

```ts
{
  type: "request:cancel";
  requestId: string;
  reason?: string;
}
```

### `fetch:result`

```ts
{
  type: "fetch:result";
  requestId: string;
  fetchId: string;
  ok: true;
  response: SerializedResponse;
} | {
  type: "fetch:result";
  requestId: string;
  fetchId: string;
  ok: false;
  error: SerializedError;
}
```

### `agent:error`

```ts
{
  type: "agent:error";
  message: string;
  detail?: unknown;
}
```

---

## Proxy → Node

### `decision:fulfill`

```ts
{
  type: "decision:fulfill";
  requestId: string;
  response: SerializedResponse;
}
```

### `decision:continue`

```ts
{
  type: "decision:continue";
  requestId: string;
  overrides?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    bodyBase64?: string | null;
  };
}
```

### `decision:abort`

```ts
{
  type: "decision:abort";
  requestId: string;
  errorCode: BackendErrorCode;
  message?: string;
}
```

### `decision:fetch`

Instruct Node to perform an upstream request and return `fetch:result`.

```ts
{
  type: "decision:fetch";
  requestId: string;
  fetchId: string;
  overrides?: { ... };
}
```

### `decision:passthrough`

Unmatched request — let interceptor fall through.

```ts
{
  type: "decision:passthrough";
  requestId: string;
}
```

### `decision:error`

Ambiguity or coordination failure.

```ts
{
  type: "decision:error";
  requestId: string;
  code: "ambiguous_route" | "handler_failed" | "disconnected" | "internal";
  message: string;
  matches?: RouteMatchDiagnostic[];
}
```

---

## Playwright → Proxy

### `test:register`

```ts
{
  type: "test:register";
  testId: string;
  title: string;
  file: string;
  workerId: string;
}
```

### `test:unregister`

```ts
{
  type: "test:unregister";
  testId: string;
}
```

### `route:register`

```ts
{
  type: "route:register";
  routeId: string;
  testId: string;
  matcher: SerializedMatcher;
}
```

### `route:unregister`

```ts
{
  type: "route:unregister";
  routeId: string;
} | {
  type: "route:unregister";
  testId: string; // remove all for test
}
```

### `handler:result`

```ts
{
  type: "handler:result";
  requestId: string;
  result:
    | { action: "fulfill"; response: SerializedResponse }
    | { action: "continue"; overrides?: ... }
    | { action: "abort"; errorCode: BackendErrorCode; message?: string }
    | { action: "fetch"; fetchId: string; overrides?: ... };
}
```

After a `fetch` action completes, Playwright sends a subsequent `handler:result` with `fulfill` / `continue` / `abort`.

### `history:query`

```ts
{
  type: "history:query";
  queryId: string;
  testId?: string;
  matcher?: SerializedMatcher;
}
```

---

## Proxy → Playwright

### `request:matched`

```ts
{
  type: "request:matched";
  requestId: string;
  routeId: string;
  testId: string;
  request: SerializedRequest;
  clientId: string;
}
```

### `fetch:done`

```ts
{
  type: "fetch:done";
  requestId: string;
  fetchId: string;
  ok: boolean;
  response?: SerializedResponse;
  error?: SerializedError;
}
```

### `history:result`

```ts
{
  type: "history:result";
  queryId: string;
  entries: HistoryEntry[];
}
```

### `proxy:error`

```ts
{
  type: "proxy:error";
  testId?: string;
  code: string;
  message: string;
  detail?: unknown;
}
```

---

## Serialization

### Headers

Lowercased map `Record<string, string>`. Multiple values joined with `, `.

### Body

```ts
{
  bodyBase64: string | null; // null when empty / no body
  bodyEncoding: "base64" | "none";
}
```

Streaming bodies are rejected before serialization.

### `SerializedRequest`

```ts
{
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyBase64: string | null;
}
```

### `SerializedResponse`

```ts
{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string | null;
}
```

### `SerializedMatcher`

```ts
{
  urlGlob?: string;
  urlRegex?: { source: string; flags: string };
  methods?: string[];
  clientIds?: string[];
}
```

### `SerializedError`

```ts
{
  name: string;
  message: string;
  stack?: string;
  code?: string;
}
```

### `HistoryEntry`

```ts
{
  id: string;
  timestamp: number;
  clientId: string;
  request: SerializedRequest;
  outcome:
    | { kind: "mocked"; response: SerializedResponse; routeId: string; testId: string }
    | { kind: "passthrough" }
    | { kind: "continued"; response?: SerializedResponse }
    | { kind: "aborted"; errorCode: string }
    | { kind: "error"; message: string };
  durationMs?: number;
  testId?: string;
  routeId?: string;
}
```

---

## Matching rules

For each `request:start`:

1. Evaluate all active route registrations.
2. Zero matches → `decision:passthrough`.
3. One match → `request:matched` to owning Playwright connection; await `handler:result`.
4. Multiple matches → `decision:error` (`ambiguous_route`) to Node; `proxy:error` to every matching Playwright test.

URL glob matching follows a Playwright-like algorithm (`*` / `**`). Method and clientId filters are case-insensitive for methods.

---

## Cancellation & disconnect

- Node `request:cancel` abandons pending proxy work for that id.
- Playwright disconnect → unregister all its routes/tests; pending requests get `decision:error` (`disconnected`).
- Node disconnect → pending requests for that agent fail; history records the error.
- Test unregister rejects outstanding handler waits for that test.

---

## Application WebSockets (Step 2 draft)

Control-plane traffic above is unrelated to **application** WebSockets. App sockets need a session-oriented companion to HTTP pause/settle. Exact Zod schemas land with the rewrite; shapes below mirror Playwright’s `WebSocketRoute` channel / injected mock (see [`playwright-network-parity.md`](./playwright-network-parity.md) §1b / §8).

### Registration

- Playwright registers WS handlers similarly to HTTP routes (`kind: "websocket"` or dedicated `wsRoute:*` messages).
- `unrouteAll` **must not** clear WebSocket routes (Playwright quirk).
- Matching uses Playwright-like URL rules with `webSocket=true`; predicates stay on the worker via claim broadcast.
- Zero matches → passthrough (real upstream). One owning `testId` → newest handler. Multiple `testId`s → `ambiguous_route`.

### Node → Proxy → Playwright (illustrative)

```ts
{ type: "ws:connection"; socketId: string; url: string; protocols: string[]; clientId: string }
{ type: "ws:messageFromPage"; socketId: string; data: string; isBase64: boolean }
{ type: "ws:messageFromServer"; socketId: string; data: string; isBase64: boolean }
{ type: "ws:closePage"; socketId: string; code?: number; reason?: string; wasClean: boolean }
{ type: "ws:closeServer"; socketId: string; code?: number; reason?: string; wasClean: boolean }
```

### Playwright → Proxy → Node (illustrative)

```ts
{ type: "ws:passthrough"; socketId: string }
{ type: "ws:connect"; socketId: string }          // connectToServer
{ type: "ws:ensureOpened"; socketId: string }     // mock open after handler
{ type: "ws:sendToPage"; socketId: string; data: string; isBase64: boolean }
{ type: "ws:sendToServer"; socketId: string; data: string; isBase64: boolean }
{ type: "ws:closePage"; socketId: string; code?: number; reason?: string; wasClean: boolean }
{ type: "ws:closeServer"; socketId: string; code?: number; reason?: string; wasClean: boolean }
```

Node applies these via `@mswjs/interceptors` `WebSocketInterceptor` plus a product bridge for Playwright open/close timing (`ensureOpened`, send-during-`CONNECTING`, connect-then-real-`onopen`). Only `globalThis.WebSocket` is in scope.

## Compatibility

- Protocol version is the hard gate.
- Additive optional fields may appear in future minor protocol bumps under the same major version only when ignored by older receivers.
- v1 receivers reject unknown required discriminants.
- Migration strategy: bump `PROTOCOL_VERSION` on breaking wire changes; ship all packages together.
