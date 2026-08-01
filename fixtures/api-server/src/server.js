import { createServer } from "node:http";
import axios from "axios";
import { startBackendMocks } from "@playwright-backend-mocks/node";

const port = Number(process.env.PORT ?? 3000);
const upstream = process.env.UPSTREAM_URL ?? "http://127.0.0.1:4001";

const agent = await startBackendMocks({
  clientId: "api-server",
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, { ok: true, clientId: agent.clientId });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      html(
        res,
        `<!doctype html>
<html>
  <head><title>Checkout</title></head>
  <body>
    <h1>Checkout</h1>
    <button id="pay">Pay</button>
    <pre id="result"></pre>
    <script>
      document.getElementById("pay").addEventListener("click", async () => {
        const response = await fetch("/api/pay", { method: "POST" });
        const data = await response.json();
        document.getElementById("result").textContent = JSON.stringify(data);
        if (data.error === "card_declined") {
          const p = document.createElement("p");
          p.textContent = "Your card was declined";
          document.body.appendChild(p);
        }
      });
    </script>
  </body>
</html>`,
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/users") {
      const response = await fetch(`${upstream}/users`);
      const data = await response.json();
      json(res, response.status, data);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/pay") {
      const response = await fetch(`${upstream}/charges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 2500 }),
      });
      const data = await response.json();
      json(res, response.status, data);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/users-axios") {
      const response = await axios.get(`${upstream}/users`);
      json(res, response.status, response.data);
      return;
    }

    json(res, 404, { error: "not_found" });
  } catch (error) {
    json(res, 500, {
      error: "request_failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function html(res, body) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

server.listen(port, "127.0.0.1", () => {
  console.log(`[api-server] listening on http://127.0.0.1:${port}`);
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
