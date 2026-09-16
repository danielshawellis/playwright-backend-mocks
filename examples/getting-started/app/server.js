import http from "node:http";
import { startBackendMocks } from "@playwright-backend-mocks/node";

const port = Number(process.env.PORT ?? 3000);
const host = "127.0.0.1";

const agent = await startBackendMocks({
  proxyUrl: process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL,
  token: process.env.PLAYWRIGHT_BACKEND_MOCKS_TOKEN,
  clientId: "api-server",
});

const checkoutPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Checkout</title>
  </head>
  <body>
    <h1>Checkout</h1>
    <button type="button">Pay</button>
    <p id="message"></p>
    <script type="module">
      const message = document.querySelector("#message");
      document.querySelector("button").addEventListener("click", async () => {
        const response = await fetch("/api/pay", { method: "POST" });
        const body = await response.json();
        message.textContent = body.message;
      });
    </script>
  </body>
</html>
`;

const server = http.createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && url === "/checkout") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(checkoutPage);
    return;
  }

  if (req.method === "POST" && url === "/api/pay") {
    const upstream = await fetch("https://payments.example.test/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 2500, currency: "usd" }),
    });
    const payload = await upstream.json().catch(() => ({}));
    const declined = upstream.status === 402 || payload?.error === "card_declined";

    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        message: declined ? "Your card was declined" : "Payment successful",
      }),
    );
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(port, host, () => {
  console.log(`[getting-started] listening on http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`[getting-started] shutting down (${signal})`);
  server.close();
  await agent.stop();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
