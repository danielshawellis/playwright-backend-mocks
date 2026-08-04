# Living package → Playwright module map

Pinned SHA: **`26a9e47`** (`@playwright/test@1.62.1`). Deep dive: [`../research/playwright-network-parity.md`](../research/playwright-network-parity.md).

Blob URL shape used in source:

```text
https://github.com/microsoft/playwright/blob/26a9e47/<path>
```

| Our module | Playwright analogue(s) | Notes |
| --- | --- | --- |
| `playwright/src/backend-mocks.ts` | `client/network.ts` (`Request` / `Response` / `Route` / `RouteHandler`), `client/page.ts` (`_onRoute`, waiters, unroute), `client/fetch.ts`, `client/harRouter.ts` | Primary HTTP orchestration mirror |
| `playwright/src/websocket-route.ts` | `client/network.ts` (`WebSocketRoute` / handler) | Newest-match only (no HTTP-style fallback chain) |
| `playwright/src/route-from-har.ts` | `client/harRouter.ts`, `client/page.ts` (`routeFromHAR`) | `DIVERGENCE`: update/record path |
| `playwright/src/match.ts` | `@isomorphic/urlMatch` via protocol | Product `method` / `clientId` filters |
| `protocol/src/match.ts` | `@isomorphic/urlMatch` (`urlMatches`, glob → regex) | Shared with proxy claim filtering |
| `node/src/agent.ts` | Browser Fetch interceptor + channel settle | MSW HTTP interceptor → proxy protocol |
| `node/src/websocket-bridge.ts` | `injected/webSocketMock.ts` + WS dispatcher | `DIVERGENCE`: `globalThis.WebSocket` only |
| `proxy/src/server.ts` | Dispatcher / ownership seam | `DIVERGENCE`: cross-test `ambiguous_route` |

Intentional product differences are marked in source with `DIVERGENCE` / `DIVERGENCE END`.
