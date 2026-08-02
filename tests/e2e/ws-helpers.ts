import { createServer } from "node:http";
import {
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  parseJsonProxyMessage,
  stringifyMessage,
  type ClientToProxyMessage,
  type ProxyToClientMessage,
} from "@playwright-backend-mocks/protocol";
import { createProxyServer, type ProxyServer } from "@playwright-backend-mocks/proxy";

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate free port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

export async function withProxy(
  overrides: Parameters<typeof createProxyServer>[0],
  run: (proxy: ProxyServer) => Promise<void>,
): Promise<void> {
  const port = overrides?.port ?? (await getFreePort());
  const proxy = createProxyServer({
    host: "127.0.0.1",
    logLevel: "silent",
    ...overrides,
    port,
  });
  await proxy.start();
  try {
    await run(proxy);
  } finally {
    await proxy.stop();
  }
}

export class TestSocket {
  private readonly socket: WebSocket;
  private readonly queue: ProxyToClientMessage[] = [];
  private waiters: Array<(message: ProxyToClientMessage) => void> = [];
  private readonly openPromise: Promise<void>;

  private constructor(url: string) {
    this.socket = new WebSocket(url);
    this.openPromise = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener(
        "error",
        () => reject(new Error(`WebSocket error for ${url}`)),
        { once: true },
      );
    });
    this.socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      const message = parseJsonProxyMessage(raw);
      if (message.type === "ping") {
        this.send({ type: "pong", at: message.at });
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        this.queue.push(message);
      }
    });
  }

  static async connect(proxyUrl: string): Promise<TestSocket> {
    const url = new URL(proxyUrl);
    url.protocol = "ws:";
    url.pathname = "/ws";
    const client = new TestSocket(url.toString());
    await client.openPromise;
    return client;
  }

  send(message: ClientToProxyMessage): void {
    this.socket.send(stringifyMessage(message));
  }

  private waitForIncoming(timeoutMs: number): Promise<ProxyToClientMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(onMessage);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for proxy message after ${timeoutMs}ms`));
      }, timeoutMs);

      const onMessage = (message: ProxyToClientMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(onMessage);
    });
  }

  async waitForType<T extends ProxyToClientMessage["type"]>(
    type: T,
    timeoutMs = 5_000,
  ): Promise<Extract<ProxyToClientMessage, { type: T }>> {
    return (await this.waitForOneOf([type], timeoutMs)) as Extract<
      ProxyToClientMessage,
      { type: T }
    >;
  }

  async waitForOneOf(
    types: readonly ProxyToClientMessage["type"][],
    timeoutMs = 5_000,
  ): Promise<ProxyToClientMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const queuedIndex = this.queue.findIndex((message) =>
        (types as readonly string[]).includes(message.type),
      );
      if (queuedIndex >= 0) {
        const [message] = this.queue.splice(queuedIndex, 1);
        if (message === undefined) {
          throw new Error("Failed to read queued proxy message");
        }
        return message;
      }

      const message = await this.waitForIncoming(Math.max(1, deadline - Date.now()));
      if ((types as readonly string[]).includes(message.type)) {
        return message;
      }
      this.queue.push(message);
    }
    throw new Error(`Timed out waiting for one of: ${types.join(", ")}`);
  }

  async hello(options: {
    role: "node" | "playwright";
    clientId?: string;
    workerId?: string;
    token?: string;
    protocolVersion?: number;
    packageVersion?: string;
  }): Promise<ProxyToClientMessage> {
    this.send({
      type: "hello",
      protocolVersion: options.protocolVersion ?? PROTOCOL_VERSION,
      packageVersion: options.packageVersion ?? PACKAGE_VERSION,
      role: options.role,
      ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
      ...(options.workerId !== undefined ? { workerId: options.workerId } : {}),
      ...(options.token !== undefined ? { token: options.token } : {}),
    });
    return this.waitForOneOf(["hello:ok", "hello:error"]);
  }

  close(): void {
    this.socket.close();
  }
}
