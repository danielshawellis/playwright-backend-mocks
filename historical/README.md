# Historical material

Frozen reference from the pre-rewrite `@playwright-backend-mocks` era.

**Not wired** into the pnpm workspace, build, lint, docs deploy, or CI. Pull from it sporadically while rewriting; delete when no longer needed.

Contents:

- `packages/` — protocol, proxy, node agent, playwright fixtures, dashboard
- `fixtures/` — upstream, api-server, worker apps used by the prototype e2e suite
- `tests/` — unit, contract, and e2e suites for the prototype
- `documentation/` — old VitePress product site (prototype-era; will be reworked)

Living source of truth: [`../PHILOSOPHY.md`](../PHILOSOPHY.md). Rewrite plan: [`../research/rewrite-specification.md`](../research/rewrite-specification.md).
