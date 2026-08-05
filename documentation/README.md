# Documentation

VitePress site for Playwright Backend Mocks. Content under `guide/`, `api/`, `recipes/`, and `ops/` documents the living packages in `packages/`.

## Scripts (from repo root)

```bash
pnpm docs:dev      # local preview with HMR
pnpm docs:build    # static output → .vitepress/dist
pnpm docs:preview  # serve the production build
```

## Deployment

Pushing to `main` runs [`.github/workflows/deploy-docs.yml`](../.github/workflows/deploy-docs.yml), which builds with `pnpm docs:build` and deploys `.vitepress/dist` to GitHub Pages (`base: /playwright-backend-mocks/`).

## Authoring notes

- Prefer Markdown. Use ordinary ` ```mermaid ` fences for diagrams (rendered site-wide).
- Use VitePress `::: code-group` for tabbed examples.
- Match the real library surface in `packages/playwright` and `packages/node` — request/response accessors are methods (`request.method()`, `await response.json()`).
- WebSocket docs must lead with the `globalThis.WebSocket`-only caveat.
