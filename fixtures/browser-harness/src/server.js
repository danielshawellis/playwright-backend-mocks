import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 3000);
const __dirname = dirname(fileURLToPath(import.meta.url));
const downstreamDir = join(__dirname, "../../downstream/src");

/**
 * Inline shared ESM helpers into a classic script so the harness is one
 * document request. Catch-all page.route / routeFromHAR handlers installed
 * after load cannot strand deferred module imports.
 */
function loadSharedAsClassic(name) {
  const filePath = join(downstreamDir, name);
  if (!existsSync(filePath)) {
    throw new Error(`missing shared downstream module: ${filePath}`);
  }
  return readFileSync(filePath, "utf8")
    .replace(/^export\s+async\s+function\s+/m, "async function ")
    .replace(/^export\s+function\s+/m, "function ");
}

const sharedHttp = loadSharedAsClassic("http.js");
const sharedWs = loadSharedAsClassic("ws.js");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Parity browser harness</title>
  </head>
  <body>
    <h1>Parity browser harness</h1>
    <script>
${sharedHttp}

${sharedWs}

      // Shared fetch / WebSocket path (same source files as Node downstream).
      window.trigger = (url, init) => triggerHttp(url, init);
      window.connectWebSocket = connectWebSocket;
      window.__parityReady = true;

      // Browser-only transport — not part of the shared isomorphic core.
      window.triggerXhr = function triggerXhr(url, init = {}) {
        return new Promise((resolve) => {
          const xhr = new XMLHttpRequest();
          const method = init.method ?? "GET";
          xhr.open(method, url);
          const headers = init.headers ?? {};
          for (const [name, value] of Object.entries(headers)) {
            xhr.setRequestHeader(name, value);
          }
          xhr.onload = () => {
            const rawHeaders = xhr.getAllResponseHeaders();
            const headersObj = {};
            for (const line of rawHeaders.trim().split(/[\\r\\n]+/)) {
              const parts = line.split(": ");
              const key = parts.shift();
              if (key) headersObj[key.toLowerCase()] = parts.join(": ");
            }
            let data = null;
            try {
              data = JSON.parse(xhr.responseText);
            } catch {
              data = null;
            }
            resolve({
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
              statusText: xhr.statusText,
              headers: headersObj,
              raw: xhr.responseText,
              data,
            });
          };
          xhr.onerror = () => {
            resolve({ ok: false, error: "xhr_error" });
          };
          xhr.send(init.body ?? null);
        });
      };
    </script>
  </body>
</html>
`;

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

  // Optional direct access to shared modules (debugging / non-harness use).
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
