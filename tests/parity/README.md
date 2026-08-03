# Playwright oracle / parity suite

Step 1 of the rewrite ([`research/rewrite-specification.md`](../../research/rewrite-specification.md)).

## Pins

| Item                       | Value                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `@playwright/test` npm     | `1.62.1` (exact; no `^`)                                                                    |
| `microsoft/playwright` SHA | `26a9e47` (tag `v1.62.1`)                                                                   |
| Research inventory commit  | `15b1aec` ([`playwright-network-tests.json`](../../research/playwright-network-tests.json)) |

See [`research/playwright-network-parity.md`](../../research/playwright-network-parity.md) for HTTP + WebSocket source mapping. Bump pins deliberately when refreshing the oracle against a newer Playwright.

## Dual-mode philosophy

Specs exercise **one** developer-facing routing surface through `harness.ts`. Upstream is always Node. Downstream outbound code is always `fixtures/downstream`. Only the host switches (`PARITY_MODE=browser|node`). See [`downstream.md`](./downstream.md).

## Modes

```bash
pnpm test:parity            # PARITY_MODE=browser — stock Playwright + browser downstream
pnpm test:parity:node       # PARITY_MODE=node — Node downstream control plane (passthrough smokes)
PARITY_NODE_FULL=1 pnpm test:parity:node   # full suite in node mode (mostly red until Step 2)
```

Browser mode imports **only** `@playwright/test` for routing (via the harness). Node mode uses the same specs; routing fixtures throw until Step 2 wires `backendMocks`.

## Layout

- `harness.ts` — thin dual-mode seam (`route` / `routeWebSocket` / `routeFromHAR` / `trigger` / `openDownstreamSocket` / waiters / `withIsolatedDownstream`)
- `node-control.ts` — Playwright ↔ Node control-plane client
- `specs/` — scenarios adapted from Playwright’s network suite + checklist gaps
- `specs/smoke-passthrough.spec.ts` — HTTP + WS passthrough green in both modes
- Shared upstream: `fixtures/upstream`, `fixtures/ws-upstream`
- Shared downstream core: `fixtures/downstream`
- Browser host: `fixtures/browser-harness`
- Node host: `fixtures/node-downstream`

## Running

From repo root (after `pnpm install` and Chromium install):

```bash
pnpm test:parity
pnpm test:parity:node
```
