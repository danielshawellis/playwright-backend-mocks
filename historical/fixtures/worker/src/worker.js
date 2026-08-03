import http from "node:http";
import { startBackendMocks } from "@playwright-backend-mocks/node";

const port = Number(process.env.PORT ?? 3001);
const upstream = process.env.UPSTREAM_URL ?? "http://127.0.0.1:4001";

const agent = await startBackendMocks({
  clientId: "job-worker",
});

/**
 * Second Node process used for clientId-scoped routing tests.
 * Same /via/http/* shape as the api-server.
 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, clientId: agent.clientId });
    return;
  }

  const httpMatch = url.pathname.match(/^\/via\/http(\/.*)$/);
  if (httpMatch) {
    const targetUrl = `${upstream}${httpMatch[1] ?? "/"}`;
    const method = req.method ?? "GET";
    const body = await readBody(req);

    try {
      const result = await callWithNodeHttp(targetUrl, method, body);
      json(res, 200, {
        transport: "http",
        clientId: agent.clientId,
        status: result.status,
        headers: result.headers,
        data: tryParseJson(result.body),
        raw: result.body,
      });
    } catch (error) {
      json(res, 500, {
        transport: "http",
        clientId: agent.clientId,
        error: "request_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  json(res, 404, { error: "not_found" });
});

function callWithNodeHttp(targetUrl, method, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: { accept: "application/json" },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.on("error", reject);
    if (method !== "GET" && method !== "HEAD" && body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`[worker] listening on http://127.0.0.1:${port}`);
});

process.on("SIGINT", async () => {
  await agent.stop();
  process.exit(0);
});
