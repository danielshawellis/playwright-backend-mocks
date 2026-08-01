import { WebSocket } from "ws";
import {
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  parseJsonProxyMessage,
  stringifyMessage,
  type ClientToProxyMessage,
  type ProxyToClientMessage,
} from "@playwright-backend-mocks/protocol";

export type ProxyMessageHandler = (message: ProxyToClientMessage) => void;

export interface ProxyConnection {
  readonly clientId: string;
  send(message: ClientToProxyMessage): void;
  onMessage(handler: ProxyMessageHandler): void;
  close(): Promise<void>;
}

function toWsUrl(proxyUrl: string): string {
  const url = new URL(proxyUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function connectToProxy(options: {
  proxyUrl: string;
  clientId: string;
  token?: string;
}): Promise<ProxyConnection> {
  const wsUrl = toWsUrl(options.proxyUrl);
  const socket = new WebSocket(wsUrl);
  const handlers = new Set<ProxyMessageHandler>();

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    socket.on("open", onOpen);
    socket.on("error", onError);
  });

  let resolvedClientId = options.clientId;
  let helloDone!: (value: void) => void;
  let helloFail!: (error: Error) => void;
  const helloPromise = new Promise<void>((resolve, reject) => {
    helloDone = resolve;
    helloFail = reject;
  });

  socket.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString("utf8");
    let message: ProxyToClientMessage;
    try {
      message = parseJsonProxyMessage(raw);
    } catch (error) {
      console.error("[playwright-backend-mocks/node] invalid proxy message", error);
      return;
    }

    if (message.type === "hello:ok") {
      resolvedClientId = message.clientId;
      helloDone();
      return;
    }
    if (message.type === "hello:error") {
      helloFail(new Error(`Proxy handshake failed: ${message.message}`));
      return;
    }
    if (message.type === "ping") {
      send({ type: "pong", at: message.at });
      return;
    }

    for (const handler of handlers) {
      handler(message);
    }
  });

  function send(message: ClientToProxyMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error("Proxy WebSocket is not open");
    }
    socket.send(stringifyMessage(message));
  }

  send({
    type: "hello",
    protocolVersion: PROTOCOL_VERSION,
    packageVersion: PACKAGE_VERSION,
    role: "node",
    clientId: options.clientId,
    ...(options.token !== undefined ? { token: options.token } : {}),
  });

  await helloPromise;

  return {
    get clientId() {
      return resolvedClientId;
    },
    send,
    onMessage(handler) {
      handlers.add(handler);
    },
    async close() {
      handlers.clear();
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        await new Promise<void>((resolve) => {
          socket.once("close", () => resolve());
          socket.close();
        });
      }
    },
  };
}
