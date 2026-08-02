import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4001);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const body = await readBody(req);

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
    json(res, 201, {
      id: "ch_real",
      amount: body ? JSON.parse(body).amount : null,
      status: "succeeded",
    });
    return;
  }

  if (url.pathname === "/echo") {
    json(res, 200, {
      method: req.method,
      url: url.pathname + url.search,
      headers: req.headers,
      body: body.length > 0 ? body : null,
    });
    return;
  }

  if (url.pathname === "/echo-alt") {
    json(res, 200, {
      method: req.method,
      url: url.pathname + url.search,
      headers: req.headers,
      body: body.length > 0 ? body : null,
      variant: "alt",
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

server.listen(port, "127.0.0.1", () => {
  console.log(`[upstream] listening on http://127.0.0.1:${port}`);
});
