import http from "node:http";
import { startBackendMocks } from "@playwright-backend-mocks/node";

const port = Number(process.env.PORT ?? 3000);
const upstream = process.env.UPSTREAM_URL ?? "http://127.0.0.1:4001";
const clientId = process.env.CLIENT_ID ?? "api-server";

const agent = await startBackendMocks({ clientId });

/**
 * JSON proxy used by e2e tests.
 *
 *   GET|POST /via/fetch/<path>  → outbound fetch to upstream/<path>
 *   GET|POST /via/http/<path>   → outbound node:http to upstream/<path>
 *
 * The response body is always JSON:
 *   { transport, clientId, status, headers, data }
 * On outbound failure:
 *   { transport, clientId, error: "request_failed", message }
 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, clientId: agent.clientId });
    return;
  }

  const fetchMatch = url.pathname.match(/^\/via\/fetch(\/.*)$/);
  if (fetchMatch) {
    await forward(res, "fetch", fetchMatch[1] ?? "/", req);
    return;
  }

  const httpMatch = url.pathname.match(/^\/via\/http(\/.*)$/);
  if (httpMatch) {
    await forward(res, "http", httpMatch[1] ?? "/", req);
    return;
  }

  json(res, 404, { error: "not_found" });
});

async function forward(res, transport, upstreamPath, incoming) {
  const targetUrl = `${upstream}${upstreamPath}`;
  const method = incoming.method ?? "GET";
  const incomingBody = await readBody(incoming);

  try {
    const result =
      transport === "fetch"
        ? await callWithFetch(targetUrl, method, incomingBody, incoming.headers)
        : await callWithNodeHttp(targetUrl, method, incomingBody, incoming.headers);

    json(res, 200, {
      transport,
      clientId: agent.clientId,
      status: result.status,
      headers: result.headers,
      data: tryParseJson(result.body),
      raw: result.body,
    });
  } catch (error) {
    json(res, 500, {
      transport,
      clientId: agent.clientId,
      error: "request_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function callWithFetch(targetUrl, method, body, incomingHeaders) {
  const headers = pickForwardHeaders(incomingHeaders);
  const init = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD" && body.length > 0) {
    init.body = body;
  }

  const response = await fetch(targetUrl, init);
  const text = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: text,
  };
}

function callWithNodeHttp(targetUrl, method, body, incomingHeaders) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const headers = pickForwardHeaders(incomingHeaders);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
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

function pickForwardHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    const lower = key.toLowerCase();
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "transfer-encoding"
    ) {
      continue;
    }
    if (typeof value === "string") {
      result[lower] = value;
    }
  }
  if (!result["content-type"] && !result.accept) {
    result.accept = "application/json";
  }
  return result;
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
  console.log(
    `[api-server] listening on http://127.0.0.1:${port} clientId=${agent.clientId}`,
  );
});

async function shutdown() {
  await agent.stop();
  server.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
