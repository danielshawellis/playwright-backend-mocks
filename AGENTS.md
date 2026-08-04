# Agent notes

**Read [`PHILOSOPHY.md`](./PHILOSOPHY.md) first.** It is the high-level source of truth.

Doc hierarchy when sources disagree:

1. [`PHILOSOPHY.md`](./PHILOSOPHY.md)
2. Living oracle suite: [`tests/parity/`](./tests/parity/)
3. Rewrite / parity research: [`research/rewrite-specification.md`](./research/rewrite-specification.md), [`research/playwright-parity-tdd.md`](./research/playwright-parity-tdd.md), [`research/playwright-network-parity.md`](./research/playwright-network-parity.md)
4. Observability stack plan: [`research/observability-system-plan.md`](./research/observability-system-plan.md) (proxy REST, dashboard, MCP — library-only)
5. User-facing docs: [`documentation/`](./documentation/) (VitePress; plan: [`research/documentation-site-plan.md`](./research/documentation-site-plan.md))
6. [`historical/`](./historical/) — archived prototype + old VitePress site; reference only, not wired into the workspace

Key pointers from the philosophy:

- **Oracle suite:** complete Playwright-against-Playwright DX contract (including edges); same specs + upstream; thin harness switches downstream browser ↔ Node.
- **Parity:** complete HTTP + WebSocket interception parity with Playwright; narrow exceptions only.
- **Code mapping:** keep implementation close to Playwright; comment exact GitHub blob URLs at the pinned SHA; mark intentional differences with `DIVERGENCE` / `DIVERGENCE END`. Align TS/ESLint with the Playwright pin so the toolchain does not fight parity-shaped code.
- **Cross-test ownership:** if two **tests** claim the same Node request → fail loud (`ambiguous_route`); within one test, mirror Playwright handler rules. Architect suites so cross-test claims cannot happen.
