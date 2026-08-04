# Agent notes

Read [`PHILOSOPHY.md`](./PHILOSOPHY.md) first. Intention + architecture (proxy ↔ Node agent ↔ Playwright fixture), then the development assertions.

Key pointers:

- **Oracle suite:** [`tests/parity/`](./tests/parity/) — complete Playwright-against-Playwright DX contract (including edges); same specs + upstream; thin harness switches downstream browser ↔ Node.
- **Parity:** complete HTTP + WebSocket interception parity with Playwright; narrow exceptions only (browser-only concerns; additions like `clientId` on matchers).
- **Code mapping:** keep implementation close to Playwright; comment exact GitHub blob URLs at the pinned SHA; mark intentional differences with searchable `DIVERGENCE` / `DIVERGENCE END` comments.
- **Cross-test ownership:** if two tests claim the same Node request → fail loud (`ambiguous_route`); architect tests so this cannot happen.
- **Rewrite plan:** [`research/rewrite-specification.md`](./research/rewrite-specification.md)
- **Parity research:** [`research/playwright-network-parity.md`](./research/playwright-network-parity.md)
- **Product intent:** [`SPECIFICATION.md`](./SPECIFICATION.md)
