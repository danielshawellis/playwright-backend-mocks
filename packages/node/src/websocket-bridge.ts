// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/injected/src/webSocketMock.ts
// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/dispatchers/webSocketRouteDispatcher.ts
//
// DIVERGENCE: Only `globalThis.WebSocket` is intercepted (MSW WebSocketInterceptor).
// Control-plane sockets use the `ws` npm package and are not patched.
// DIVERGENCE END
import {
  CloseEvent as MswCloseEvent,
  WebSocketInterceptor,
} from "@mswjs/interceptors/WebSocket";
import type { ProxyToClientMessage } from "@playwright-backend-mocks/protocol";
import type { ProxyConnection } from "./ws-client.js";

type WsClient = {
  id: string;
  url: URL;
  socket: WebSocket;
  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "message" | "close",
    listener: (event: MessageEvent | CloseEvent) => void,
  ): void;
};

type WsServer = {
  connect(): void;
  send(data: string | ArrayBuffer | Blob | ArrayBufferView): void;
  close(): void;
  socket: WebSocket;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: Event) => void,
  ): void;
};

interface PendingWs {
  readonly client: WsClient;
  readonly server: WsServer;
  readonly protocols: string[];
  /** Resolves the MSW connection listener so the mock may open / continue. */
  releaseOpen: () => void;
  openReleased: boolean;
  connected: boolean;
  passthrough: boolean;
  serverCloseBound: boolean;
}

function protocolsList(protocols: string | string[] | undefined): string[] {
  if (protocols === undefined) {
    return [];
  }
  return Array.isArray(protocols) ? [...protocols] : [protocols];
}

function bufferToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function dataToWire(
  data: string | ArrayBuffer | Blob | ArrayBufferView,
  cb: (wire: { data: string; isBase64: boolean }) => void,
): void {
  if (typeof data === "string") {
    cb({ data, isBase64: false });
    return;
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    void data.arrayBuffer().then((buffer) => {
      cb({ data: bufferToBase64(new Uint8Array(buffer)), isBase64: true });
    });
    return;
  }
  if (ArrayBuffer.isView(data)) {
    cb({
      data: bufferToBase64(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      ),
      isBase64: true,
    });
    return;
  }
  // Remaining: ArrayBuffer (Blob already handled above; TS may still widen).
  cb({
    data: bufferToBase64(new Uint8Array(data as ArrayBuffer)),
    isBase64: true,
  });
}

