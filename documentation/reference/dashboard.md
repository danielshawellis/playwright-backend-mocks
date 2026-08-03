# Dashboard

Package: `@playwright-backend-mocks/dashboard`

Optional, **separate** process that renders a read-only Vue UI for connections and request history. It is **not** bundled with `@playwright-backend-mocks/proxy` — install it only when you want the UI.

The dashboard talks to the proxy over the [REST API](/reference/rest-api).

## Install

```bash
npm install -D @playwright-backend-mocks/dashboard
```

## CLI

Binary: `playwright-backend-mocks-dashboard`

```bash
playwright-backend-mocks-dashboard [options]
```

| Flag                | Default                 | Description                            |
| ------------------- | ----------------------- | -------------------------------------- |
| `--host <host>`     | `127.0.0.1`             | Bind host                              |
| `--port <port>`     | `4311`                  | Bind port                              |
| `--proxy-url <url>` | `http://127.0.0.1:4310` | Proxy base URL used for `/api/*` calls |
| `-h`, `--help`      |                         | Print help                             |

Example:

```bash
# terminal 1
playwright-backend-mocks-proxy --host 127.0.0.1 --port 4310

# terminal 2
playwright-backend-mocks-dashboard --host 127.0.0.1 --port 4311 --proxy-url http://127.0.0.1:4310
```

Open `http://127.0.0.1:4311/`. The UI polls the proxy every 2 seconds.

## HTTP endpoints (dashboard process)

| Method | Path           | Description                                |
| ------ | -------------- | ------------------------------------------ |
| `GET`  | `/`            | Vue SPA                                    |
| `GET`  | `/config.json` | `{ proxyUrl }` injected from `--proxy-url` |
| `GET`  | `/health`      | `{ ok, version, proxyUrl }`                |

## Playwright webServer (optional)

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
  // …your app under test
];
```

## Notes

- The UI does **not** mutate routes or connections.
- History still lives in the proxy process; restarting only the dashboard does not clear it.
- For agents and scripts, prefer calling the [REST API](/reference/rest-api) on the proxy directly.
