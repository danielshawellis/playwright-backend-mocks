import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 4002);

/** @type {{ code: number, reason: string } | null} */
let lastClose = null;

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "*");
  res.setHeader("access-control-expose-headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (req.method === "GET" && url.pathname === "/last-close") {
    const body = JSON.stringify({ lastClose });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (
    (req.method === "GET" || req.method === "POST") &&
    url.pathname === "/reset-last-close"
  ) {
    lastClose = null;
    res.writeHead(204);
    res.end();
    return;
  }

  // Minimal document so relative WebSocket URLs resolve against this origin.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/page")) {
    const body = "<!doctype html><html><body><h1>ws-upstream page</h1></body></html>";
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  noServer: true,
  handleProtocols(protocols) {
    // Prefer an explicit chat protocol when requested; otherwise accept the first.
    if (protocols.has("chat.v1")) {
      return "chat.v1";
    }
    if (protocols.has("chat.v2")) {
      return "chat.v2";
    }
    const first = protocols.values().next().value;
    return first ?? false;
  },
});

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  // Reject handshake for failure-oracle paths.
  if (url.pathname === "/reject") {
    socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    socket.destroy();
    return;
  }

  const upgrade = () => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  // Delay the upgrade so connectToServer can observe CONNECTING-side buffering.
  if (url.pathname === "/slow-upgrade") {
    setTimeout(upgrade, 300);
    return;
  }

  upgrade();
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const mode = url.searchParams.get("mode") ?? "echo";

  ws.on("close", (code, reason) => {
    lastClose = { code, reason: reason.toString() };
  });

  ws.on("message", (data, isBinary) => {
    const asText = !isBinary ? data.toString() : "";

    // Upstream-initiated close for default server→page close forwarding tests.
    if (!isBinary && asText === "die") {
      ws.close(3008, "server-bye");
      return;
    }

    // Abrupt TCP destroy — unclean close (wasClean=false).
    if (!isBinary && asText === "die-unclean") {
      ws.terminate();
      return;
    }

    if (mode === "prefix") {
      if (isBinary) {
        ws.send(Buffer.concat([Buffer.from("BIN:"), Buffer.from(data)]));
      } else {
        ws.send(`echo:${asText}`);
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
