# Concepts

A small architecture with three roles. Understanding them makes every other page in these docs obvious.

## Architecture

```
┌─────────────────────┐         WebSocket          ┌──────────────────────┐
│  Playwright worker  │ ◄────────────────────────► │                      │
│  backendMocks.route │                            │  Proxy coordinator   │
│  fulfill / continue │                            │  + dashboard         │
└─────────────────────┘                            │  + request history    │
                                                   └──────────▲───────────┘
                                                              │ WebSocket
                                                   ┌──────────┴───────────┐
                                                   │  Node app process(es)│
                                                   │  startBackendMocks() │
                                                   │  @mswjs/interceptors │
                                                   └──────────────────────┘
                                                              │
                                                   outbound HTTP/HTTPS
```

1. **Node agent** pauses an outbound request and asks the proxy what to do.
2. **Proxy** matches the request against routes registered by Playwright tests.
3. **Playwright fixture** runs your route handler and returns a decision (`fulfill`, `continue`, `abort`, or a `fetch` round-trip).

You almost never interact with the protocol directly. You write tests against `backendMocks` and start the agent + proxy around your app.

## The three packages you use day to day

| Package                                | Role                                                          |
| -------------------------------------- | ------------------------------------------------------------- |
| `@playwright-backend-mocks/proxy`      | CLI process that coordinates matching and serves `/dashboard` |
| `@playwright-backend-mocks/node`       | Agent installed in each Node process under test               |
| `@playwright-backend-mocks/playwright` | `test` fixture exposing `backendMocks`                        |

`@playwright-backend-mocks/protocol` is shared wire types for the packages above. Application tests rarely import it.

## Route lifecycle

1. A test calls `backendMocks.route(matcher, handler)`.
2. The fixture registers that matcher with the proxy for the current `testId`.
3. When a Node agent reports an outbound request, the proxy finds matching routes.
4. On a single match, your handler runs and must settle with `fulfill`, `continue`, or `abort`.
5. When the test ends, routes are unregistered automatically.

## Matching outcomes

| Matches | Result                                                                   |
| ------- | ------------------------------------------------------------------------ |
| **0**   | Passthrough — the Node process continues the real request                |
| **1**   | Your handler runs                                                        |
| **>1**  | Ambiguous — the Node request fails and Playwright receives a proxy error |

Design matchers so concurrent tests (or overlapping routes in one test) stay unambiguous. Prefer method / `clientId` filters when URLs collide.

## Passthrough by default

Unmatched traffic is **not** blocked. That keeps setup light, but it also means a missing route can hit a real service. Prefer explicit mocks for anything external or costly, and use the [dashboard](/reference/proxy#http-endpoints) while writing tests to confirm what was mocked vs passed through.

## Test scope vs worker scope

- **Worker:** one WebSocket from the Playwright worker to the proxy (shared across tests in that worker).
- **Test:** each test gets its own `backendMocks` instance, `testId`, and route set.

Routes never leak across tests. Observed requests and drained errors belong to the current test only.
