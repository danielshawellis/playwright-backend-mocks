# Limitations

v1 optimizes for the common Playwright + Node HTTP mocking case. Unsupported behavior fails clearly rather than partially working.

## Out of scope

| Area                              | Notes                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Browser traffic                   | Use Playwright `page.route()` / `context.route()`                                                |
| Non-global WebSockets             | App WS via npm `ws` / direct Undici imports is **not** intercepted (only `globalThis.WebSocket`) |
| gRPC / raw TCP                    | Not supported                                                                                    |
| Streaming request/response bodies | Bodies are fully buffered; streaming failures surface as errors                                  |
| Auto-reconnect                    | If the proxy dies, restart the agent against a running proxy                                     |

## Interception coverage

Interception uses `@mswjs/interceptors` Node presets for HTTP, plus `WebSocketInterceptor` for application sockets created with **`globalThis.WebSocket`**. Clients that never enter those interceptors cannot be mocked — and unlike HTTP, common WS clients often bypass the global constructor.

Axios and similar libraries are typically covered when they use `http`/`https` under the hood, but always verify with a quick route in your environment.

## Passthrough default

Unmatched requests go to the real network. That is intentional, but easy to miss when writing tests. Prefer explicit mocks for external services, and check the dashboard's passthrough entries while developing.

## Concurrent tests

Overlapping routes from parallel tests produce **ambiguous match** failures. Keep matchers mutually exclusive or serialize those tests.

## Resource bounds

- Request/response bodies are held in memory for the round trip.
- Proxy history is capped (`--history-limit`, default 1000) and not persisted.
- Large binary payloads work, but very large bodies increase memory use in the agent, proxy, and Playwright worker.

## Error fidelity

`abort()` codes map to common Chromium-like `net::ERR_*` messages. They will not reproduce every OS-level socket failure nuance — they are enough for application error-handling tests.
