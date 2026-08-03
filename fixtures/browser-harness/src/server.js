import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 3000);
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, "index.html"), "utf8");
const downstreamDir = join(__dirname, "../../downstream/src");

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  // Shared isomorphic downstream modules (same files Node host imports).
  if (req.method === "GET" && url.pathname.startsWith("/downstream/")) {
    const name = url.pathname.slice("/downstream/".length);
    if (name !== "http.js" && name !== "ws.js") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const filePath = join(downstreamDir, name);
    if (!existsSync(filePath)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const body = readFileSync(filePath, "utf8");
    res.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
    });
    res.end(html);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[browser-harness] listening on http://127.0.0.1:${port}`);
});
