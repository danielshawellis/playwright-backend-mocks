# Historical prototype

Frozen reference copy of the pre-rewrite `@playwright-backend-mocks` implementation.

Moved here per [`research/rewrite-specification.md`](../research/rewrite-specification.md) before the greenfield reimplementation.

**Not wired** into the pnpm workspace, build, lint, or CI. Use only as short-lived reference while Step 1/2 of the rewrite land. Delete this directory once it is no longer needed.

Contents:

- `packages/` — protocol, proxy, node agent, playwright fixtures, dashboard
- `fixtures/` — upstream, api-server, worker apps used by the prototype e2e suite
- `tests/` — unit, contract, and e2e suites for the prototype
