import { test, expect, WS_UPSTREAM, WS_UPSTREAM_HTTP, sleep } from "../harness.js";
import type { WebSocketRoute } from "@playwright/test";

/**
 * Oracle for Playwright `page.routeWebSocket` / `WebSocketRoute`.
 *
 * Portable for later Node `globalThis.WebSocket` parity
 * (see research/rewrite-specification.md §4 — partial client coverage + loud docs).
 *
 * Sourced from Playwright `WebSocketRoute` client (`network.ts`), dispatcher, and
 * injected `webSocketMock.ts` — including mock open/protocol, binary frames,
 * TypedArray byteOffset slicing, close-code validation, URLPattern matchers, and
 * predicate catch-all interception (function matchers expand to all URLs).
 *
 * Out of scope: page/context dual-scope routing (product is single-scope).
 */

type MessageSocket = {
  waitForMessage(timeoutMs?: number): Promise<{
    event: "message";
    data: string;
    encoding: "utf8" | "base64";
    binaryType?: string;
  }>;
};

async function expectTextMessage(socket: MessageSocket, expected: string) {
  const message = await socket.waitForMessage();
  expect(message.encoding).toBe("utf8");
  expect(message.data).toBe(expected);
}

async function expectBinaryMessage(
  socket: MessageSocket,
  expected: Buffer,
  binaryType?: string,
) {
  const message = await socket.waitForMessage();
  expect(message.encoding).toBe("base64");
  expect(Buffer.from(message.data, "base64")).toEqual(expected);
  if (binaryType !== undefined) expect(message.binaryType).toBe(binaryType);
}

async function expectUpstreamLastClose(
  trigger: (url: string) => Promise<{ data?: unknown }>,
  expected: { lastClose: { code: number; reason: string } | null },
) {
  await expect
    .poll(async () => {
      const res = await trigger(`${WS_UPSTREAM_HTTP}/last-close`);
      return res.data;
    })
    .toEqual(expected);
}

