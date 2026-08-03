import { test, expect, WS_UPSTREAM, HARNESS } from "../harness.js";
import type { Page, WebSocketRoute } from "@playwright/test";

/**
 * Oracle for Playwright `page.routeWebSocket` / `WebSocketRoute`.
 *
 * Important: Playwright installs WebSocket routing via an init script, so
 * `routeWebSocket` must be registered **before** navigating the page that will
 * open sockets. Tests below always route first, then goto the harness.
 *
 * Portable for later Node `globalThis.WebSocket` parity
 * (see research/rewrite-specification.md §4 — partial client coverage + loud docs).
 *
 * Sourced from Playwright `WebSocketRoute` client (`network.ts`), dispatcher, and
 * injected `webSocketMock.ts` — including mock open/protocol, Blob binary frames,
 * TypedArray byteOffset slicing, close-code validation, URLPattern matchers, and
 * predicate catch-all interception (function matchers expand to all URLs).
 *
 * Out of scope: page/context dual-scope routing (product is single-scope).
 */

async function gotoHarness(page: Page) {
  await page.goto(HARNESS + "/", { waitUntil: "domcontentloaded" });
}

async function openPageSocket(
  page: Page,
  url: string,
  options?: { protocols?: string | string[]; binaryType?: BinaryType },
) {
  await page.evaluate(
    ({ url, protocols, binaryType }) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      if (binaryType) ws.binaryType = binaryType;
      (window as unknown as { ws: WebSocket }).ws = ws;
      (window as unknown as { wsOpened: Promise<void> }).wsOpened = new Promise(
        (resolve, reject) => {
          ws.addEventListener("open", () => {
            (window as unknown as { log: string[] }).log.push("open");
            resolve();
          });
          ws.addEventListener("error", () => reject(new Error("ws error")));
        },
      );
      ws.addEventListener("message", (event) => {
        const data = event.data;
        const push = (rendered: string) => {
          (window as unknown as { log: string[] }).log.push(`message:${rendered}`);
        };
        if (typeof data === "string") {
          push(data);
        } else if (data instanceof ArrayBuffer) {
          const bytes = Array.from(new Uint8Array(data))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          push(`buf:${bytes}`);
        } else if (typeof Blob !== "undefined" && data instanceof Blob) {
          void data.arrayBuffer().then((buffer) => {
            const bytes = Array.from(new Uint8Array(buffer))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
            push(`blob:${bytes}`);
          });
        } else {
          push("unknown");
        }
      });
      ws.addEventListener("close", (event) => {
        (window as unknown as { log: string[] }).log.push(
          `close code=${event.code} reason=${event.reason} wasClean=${event.wasClean}`,
        );
      });
    },
    {
      url,
      protocols: options?.protocols,
      binaryType: options?.binaryType,
    },
  );
  await page.evaluate(() => (window as unknown as { wsOpened: Promise<void> }).wsOpened);
}

