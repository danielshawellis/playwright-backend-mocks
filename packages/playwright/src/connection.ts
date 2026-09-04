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

export interface PlaywrightProxyConnection {
  readonly clientId: string;
  send(message: ClientToProxyMessage): void;
  onMessage(handler: ProxyMessageHandler): () => void;
  close(): Promise<void>;
}

/** How long `route()` / fixture setup wait for a proxy ack. */
export const ACK_TIMEOUT_MS = 5_000;

export type AckWaiter = {
  readonly promise: Promise<void>;
  cancel(error: Error): void;
};

export function createAckWaiter(
  connection: Pick<PlaywrightProxyConnection, "onMessage">,
  isAck: (message: ProxyToClientMessage) => boolean,
  timeoutMs: number,
  label: string,
): AckWaiter {
  let cancel!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => {
        reject(
          new Error(
            `Timed out waiting for proxy to acknowledge ${label} after ${timeoutMs}ms`,
          ),
        );
      });
    }, timeoutMs);
    const off = connection.onMessage((message) => {
      if (!isAck(message)) {
        return;
      }
      finish(resolve);
    });
    function finish(action: () => void): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      off();
      action();
    }
    cancel = (error) => {
      finish(() => reject(error));
    };
  });
  return { promise, cancel };
}

export function waitForAck(
  connection: Pick<PlaywrightProxyConnection, "onMessage">,
  isAck: (message: ProxyToClientMessage) => boolean,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return createAckWaiter(connection, isAck, timeoutMs, label).promise;
}

export async function sendAndWaitForAck(
  connection: Pick<PlaywrightProxyConnection, "send" | "onMessage">,
  message: ClientToProxyMessage,
  isAck: (message: ProxyToClientMessage) => boolean,
  timeoutMs: number = ACK_TIMEOUT_MS,
): Promise<void> {
  const waiter = createAckWaiter(connection, isAck, timeoutMs, message.type);
  try {
    connection.send(message);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    waiter.cancel(err);
    await waiter.promise;
  }
  await waiter.promise;
}

function toWsUrl(proxyUrl: string): string {
  const url = new URL(proxyUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function connectPlaywrightProxy(options: {
  proxyUrl: string;
  workerId: string;
  token?: string;
}): Promise<PlaywrightProxyConnection> {
  const socket = new WebSocket(toWsUrl(options.proxyUrl));
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

  let resolvedClientId = `playwright-${options.workerId}`;
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
      console.error("[playwright-backend-mocks/playwright] invalid proxy message", error);
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
    role: "playwright",
    workerId: options.workerId,
    clientId: resolvedClientId,
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
    send,
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
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
