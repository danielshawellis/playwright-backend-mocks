# Technical Plan

## Repository structure

```text
/
├── SPECIFICATION.md
├── docs/
│   ├── research.md
│   ├── public-api.md
│   ├── protocol.md
│   └── technical-plan.md
├── packages/
│   ├── protocol/          # @playwright-backend-mocks/protocol
│   ├── proxy/             # @playwright-backend-mocks/proxy
│   ├── node/              # @playwright-backend-mocks/node
│   └── playwright/        # @playwright-backend-mocks/playwright
├── fixtures/
│   ├── upstream/          # fake upstream HTTP API
│   ├── api-server/        # Express-like app using fetch + axios
│   └── worker/            # background worker using node:http
├── tests/
│   ├── unit/
│   ├── contract/
│   └── e2e/               # Playwright tests against built packages
├── .github/workflows/
│   ├── ci.yml
│   └── publish.yml
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.cjs
└── README.md
```

pnpm workspace:

```yaml
packages:
  - "packages/*"
  - "fixtures/*"
  - "tests/*"
```

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` where practical
- Shared `tsconfig.base.json`
- Per-package `tsconfig.json` extending base
- Build with `tsup` → ESM + CJS + `.d.ts`
- NodeNext module resolution for packages

## Linting & formatting

- ESLint flat config with `@typescript-eslint`
- Prettier for formatting
- CI runs `pnpm lint`, `pnpm typecheck`, `pnpm format:check`

## Module formats

Each published package:

```json
{
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

Proxy package additionally exports a `bin` entry.

## Package responsibilities

### protocol

- Zod schemas for every message
- Inferred types
- `PROTOCOL_VERSION`, helpers to parse/serialize
- Body/header helpers
- Matcher types + matching pure functions (used by proxy; also tested in unit suite)

### proxy

- HTTP server (`node:http`) + `ws`
- CLI (`playwright-backend-mocks-proxy`)
- Connection registry
- Route registry & matching
- Request dispatch / pending map
- History ring buffer
- `/health`, `/api/*` (CORS-enabled read-only REST)
- Dashboard: separate optional Vue package/process consuming `/api/*`

### node

- WebSocket client to proxy
- `BatchInterceptor` + node preset
- Serialize intercepted requests
- Apply decisions via controller
- Upstream `fetch` for `decision:fetch`
- Lifecycle: `startBackendMocks` / `stop`

### playwright

- `test` fixture via `base.extend`
- Worker-scoped WS connection; test-scoped route registration
- `BackendMocks` / `BackendRoute` public API
- Maps handler results to protocol messages
- Surfaces `proxy:error` as test failures

## Lifecycles

### Proxy

1. Bind HTTP + WS
2. Accept handshakes
3. Serve until SIGINT/SIGTERM → close sockets, exit

### Node agent

1. Connect + hello
2. `interceptor.apply()`
3. On request → buffer body → `request:start` → await decision → apply
4. On stop/dispose → `interceptor.dispose()`, close WS

### Playwright fixture

1. Worker setup: connect WS, hello as `playwright`
2. Per test: `test:register`, provide `backendMocks`
3. Teardown: `test:unregister` (removes routes), reject pending handlers
4. Worker teardown: close WS

## Error handling

- All WS messages validated; invalid → log + optional `proxy:error`
- Ambiguous routes fail Node request and all matching tests
- Disconnects fail pending work with clear messages
- Unsupported features throw immediately in the calling API

## Testing

| Layer    | Tool       | Focus                                       |
| -------- | ---------- | ------------------------------------------- |
| Unit     | Vitest     | matchers, body encoding, schemas            |
| Contract | Vitest     | serialize/parse round-trips, reject invalid |
| E2E      | Playwright | full cross-process against built dist       |

Fixture apps run under Playwright `webServer` with proxy + upstream + api-server.

E2E scenarios (minimum):

- Mock JSON fulfill
- Passthrough to upstream
- fetch + modify + fulfill
- abort / error codes
- waitForRequest / requests()
- multiple node clients
- ambiguous route failure
- health + REST API reachable; optional dashboard process

## CI

`.github/workflows/ci.yml`:

- Node current LTS (22)
- `pnpm install --frozen-lockfile`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test`

## Release

`.github/workflows/publish.yml` on `release: published`:

- build + test
- `pnpm -r publish --access public` with `id-token: write` for npm OIDC

## Versioning

Root `package.json` version is source of truth; packages mirror `0.1.0` initially. Use changesets or a simple bump script later; v1 ships locked together.

## Dashboard

Separate package `@playwright-backend-mocks/dashboard` (Vue SPA + CLI):

- Connected node agents / playwright workers
- Recent history table (method, URL, client, outcome, test)
- Detail pane for selected entry
- Auto-refresh via proxy `GET /api/history` and `GET /api/connections`
- Not bundled with the proxy package

## Implementation order

1. Protocol package + unit/contract tests
2. Proxy server + CLI + health/REST API (+ optional dashboard package)
3. Node agent
4. Playwright fixtures
5. Fixture apps
6. E2E suite
7. CI + publish workflow + README
