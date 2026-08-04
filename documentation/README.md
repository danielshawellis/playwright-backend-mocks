# Documentation

This directory contains the VitePress documentation site for Playwright Backend Mocks.

## Develop

Run from the repository root:

```bash
pnpm docs:dev
```

## Build

Run from the repository root:

```bash
pnpm docs:build
```

The VitePress config lives in `documentation/.vitepress/config.ts`. The site uses the living packages under `packages/` as the source of truth for API docs.
