import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 4001);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

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
    const body = await readBody(req);
    json(res, 201, {
      id: "ch_real",
      amount: body ? JSON.parse(body).amount : null,
      status: "succeeded",
    });
    return;
  }

  json(res, 404, { error: "not_found" });
});

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
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