test.describe("routeWebSocket", () => {
  test("fully mocks without connecting to the server", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (message === "ping") ws.send("pong");
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => {
      (window as unknown as { ws: WebSocket }).ws.send("ping");
      (window as unknown as { ws: WebSocket }).ws.send("ignored");
    });

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:pong"]);
  });

  test("empty handler still opens a mocked socket", async ({ page }) => {
    let handled = false;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {
      handled = true;
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    expect(handled).toBe(true);
    const readyState = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.readyState,
    );
    expect(readyState).toBe(1); // OPEN
  });

  test("exposes url and protocols on the route", async ({ page }) => {
    let seenUrl = "";
    let seenProtocols: string[] = ["unset"];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenUrl = ws.url();
      seenProtocols = ws.protocols();
      ws.onMessage((message) => ws.send(String(message)));
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    expect(seenUrl).toBe(`${WS_UPSTREAM}/echo`);
    expect(seenProtocols).toEqual(["chat.v1", "chat.v2"]);
  });

  test("protocols() is empty when none were requested", async ({ page }) => {
    let seenProtocols: string[] | undefined;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenProtocols = ws.protocols();
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    expect(seenProtocols).toEqual([]);
  });

  test("sends binary frames to the page", async ({ page }) => {
    const bytes = Buffer.from([1, 2, 3, 254, 255]);
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(() => {
        ws.send(bytes);
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, {
      binaryType: "arraybuffer",
    });
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("go"));

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", `message:buf:${bytes.toString("hex")}`]);
  });

  test("connectToServer forwards messages by default", async ({ page }) => {
    let connected = false;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
      ws.connectToServer();
      connected = true;
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo?mode=prefix`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("hi"));

    expect(connected).toBe(true);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:echo:hi"]);
  });

  test("onMessage on the page side disables page→server auto-forward", async ({
    page,
  }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
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
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo?mode=prefix`);
    await page.evaluate(() => {
      const ws = (window as unknown as { ws: WebSocket }).ws;
      ws.send("block");
      ws.send("modify");
      ws.send("pass");
    });

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:echo:changed", "message:echo:pass"]);
  });

  test("onMessage on the server side disables server→page auto-forward", async ({
    page,
  }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
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
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo?mode=prefix`);
    await page.evaluate(() => {
      const ws = (window as unknown as { ws: WebSocket }).ws;
      ws.send("ok");
      ws.send("block");
      ws.send("secret");
    });

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:echo:ok", "message:redacted"]);
  });

  test("second onMessage replaces the first handler", async ({ page }) => {
    const seen: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        seen.push(`first:${String(message)}`);
        ws.send("from-first");
      });
      ws.onMessage((message) => {
        seen.push(`second:${String(message)}`);
        ws.send("from-second");
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:from-second"]);
    expect(seen).toEqual(["second:x"]);
  });

  test("route.close closes the page socket with code and reason", async ({ page }) => {
    let route!: WebSocketRoute;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    expect(route).toBeTruthy();
    await route.close({ code: 3009, reason: "oops" });

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "close code=3009 reason=oops wasClean=true"]);
  });

  test("default close from the page forwards to the server", async ({ page }) => {
    let serverClosed:
      { code?: number | undefined; reason?: string | undefined } | undefined;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      server.onClose((code, reason) => {
        serverClosed = { code, reason };
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() =>
      (window as unknown as { ws: WebSocket }).ws.close(3001, "bye"),
    );

    await expect.poll(() => serverClosed?.code).toBe(3001);
    expect(serverClosed?.reason).toBe("bye");
  });

  test("onClose disables default close forwarding", async ({ page }) => {
    let pageCloseSeen = false;
    let serverCloseSeen = false;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      ws.onClose(() => {
        pageCloseSeen = true;
      });
      server.onClose(() => {
        serverCloseSeen = true;
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() =>
      (window as unknown as { ws: WebSocket }).ws.close(3002, "local"),
    );

    await expect.poll(() => pageCloseSeen).toBe(true);
    await page.waitForTimeout(200);
    expect(serverCloseSeen).toBe(false);
  });

  test("throws when connectToServer is called twice", async ({ page }) => {
    let message = "";
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
      try {
        ws.connectToServer();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    expect(message).toMatch(/already connected/i);
  });

  test("matches glob and leaves unmatched sockets to the network", async ({ page }) => {
    await page.routeWebSocket("**/mock-ws", (ws) => {
      ws.onMessage(() => ws.send("mocked"));
    });
    await gotoHarness(page);

    const results = await page.evaluate(async (base) => {
      const mock = new Promise<string>((resolve) => {
        const ws = new WebSocket(`${base}/mock-ws`);
        ws.addEventListener("open", () => ws.send("x"));
        ws.addEventListener("message", (e) => resolve(String(e.data)));
      });
      const real = new Promise<string>((resolve) => {
        const ws = new WebSocket(`${base}/echo?mode=prefix`);
        ws.addEventListener("open", () => ws.send("y"));
        ws.addEventListener("message", (e) => resolve(String(e.data)));
      });
      return { mock: await mock, real: await real };
    }, WS_UPSTREAM);

    expect(results.mock).toBe("mocked");
    expect(results.real).toBe("echo:y");
  });

  test("matches RegExp patterns", async ({ page }) => {
    await page.routeWebSocket(/\/echo$/, (ws) => {
      ws.onMessage(() => ws.send("regex"));
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:regex"]);
  });

  test("newest matching handler wins (no fallback chain)", async ({ page }) => {
    const seen: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seen.push("older");
      ws.onMessage(() => ws.send("older"));
    });
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seen.push("newer");
      ws.onMessage(() => ws.send("newer"));
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:newer"]);
    expect(seen).toEqual(["newer"]);
  });

  test("only sockets created after registration are routed", async ({ page }) => {
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo?mode=prefix`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("before"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:echo:before"]);

    await page.routeWebSocket(`${WS_UPSTREAM}/echo**`, (ws) => {
      ws.onMessage(() => ws.send("after-reg"));
    });
    // Re-goto so the WS init script applies after late registration.
    await gotoHarness(page);

    const mocked = await page.evaluate(async (url) => {
      return new Promise<string>((resolve) => {
        const ws = new WebSocket(url);
        ws.addEventListener("open", () => ws.send("x"));
        ws.addEventListener("message", (e) => resolve(String(e.data)));
      });
    }, `${WS_UPSTREAM}/echo?mode=prefix`);
    expect(mocked).toBe("after-reg");
  });

  test("isolates concurrent routed sockets", async ({ page }) => {
    let routed = 0;
    await page.routeWebSocket(/\/echo/, (ws) => {
      routed += 1;
      const server = ws.connectToServer();
      ws.onMessage((message) => server.send(message));
      server.onMessage((message) => ws.send(message));
    });
    await gotoHarness(page);

    const results = await page.evaluate(async (base) => {
      const one = (tag: string) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(`${base}/echo?mode=prefix`);
          ws.addEventListener("open", () => ws.send(tag));
          ws.addEventListener("message", (e) => {
            resolve(String(e.data));
            ws.close();
          });
        });
      return Promise.all([one("a"), one("b")]);
    }, WS_UPSTREAM);

    expect(results.sort()).toEqual(["echo:a", "echo:b"]);
    expect(routed).toBe(2);
  });

  test("observes upstream handshake failure with connectToServer", async ({ page }) => {
    let serverClosed = false;
    await page.routeWebSocket(`${WS_UPSTREAM}/reject`, (ws) => {
      const server = ws.connectToServer();
      server.onClose(() => {
        serverClosed = true;
        void ws.close();
      });
    });
    await gotoHarness(page);

    await page.evaluate((url) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      ws.addEventListener("close", (e) => {
        (window as unknown as { log: string[] }).log.push(`close code=${e.code}`);
      });
    }, `${WS_UPSTREAM}/reject`);

    await expect.poll(() => serverClosed).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.readyState),
      )
      .toBe(3); // CLOSED
  });

  test("unrouteAll does not remove WebSocket routes", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(() => ws.send("still-routed"));
    });
    // HTTP unrouteAll must not clear WS routes; re-navigate so WS init remains.
    await page.unrouteAll();
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:still-routed"]);
  });

  test("works with baseURL for relative ws patterns", async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:4002",
    });
    const page = await context.newPage();
    await page.routeWebSocket("/echo", (ws) => {
      ws.onMessage(() => ws.send("base"));
    });
    await page.goto(HARNESS + "/");

    const result = await page.evaluate(async () => {
      return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket("ws://127.0.0.1:4002/echo");
        ws.addEventListener("open", () => ws.send("x"));
        ws.addEventListener("message", (e) => resolve(String(e.data)));
        ws.addEventListener("error", () => reject(new Error("error")));
      });
    });
    expect(result).toBe("base");
    await context.close();
  });

  test("matches host URL with no trailing slash", async ({ page }) => {
    const log: string[] = [];
    await page.routeWebSocket(WS_UPSTREAM, (ws) => {
      ws.onMessage((message) => {
        log.push(String(message));
        ws.send("root");
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, WS_UPSTREAM);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("query"));
    await expect.poll(() => log).toEqual(["query"]);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:root"]);
  });

  test("matches predicate URL matchers", async ({ page }) => {
    await page.routeWebSocket(
      (url) => url.pathname === "/echo",
      (ws) => {
        ws.onMessage(() => ws.send("pred"));
      },
    );
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:pred"]);
  });

  test("exposes a single string protocol as a one-element list", async ({ page }) => {
    let seenProtocols: string[] | undefined;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenProtocols = ws.protocols();
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, { protocols: "chat.v1" });
    expect(seenProtocols).toEqual(["chat.v1"]);
  });

  test("pass-through preserves negotiated subprotocol from upstream", async ({
    page,
  }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    const negotiated = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.protocol,
    );
    expect(negotiated).toBe("chat.v1");
  });

  test("server-side route.protocols mirrors page-requested protocols", async ({
    page,
  }) => {
    let pageProtocols: string[] = [];
    let serverProtocols: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      pageProtocols = ws.protocols();
      const server = ws.connectToServer();
      serverProtocols = server.protocols();
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    expect(pageProtocols).toEqual(["chat.v1", "chat.v2"]);
    expect(serverProtocols).toEqual(["chat.v1", "chat.v2"]);
  });

  test("route can send to the page without waiting for a message", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.send("hello-first");
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:hello-first"]);
  });

  test("close without options closes the page socket", async ({ page }) => {
    let route!: WebSocketRoute;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await route.close();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", expect.stringMatching(/^close code=\d+ reason=.*wasClean=/)]);
  });

  test("route.close while connected to server closes both sides", async ({ page }) => {
    await page.request.post("http://127.0.0.1:4002/reset-last-close");
    let route!: WebSocketRoute;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
      ws.connectToServer();
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await route.close({ code: 3009, reason: "oops" });

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "close code=3009 reason=oops wasClean=true"]);
    await expect
      .poll(async () => {
        const res = await page.request.get("http://127.0.0.1:4002/last-close");
        return (await res.json()) as {
          lastClose: { code: number; reason: string } | null;
        };
      })
      .toEqual({ lastClose: { code: 3009, reason: "oops" } });
  });

  test("default close from the server forwards to the page", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("die"));

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "close code=3008 reason=server-bye wasClean=true"]);
  });

  test("server-side onClose disables server→page close forwarding", async ({ page }) => {
    let serverCloseSeen = false;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      server.onClose(() => {
        serverCloseSeen = true;
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("die"));

    await expect.poll(() => serverCloseSeen).toBe(true);
    await page.waitForTimeout(200);
    const log = await page.evaluate(() => (window as unknown as { log: string[] }).log);
    expect(log).toEqual(["open"]);
    const readyState = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.readyState,
    );
    expect(readyState).toBe(1); // still OPEN — close was not forwarded
  });

  test("onClose handler can manually forward close to the other side", async ({
    page,
  }) => {
    let pageCloseCode: number | undefined;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      ws.onClose((code, reason) => {
        pageCloseCode = code;
        const options: { code?: number; reason?: string } = {};
        if (code !== undefined) options.code = code;
        if (reason !== undefined) options.reason = reason;
        void server.close(options);
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() =>
      (window as unknown as { ws: WebSocket }).ws.close(3010, "manual"),
    );

    await expect.poll(() => pageCloseCode).toBe(3010);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "close code=3010 reason=manual wasClean=true"]);
  });

  test("receives binary frames from the page in onMessage", async ({ page }) => {
    const seen: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (typeof message === "string") {
          seen.push(`str:${message}`);
          return;
        }
        seen.push(`bin:${Buffer.from(message).toString("hex")}`);
        ws.send(Buffer.from([9, 8, 7]));
      });
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, { binaryType: "arraybuffer" });
    await page.evaluate(() => {
      const bytes = new Uint8Array([1, 2, 3, 254]);
      (window as unknown as { ws: WebSocket }).ws.send(bytes.buffer);
    });

    await expect.poll(() => seen).toEqual(["bin:010203fe"]);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:buf:090807"]);
  });

  test("forwards binary frames through connectToServer by default", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo?mode=prefix`, (ws) => {
      ws.connectToServer();
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo?mode=prefix`, {
      binaryType: "arraybuffer",
    });
    await page.evaluate(() => {
      const bytes = new Uint8Array([0xaa, 0xbb]);
      (window as unknown as { ws: WebSocket }).ws.send(bytes.buffer);
    });

    // Upstream prefixes binary with ASCII "BIN:" then the payload.
    const expected = Buffer.concat([Buffer.from("BIN:"), Buffer.from([0xaa, 0xbb])]);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", `message:buf:${expected.toString("hex")}`]);
  });

  test("bidirectional block/modify matrix with connectToServer", async ({ page }) => {
    const serverLog: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
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
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await expect.poll(() => serverLog).toEqual(["fake"]);

    await page.evaluate(() => {
      (window as unknown as { ws: WebSocket }).ws.send("to-respond");
    });

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:fake", "message:response"]);
  });

  test("baseURL pattern matches when page baseURL uses uppercase scheme", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "HTTP://127.0.0.1:4002",
    });
    const page = await context.newPage();
    await page.routeWebSocket("/echo", (ws) => {
      ws.onMessage(() => ws.send("cased"));
    });
    await page.goto(HARNESS + "/");

    const result = await page.evaluate(async () => {
      return new Promise<string>((resolve, reject) => {
        const ws = new WebSocket("ws://127.0.0.1:4002/echo");
        ws.addEventListener("open", () => ws.send("x"));
        ws.addEventListener("message", (e) => resolve(String(e.data)));
        ws.addEventListener("error", () => reject(new Error("error")));
      });
    });
    expect(result).toBe("cased");
    await context.close();
  });

  test("pending async handler leaves socket CONNECTING until it settles", async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, async (ws) => {
      await gate;
      ws.onMessage((message) => ws.send(`late:${String(message)}`));
    });
    await gotoHarness(page);

    await page.evaluate((url) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      ws.addEventListener("open", () =>
        (window as unknown as { log: string[] }).log.push("open"),
      );
      ws.addEventListener("message", (e) =>
        (window as unknown as { log: string[] }).log.push(`message:${String(e.data)}`),
      );
    }, `${WS_UPSTREAM}/echo`);

    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.readyState),
      )
      .toBe(0); // CONNECTING while handler is pending

    release();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.readyState),
      )
      .toBe(1);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:late:x"]);
  });

  test("send during pending handler forces the page socket open", async ({ page }) => {
    let route!: WebSocketRoute;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, async (ws) => {
      route = ws;
      await gate;
    });
    await gotoHarness(page);

    await page.evaluate((url) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      ws.addEventListener("open", () =>
        (window as unknown as { log: string[] }).log.push("open"),
      );
      ws.addEventListener("message", (e) =>
        (window as unknown as { log: string[] }).log.push(`message:${String(e.data)}`),
      );
    }, `${WS_UPSTREAM}/echo`);

    await expect.poll(() => route !== undefined).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.readyState),
      )
      .toBe(0);

    route.send("forced");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:forced"]);
    release();
  });

  test("mock without server selects the first requested protocol", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, {
      protocols: ["chat.v1", "chat.v2"],
    });
    const protocol = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.protocol,
    );
    expect(protocol).toBe("chat.v1");
  });

  test("mock without server leaves extensions empty", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    const extensions = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.extensions,
    );
    expect(extensions).toBe("");
  });

  test("server-side connectToServer throws", async ({ page }) => {
    let message = "";
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      const server = ws.connectToServer();
      try {
        server.connectToServer();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    expect(message).toMatch(/connectToServer must be called on the page-side/i);
  });

  test("page send while CONNECTING throws", async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, async () => {
      await gate;
    });
    await gotoHarness(page);

    const error = await page.evaluate(async (url) => {
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      try {
        ws.send("too-early");
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    }, `${WS_UPSTREAM}/echo`);

    expect(error).toMatch(/CONNECTING/i);
    release();
  });

  test("page send after close throws", async ({ page }) => {
    let route!: WebSocketRoute;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await route.close({ code: 3000, reason: "done" });
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.readyState),
      )
      .toBe(3);

    const error = await page.evaluate(() => {
      try {
        (window as unknown as { ws: WebSocket }).ws.send("nope");
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(error).toMatch(/CLOSING or CLOSED/i);
  });

  test("page close rejects invalid close codes", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);

    const error = await page.evaluate(() => {
      try {
        (window as unknown as { ws: WebSocket }).ws.close(1001, "bad");
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(error).toMatch(/close code must be either 1000, or between 3000 and 4999/i);
  });

  test("page close allows code 1000", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() =>
      (window as unknown as { ws: WebSocket }).ws.close(1000, "normal"),
    );
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "close code=1000 reason=normal wasClean=true"]);
  });

  test("delivers binary as Blob when binaryType is blob", async ({ page }) => {
    const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(() => ws.send(bytes));
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`, { binaryType: "blob" });
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("go"));

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", `message:blob:${bytes.toString("hex")}`]);
  });

  test("receives Blob sends from the page as binary frames", async ({ page }) => {
    const seen: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (typeof message === "string") {
          seen.push(`str:${message}`);
        } else {
          seen.push(`bin:${Buffer.from(message).toString("hex")}`);
        }
      });
    });
    await gotoHarness(page);

    await page.evaluate(async (url) => {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", () => reject(new Error("ws error")));
      });
      ws.send(new Blob([new Uint8Array([1, 2, 3])]));
    }, `${WS_UPSTREAM}/echo`);

    await expect.poll(() => seen).toEqual(["bin:010203"]);
  });

  test("TypedArray send uses byteOffset and byteLength, not the whole buffer", async ({
    page,
  }) => {
    const seen: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (typeof message !== "string") {
          seen.push(Buffer.from(message).toString("hex"));
        }
      });
    });
    await gotoHarness(page);

    await page.evaluate(async (url) => {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", () => reject(new Error("ws error")));
      });
      const buffer = new ArrayBuffer(8);
      const full = new Uint8Array(buffer);
      full.set([0xaa, 0xbb, 0x01, 0x02, 0x03, 0xcc, 0xdd, 0xee]);
      const view = new Uint8Array(buffer, 2, 3); // only 01 02 03
      ws.send(view);
    }, `${WS_UPSTREAM}/echo`);

    await expect.poll(() => seen).toEqual(["010203"]);
  });

  test("accepts http(s) WebSocket constructor URLs and rewrites to ws(s)", async ({
    page,
  }) => {
    let seenUrl = "";
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      seenUrl = ws.url();
    });
    await gotoHarness(page);

    await page.evaluate(async () => {
      const ws = new WebSocket("http://127.0.0.1:4002/echo");
      (window as unknown as { ws: WebSocket }).ws = ws;
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", () => reject(new Error("ws error")));
      });
    });
    expect(seenUrl).toBe(`${WS_UPSTREAM}/echo`);
  });

  test("predicate matcher installs catch-all interception and unmatched sockets pass through", async ({
    page,
  }) => {
    // Predicate matchers intercept broadly; unmatched sockets still pass through.
    let matched = 0;
    await page.routeWebSocket(
      (url) => url.pathname === "/mock-only",
      (ws) => {
        matched += 1;
        ws.onMessage(() => ws.send("mocked"));
      },
    );
    await gotoHarness(page);

    const results = await page.evaluate(async (base) => {
      const mock = new Promise<string>((resolve) => {
        const ws = new WebSocket(`${base}/mock-only`);
        ws.addEventListener("open", () => ws.send("x"));
        ws.addEventListener("message", (e) => resolve(String(e.data)));
      });
      const real = new Promise<string>((resolve) => {
        const ws = new WebSocket(`${base}/echo?mode=prefix`);
        ws.addEventListener("open", () => ws.send("y"));
        ws.addEventListener("message", (e) => resolve(String(e.data)));
      });
      return { mock: await mock, real: await real };
    }, WS_UPSTREAM);

    expect(results.mock).toBe("mocked");
    expect(results.real).toBe("echo:y");
    expect(matched).toBe(1);
  });

  test("invalid glob pattern throws at routeWebSocket registration", async ({ page }) => {
    let error: Error | undefined;
    try {
      await page.routeWebSocket("http://127.0.0.1:4002/{unclosed", () => {});
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeTruthy();
  });

  test("URLPattern matcher matches WebSocket URLs", async ({ page }) => {
    const { URLPattern } = await import("urlpattern-polyfill");
    // playwright-core Page.routeWebSocket accepts URLPattern; some test typings omit it.
    const routeWebSocket = page.routeWebSocket.bind(page) as (
      url: string | RegExp | URLPattern | ((url: URL) => boolean),
      handler: (ws: WebSocketRoute) => void,
    ) => Promise<void>;
    await routeWebSocket(
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
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:urlpattern"]);
  });

  test("buffers server.send while the upstream handshake is still CONNECTING", async ({
    page,
  }) => {
    const upstreamSeen: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/slow-upgrade`, (ws) => {
      const server = ws.connectToServer();
      server.onMessage((message) => {
        upstreamSeen.push(String(message));
        ws.send(`got:${String(message)}`);
      });
      // Upstream upgrade is delayed 300ms — this must buffer, then flush on open.
      server.send("early");
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/slow-upgrade`);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:got:early"]);
    expect(upstreamSeen).toEqual(["early"]);
  });

  test("onMessage handlers are not awaited (async handler does not block next frame)", async ({
    page,
  }) => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
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
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => {
      const ws = (window as unknown as { ws: WebSocket }).ws;
      ws.send("block");
      ws.send("next");
    });

    await expect.poll(() => order.includes("msg:next")).toBe(true);
    expect(order.indexOf("block-enter")).toBeLessThan(order.indexOf("msg:next"));
    expect(order.includes("block-exit")).toBe(false);
    release();
    await expect.poll(() => order.includes("block-exit")).toBe(true);
  });

  test("server.close without options closes the upstream socket", async ({ page }) => {
    await page.request.post("http://127.0.0.1:4002/reset-last-close");
    let server!: WebSocketRoute;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      server = ws.connectToServer();
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await server.close();

    await expect
      .poll(async () => {
        const res = await page.request.get("http://127.0.0.1:4002/last-close");
        const body = (await res.json()) as {
          lastClose: { code: number; reason: string } | null;
        };
        return body.lastClose !== null;
      })
      .toBe(true);
  });

  test("empty string matcher matches every WebSocket URL", async ({ page }) => {
    await page.routeWebSocket("", (ws) => {
      ws.onMessage(() => ws.send("empty-match"));
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:empty-match"]);
  });

  test("second route.close is a no-op once the page socket is CLOSED", async ({
    page,
  }) => {
    let route!: WebSocketRoute;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await route.close({ code: 3000, reason: "once" });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "close code=3000 reason=once wasClean=true"]);

    await route.close({ code: 3001, reason: "twice" });
    await page.waitForTimeout(100);
    const log = await page.evaluate(() => (window as unknown as { log: string[] }).log);
    expect(log).toEqual(["open", "close code=3000 reason=once wasClean=true"]);
  });

  test("page close while CONNECTING still closes with code and reason", async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, async () => {
      await gate;
    });
    await gotoHarness(page);

    await page.evaluate((url) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      ws.addEventListener("open", () =>
        (window as unknown as { log: string[] }).log.push("open"),
      );
      ws.addEventListener("close", (e) =>
        (window as unknown as { log: string[] }).log.push(
          `close code=${e.code} reason=${e.reason} wasClean=${e.wasClean}`,
        ),
      );
      ws.close(3007, "early");
    }, `${WS_UPSTREAM}/echo`);

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["close code=3007 reason=early wasClean=true"]);
    release();
  });

  test("mock page socket.protocol uses a single string protocol argument", async ({
    page,
  }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`, { protocols: "chat.v1" });
    const protocol = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.protocol,
    );
    expect(protocol).toBe("chat.v1");
  });

  test("unclean upstream close forwards wasClean=false to the page", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.connectToServer();
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);

    await page.evaluate(() =>
      (window as unknown as { ws: WebSocket }).ws.send("die-unclean"),
    );
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual([
        "open",
        expect.stringMatching(/^close code=\d+ reason=.*wasClean=false/),
      ]);
  });

  test("throwing routeWebSocket handler leaves the socket CONNECTING", async ({
    page,
  }) => {
    // Playwright reports the handler exception as a test failure; pin CONNECTING.
    test.fail();
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {
      throw new Error("ws-handler-boom");
    });
    await gotoHarness(page);

    await page.evaluate((url) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      ws.addEventListener("open", () =>
        (window as unknown as { log: string[] }).log.push("open"),
      );
      ws.addEventListener("error", () =>
        (window as unknown as { log: string[] }).log.push("error"),
      );
      ws.addEventListener("close", () =>
        (window as unknown as { log: string[] }).log.push("close"),
      );
    }, `${WS_UPSTREAM}/echo`);

    await page.waitForTimeout(300);
    const state = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.readyState,
    );
    expect(state).toBe(0); // CONNECTING — ensureOpened never ran
    const log = await page.evaluate(() => (window as unknown as { log: string[] }).log);
    expect(log).not.toContain("open");
  });

  test("upstream handshake failure dispatches an error event on the page socket", async ({
    page,
  }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/reject`, (ws) => {
      ws.connectToServer();
    });
    await gotoHarness(page);

    await page.evaluate((url) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      ws.addEventListener("open", () =>
        (window as unknown as { log: string[] }).log.push("open"),
      );
      ws.addEventListener("error", () =>
        (window as unknown as { log: string[] }).log.push("error"),
      );
      ws.addEventListener("close", (e) =>
        (window as unknown as { log: string[] }).log.push(
          `close code=${e.code} wasClean=${e.wasClean}`,
        ),
      );
    }, `${WS_UPSTREAM}/reject`);

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["error", expect.stringMatching(/^close code=\d+ wasClean=/)]);
  });

  test("changing binaryType after connect affects subsequent binary frames", async ({
    page,
  }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((msg) => {
        if (typeof msg === "string") ws.send(Buffer.from([1, 2, 3]));
      });
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`, { binaryType: "blob" });

    await page.evaluate(() => {
      const ws = (window as unknown as { ws: WebSocket }).ws;
      ws.binaryType = "arraybuffer";
      ws.send("ping");
    });

    await expect
      .poll(() =>
        page.evaluate(() => {
          const log = (window as unknown as { log: string[] }).log;
          return log.find((entry) => entry.startsWith("message:"));
        }),
      )
      .toBe("message:buf:010203");
  });

  test("route.send after the page socket is closed does not throw", async ({ page }) => {
    let route!: WebSocketRoute;
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      route = ws;
    });
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await route.close({ code: 3000, reason: "done" });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "close code=3000 reason=done wasClean=true"]);

    expect(() => route.send("after-close")).not.toThrow();
    await page.waitForTimeout(100);
    const log = await page.evaluate(() => (window as unknown as { log: string[] }).log);
    expect(log.filter((e) => e.startsWith("message:"))).toHaveLength(0);
  });

  test("throwing WebSocket predicate matcher fails without opening the socket", async ({
    page,
  }) => {
    test.fail();
    await page.routeWebSocket(
      () => {
        throw new Error("ws-predicate-boom");
      },
      () => {},
    );
    await gotoHarness(page);

    await page.evaluate((url) => {
      (window as unknown as { log: string[] }).log = [];
      const ws = new WebSocket(url);
      (window as unknown as { ws: WebSocket }).ws = ws;
      ws.addEventListener("open", () =>
        (window as unknown as { log: string[] }).log.push("open"),
      );
    }, `${WS_UPSTREAM}/echo`);

    await page.waitForTimeout(300);
    const state = await page.evaluate(
      () => (window as unknown as { ws: WebSocket }).ws.readyState,
    );
    expect(state).toBe(0);
  });

  test("page close sets readyState to CLOSING synchronously", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, () => {});
    await gotoHarness(page);
    await openPageSocket(page, `${WS_UPSTREAM}/echo`);

    const stateRightAfterClose = await page.evaluate(() => {
      const ws = (window as unknown as { ws: WebSocket }).ws;
      ws.close(3009, "sync");
      return ws.readyState;
    });
    // Injected mock sets CLOSING (2) synchronously; may already be CLOSED (3).
    expect([2, 3]).toContain(stateRightAfterClose);
    expect(stateRightAfterClose).not.toBe(1); // not OPEN
  });

  test("Blob then text page sends: text can overtake because Blob conversion is async", async ({
    page,
  }) => {
    const seen: string[] = [];
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage((message) => {
        if (typeof message === "string") seen.push(`str:${message}`);
        else seen.push(`bin:${Buffer.from(message).toString("hex")}`);
      });
    });
    await gotoHarness(page);

    await page.evaluate(async (url) => {
      const ws = new WebSocket(url);
      await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve());
        ws.addEventListener("error", () => reject(new Error("ws error")));
      });
      // Blob path is async in Playwright's injected mock; a following string
      // send is delivered synchronously and can arrive first.
      ws.send(new Blob([new Uint8Array([9, 8, 7])]));
      ws.send("after-blob");
    }, `${WS_UPSTREAM}/echo`);

    await expect.poll(() => seen).toEqual(["str:after-blob", "bin:090807"]);
  });
});
