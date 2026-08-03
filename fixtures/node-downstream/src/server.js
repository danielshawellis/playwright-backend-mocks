/**
 * Node downstream host for the parity suite.
 *
 * - Shared outbound logic: @playwright-backend-mocks/fixture-downstream
 * - Control plane: WebSocket at /control (Playwright harness drives HTTP + app WS)
 * - Optional Step 2: ENABLE_BACKEND_MOCKS=1 → startBackendMocks() in this process
 *
 * Control protocol (JSON text frames), v1:
 *   → { v:1, id, op:"http.request", url, method?, headers?, body? }
 *   ← { v:1, id, op:"http.response", result }
 *
 *   → { v:1, id, op:"ws.open", url, protocols?, binaryType?, waitUntil?: "open"|"connecting" }
 *   ← { v:1, id, op:"ws.opened", socketId, protocol, extensions, readyState }
 *   ← { v:1, id, op:"ws.event", socketId, event:"message"|"close"|"error"|"open", ... }
 *
 *   → { v:1, id, op:"ws.send", socketId, data, encoding?: "utf8"|"base64" }
 *   ← { v:1, id, op:"ok" }
 *
 *   → { v:1, id, op:"ws.close", socketId, code?, reason? }
 *   ← { v:1, id, op:"ok" }
 *
 *   → { v:1, id, op:"ws.info", socketId }
 *   ← { v:1, id, op:"ws.info", readyState, protocol, extensions }
 */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { triggerHttp } from "../../downstream/src/http.js";
import { connectWebSocket } from "../../downstream/src/ws.js";

// Shared connectWebSocket uses globalThis.WebSocket (WHATWG). Polyfill on Node.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket;
}

const port = Number(process.env.PORT ?? 3001);
const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.env.ENABLE_BACKEND_MOCKS === "1") {
  // Step 2: dynamic import so Step 1 does not require the library package.
  const mod = await import(
    pathToFileURL(join(__dirname, "../../../packages/node/src/index.js")).href
  ).catch(() => null);
  if (!mod?.startBackendMocks) {
    console.error(
      "[node-downstream] ENABLE_BACKEND_MOCKS=1 but startBackendMocks is unavailable",
    );
    process.exit(1);
  }
  await mod.startBackendMocks({
    clientId: process.env.CLIENT_ID ?? "parity-node",
  });
  console.log("[node-downstream] backend mocks started");
}

/** @type {Map<string, WebSocket>} */
const sockets = new Map();
let nextSocketId = 1;

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (req.method === "GET" && url.pathname === "/health") {
    const body = JSON.stringify({
      ok: true,
      role: "node-downstream",
      mocks: process.env.ENABLE_BACKEND_MOCKS === "1",
    });
    res.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname !== "/control") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (control) => {
  control.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      control.send(JSON.stringify({ v: 1, op: "error", message: "invalid_json" }));
      return;
    }
    if (msg.v !== 1 || typeof msg.id !== "string" || typeof msg.op !== "string") {
      control.send(JSON.stringify({ v: 1, op: "error", message: "invalid_envelope" }));
      return;
    }
    try {
      await handleControl(control, msg);
    } catch (error) {
      control.send(
        JSON.stringify({
          v: 1,
          id: msg.id,
          op: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });
});

/**
 * @param {import("ws").WebSocket} control
 * @param {any} msg
 */
