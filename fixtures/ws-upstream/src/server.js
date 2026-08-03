import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 4002);

const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  // Reject handshake for failure-oracle paths.
  if (url.pathname === "/reject") {
    socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const mode = url.searchParams.get("mode") ?? "echo";

  ws.on("message", (data, isBinary) => {
    if (mode === "prefix") {
      if (isBinary) {
        ws.send(Buffer.concat([Buffer.from("BIN:"), Buffer.from(data)]));
      } else {
        ws.send(`echo:${data.toString()}`);
      }
      return;
    }
    // Default echo — preserve binary vs text.
    ws.send(data, { binary: isBinary });
  });
});

httpServer.listen(port, "127.0.0.1", () => {
  console.log(`[ws-upstream] listening on ws://127.0.0.1:${port}`);
});
