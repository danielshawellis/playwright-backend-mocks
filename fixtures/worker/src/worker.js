import http from "node:http";
import { startBackendMocks } from "@playwright-backend-mocks/node";

const port = Number(process.env.PORT ?? 3001);
const upstream = process.env.UPSTREAM_URL ?? "http://127.0.0.1:4001";

const agent = await startBackendMocks({
  clientId: "job-worker",
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, clientId: agent.clientId });
    return;
  }

  if (req.method === "POST" && url.pathname === "/run") {
    try {
      const data = await nodeHttpGet(`${upstream}/users`);
      json(res, 200, { source: "node:http", data: JSON.parse(data) });
    } catch (error) {
      json(res, 500, {
        error: "request_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  json(res, 404, { error: "not_found" });
});

function nodeHttpGet(targetUrl) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    // Use the module namespace so @mswjs/interceptors can patch http.request.
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: "GET",
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("error", reject);
    req.end();
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