async function handleControl(control, msg) {
  switch (msg.op) {
    case "http.request": {
      const result = await triggerHttp(msg.url, {
        method: msg.method,
        headers: msg.headers,
        body: msg.body,
        redirect: msg.redirect,
      });
      control.send(JSON.stringify({ v: 1, id: msg.id, op: "http.response", result }));
      return;
    }
    case "ws.open": {
      const socketId = `s${nextSocketId++}`;
      const waitUntil = msg.waitUntil === "connecting" ? "connecting" : "open";
      const ws = connectWebSocket(msg.url, {
        protocols: msg.protocols,
        binaryType: msg.binaryType,
      });
      sockets.set(socketId, ws);

      const sendEvent = (event, extra = {}) => {
        if (control.readyState === control.OPEN) {
          control.send(
            JSON.stringify({
              v: 1,
              id: msg.id,
              op: "ws.event",
              socketId,
              event,
              ...extra,
            }),
          );
        }
      };

      let settled = false;
      const failOpen = (message) => {
        if (settled) return;
        settled = true;
        sockets.delete(socketId);
        control.send(JSON.stringify({ v: 1, id: msg.id, op: "error", message }));
      };

      const announceOpened = () => {
        if (settled) return;
        settled = true;
        control.send(
          JSON.stringify({
            v: 1,
            id: msg.id,
            op: "ws.opened",
            socketId,
            protocol: ws.protocol,
            extensions: ws.extensions,
            readyState: ws.readyState,
          }),
        );
      };

      // Connecting mode returns immediately so tests can observe CONNECTING.
      if (waitUntil === "connecting") {
        announceOpened();
      }

      ws.addEventListener("open", () => {
        sendEvent("open");
        if (waitUntil === "open") announceOpened();
      });
      ws.addEventListener("message", (event) => {
        const data = event.data;
        if (typeof data === "string") {
          sendEvent("message", { data, encoding: "utf8" });
          return;
        }
        if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
          sendEvent("message", {
            data: data.toString("base64"),
            encoding: "base64",
          });
          return;
        }
        if (data instanceof ArrayBuffer) {
          sendEvent("message", {
            data: Buffer.from(data).toString("base64"),
            encoding: "base64",
          });
          return;
        }
        if (ArrayBuffer.isView(data)) {
          sendEvent("message", {
            data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
              "base64",
            ),
            encoding: "base64",
          });
          return;
        }
        if (typeof Blob !== "undefined" && data instanceof Blob) {
          void data.arrayBuffer().then((ab) => {
            sendEvent("message", {
              data: Buffer.from(ab).toString("base64"),
              encoding: "base64",
              binaryType: "blob",
            });
          });
          return;
        }
        sendEvent("message", { data: String(data), encoding: "utf8" });
      });
      ws.addEventListener("close", (event) => {
        sockets.delete(socketId);
        if (!settled && waitUntil === "open") {
          // Handshake never completed — fail the open RPC instead of hanging.
          failOpen(`ws_open_failed:${event.code}:${event.reason || "closed"}`);
        }
        sendEvent("close", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
      });
      ws.addEventListener("error", () => {
        if (!settled && waitUntil === "open") failOpen("ws_open_failed:error");
        sendEvent("error");
      });
      return;
    }
    case "ws.send": {
      const ws = sockets.get(msg.socketId);
      if (!ws) throw new Error(`unknown_socket:${msg.socketId}`);
      try {
        if (msg.encoding === "base64") {
          ws.send(Buffer.from(msg.data, "base64"));
        } else {
          ws.send(msg.data);
        }
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
      control.send(JSON.stringify({ v: 1, id: msg.id, op: "ok" }));
      return;
    }
    case "ws.close": {
      const ws = sockets.get(msg.socketId);
      if (!ws) throw new Error(`unknown_socket:${msg.socketId}`);
      if (msg.code !== undefined) {
        ws.close(msg.code, msg.reason ?? "");
      } else {
        ws.close();
      }
      control.send(JSON.stringify({ v: 1, id: msg.id, op: "ok" }));
      return;
    }
    case "ws.info": {
      const ws = sockets.get(msg.socketId);
      if (!ws) throw new Error(`unknown_socket:${msg.socketId}`);
      control.send(
        JSON.stringify({
          v: 1,
          id: msg.id,
          op: "ws.info",
          readyState: ws.readyState,
          protocol: ws.protocol,
          extensions: ws.extensions,
        }),
      );
      return;
    }
    default:
      throw new Error(`unknown_op:${msg.op}`);
  }
}

httpServer.listen(port, "127.0.0.1", () => {
  console.log(`[node-downstream] listening on http://127.0.0.1:${port}`);
  console.log(`[node-downstream] control ws://127.0.0.1:${port}/control`);
});
