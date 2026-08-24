import { createServer } from "node:http";
import { expect } from "@playwright/test";
import {
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  matchSerializedMatcher,
  parseJsonProxyMessage,
  stringifyMessage,
  type ClientToProxyMessage,
  type ProxyToClientMessage,
  type SerializedMatcher,
} from "@playwright-backend-mocks/protocol";
import { createProxyServer, type ProxyServer } from "@playwright-backend-mocks/proxy";
import { WIRE_BODIES, WIRE_CONTENT_TYPES, type WireBodyType } from "./wire-upstream.js";

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

/**
 * Raw control-plane client that answers claim broadcasts like a Playwright worker.
 * Used to exercise proxy ownership / disconnect without the full fixture stack.
 */
export class TestSocket {
  private readonly socket: WebSocket;
  private readonly queue: ProxyToClientMessage[] = [];
  private waiters: Array<(message: ProxyToClientMessage) => void> = [];
  private readonly openPromise: Promise<void>;
  private readonly routes = new Map<
    string,
    { testId: string; matcher: SerializedMatcher }
  >();

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
      if (message.type === "request:claim") {
        this.answerClaim(message);
        return;
      }
      if (message.type === "ws:claim") {
        this.answerWsClaim(message);
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
    if (message.type === "route:register") {
      this.routes.set(message.routeId, {
        testId: message.testId,
        matcher: message.matcher,
      });
    } else if (message.type === "route:unregister") {
      if (message.routeId !== undefined) {
        this.routes.delete(message.routeId);
      } else if (message.testId !== undefined) {
        for (const [routeId, route] of this.routes) {
          if (route.testId === message.testId) {
            this.routes.delete(routeId);
          }
        }
      }
    } else if (message.type === "test:unregister") {
      for (const [routeId, route] of this.routes) {
        if (route.testId === message.testId) {
          this.routes.delete(routeId);
        }
      }
    }
    this.socket.send(stringifyMessage(message));
  }

  private answerClaim(
    message: Extract<ProxyToClientMessage, { type: "request:claim" }>,
  ): void {
    const byTest = new Map<string, Array<{ routeId: string }>>();
    for (const [routeId, route] of this.routes) {
      if (
        !matchSerializedMatcher(route.matcher, {
          request: message.request,
          clientId: message.clientId,
        })
      ) {
        continue;
      }
      const matches = byTest.get(route.testId) ?? [];
      matches.push({ routeId });
      byTest.set(route.testId, matches);
    }

    const testIds = new Set([...this.routes.values()].map((route) => route.testId));
    for (const testId of testIds) {
      this.send({
        type: "request:claim-result",
        requestId: message.requestId,
        testId,
        matches: byTest.get(testId) ?? [],
      });
    }
  }

  private answerWsClaim(
    message: Extract<ProxyToClientMessage, { type: "ws:claim" }>,
  ): void {
    const byTest = new Map<string, Array<{ routeId: string }>>();
    for (const [routeId, route] of this.routes) {
      if (
        !matchSerializedMatcher(route.matcher, {
          request: {
            url: message.url,
            method: "GET",
            headers: {},
            bodyBase64: null,
          },
          clientId: message.clientId,
        })
      ) {
        continue;
      }
      const matches = byTest.get(route.testId) ?? [];
      matches.push({ routeId });
      byTest.set(route.testId, matches);
    }

    const testIds = new Set([...this.routes.values()].map((route) => route.testId));
    for (const testId of testIds) {
      this.send({
        type: "ws:claim-result",
        socketId: message.socketId,
        testId,
        matches: byTest.get(testId) ?? [],
      });
    }
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

/**
 * App-visible response after agent passthrough/continue must match a fully
 * buffered body: readable bytes, no stale Content-Encoding, and no illegal
 * Content-Length + Transfer-Encoding: chunked pair (MSW respondWith / Undici
 * closes the socket on that combination).
 */
export async function assertWireResponseCoherent(
  response: Response,
  type: WireBodyType = "json",
): Promise<void> {
  expect(response.status).toBe(200);

  const encoding = response.headers.get("content-encoding");
  expect(encoding === null || encoding.toLowerCase() === "identity").toBe(true);

  const contentLength = response.headers.get("content-length");
  const transferEncoding = response.headers.get("transfer-encoding");
  if (contentLength !== null && transferEncoding !== null) {
    expect(
      transferEncoding,
      "buffered settle must not keep Transfer-Encoding alongside Content-Length",
    ).toBeNull();
  }

  const expectedType = WIRE_CONTENT_TYPES[type];
  if (expectedType !== undefined) {
    expect(response.headers.get("content-type")).toBe(expectedType);
  }

  const actual = Buffer.from(await response.arrayBuffer());
  expect(actual.equals(WIRE_BODIES[type])).toBe(true);
}
