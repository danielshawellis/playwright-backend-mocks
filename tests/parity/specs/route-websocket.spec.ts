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
 * (see research/rewrite-specification.md §4).
 *
 * Skips: frame navigation/detach close, page-closure races, DOM binaryType
 * object-identity quirks.
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
        let rendered: string;
        if (typeof data === "string") {
          rendered = data;
        } else if (data instanceof ArrayBuffer) {
          const bytes = Array.from(new Uint8Array(data))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          rendered = `buf:${bytes}`;
        } else {
          rendered = `blob`;
        }
        (window as unknown as { log: string[] }).log.push(`message:${rendered}`);
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

    // Open a passthrough socket before any WS route exists.
    await openPageSocket(page, `${WS_UPSTREAM}/echo?mode=prefix`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("before"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:echo:before"]);

    // Registering after navigation does not retrofit the already-loaded page.
    // Navigate again after registration so the init script applies.
    await page.routeWebSocket(`${WS_UPSTREAM}/echo**`, (ws) => {
      ws.onMessage(() => ws.send("after-reg"));
    });
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

  test("no trailing slash path still matches", async ({ page }) => {
    await page.routeWebSocket(`${WS_UPSTREAM}/echo`, (ws) => {
      ws.onMessage(() => ws.send("exact"));
    });
    await gotoHarness(page);

    await openPageSocket(page, `${WS_UPSTREAM}/echo`);
    await page.evaluate(() => (window as unknown as { ws: WebSocket }).ws.send("x"));
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { log: string[] }).log))
      .toEqual(["open", "message:exact"]);
  });
});
