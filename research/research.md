# Research Notes

Findings that informed the v1 architecture. This is a decision log, not a comprehensive survey.

For a deeper dive into Playwright’s HTTP **and WebSocket** routing implementation, how closely this library can mirror it across the control-plane WebSocket boundary, MSW bridge gaps for `routeWebSocket`, and a catalog of Playwright’s related tests, see [`playwright-network-parity.md`](./playwright-network-parity.md) (test dump: [`playwright-network-tests.json`](./playwright-network-tests.json); living oracle: [`tests/parity/`](../tests/parity/)).

## Playwright request routing

Playwright’s browser-side routing is the DX target:

- `page.route(url, handler)` / `context.route(url, handler)`
- Handler receives a `Route` and must take exactly one terminal action
- Terminal actions: `fulfill`, `continue`, `abort`
- Non-terminal: `fetch` (perform upstream, return response for modification), `fallback` (next handler)

Matchers may be a string glob, RegExp, or predicate function. Predicates are evaluated in Playwright workers during claim broadcast; the proxy only stores a `predicate: true` marker for diagnostics.

`mergeTests()` composes fixture modules. Exporting a fixture-enabled `test` from `@playwright-backend-mocks/playwright` is the right integration point. Proxy URL is configured via a Playwright fixture option (`backendMocksProxyUrl`) with an env-var fallback.

Playwright `webServer` can start the proxy and the app under test, passing `PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL` into the app process.

## @mswjs/interceptors

Chosen interception layer (v0.42.x).

- `BatchInterceptor` + `@mswjs/interceptors/presets/node` covers Fetch, `http`/`https` (`ClientRequest`), and XMLHttpRequest.
- Request event: `{ request, requestId, controller }`
- `controller.respondWith(Response)` — mock response
- `controller.errorWith(Error)` — fail the request with a client-visible error
- No controller call — request continues to the real network (passthrough)
- `Response.error()` produces a network-error Response (Fetch semantics); prefer `errorWith` for explicit failures
- Async handlers are supported; the interceptor waits until a controller method is called or the listener settles without one
- Bodies arrive as Fetch-standard `Request` objects; buffer with `arrayBuffer()` / `text()` before cross-process send
- Streaming bodies are out of scope for v1; reject with a clear error if a body cannot be fully buffered

`RemoteHttpInterceptor` exists but uses Node IPC parent/child messaging. It does not fit a standalone multi-client WebSocket coordinator, so we implement our own protocol on top of `BatchInterceptor`.

## Architecture decision: WebSocket coordinator

All Node agents and Playwright workers connect to one standalone proxy over WebSockets.

Rationale:

- Matches the spec’s central coordinator model
- Supports multiple Node processes and multiple Playwright workers
- Proxy owns route registry, matching, history, and diagnostics
- Node/Playwright packages stay thin

Connection granularity: one WebSocket per Playwright worker, with test-scoped route registrations multiplexed over that connection. Node agents use one WebSocket per process.

## Failure simulation

Supported v1 error kinds map to interceptor actions:

| Public error                                                          | Node agent action                                          |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `failed` / `aborted`                                                  | `controller.errorWith(new Error(...))` or abort-like error |
| `timedout`                                                            | delayed `errorWith` with timeout semantics                 |
| `connectionrefused`, `connectionreset`, `namenotresolved`, `timedout` | `errorWith` with a labeled `BackendMocksNetworkError`      |

Perfect OS-level fidelity is not promised; clients may surface different error shapes.

## Passthrough and response modification

`continue()` → proxy tells Node agent to let the interceptor fall through (no controller call).

`fetch()` → Node agent performs the real upstream request outside the interceptor’s pending path (or via a temporary bypass), returns the buffered response to the Playwright handler, which may then `fulfill` with a modified body.

Implementation approach for `fetch`:

1. Playwright handler calls `route.fetch()`
2. Proxy sends `decision:fetch` to Node agent
3. Node agent temporarily allows that request URL through (or uses undici/fetch directly with the serialized request) and returns the response
4. Playwright may then `fulfill` with the modified response

For simplicity and correctness in v1, Node performs the upstream request with native `fetch` using the serialized request fields, then the Playwright handler fulfills. This approximates Playwright’s `route.fetch()` + `route.fulfill({ response, json })` pattern.

## Body encoding

Cross-process bodies are base64-encoded `Uint8Array` payloads plus content-type metadata. Text/JSON convenience is reconstructed on the Playwright side via `Request` helpers. Streaming is rejected.

## Schema library

Zod provides a single source of truth: runtime validators + inferred TypeScript types. Protocol messages are discriminated unions on `type`.

## Package publishing

GitHub Actions OIDC trusted publishing to npm on GitHub Release. All packages share one version.

## Spike conclusions

A thin spike confirmed:

1. `BatchInterceptor` + node preset intercepts Fetch, Axios (via http/https), and `node:http`
2. An async request listener can await a WebSocket round-trip before calling `respondWith`
3. Omitting a controller call passes the request through
4. `errorWith` surfaces a rejection to the caller
5. `interceptor.dispose()` cleanly removes patches

These behaviors are sufficient for the v1 design.

## Related plans

- [Rewrite Specification](./rewrite-specification.md) — archive the prototype, oracle suite against Playwright, then high-parity reimplementation (the plan to execute).
- [Playwright Parity via Oracle-Suite TDD](./playwright-parity-tdd.md) — write the request-routing suite against Playwright itself first, then switch the same suite onto this library.
