# Playwright oracle / parity suite

Step 1 of the rewrite ([`research/rewrite-specification.md`](../../research/rewrite-specification.md)).

## Pins

| Item                      | Value                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `@playwright/test` npm    | `1.62.1` (exact; no `^`)                                                                    |
| Research inventory commit | `15b1aec` ([`playwright-network-tests.json`](../../research/playwright-network-tests.json)) |

Bump both deliberately when refreshing the oracle against a newer Playwright.

## Mode

```bash
PARITY_MODE=browser pnpm test   # default — stock Playwright only
# PARITY_MODE=backend           # Step 2 — not wired yet
```

Browser mode imports **only** `@playwright/test`. No `@playwright-backend-mocks/*`.

## Layout

- `harness.ts` — thin dual-mode seam (`route` / `trigger` / `unroute` / …)
- `specs/` — scenarios adapted from Playwright’s network suite + checklist gaps
- `checklist.md` — guaranteed API surface coverage and intentional skips
- Shared upstream: `fixtures/upstream`
- Browser downstream: `fixtures/browser-harness`

## Running

From repo root (after `pnpm install` and Chromium install):

```bash
pnpm test:parity
```