test.describe("routeWebSocket", () => {
  test("fully mocks without connecting to the server", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (message === "ping") ws.send("pong");
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("ping");
    await socket.send("ignored");

    await expectTextMessage(socket, "pong");
    await expect(socket.waitForMessage(100)).rejects.toThrow(/timeout/i);
  });

  test("empty handler still opens a mocked socket", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let handled = false;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, () => {
      handled = true;
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    expect(handled).toBe(true);
    expect(await socket.readyState()).toBe(1); // OPEN
  });

  test("exposes url and protocols on the route", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let seenUrl = "";
    let seenProtocols: string[] = ["unset"];
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenUrl = ws.url();
      seenProtocols = ws.protocols();
      ws.onMessage((message) => ws.send(String(message)));
    });

    await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    expect(seenUrl).toBe(`${WS_UPSTREAM}/echo`);
    expect(seenProtocols).toEqual(["chat.v1", "chat.v2"]);
  });

  test("protocols() is empty when none were requested", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let seenProtocols: string[] | undefined;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenProtocols = ws.protocols();
    });

    await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    expect(seenProtocols).toEqual([]);
  });

  test("sends binary frames to the page", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const bytes = Buffer.from([1, 2, 3, 254, 255]);
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(() => {
        ws.send(bytes);
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      binaryType: "arraybuffer",
    });
    await socket.send("go");

    await expectBinaryMessage(socket, bytes, "arraybuffer");
  });

  test("connectToServer forwards messages by default", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let connected = false;
    await routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
      ws.connectToServer();
      connected = true;
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`);
    await socket.send("hi");

    expect(connected).toBe(true);
    await expectTextMessage(socket, "echo:hi");
  });

  test("onMessage on the page side disables page→server auto-forward", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        if (message === "block") return;
        if (message === "modify") {
          server.send("changed");
          return;
        }
        server.send(message);
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`);
    await socket.send("block");
    await socket.send("modify");
    await socket.send("pass");

    await expectTextMessage(socket, "echo:changed");
    await expectTextMessage(socket, "echo:pass");
  });

  test("onMessage on the server side disables server→page auto-forward", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        if (typeof message === "string" && message.includes("block")) return;
        if (typeof message === "string" && message.includes("secret")) {
          ws.send("redacted");
          return;
        }
        ws.send(message);
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`);
    await socket.send("ok");
    await socket.send("block");
    await socket.send("secret");

    await expectTextMessage(socket, "echo:ok");
    await expectTextMessage(socket, "redacted");
  });

  test("second onMessage replaces the first handler", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const seen: string[] = [];
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        seen.push(`first:${String(message)}`);
        ws.send("from-first");
      });
      ws.onMessage((message) => {
        seen.push(`second:${String(message)}`);
        ws.send("from-second");
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("x");

    await expectTextMessage(socket, "from-second");
    expect(seen).toEqual(["second:x"]);
  });

  test("route.close closes the page socket with code and reason", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let route!: WebSocketRoute;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    expect(route).toBeTruthy();
    await route.close({ code: 3009, reason: "oops" });

    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 3009,
      reason: "oops",
      wasClean: true,
    });
  });

  test("default close from the page forwards to the server", async ({
    routeWebSocket,
    openDownstreamSocket,
    trigger,
  }) => {
    await trigger(`${WS_UPSTREAM_HTTP}/reset-last-close`);
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.close(3001, "bye");

    await expectUpstreamLastClose(trigger, {
      lastClose: { code: 3001, reason: "bye" },
    });
  });

  test("onClose disables default close forwarding", async ({
    routeWebSocket,
    openDownstreamSocket,
    trigger,
  }) => {
    await trigger(`${WS_UPSTREAM_HTTP}/reset-last-close`);
    let pageCloseSeen = false;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
      ws.onClose(() => {
        pageCloseSeen = true;
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.close(3002, "local");

    await expect.poll(() => pageCloseSeen).toBe(true);
    await sleep(200);
    await expectUpstreamLastClose(trigger, { lastClose: null });
  });

  test("throws when connectToServer is called twice", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let message = "";
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
      try {
        ws.connectToServer();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    });

    await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    expect(message).toMatch(/already connected/i);
  });

  test("matches glob and leaves unmatched sockets to the network", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket("**/mock-ws", (ws) => {
      ws.onMessage(() => ws.send("mocked"));
    });

    const [mock, real] = await Promise.all([
      openDownstreamSocket(`${WS_UPSTREAM}/mock-ws`),
      openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`),
    ]);
    await mock.send("x");
    await real.send("y");

    await expectTextMessage(mock, "mocked");
    await expectTextMessage(real, "echo:y");
  });

  test("matches RegExp patterns", async ({ routeWebSocket, openDownstreamSocket }) => {
    await routeWebSocket(/\/echo$/, (ws) => {
      ws.onMessage(() => ws.send("regex"));
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("x");
    await expectTextMessage(socket, "regex");
  });

  test("newest matching handler wins (no fallback chain)", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const seen: string[] = [];
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seen.push("older");
      ws.onMessage(() => ws.send("older"));
    });
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seen.push("newer");
      ws.onMessage(() => ws.send("newer"));
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("x");

    await expectTextMessage(socket, "newer");
    expect(seen).toEqual(["newer"]);
  });

  test("only sockets created after registration are routed", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const before = await openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`);
    await before.send("before");
    await expectTextMessage(before, "echo:before");

    await routeWebSocket(`${WS_UPSTREAM}/echo**`, (ws) => {
      ws.onMessage(() => ws.send("after-reg"));
    });

    const after = await openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`);
    await after.send("x");
    await expectTextMessage(after, "after-reg");
  });

  test("isolates concurrent routed sockets", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let routed = 0;
    await routeWebSocket(/\/echo/, (ws) => {
      routed += 1;
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((message) => ws.send(message));
    });

    const [first, second] = await Promise.all([
      openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`),
      openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`),
    ]);
    await first.send("a");
    await second.send("b");

    const results = [
      (await first.waitForMessage()).data,
      (await second.waitForMessage()).data,
    ];
    expect(results.sort()).toEqual(["echo:a", "echo:b"]);
    expect(routed).toBe(2);
  });

  test("observes upstream handshake failure with connectToServer", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let serverClosed = false;
    await routeWebSocket(`${WS_UPSTREAM}/reject`, (ws) => {
      const server = ws.connectToServer();
      server.onClose(() => {
        serverClosed = true;
        void ws.close();
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/reject`, {
      waitUntil: "connecting",
    });

    await expect.poll(() => serverClosed).toBe(true);
    await expect.poll(() => socket.readyState()).toBe(3); // CLOSED
  });

  test("unrouteAll does not remove WebSocket routes", async ({
    routeWebSocket,
    openDownstreamSocket,
    unrouteAll,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(() => ws.send("still-routed"));
    });
    // HTTP unrouteAll must not clear WS routes.
    await unrouteAll();

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("x");
    await expectTextMessage(socket, "still-routed");
  });

  test("works with baseURL for relative ws patterns", async ({
    withIsolatedDownstream,
  }) => {
    await withIsolatedDownstream({ baseURL: "http://127.0.0.1:4002" }, async (api) => {
      await api.routeWebSocket("/echo", (ws) => {
        ws.onMessage(() => ws.send("base"));
      });

      const socket = await api.openDownstreamSocket(`${WS_UPSTREAM}/echo`);
      await socket.send("x");
      await expectTextMessage(socket, "base");
    });
  });

  test("matches host URL with no trailing slash", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const log: string[] = [];
    await routeWebSocket(WS_UPSTREAM, (ws) => {
      ws.onMessage((message) => {
        log.push(String(message));
        ws.send("root");
      });
    });

    const socket = await openDownstreamSocket(WS_UPSTREAM);
    await socket.send("query");

    await expect.poll(() => log).toEqual(["query"]);
    await expectTextMessage(socket, "root");
  });

  test("matches predicate URL matchers", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(
      (url) => url.pathname === "/echo",
      (ws) => {
        ws.onMessage(() => ws.send("pred"));
      },
    );

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("x");
    await expectTextMessage(socket, "pred");
  });

  test("exposes a single string protocol as a one-element list", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let seenProtocols: string[] | undefined;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenProtocols = ws.protocols();
    });

    await openDownstreamSocket(`${WS_UPSTREAM}/echo`, { protocols: "chat.v1" });
    expect(seenProtocols).toEqual(["chat.v1"]);
  });

  test("pass-through preserves negotiated subprotocol from upstream", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    expect((await socket.info()).protocol).toBe("chat.v1");
  });

  test("server-side route.protocols mirrors page-requested protocols", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let pageProtocols: string[] = [];
    let serverProtocols: string[] = [];
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      pageProtocols = ws.protocols();
      const server = ws.connectToServer();
      serverProtocols = server.protocols();
    });

    await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    expect(pageProtocols).toEqual(["chat.v1", "chat.v2"]);
    expect(serverProtocols).toEqual(["chat.v1", "chat.v2"]);
  });

  test("route can send to the page without waiting for a message", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.send("hello-first");
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await expectTextMessage(socket, "hello-first");
  });

  test("close without options closes the page socket", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let route!: WebSocketRoute;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await route.close();

    const close = await socket.waitForClose();
    expect(close.code).toEqual(expect.any(Number));
    expect(close.wasClean).toEqual(expect.any(Boolean));
  });

  test("route.close while connected to server closes both sides", async ({
    routeWebSocket,
    openDownstreamSocket,
    trigger,
  }) => {
    await trigger(`${WS_UPSTREAM_HTTP}/reset-last-close`);
    let route!: WebSocketRoute;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
      ws.connectToServer();
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await route.close({ code: 3009, reason: "oops" });

    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 3009,
      reason: "oops",
      wasClean: true,
    });
    await expectUpstreamLastClose(trigger, {
      lastClose: { code: 3009, reason: "oops" },
    });
  });

  test("default close from the server forwards to the page", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("die");

    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 3008,
      reason: "server-bye",
      wasClean: true,
    });
  });

  test("server-side onClose disables server→page close forwarding", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let serverCloseSeen = false;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      server.onClose(() => {
        serverCloseSeen = true;
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("die");

    await expect.poll(() => serverCloseSeen).toBe(true);
    await sleep(200);
    expect(await socket.readyState()).toBe(1); // still OPEN — close was not forwarded
  });

  test("onClose handler can manually forward close to the other side", async ({
    routeWebSocket,
    openDownstreamSocket,
    trigger,
  }) => {
    await trigger(`${WS_UPSTREAM_HTTP}/reset-last-close`);
    let pageCloseCode: number | undefined;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      ws.onClose((code, reason) => {
        pageCloseCode = code;
        const options: { code?: number; reason?: string } = {};
        if (code !== undefined) options.code = code;
        if (reason !== undefined) options.reason = reason;
        void server.close(options);
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.close(3010, "manual");

    await expect.poll(() => pageCloseCode).toBe(3010);
    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 3010,
      reason: "manual",
      wasClean: true,
    });
    await expectUpstreamLastClose(trigger, {
      lastClose: { code: 3010, reason: "manual" },
    });
  });

  test("receives binary frames from the page in onMessage", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const seen: string[] = [];
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (typeof message === "string") {
          seen.push(`str:${message}`);
          return;
        }
        seen.push(`bin:${Buffer.from(message).toString("hex")}`);
        ws.send(Buffer.from([9, 8, 7]));
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      binaryType: "arraybuffer",
    });
    await socket.send(new Uint8Array([1, 2, 3, 254]));

    await expect.poll(() => seen).toEqual(["bin:010203fe"]);
    await expectBinaryMessage(socket, Buffer.from([9, 8, 7]), "arraybuffer");
  });

  test("forwards binary frames through connectToServer by default", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
      ws.connectToServer();
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`, {
      binaryType: "arraybuffer",
    });
    await socket.send(new Uint8Array([0xaa, 0xbb]));

    // Upstream prefixes binary with ASCII "BIN:" then the payload.
    const expected = Buffer.concat([Buffer.from("BIN:"), Buffer.from([0xaa, 0xbb])]);
    await expectBinaryMessage(socket, expected, "arraybuffer");
  });

  test("bidirectional block/modify matrix with connectToServer", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const serverLog: string[] = [];
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        if (message === "to-respond") {
          ws.send("response");
          return;
        }
        server.send(message);
      });
      server.onMessage((message) => {
        serverLog.push(String(message));
        ws.send(message);
      });
      server.send("fake");
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await expect.poll(() => serverLog).toEqual(["fake"]);

    await socket.send("to-respond");

    await expectTextMessage(socket, "fake");
    await expectTextMessage(socket, "response");
  });

  test("baseURL pattern matches when page baseURL uses uppercase scheme", async ({
    withIsolatedDownstream,
  }) => {
    await withIsolatedDownstream({ baseURL: "HTTP://127.0.0.1:4002" }, async (api) => {
      await api.routeWebSocket("/echo", (ws) => {
        ws.onMessage(() => ws.send("cased"));
      });

      const socket = await api.openDownstreamSocket(`${WS_UPSTREAM}/echo`);
      await socket.send("x");
      await expectTextMessage(socket, "cased");
    });
  });

  test("pending async handler leaves socket CONNECTING until it settles", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await routeWebSocket(`${WS_UPSTREAM}/echo`, async (ws) => {
      await gate;
      ws.onMessage((message) => ws.send(`late:${String(message)}`));
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      waitUntil: "connecting",
    });

    await expect.poll(() => socket.readyState()).toBe(0); // CONNECTING while handler is pending

    release();
    await socket.waitForOpen();
    await socket.send("x");
    await expectTextMessage(socket, "late:x");
  });

  test("send during pending handler forces the page socket open", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let route!: WebSocketRoute;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await routeWebSocket(`${WS_UPSTREAM}/echo`, async (ws) => {
      route = ws;
      await gate;
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      waitUntil: "connecting",
    });

    await expect.poll(() => route !== undefined).toBe(true);
    await expect.poll(() => socket.readyState()).toBe(0);

    route.send("forced");
    await expectTextMessage(socket, "forced");
    release();
  });

  test("mock without server selects the first requested protocol", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    expect((await socket.info()).protocol).toBe("chat.v1");
  });

  test("mock without server leaves extensions empty", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    expect((await socket.info()).extensions).toBe("");
  });

  test("server-side connectToServer throws", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let message = "";
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      try {
        server.connectToServer();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    });

    await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    expect(message).toMatch(/connectToServer must be called on the page-side/i);
  });

  test("page send while CONNECTING throws", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await routeWebSocket(`${WS_UPSTREAM}/echo`, async () => {
      await gate;
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      waitUntil: "connecting",
    });

    await expect(socket.send("too-early")).rejects.toThrow(/CONNECTING/i);
    release();
  });

  test("page send after close throws", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let route!: WebSocketRoute;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await route.close({ code: 3000, reason: "done" });
    await expect.poll(() => socket.readyState()).toBe(3);

    await expect(socket.send("nope")).rejects.toThrow(/CLOSING or CLOSED/i);
  });

  test("page close rejects invalid close codes", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);

    await expect(socket.close(1001, "bad")).rejects.toThrow(
      /close code must be either 1000, or between 3000 and 4999/i,
    );
  });

  test("page close allows code 1000", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.close(1000, "normal");
    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 1000,
      reason: "normal",
      wasClean: true,
    });
  });

  test("delivers binary as Blob when binaryType is blob", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(() => ws.send(bytes));
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      binaryType: "blob",
    });
    await socket.send("go");

    await expectBinaryMessage(socket, bytes, "blob");
  });

  test.skip("receives Blob sends from the page as binary frames", async () => {
    // DownstreamSocket exposes portable string/byte-array sends, not DOM Blob.
  });

  test("TypedArray send uses byteOffset and byteLength, not the whole buffer", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const seen: string[] = [];
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (typeof message !== "string") {
          seen.push(Buffer.from(message).toString("hex"));
        }
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    const buffer = new ArrayBuffer(8);
    const full = new Uint8Array(buffer);
    full.set([0xaa, 0xbb, 0x01, 0x02, 0x03, 0xcc, 0xdd, 0xee]);
    const view = new Uint8Array(buffer, 2, 3); // only 01 02 03
    await socket.send(view);

    await expect.poll(() => seen).toEqual(["010203"]);
  });

  test("accepts http(s) WebSocket constructor URLs and rewrites to ws(s)", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let seenUrl = "";
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenUrl = ws.url();
    });

    await openDownstreamSocket(`${WS_UPSTREAM_HTTP}/echo`);
    expect(seenUrl).toBe(`${WS_UPSTREAM}/echo`);
  });

  test("predicate matcher installs catch-all interception and unmatched sockets pass through", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    // Predicate matchers intercept broadly; unmatched sockets still pass through.
    let matched = 0;
    await routeWebSocket(
      (url) => url.pathname === "/mock-only",
      (ws) => {
        matched += 1;
        ws.onMessage(() => ws.send("mocked"));
      },
    );

    const [mock, real] = await Promise.all([
      openDownstreamSocket(`${WS_UPSTREAM}/mock-only`),
      openDownstreamSocket(`${WS_UPSTREAM}/echo?mode=prefix`),
    ]);
    await mock.send("x");
    await real.send("y");

    await expectTextMessage(mock, "mocked");
    await expectTextMessage(real, "echo:y");
    expect(matched).toBe(1);
  });

  test("invalid glob pattern throws at routeWebSocket registration", async ({
    routeWebSocket,
  }) => {
    await expect(
      routeWebSocket("http://127.0.0.1:4002/{unclosed", () => {}),
    ).rejects.toThrow();
  });

  test("URLPattern matcher matches WebSocket URLs", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const { URLPattern } = await import("urlpattern-polyfill");
    // playwright-core Page.routeWebSocket accepts URLPattern; some test typings omit it.
    const routeWS = routeWebSocket as (
      url: string | RegExp | URLPattern | ((url: URL) => boolean),
      handler: (ws: WebSocketRoute) => void,
    ) => Promise<void>;
    await routeWS(
      new URLPattern({
        protocol: "ws",
        hostname: "127.0.0.1",
        port: "4002",
        pathname: "/echo",
      }),
      (ws) => {
        ws.onMessage(() => ws.send("urlpattern"));
      },
    );

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("x");
    await expectTextMessage(socket, "urlpattern");
  });

  test("buffers server.send while the upstream handshake is still CONNECTING", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const upstreamSeen: string[] = [];
    await routeWebSocket(`${WS_UPSTREAM}/slow-upgrade`, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        upstreamSeen.push(String(message));
        ws.send(`got:${String(message)}`);
      });
      // Upstream upgrade is delayed 300ms — this must buffer, then flush on open.
      server.send("early");
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/slow-upgrade`);
    await expectTextMessage(socket, "got:early");
    expect(upstreamSeen).toEqual(["early"]);
  });

  test("onMessage handlers are not awaited (async handler does not block next frame)", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(async (message) => {
        if (message === "block") {
          order.push("block-enter");
          await gate;
          order.push("block-exit");
          return;
        }
        order.push(`msg:${String(message)}`);
      });
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("block");
    await socket.send("next");

    await expect.poll(() => order.includes("msg:next")).toBe(true);
    expect(order.indexOf("block-enter")).toBeLessThan(order.indexOf("msg:next"));
    expect(order.includes("block-exit")).toBe(false);
    release();
    await expect.poll(() => order.includes("block-exit")).toBe(true);
  });

  test("server.close without options closes the upstream socket", async ({
    routeWebSocket,
    openDownstreamSocket,
    trigger,
  }) => {
    await trigger(`${WS_UPSTREAM_HTTP}/reset-last-close`);
    let server!: WebSocketRoute;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      server = ws.connectToServer();
    });
    await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await server.close();

    await expect
      .poll(async () => {
        const res = await trigger(`${WS_UPSTREAM_HTTP}/last-close`);
        return (res.data as { lastClose: unknown }).lastClose !== null;
      })
      .toBe(true);
  });

  test("empty string matcher matches every WebSocket URL", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket("", (ws) => {
      ws.onMessage(() => ws.send("empty-match"));
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await socket.send("x");
    await expectTextMessage(socket, "empty-match");
  });

  test("second route.close is a no-op once the page socket is CLOSED", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let route!: WebSocketRoute;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await route.close({ code: 3000, reason: "once" });
    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 3000,
      reason: "once",
      wasClean: true,
    });

    await route.close({ code: 3001, reason: "twice" });
    await expect(socket.waitForClose(100)).rejects.toThrow(/timeout/i);
  });

  test("page close while CONNECTING still closes with code and reason", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await routeWebSocket(`${WS_UPSTREAM}/echo`, async () => {
      await gate;
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      waitUntil: "connecting",
    });
    await socket.close(3007, "early");

    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 3007,
      reason: "early",
      wasClean: true,
    });
    release();
  });

  test("mock page socket.protocol uses a single string protocol argument", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      protocols: "chat.v1",
    });
    expect((await socket.info()).protocol).toBe("chat.v1");
  });

  test("unclean upstream close forwards wasClean=false to the page", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
    });
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);

    await socket.send("die-unclean");
    const close = await socket.waitForClose();
    expect(close.wasClean).toBe(false);
  });

  test("throwing routeWebSocket handler leaves the socket CONNECTING", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    // Playwright reports the handler exception as a test failure; pin CONNECTING.
    test.fail();
    await routeWebSocket(`${WS_UPSTREAM}/echo`, () => {
      throw new Error("ws-handler-boom");
    });

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      waitUntil: "connecting",
    });

    await sleep(300);
    expect(await socket.readyState()).toBe(0); // CONNECTING — ensureOpened never ran
  });

  test.skip("upstream handshake failure dispatches an error event on the page socket", async () => {
    // DownstreamSocket exposes message/close/open observations, not DOM error events.
  });

  test.skip("changing binaryType after connect affects subsequent binary frames", async () => {
    // DownstreamSocket binaryType is configured when opening the socket.
  });

  test("route.send after the page socket is closed does not throw", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    let route!: WebSocketRoute;
    await routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`);
    await route.close({ code: 3000, reason: "done" });
    await expect(socket.waitForClose()).resolves.toMatchObject({
      code: 3000,
      reason: "done",
      wasClean: true,
    });

    expect(() => route.send("after-close")).not.toThrow();
    await expect(socket.waitForMessage(100)).rejects.toThrow(/timeout/i);
  });

  test("throwing WebSocket predicate matcher fails without opening the socket", async ({
    routeWebSocket,
    openDownstreamSocket,
  }) => {
    test.fail();
    await routeWebSocket(
      () => {
        throw new Error("ws-predicate-boom");
      },
      () => {},
    );

    const socket = await openDownstreamSocket(`${WS_UPSTREAM}/echo`, {
      waitUntil: "connecting",
    });

    await sleep(300);
    expect(await socket.readyState()).toBe(0);
  });

  test.skip("page close sets readyState to CLOSING synchronously", async () => {
    // The parity socket close API is async, so it cannot observe synchronous DOM state.
  });

  test.skip("Blob then text page sends: text can overtake because Blob conversion is async", async () => {
    // This is specific to Playwright's DOM Blob conversion path.
  });
});
