# Dual-mode downstream architecture

## Philosophy

- **Upstream** is always a Node fake (`fixtures/upstream`, `fixtures/ws-upstream`).
- **Downstream outbound logic** is always the shared modules in `fixtures/downstream`
  (`triggerHttp`, `connectWebSocket` — WHATWG `fetch` / `globalThis.WebSocket`).
- Only the **host** switches between browser and Node. Specs call harness fixtures
  (`route`, `routeWebSocket`, `trigger`, `openDownstreamSocket`, …), never raw
  `page.route` / `page.evaluate` for the contract under test.

```text
Test author
  → harness routing API
  → downstream host (browser page OR Node process)
       using fixtures/downstream
  → upstream Node fake
```

## Shared core

`fixtures/downstream/src/{http,ws}.js` — isomorphic helpers used by both hosts.

## Hosts

| Mode                  | Host                       | How Playwright drives it                                                                                                                                   |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PARITY_MODE=browser` | `fixtures/browser-harness` | Harness loads shared helpers (inlined classic script so catch-all HTTP routes cannot strand module imports); fixtures call into `window.trigger` / sockets |
| `PARITY_MODE=node`    | `fixtures/node-downstream` | **Control-plane WebSocket** `ws://127.0.0.1:3001/control`                                                                                                  |

## Why a control-plane WebSocket (not one-shot HTTP)

Parity WebSocket tests need a long-lived app socket: open, send/receive over time, inspect `readyState`, close with codes, concurrency. One-shot HTTP helpers cannot express that.

The control plane is a JSON command channel from the Playwright worker → Node host. App sockets are real `globalThis.WebSocket` instances **inside** the Node process (where Step 2 will run `startBackendMocks`).

Protocol sketch (see `fixtures/node-downstream/src/server.js`):

- `http.request` → shared `triggerHttp`
- `ws.open` / `ws.send` / `ws.close` / `ws.info` + streamed `ws.event` frames

## Harness API

| Fixture / helper                     | Browser                                             | Node (Step 2)                              |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------ |
| `route` / `unroute` / `unrouteAll`   | `page.route*`                                       | `backendMocks.route*` (throws until wired) |
| `routeFromHAR`                       | `page.routeFromHAR`                                 | `backendMocks.routeFromHAR`                |
| `routeWebSocket`                     | `page.routeWebSocket`                               | `backendMocks.routeWebSocket`              |
| `trigger`                            | shared `triggerHttp` in page                        | control-plane → shared `triggerHttp`       |
| `openDownstreamSocket`               | shared `connectWebSocket` in page                   | control-plane → shared `connectWebSocket`  |
| `waitForRequest` / `waitForResponse` | Playwright waiters                                  | `backendMocks.waitFor*`                    |
| `withIsolatedDownstream`             | fresh context (HAR update flush / custom `baseURL`) | control-plane reset / Step 2 scope         |
| `sleep`                              | timer                                               | timer                                      |

Register `routeWebSocket` **before** opening sockets. The harness reloads the browser host when needed so Playwright’s WS init script applies.

## Commands

```bash
pnpm test:parity          # browser oracle (full suite)
pnpm test:parity:node     # node downstream smokes (passthrough HTTP + WS)
PARITY_NODE_FULL=1 pnpm test:parity:node   # full suite in node mode (mostly red until Step 2)
```
