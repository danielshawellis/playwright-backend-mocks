# Dual-mode downstream architecture

## Shared core

`fixtures/downstream/src/{http,ws}.js` — isomorphic WHATWG `fetch` / `WebSocket` helpers used by both hosts.

## Hosts

| Mode                  | Host                       | How Playwright drives it                                                                                                                                    |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PARITY_MODE=browser` | `fixtures/browser-harness` | `page.evaluate` → `window.trigger` / page WebSocket (shared helpers inlined into one classic script so catch-all `page.route` cannot strand module imports) |
| `PARITY_MODE=node`    | `fixtures/node-downstream` | **Control-plane WebSocket** `ws://127.0.0.1:3001/control`                                                                                                   |

## Why a control-plane WebSocket (not one-shot HTTP)

Parity WebSocket tests need a long-lived app socket: open, send/receive over time, inspect `readyState`, close with codes, concurrency. One-shot HTTP helpers cannot express that.

The control plane is a JSON command channel from the Playwright worker → Node host. App sockets are real `globalThis.WebSocket` instances **inside** the Node process (where Step 2 will run `startBackendMocks`).

Protocol sketch (see `fixtures/node-downstream/src/server.js`):

- `http.request` → shared `triggerHttp`
- `ws.open` / `ws.send` / `ws.close` / `ws.info` + streamed `ws.event` frames

## Harness API

- `trigger(path)` — shared HTTP path (both modes)
- `openDownstreamSocket(url)` — long-lived socket handle (both modes)
- `route` / `routeFromHAR` — browser: Playwright; node: throws until Step 2 `backendMocks`

## Commands

```bash
pnpm test:parity          # browser oracle (full suite)
pnpm test:parity:node     # node downstream smokes (passthrough HTTP + WS)
PARITY_NODE_FULL=1 pnpm test:parity:node   # full suite in node mode (mostly red until Step 2)
```
