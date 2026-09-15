# Getting started example

Minimal Node app + Playwright project used by the [getting started guide](https://danielshawellis.github.io/playwright-backend-mocks/guide/getting-started).

## Quick start

From this directory (in the monorepo, build packages first):

```bash
pnpm install   # from repo root
pnpm build     # from repo root
pnpm --filter @playwright-backend-mocks/example-getting-started exec playwright install chromium
pnpm --filter @playwright-backend-mocks/example-getting-started test
```

Or scaffold a copy outside the monorepo:

```bash
npm create @playwright-backend-mocks@latest getting-started-demo
cd getting-started-demo
npm test
```