/** Mock page sockets expose writable protocol/extensions like Playwright's webSocketMock. */
function setMockSocketHandshake(
  socket: WebSocket,
  protocol: string,
  extensions: string,
): void {
  const target = socket as WebSocket & {
    protocol: string;
    extensions: string;
  };
  try {
    target.protocol = protocol;
    target.extensions = extensions;
  } catch {
    Object.defineProperty(target, "protocol", {
      value: protocol,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(target, "extensions", {
      value: extensions,
      writable: true,
      configurable: true,
    });
  }
}

function wireToData(
  data: string,
  isBase64: boolean,
  binaryType: BinaryType,
): string | ArrayBuffer | Blob {
  if (!isBase64) {
    return data;
  }
  const buffer = Buffer.from(data, "base64");
  const ab = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return binaryType === "arraybuffer" ? ab : new Blob([buffer]);
}

/**
 * Close the mock page socket with an explicit wasClean flag.
 * MSW's public `close()` always uses wasClean=true.
 */
function closeClientWithClean(
  client: WsClient,
  code: number | undefined,
  reason: string | undefined,
  wasClean: boolean,
): void {
  const socket = client.socket as WebSocket & { readyState: number };
  if (socket.readyState === 2 || socket.readyState === 3) {
    return;
  }
  socket.readyState = 2; // CLOSING
  queueMicrotask(() => {
    socket.readyState = 3; // CLOSED
    // Node may lack a global CloseEvent; use MSW's implementation.
    socket.dispatchEvent(
      new MswCloseEvent("close", {
        code: code ?? 1000,
        reason: reason ?? "",
        wasClean,
      }),
    );
  });
}

/**
 * Install MSW WebSocketInterceptor and bridge open/message/close to the proxy,
 * mirroring Playwright's injected webSocketMock + dispatcher API requests.
 */
export function installWebSocketBridge(connection: ProxyConnection): {
  handleProxyMessage(message: ProxyToClientMessage): boolean;
  dispose(): void;
} {
  const interceptor = new WebSocketInterceptor();
  const pending = new Map<string, PendingWs>();

  const releaseOpen = (item: PendingWs) => {
    if (item.openReleased) {
      return;
    }
    item.openReleased = true;
    item.releaseOpen();
  };

  const bindServerEvents = (socketId: string, item: PendingWs) => {
    if (item.serverCloseBound) {
      return;
    }
    item.serverCloseBound = true;

    // Disable MSW page→server auto-close; Playwright owns close forwarding.
    const mockCloseController = (
      item.server as unknown as { mockCloseController?: AbortController }
    ).mockCloseController;
    mockCloseController?.abort();

    item.server.addEventListener("message", (event) => {
      const messageEvent = event as MessageEvent & { preventDefault(): void };
      messageEvent.preventDefault();
      dataToWire(
        messageEvent.data as string | ArrayBuffer | Blob | ArrayBufferView,
        (wire) => {
          try {
            connection.send({
              type: "ws:messageFromServer",
              socketId,
              data: wire.data,
              isBase64: wire.isBase64,
            });
          } catch {
            /* proxy gone */
          }
        },
      );
    });

    item.server.addEventListener("close", (event) => {
      const closeEvent = event as CloseEvent & { preventDefault(): void };
      if (typeof closeEvent.preventDefault === "function") {
        closeEvent.preventDefault();
      }
      const code = "code" in closeEvent ? closeEvent.code : undefined;
      const reason =
        "reason" in closeEvent ? String(closeEvent.reason ?? "") : undefined;
      const wasClean =
        "wasClean" in closeEvent ? Boolean(closeEvent.wasClean) : true;
      try {
        connection.send({
          type: "ws:closeServer",
          socketId,
          ...(code !== undefined ? { code } : {}),
          ...(reason !== undefined ? { reason } : {}),
          wasClean,
        });
      } catch {
        /* proxy gone */
      }
    });
  };

  interceptor.on("connection", async ({ client, server, info }) => {
    const socketId = client.id;
    const protocols = protocolsList(info.protocols);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const item: PendingWs = {
      client: client as unknown as WsClient,
      server: server as unknown as WsServer,
      protocols,
      releaseOpen: release,
      openReleased: false,
      connected: false,
      passthrough: false,
      serverCloseBound: false,
    };
    pending.set(socketId, item);

    // Page → mock frames (matched path reports to Playwright; passthrough uses MSW forward).
    client.addEventListener("message", (event) => {
      const messageEvent = event as MessageEvent & { preventDefault(): void };
      if (item.passthrough) {
        return;
      }
      messageEvent.preventDefault();
      dataToWire(
        messageEvent.data as string | ArrayBuffer | Blob | ArrayBufferView,
        (wire) => {
          try {
            connection.send({
              type: "ws:messageFromPage",
              socketId,
              data: wire.data,
              isBase64: wire.isBase64,
            });
          } catch {
            /* proxy gone */
          }
        },
      );
    });

    client.addEventListener("close", (event) => {
      const closeEvent = event as CloseEvent;
      if (item.passthrough) {
        pending.delete(socketId);
        return;
      }
      try {
        connection.send({
          type: "ws:closePage",
          socketId,
          ...(closeEvent.code !== undefined ? { code: closeEvent.code } : {}),
          ...(closeEvent.reason !== undefined
            ? { reason: closeEvent.reason }
            : {}),
          wasClean: closeEvent.wasClean,
        });
      } catch {
        /* proxy gone */
      }
    });

    try {
      connection.send({
        type: "ws:connection",
        socketId,
        url: client.url.href,
        protocols,
        clientId: connection.clientId,
      });
    } catch (error) {
      pending.delete(socketId);
      release();
      throw error;
    }

    // Hold MSW auto-open until ensureOpened / sendToPage / real server open / passthrough.
    await held;
  });

  interceptor.apply();

  return {
    handleProxyMessage(message: ProxyToClientMessage): boolean {
      switch (message.type) {
        case "ws:passthrough": {
          const item = pending.get(message.socketId);
          if (!item) return true;
          item.passthrough = true;
          item.server.connect();
          item.server.addEventListener("open", () => {
            try {
              const real = item.server.socket;
              setMockSocketHandshake(
                item.client.socket,
                real.protocol,
                real.extensions,
              );
            } catch {
              /* ignore */
            }
            releaseOpen(item);
          });
          item.server.addEventListener("close", () => {
            pending.delete(message.socketId);
          });
          return true;
        }
        case "ws:connect": {
          const item = pending.get(message.socketId);
          if (!item) return true;
          if (item.connected) return true;
          item.connected = true;
          try {
            item.server.connect();
          } catch (error) {
            try {
              connection.send({
                type: "ws:closeServer",
                socketId: message.socketId,
                code: 1006,
                reason: error instanceof Error ? error.message : String(error),
                wasClean: false,
              });
            } catch {
              /* proxy gone */
            }
            return true;
          }
          // Bind message/close after open so handshake is not disturbed.
          item.server.addEventListener("open", () => {
            try {
              const real = item.server.socket;
              setMockSocketHandshake(
                item.client.socket,
                real.protocol,
                real.extensions,
              );
            } catch {
              /* ignore */
            }
            bindServerEvents(message.socketId, item);
            releaseOpen(item);
          });
          item.server.addEventListener("error", () => {
            // Handshake failure: do not mock-open; report server close to Playwright.
            // MSW also forwards error to the page socket.
            try {
              connection.send({
                type: "ws:closeServer",
                socketId: message.socketId,
                code: 1006,
                reason: "",
                wasClean: false,
              });
            } catch {
              /* proxy gone */
            }
          });
          item.server.addEventListener("close", (event) => {
            if (item.serverCloseBound) {
              return; // handled by bindServerEvents after open
            }
            const closeEvent = event as CloseEvent;
            try {
              connection.send({
                type: "ws:closeServer",
                socketId: message.socketId,
                ...(closeEvent.code !== undefined
                  ? { code: closeEvent.code }
                  : { code: 1006 }),
                ...(closeEvent.reason !== undefined
                  ? { reason: closeEvent.reason }
                  : {}),
                wasClean: closeEvent.wasClean ?? false,
              });
            } catch {
              /* proxy gone */
            }
          });
          return true;
        }
        case "ws:ensureOpened": {
          const item = pending.get(message.socketId);
          if (!item) return true;
          // Mock path: first requested subprotocol (Playwright webSocketMock).
          if (!item.connected && item.client.socket.readyState === 0) {
            setMockSocketHandshake(
              item.client.socket,
              item.protocols[0] ?? "",
              "",
            );
          }
          releaseOpen(item);
          return true;
        }
        case "ws:sendToPage": {
          const item = pending.get(message.socketId);
          if (!item) return true;
          // Force mock open if still CONNECTING (Playwright sendToPage → _ensureOpened).
          if (!item.connected && item.client.socket.readyState === 0) {
            setMockSocketHandshake(
              item.client.socket,
              item.protocols[0] ?? "",
              "",
            );
          }
          releaseOpen(item);
          const payload = wireToData(
            message.data,
            message.isBase64,
            item.client.socket.binaryType,
          );
          item.client.send(payload);
          return true;
        }
        case "ws:sendToServer": {
          const item = pending.get(message.socketId);
          if (!item || !item.connected) return true;
          const payload = wireToData(
            message.data,
            message.isBase64,
            item.client.socket.binaryType,
          );
          item.server.send(payload);
          return true;
        }
        case "ws:closePage": {
          const item = pending.get(message.socketId);
          if (!item) return true;
          releaseOpen(item);
          closeClientWithClean(
            item.client,
            message.code,
            message.reason,
            message.wasClean,
          );
          return true;
        }
        case "ws:closeServer": {
          const item = pending.get(message.socketId);
          if (!item) return true;
          if (!item.connected) {
            // Short-circuit mock server close (Playwright _apiCloseServer without _ws).
            try {
              connection.send({
                type: "ws:closeServer",
                socketId: message.socketId,
                ...(message.code !== undefined ? { code: message.code } : {}),
                ...(message.reason !== undefined
                  ? { reason: message.reason }
                  : {}),
                wasClean: message.wasClean,
              });
            } catch {
              /* proxy gone */
            }
            return true;
          }
          // Close real upstream with requested code/reason.
          const realCloseController = (
            item.server as unknown as { realCloseController?: AbortController }
          ).realCloseController;
          realCloseController?.abort();
          try {
            item.server.socket.close(message.code, message.reason);
          } catch {
            try {
              item.server.close();
            } catch {
              /* ignore */
            }
          }
          // Report closeServer (real close listener was aborted).
          try {
            connection.send({
              type: "ws:closeServer",
              socketId: message.socketId,
              ...(message.code !== undefined ? { code: message.code } : {}),
              ...(message.reason !== undefined
                ? { reason: message.reason }
                : {}),
              wasClean: message.wasClean,
            });
          } catch {
            /* proxy gone */
          }
          return true;
        }
        case "ws:error": {
          const item = pending.get(message.socketId);
          if (!item) return true;
          // Do not mock-open on error — fail the handshake.
          try {
            item.client.socket.dispatchEvent(new Event("error"));
          } catch {
            /* ignore */
          }
          // Skip MSW auto-open by leaving CONNECTING before resolving the hold.
          (item.client.socket as WebSocket & { readyState: number }).readyState = 3;
          item.openReleased = true;
          item.releaseOpen();
          closeClientWithClean(item.client, 1011, message.message, false);
          pending.delete(message.socketId);
          return true;
        }
        default:
          return false;
      }
    },
    dispose() {
      interceptor.dispose();
      for (const [, item] of pending) {
        releaseOpen(item);
      }
      pending.clear();
    },
  };
}
