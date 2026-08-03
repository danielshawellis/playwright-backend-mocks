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
export type ProxyCloseHandler = (reason: string) => void;

export interface ProxyConnection {
  readonly clientId: string;
  readonly connected: boolean;
  send(message: ClientToProxyMessage): void;
  onMessage(handler: ProxyMessageHandler): void;
  onClose(handler: ProxyCloseHandler): void;
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
  const messageHandlers = new Set<ProxyMessageHandler>();
  const closeHandlers = new Set<ProxyCloseHandler>();
  let connected = false;
  let closingIntentionally = false;
  let closeNotified = false;

  try {
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
  } catch (error) {
    throw new Error(
      `Failed to connect to Playwright Backend Mocks proxy at ${options.proxyUrl}. ` +
        `Is the proxy running and reachable? ` +
        `Cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let resolvedClientId = options.clientId;
  let helloDone!: (value: void) => void;
  let helloFail!: (error: Error) => void;
  const helloPromise = new Promise<void>((resolve, reject) => {
    helloDone = resolve;
    helloFail = reject;
  });

  const notifyClose = (reason: string) => {
    if (closeNotified) {
      return;
    }
    closeNotified = true;
    connected = false;
    for (const handler of closeHandlers) {
      handler(reason);
    }
  };

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
      connected = true;
      helloDone();
      return;
    }
    if (message.type === "hello:error") {
      helloFail(
        new Error(
          `Playwright Backend Mocks proxy rejected the connection: ${message.message}`,
        ),
      );
      return;
    }
    if (message.type === "ping") {
      send({ type: "pong", at: message.at });
      return;
    }

    for (const handler of messageHandlers) {
      handler(message);
    }
  });

  socket.on("close", () => {
    if (closingIntentionally) {
      notifyClose("Backend mocks agent stopped while a request was pending");
      return;
    }
    notifyClose(
      "Lost connection to the Playwright Backend Mocks proxy while a request was pending. " +
        "The proxy may have exited; pending outbound requests were failed.",
    );
  });

  socket.on("error", (error) => {
    if (closingIntentionally || closeNotified) {
      return;
    }
    notifyClose(`Playwright Backend Mocks proxy connection error: ${error.message}`);
  });

  function send(message: ClientToProxyMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new Error(
        "Cannot send to the Playwright Backend Mocks proxy because the WebSocket is not open",
      );
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

  try {
    await helloPromise;
  } catch (error) {
    socket.close();
    throw error;
  }

  return {
    get clientId() {
      return resolvedClientId;
    },
    get connected() {
      return connected;
    },
    send,
    onMessage(handler) {
      messageHandlers.add(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
    },
    async close() {
      closingIntentionally = true;
      messageHandlers.clear();
      if (
        socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING
      ) {
        await new Promise<void>((resolve) => {
          socket.once("close", () => resolve());
          socket.close();
        });
      } else {
        notifyClose("Backend mocks agent stopped while a request was pending");
      }
      closeHandlers.clear();
    },
  };
}
