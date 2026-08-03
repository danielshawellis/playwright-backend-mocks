# Technical Plan

Living plan for the rewrite. Product intent: [`SPECIFICATION.md`](../SPECIFICATION.md). Execution order: [`rewrite-specification.md`](./rewrite-specification.md).

## Repository structure

```text
/
├── SPECIFICATION.md
├── research/                 # architecture + rewrite plans (this folder)
├── documentation/            # VitePress site
├── packages/                 # Step 2 greenfield (not present until reimplementation)
│   ├── protocol/             # @playwright-backend-mocks/protocol
│   ├── proxy/                # @playwright-backend-mocks/proxy
│   ├── node/                 # @playwright-backend-mocks/node
│   ├── playwright/           # @playwright-backend-mocks/playwright
│   └── dashboard/            # optional Vue dashboard
├── fixtures/
│   ├── upstream/             # fake upstream HTTP API (always Node)
│   ├── ws-upstream/          # fake upstream WebSocket server (always Node)
│   ├── downstream/           # shared isomorphic fetch + WebSocket helpers
│   ├── browser-harness/      # browser host that inlines fixtures/downstream
│   └── node-downstream/      # Node host + control-plane WS; Step 2 enables mocks
├── tests/
│   ├── parity/               # dual-mode oracle (browser | node)
│   ├── library/              # Step 2: clientId / ambiguity / disconnect (later)
│   ├── unit/                 # Step 2: pure helpers
│   └── contract/             # Step 2: wire protocol
├── historical/               # frozen prototype (not in workspace)
├── .github/workflows/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── prettier.config.cjs
└── README.md
```

pnpm workspace (Step 1 / current):

```yaml
packages:
  - "fixtures/*"
  - "tests/parity"
```

Step 2 adds `packages/*` (and later `tests/library`, unit/contract as needed).

## Dual-mode oracle philosophy

```text
Test author
  → harness routing API  (page.* in browser mode → backendMocks.* in node mode)
  → downstream host using fixtures/downstream
  → upstream Node fake
```

| Role       | Always                                                              |
| ---------- | ------------------------------------------------------------------- |
| Upstream   | Node servers (`fixtures/upstream`, `fixtures/ws-upstream`)          |
| Downstream | Shared `fixtures/downstream` (`triggerHttp`, `connectWebSocket`)    |
| Host swap  | Browser harness page **or** Node process + `/control` WebSocket     |
| Specs      | Call harness fixtures only — not raw `page.route` / `page.evaluate` |

See [`tests/parity/downstream.md`](../tests/parity/downstream.md) and [`tests/parity/harness.ts`](../tests/parity/harness.ts).

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

- Zod schemas for every message (HTTP settle + app WebSocket session)
- Inferred types
- `PROTOCOL_VERSION`, helpers to parse/serialize
- Body/header helpers
- Matcher types + matching pure functions

### proxy

- HTTP server (`node:http`) + `ws` (control plane — safe beside app `WebSocketInterceptor`)
- CLI (`playwright-backend-mocks-proxy`)
- Connection registry
- Route registry & matching (HTTP + WebSocket)
- Request / socket dispatch + ownership
- History ring buffer
- `/health`, `/api/*` (CORS-enabled read-only REST)
- Dashboard: separate optional Vue package/process consuming `/api/*`

### node

- WebSocket client to proxy
- `BatchInterceptor` + node preset for HTTP
- `WebSocketInterceptor` + product bridge for app sockets (`globalThis.WebSocket` only)
- Serialize intercepted requests / socket events
- Apply decisions via controller
- Upstream `fetch` for `decision:fetch`; real WS upstream for `connectToServer`
- Lifecycle: `startBackendMocks` / `stop`

### playwright

- `test` fixture via `base.extend`
- Worker-scoped WS connection; test-scoped route registration
- `BackendMocks` / `BackendRoute` / `WebSocketRoute` / `routeFromHAR` public API
- Maps handler results to protocol messages
- Surfaces `proxy:error` as test failures

## Lifecycles

### Proxy

1. Bind HTTP + WS
2. Accept handshakes
3. Serve until SIGINT/SIGTERM → close sockets, exit

### Node agent

1. Connect + hello
2. `interceptor.apply()` (+ WS interceptor)
3. On HTTP request → buffer body → `request:start` → await decision → apply
4. On app WS → session messages → apply connect/send/close/ensureOpened
5. On stop/dispose → dispose interceptors, close WS

### Playwright fixture

1. Worker setup: connect WS, hello as `playwright`
2. Per test: `test:register`, provide `backendMocks`
3. Teardown: `test:unregister` (removes HTTP routes; WS routes follow Playwright rules), reject pending handlers
4. Worker teardown: close WS

## Error handling

- All WS messages validated; invalid → log + optional `proxy:error`
- Ambiguous routes (two tests) fail Node request/socket and all matching tests
- Disconnects fail pending work with clear messages
- Unsupported features throw immediately in the calling API

## Testing

| Layer    | Tool       | Focus                                                      |
| -------- | ---------- | ---------------------------------------------------------- |
| Oracle   | Playwright | Dual-mode parity suite (`tests/parity`) against pin 1.62.1 |
| Library  | Playwright | Step 2: `clientId`, `ambiguous_route`, disconnect, auth    |
| Unit     | Vitest     | matchers, body encoding, schemas                           |
| Contract | Vitest     | serialize/parse round-trips, reject invalid                |

CI today: browser oracle + lint/typecheck/format. Step 2 adds backend-mode parity against built packages.

## CI

`.github/workflows/ci.yml`:

- Node current LTS (22)
- `pnpm install --frozen-lockfile`
- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test` (oracle)

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

## Implementation order (rewrite)

1. **Done (Step 1):** Archive prototype → `historical/`; pin Playwright; oracle suite green in browser mode; dual-mode harness including `routeWebSocket` / `routeFromHAR` / shared downstream.
2. **Step 2 skeleton:** Reintroduce `packages/*`; wire node mode (`ENABLE_BACKEND_MOCKS`, proxy `webServer`, harness → `backendMocks.*`).
3. Implement against failing backend-mode cases until green (HTTP + HAR + WS).
4. Library-only suite; loud WS docs; remove `historical/` when finished.
