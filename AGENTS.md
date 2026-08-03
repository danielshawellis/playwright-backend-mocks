# Agent notes

Read [`PHILOSOPHY.md`](./PHILOSOPHY.md) first. It states how this repository is developed.

Key pointers:

- **Oracle suite:** [`tests/parity/`](./tests/parity/) — complete Playwright-against-Playwright DX contract (including edges); library mode reuses the same suite.
- **Parity:** complete HTTP + WebSocket interception parity with Playwright; narrow exceptions only (browser-only concerns; additions like `clientId` on matchers).
- **Cross-test ownership:** if two tests claim the same Node request → fail loud (`ambiguous_route`); architect tests so this cannot happen.
- **Rewrite plan:** [`research/rewrite-specification.md`](./research/rewrite-specification.md)
- **Parity research:** [`research/playwright-network-parity.md`](./research/playwright-network-parity.md)
- **Product intent:** [`SPECIFICATION.md`](./SPECIFICATION.md)
