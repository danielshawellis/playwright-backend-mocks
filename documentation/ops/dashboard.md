# Dashboard

Package: `@playwright-backend-mocks/dashboard`

Optional, **separate** process that renders a read-only Vue UI for HTTP history, WebSocket timelines, and connections. It is **not** bundled with `@playwright-backend-mocks/proxy` — install it only when you want the UI.

The dashboard talks to the proxy over the [REST API](/ops/rest-api). See the overview in [Observability](/ops/observability).

## Install

```bash
npm install -D @playwright-backend-mocks/dashboard
```

## CLI

Binary: `playwright-backend-mocks-dashboard`

```bash
playwright-backend-mocks-dashboard [options]
```

| Flag | Default | Description |
| --- | --- | --- |
| `--host <host>` | `127.0.0.1` | Bind host |
| `--port <port>` | `4311` | Bind port |
| `--proxy-url <url>` | `http://127.0.0.1:4310` | Proxy base URL used for `/api/*` calls |
| `-h`, `--help` | | Print help |

Example:

```bash
playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310
playwright-backend-mocks-dashboard --host 127.0.0.1 --port 4311 \
  --proxy-url http://127.0.0.1:4310
```

Open `http://127.0.0.1:4311/`.

## UI

| View | Contents |
| --- | --- |
| **HTTP** | Request timeline + detail (action, test title/path, bodies, overrides). **Download HAR** for the current filter |
| **WebSockets** | Connection list + bidirectional event timeline (live only) |
| **Connections** | Node agents and Playwright workers |

Toolbar: search, optional time range, **Auto-refresh** (on by default, ~2s), and **Refresh**. Styling uses the same VitePress CSS variable tokens as this documentation site.

## HTTP endpoints (dashboard process)

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Vue SPA |
| `GET` | `/config.json` | `{ proxyUrl }` injected from `--proxy-url` |
| `GET` | `/health` | `{ ok, version, proxyUrl }` |

## Playwright `webServer`

```ts
webServer: [
  {
    command: "playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310",
    url: "http://127.0.0.1:4310/health",
    reuseExistingServer: !process.env.CI,
  },
  {
    command:
      "playwright-backend-mocks-dashboard --host 127.0.0.1 --port 4311 --proxy-url http://127.0.0.1:4310",
    url: "http://127.0.0.1:4311/health",
    reuseExistingServer: !process.env.CI,
  },
];
```

## Notes

- The UI does **not** mutate routes or connections.
- History still lives in the proxy; restarting only the dashboard does not clear it.
- For agents and scripts, prefer the [REST API](/ops/rest-api) on the proxy directly (see [Observability](/ops/observability#using-this-with-coding-agents)).
