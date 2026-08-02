import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_VERSION = "0.1.0";

interface DashboardConfig {
  readonly host: string;
  readonly port: number;
  readonly proxyUrl: string;
}

function printHelp(): void {
  console.log(`Usage: playwright-backend-mocks-dashboard [options]

Options:
  --host <host>          Bind host (default: 127.0.0.1)
  --port <port>          Bind port (default: 4311)
  --proxy-url <url>      Proxy base URL for REST API (default: http://127.0.0.1:4310)
  -h, --help             Show help
`);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function parseArgs(argv: string[]): DashboardConfig {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const host = readFlag(argv, "--host") ?? "127.0.0.1";
  const portRaw = readFlag(argv, "--port") ?? "4311";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid --port: ${portRaw}`);
  }

  const proxyUrl = (readFlag(argv, "--proxy-url") ?? "http://127.0.0.1:4310").replace(
    /\/$/,
    "",
  );
  try {
    // Validate URL shape early.
    new URL(proxyUrl);
  } catch {
    throw new Error(`Invalid --proxy-url: ${proxyUrl}`);
  }

  return { host, port, proxyUrl };
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function clientRoot(): string {
  // tsup emits dist/cli.cjs; Vite emits dist/client/*
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "client");
}

async function serveStatic(
  res: ServerResponse,
  root: string,
  pathname: string,
): Promise<void> {
  const relative =
    pathname === "/"
      ? "/index.html"
      : pathname.endsWith("/")
        ? `${pathname}index.html`
        : pathname;
  const safePath = relative.replace(/^\/+/, "");
  const filePath = join(root, safePath);
  if (!filePath.startsWith(root)) {
    json(res, 403, { error: "forbidden" });
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypeFor(filePath) });
    res.end(body);
  } catch {
    if (pathname !== "/" && !extname(pathname)) {
      // SPA fallback
      const index = await readFile(join(root, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(index);
      return;
    }
    json(res, 404, { error: "not_found" });
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const root = clientRoot();
  if (!existsSync(join(root, "index.html"))) {
    throw new Error(
      `Dashboard client assets not found at ${root}. Run the package build before starting the CLI.`,
    );
  }

  const server = createServer((req, res) => {
    void handleHttp(req, res, config, root);
  });

  const shutdown = (signal: string) => {
    console.log(`[playwright-backend-mocks-dashboard] shutting down (${signal})`);
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(
    `[playwright-backend-mocks-dashboard] listening on http://${config.host}:${config.port} (proxy ${config.proxyUrl})`,
  );
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  config: DashboardConfig,
  root: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, {
      ok: true,
      version: PACKAGE_VERSION,
      proxyUrl: config.proxyUrl,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/config.json") {
    json(res, 200, { proxyUrl: config.proxyUrl });
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    json(res, 405, { error: "method_not_allowed" });
    return;
  }

  await serveStatic(res, root, url.pathname);
}

main().catch((error: unknown) => {
  console.error(
    "[playwright-backend-mocks-dashboard] failed to start:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
