import { createServer } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

const port = Number(process.env.PORT ?? 4001);
const flakyHits = new Map();
const countedStatusHits = new Map();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const bodyBuf = await readBody(req);
  const bodyText = bodyBuf.toString("utf8");

  // Browser harness (different origin) needs CORS for passthrough / continue cases.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-expose-headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/users") {
    json(res, 200, [
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    return;
  }

  if (req.method === "POST" && url.pathname === "/charges") {
    let amount = null;
    if (bodyBuf.length > 0) {
      try {
        amount = JSON.parse(bodyText).amount;
      } catch {
        amount = null;
      }
    }
    json(res, 201, {
      id: "ch_real",
      amount,
      status: "succeeded",
    });
    return;
  }

  if (url.pathname === "/echo") {
    json(res, 200, {
      method: req.method,
      url: url.pathname + url.search,
      headers: req.headers,
      body: bodyBuf.length > 0 ? bodyText : null,
      bodyBase64: bodyBuf.length > 0 ? bodyBuf.toString("base64") : null,
      bodyByteLength: bodyBuf.length,
    });
    return;
  }

  if (url.pathname === "/echo-alt") {
    json(res, 200, {
      method: req.method,
      url: url.pathname + url.search,
      headers: req.headers,
      body: bodyBuf.length > 0 ? bodyText : null,
      variant: "alt",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/simple.json") {
    json(res, 200, { foo: "bar" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/text") {
    text(res, 200, "hello-text");
    return;
  }

  if (req.method === "GET" && url.pathname === "/a/b") {
    json(res, 200, { path: "/a/b" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/a/c") {
    json(res, 200, { path: "/a/c" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/foo") {
    json(res, 200, { path: "/foo" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/bar") {
    json(res, 200, { path: "/bar" });
    return;
  }

  // Encoded path segment: /with%20space
  if (req.method === "GET" && url.pathname === "/with space") {
    json(res, 200, { path: "/with space", encoded: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/gzip") {
    const payload = JSON.stringify({ gzipped: true, message: "hello" });
    const compressed = gzipSync(Buffer.from(payload, "utf8"));
    res.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "gzip",
      "content-length": compressed.length,
      "x-upstream": "real",
    });
    res.end(compressed);
    return;
  }

  if (req.method === "GET" && url.pathname === "/brotli") {
    const payload = JSON.stringify({ brotli: true, message: "hello" });
    const compressed = brotliCompressSync(Buffer.from(payload, "utf8"));
    res.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "br",
      "content-length": compressed.length,
      "x-upstream": "real",
    });
    res.end(compressed);
    return;
  }

  if (req.method === "GET" && url.pathname === "/deflate") {
    const payload = JSON.stringify({ deflated: true, message: "hello" });
    const compressed = deflateSync(Buffer.from(payload, "utf8"));
    res.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "deflate",
      "content-length": compressed.length,
      "x-upstream": "real",
    });
    res.end(compressed);
    return;
  }

  // Larger Brotli JSON — closer to third-party API payloads (e.g. LLM providers).
  if (req.method === "GET" && url.pathname === "/brotli-large") {
    const payload = JSON.stringify({
      brotli: true,
      message: "hello".repeat(200),
      items: Array.from({ length: 40 }, (_, i) => ({ id: i, name: `item-${i}` })),
    });
    const compressed = brotliCompressSync(Buffer.from(payload, "utf8"));
    res.writeHead(200, {
      "content-type": "application/json",
      "content-encoding": "br",
      "content-length": compressed.length,
      "x-upstream": "real",
    });
    res.end(compressed);
    return;
  }

  if (req.method === "GET" && url.pathname === "/gzip-text") {
    const payload = "plain text, gzipped";
    const compressed = gzipSync(Buffer.from(payload, "utf8"));
    res.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
      "content-encoding": "gzip",
      "content-length": compressed.length,
      "x-upstream": "real",
    });
    res.end(compressed);
    return;
  }

  // Chunked JSON (no content-length) — transfer-encoding: chunked via res.write.
  if (req.method === "GET" && url.pathname === "/chunked-json") {
    res.writeHead(200, {
      "content-type": "application/json",
      "x-upstream": "real",
      "transfer-encoding": "chunked",
    });
    res.write('{"chunked":');
    res.write("true,");
    res.write('"message":"hello"}');
    res.end();
    return;
  }

  // Uncompressed SSE-shaped body (single buffered response; still a format clients parse).
  if (req.method === "GET" && url.pathname === "/sse") {
    const payload = [
      "event: message",
      'data: {"ok":true,"n":1}',
      "",
      "event: message",
      'data: {"ok":true,"n":2}',
      "",
      "",
    ].join("\n");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "content-length": Buffer.byteLength(payload),
      "x-upstream": "real",
    });
    res.end(payload);
    return;
  }

  // Brotli-compressed SSE framing — compression + non-JSON content-type.
  if (req.method === "GET" && url.pathname === "/sse-brotli") {
    const payload = ["event: message", 'data: {"ok":true}', "", ""].join("\n");
    const compressed = brotliCompressSync(Buffer.from(payload, "utf8"));
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "content-encoding": "br",
      "content-length": compressed.length,
      "x-upstream": "real",
    });
    res.end(compressed);
    return;
  }

  // Redirect to localhost (different origin hostname) for Authorization strip tests.
  if (url.pathname === "/redirect-to-localhost") {
    const code = Number(url.searchParams.get("code") ?? "302");
    res.writeHead(code, {
      location: `http://localhost:${port}/echo`,
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  // Relative Location for HAR / fetch redirect resolution.
  if (url.pathname === "/redirect-relative") {
    res.writeHead(302, {
      location: "echo",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/redirect") {
    res.writeHead(302, {
      location: "/users",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  if (url.pathname === "/redirect-echo") {
    res.writeHead(302, {
      location: "/echo",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  // Any method: /redirect-by-status?code=301|302|303|307|308 → Location: /echo
  // Used to pin route.fetch redirect method rewrite rules.
  if (url.pathname === "/redirect-by-status") {
    const code = Number(url.searchParams.get("code") ?? "302");
    res.writeHead(code, {
      location: "/echo",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/counted-status") {
    const key = url.searchParams.get("key") ?? "default";
    const status = Number(url.searchParams.get("code") ?? "500");
    const hits = (countedStatusHits.get(key) ?? 0) + 1;
    countedStatusHits.set(key, hits);
    json(res, status, { status, hits, key });
    return;
  }

  if (req.method === "GET" && url.pathname === "/redirect-chain") {
    res.writeHead(302, {
      location: "/redirect",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  // Longer chain for maxRedirects-exceeded tests:
  // /redirect1 → /redirect2 → /redirect3 → /users  (3 hops)
  if (req.method === "GET" && url.pathname === "/redirect1") {
    res.writeHead(302, {
      location: "/redirect2",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/redirect2") {
    res.writeHead(302, {
      location: "/redirect3",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/redirect3") {
    res.writeHead(302, {
      location: "/users",
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "*",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/slow") {
    // Intentionally never responds — used by route.fetch timeout tests.
    return;
  }

  // Destroy the socket immediately — used by HAR update abort-ignore tests.
  if (req.method === "GET" && url.pathname === "/abort-me") {
    req.socket.destroy();
    return;
  }

  // Plain text non-JSON body for APIResponse.json() throw tests.
  if (req.method === "GET" && url.pathname === "/not-json") {
    text(res, 200, "this is not json");
    return;
  }

  if (req.method === "POST" && url.pathname === "/multipart") {
    json(res, 200, {
      method: req.method,
      contentType: req.headers["content-type"] ?? null,
      body: bodyText,
      bodyByteLength: bodyBuf.length,
    });
    return;
  }

  // First N hits destroy the socket (ECONNRESET); then succeed.
  // Keyed by query ?n= to allow independent tests.
  if (req.method === "GET" && url.pathname === "/flaky") {
    const key = url.searchParams.get("key") ?? "default";
    const failTimes = Number(url.searchParams.get("fail") ?? "1");
    const hits = flakyHits.get(key) ?? 0;
    flakyHits.set(key, hits + 1);
    if (hits < failTimes) {
      req.socket.destroy();
      return;
    }
    json(res, 200, { ok: true, attempts: hits + 1, key });
    return;
  }

  // Same flaky pattern for POST — pins that retries reuse the original body.
  if (req.method === "POST" && url.pathname === "/flaky") {
    const key = url.searchParams.get("key") ?? "default";
    const failTimes = Number(url.searchParams.get("fail") ?? "1");
    const hits = flakyHits.get(key) ?? 0;
    flakyHits.set(key, hits + 1);
    if (hits < failTimes) {
      req.socket.destroy();
      return;
    }
    json(res, 200, {
      ok: true,
      attempts: hits + 1,
      key,
      body: bodyBuf.length > 0 ? bodyText : null,
    });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/status/")) {
    const code = Number(url.pathname.slice("/status/".length));
    if (!Number.isInteger(code) || code < 100 || code > 599) {
      json(res, 400, { error: "invalid_status" });
      return;
    }
    json(res, code, { status: code });
    return;
  }

  if (req.method === "GET" && url.pathname === "/binary") {
    const bytes = Buffer.from([0, 1, 2, 3, 254, 255]);
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": bytes.length,
      "x-upstream": "real",
    });
    res.end(bytes);
    return;
  }

  if (req.method === "POST" && url.pathname === "/form") {
    json(res, 200, {
      method: req.method,
      contentType: req.headers["content-type"] ?? null,
      body: bodyText,
      parsed: Object.fromEntries(new URLSearchParams(bodyText).entries()),
    });
    return;
  }

  json(res, 404, { error: "not_found", path: url.pathname });
});

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "x-upstream": "real",
  });
  res.end(payload);
}

function text(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "x-upstream": "real",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

server.listen(port, "127.0.0.1", () => {
  console.log(`[upstream] listening on http://127.0.0.1:${port}`);
});
