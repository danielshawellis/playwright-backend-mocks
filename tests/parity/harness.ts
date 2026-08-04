/**
 * Dual-mode parity harness.
 *
 * Philosophy (rewrite-spec §5):
 * - Upstream is always a Node fake (`fixtures/upstream`, `fixtures/ws-upstream`).
 * - Downstream outbound logic is always the shared modules in
 *   `fixtures/downstream` (WHATWG `fetch` / `globalThis.WebSocket`).
 * - Only the *host* switches:
 *     PARITY_MODE=browser → browser page loads shared helpers
 *     PARITY_MODE=node    → Node process + control-plane WebSocket
 * - Specs call harness fixtures (`route`, `routeWebSocket`, `trigger`,
 *   `openDownstreamSocket`, …) — never `page.route` / `page.evaluate` for the
 *   contract under test. Step 2 wires the node path to `backendMocks.*`.
 */
import {
  test as base,
  expect,
  type Browser,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";
import type { BackendMocksController } from "@playwright-backend-mocks/playwright";
import { HARNESS, UPSTREAM, sleep, type TriggerResult } from "./helpers.js";
import {
  getNodeControl,
  resetNodeControl,
  type DownstreamSocket,
} from "./node-control.js";
import {
  createNodeMocksForTest,
  createNodeRouting,
  disposeNodeMocks,
} from "./node-routing.js";

export type ParityMode = "browser" | "node";

export const parityMode: ParityMode =
  process.env.PARITY_MODE === "node" ? "node" : "browser";

type RouteHandler = (route: Route, request: Request) => unknown;
type RouteUrl = Parameters<Page["route"]>[0];
type RouteWebSocketUrl = Parameters<Page["routeWebSocket"]>[0];
type RouteWebSocketHandler = Parameters<Page["routeWebSocket"]>[1];
type RouteFromHAROptions = NonNullable<Parameters<Page["routeFromHAR"]>[1]>;

export type TriggerInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Fetch redirect mode (shared triggerHttp). Default `follow`. */
  redirect?: RequestRedirect;
  /** Browser-only. Node mode always uses shared fetch. */
  transport?: "fetch" | "xhr";
};

type BrowserTriggerFn = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: RequestRedirect;
  },
) => Promise<TriggerResult>;

type OpenSocketOptions = {
  protocols?: string | string[];
  binaryType?: BinaryType;
  /** Default `open`. Use `connecting` to observe pre-open readyState. */
  waitUntil?: "open" | "connecting";
};

/** Routing + trigger surface shared by the default fixtures and isolated hosts. */
export type ParityRouting = {
  route: (
    url: RouteUrl,
    handler: RouteHandler,
    options?: { times?: number },
  ) => Promise<{ [Symbol.dispose](): void }>;
  unroute: (url?: RouteUrl, handler?: RouteHandler) => Promise<void>;
  unrouteAll: (options?: {
    behavior?: "wait" | "ignoreErrors" | "default";
  }) => Promise<void>;
  routeFromHAR: (file: string, options?: RouteFromHAROptions) => Promise<void>;
  routeWebSocket: (
    url: RouteWebSocketUrl,
    handler: RouteWebSocketHandler,
  ) => Promise<void>;
  trigger: (path: string, init?: TriggerInit) => Promise<TriggerResult>;
  openDownstreamSocket: (
    url: string,
    options?: OpenSocketOptions,
  ) => Promise<DownstreamSocket>;
  waitForRequest: (
    urlOrPredicate: string | RegExp | ((request: Request) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<Request>;
  waitForResponse: (
    urlOrPredicate:
      string | RegExp | ((response: Response) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<Response>;
};

type ParityFixtures = {
  /** Browser mode: ensures harness page is loaded. Node mode: no-op page. */
  harnessPage: Page;
  /** Browser-only routing handle; null in node mode. */
  browserRouting: ParityRouting | null;
  /** Node-mode backendMocks controller; null in browser mode. */
  nodeMocks: BackendMocksController | null;
  /** Node-mode routing handle; null in browser mode. */
  nodeRouting: ParityRouting | null;
  route: ParityRouting["route"];
  unroute: ParityRouting["unroute"];
  unrouteAll: ParityRouting["unrouteAll"];
  routeFromHAR: ParityRouting["routeFromHAR"];
  /**
   * Register a WebSocket route handler.
   * Browser → `page.routeWebSocket`. Node → `backendMocks.routeWebSocket` (Step 2).
   *
   * Register *before* opening sockets. `openDownstreamSocket` navigates/loads
   * the downstream host after registration so Playwright's WS init script applies.
   */
  routeWebSocket: ParityRouting["routeWebSocket"];
  trigger: ParityRouting["trigger"];
  openDownstreamSocket: ParityRouting["openDownstreamSocket"];
  waitForRequest: ParityRouting["waitForRequest"];
  waitForResponse: ParityRouting["waitForResponse"];
  upstream: (path?: string) => string;
  /**
   * Run against a fresh downstream host.
   * Browser: new context (optional baseURL) + harness page; context.close()
   * flushes Playwright HAR update recordings.
   * Node: fresh backendMocks scope + control-plane reset.
   */
  withIsolatedDownstream: <T>(
    options: { baseURL?: string },
    fn: (api: ParityRouting) => Promise<T>,
  ) => Promise<T>;
};

/** Serialize harness navigation per page (concurrent trigger() must not multi-goto). */
const harnessLoads = new WeakMap<Page, Promise<void>>();

function harnessHelpersReady(): boolean {
  return (
    typeof (globalThis as unknown as { trigger?: unknown }).trigger === "function" &&
    typeof (globalThis as unknown as { connectWebSocket?: unknown }).connectWebSocket ===
      "function"
  );
}

async function ensureHarness(page: Page, url = HARNESS + "/") {
  const ready = await page.evaluate(harnessHelpersReady).catch(() => false);
  if (ready) return;

  let loading = harnessLoads.get(page);
  if (!loading) {
    loading = (async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(harnessHelpersReady);
    })();
    harnessLoads.set(page, loading);
  }
  try {
    await loading;
  } finally {
    const stillReady = await page.evaluate(harnessHelpersReady).catch(() => false);
    if (!stillReady) harnessLoads.delete(page);
  }
  if (!(await page.evaluate(harnessHelpersReady).catch(() => false))) {
    throw new Error("browser harness helpers failed to load");
  }
}

/** Force a navigation so WebSocket init scripts installed via routeWebSocket apply. */
async function reloadHarnessForWebSocket(page: Page) {
  harnessLoads.delete(page);
  await page.goto(HARNESS + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(harnessHelpersReady);
  harnessLoads.set(page, Promise.resolve());
}

function triggerPayload(init: TriggerInit): {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: RequestRedirect;
} {
  const payload: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: RequestRedirect;
  } = {};
  if (init.method !== undefined) payload.method = init.method;
  if (init.headers !== undefined) payload.headers = init.headers;
  if (init.body !== undefined) payload.body = init.body;
  if (init.redirect !== undefined) payload.redirect = init.redirect;
  return payload;
}

function notWired(api: string): never {
  throw new Error(
    `${api} is not wired for PARITY_MODE=node yet (rewrite Step 2: backendMocks). ` +
      `Passthrough smoke tests should not call this.`,
  );
}

function routeDisposable(
  page: Page,
  url: RouteUrl,
  handler: RouteHandler,
  registration: unknown,
): { [Symbol.dispose](): void } {
  let disposed = false;
  return {
    [Symbol.dispose]() {
      if (disposed) return;
      disposed = true;

      const candidate = registration as
        | { [Symbol.dispose]?: () => void; dispose?: () => void | Promise<void> }
        | undefined;
      const disposeSymbol = candidate?.[Symbol.dispose];
      if (typeof disposeSymbol === "function") {
        disposeSymbol.call(candidate);
        return;
      }
      if (typeof candidate?.dispose === "function") {
        void candidate.dispose();
        return;
      }

      void page.unroute(url, handler);
    },
  };
}

async function withBrowserFailureText(
  page: Page,
  url: string,
  action: () => Promise<TriggerResult>,
): Promise<TriggerResult> {
  let failureText: string | undefined;
  let resolveFailure!: (value: string | undefined) => void;
  const failurePromise = new Promise<string | undefined>((resolve) => {
    resolveFailure = resolve;
  });
  const onFailed = (request: Request) => {
    if (request.url() !== url) return;
    failureText = request.failure()?.errorText;
    resolveFailure(failureText);
  };

  page.on("requestfailed", onFailed);
  try {
    const result = await action();
    if (!result.ok && result.error !== "opaqueredirect") {
      const enriched =
        failureText ??
        (await Promise.race([failurePromise, sleep(100).then(() => undefined)]));
      if (enriched) {
        const failed: Extract<TriggerResult, { ok: false }> = {
          ok: false,
          error: enriched,
        };
        if (result.status !== undefined) failed.status = result.status;
        if (result.statusText !== undefined) failed.statusText = result.statusText;
        if (result.headers !== undefined) failed.headers = result.headers;
        if (result.raw !== undefined) failed.raw = result.raw;
        if (result.bodyBase64 !== undefined) failed.bodyBase64 = result.bodyBase64;
        if (result.data !== undefined) failed.data = result.data;
        return failed;
      }
    }
    return result;
  } finally {
    page.off("requestfailed", onFailed);
  }
}

function createBrowserDownstreamSocket(
  page: Page,
  socketId: string,
  protocol: string,
  extensions: string,
): DownstreamSocket {
  return {
    socketId,
    protocol,
    extensions,
    async send(data: string | Buffer | Uint8Array) {
      if (typeof data === "string") {
        await page.evaluate(
          ({ id, text }) => {
            const entry = (
              globalThis as unknown as {
                __paritySockets: Record<string, { ws: WebSocket }>;
              }
            ).__paritySockets[id];
            if (!entry) throw new Error(`missing socket ${id}`);
            entry.ws.send(text);
          },
          { id: socketId, text: data },
        );
        return;
      }
      const bytes = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      await page.evaluate(
        ({ id, base64 }) => {
          const entry = (
            globalThis as unknown as {
              __paritySockets: Record<string, { ws: WebSocket }>;
            }
          ).__paritySockets[id];
          if (!entry) throw new Error(`missing socket ${id}`);
          const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          entry.ws.send(binary.buffer);
        },
        { id: socketId, base64: bytes.toString("base64") },
      );
    },
    async close(code?: number, reason?: string) {
      await page.evaluate(
        ({ id, code, reason }) => {
          const entry = (
            globalThis as unknown as {
              __paritySockets: Record<string, { ws: WebSocket }>;
            }
          ).__paritySockets[id];
          if (!entry) throw new Error(`missing socket ${id}`);
          if (code !== undefined) entry.ws.close(code, reason ?? "");
          else entry.ws.close();
        },
        { id: socketId, code, reason },
      );
    },
    async info() {
      return page.evaluate((id) => {
        const entry = (
          globalThis as unknown as {
            __paritySockets: Record<string, { ws: WebSocket }>;
          }
        ).__paritySockets[id];
        if (!entry) throw new Error(`missing socket ${id}`);
        return {
          readyState: entry.ws.readyState,
          protocol: entry.ws.protocol,
          extensions: entry.ws.extensions,
        };
      }, socketId);
    },
    async waitForMessage(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = await page.evaluate((id) => {
          const entry = (
            globalThis as unknown as {
              __paritySockets: Record<string, { events: Array<Record<string, unknown>> }>;
            }
          ).__paritySockets[id];
          if (!entry) throw new Error(`missing socket ${id}`);
          const idx = entry.events.findIndex((e) => e.event === "message");
          if (idx < 0) return null;
          return entry.events.splice(idx, 1)[0] ?? null;
        }, socketId);
        if (hit) {
          const message: {
            event: "message";
            data: string;
            encoding: "utf8" | "base64";
            binaryType?: string;
          } = {
            event: "message",
            data: String(hit.data ?? ""),
            encoding: hit.encoding === "base64" ? "base64" : "utf8",
          };
          if (typeof hit.binaryType === "string") {
            message.binaryType = hit.binaryType;
          }
          return message;
        }
        await sleep(25);
      }
      throw new Error("timeout waiting for ws message");
    },
    async waitForClose(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const hit = await page.evaluate((id) => {
          const entry = (
            globalThis as unknown as {
              __paritySockets: Record<string, { events: Array<Record<string, unknown>> }>;
            }
          ).__paritySockets[id];
          if (!entry) throw new Error(`missing socket ${id}`);
          const idx = entry.events.findIndex((e) => e.event === "close");
          if (idx < 0) return null;
          return entry.events.splice(idx, 1)[0] ?? null;
        }, socketId);
        if (hit) {
          return {
            event: "close" as const,
            code: Number(hit.code ?? 0),
            reason: String(hit.reason ?? ""),
            wasClean: Boolean(hit.wasClean),
          };
        }
        await sleep(25);
      }
      throw new Error("timeout waiting for ws close");
    },
    async waitForOpen(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ready = await page.evaluate((id) => {
          const entry = (
            globalThis as unknown as {
              __paritySockets?: Record<string, { ws: WebSocket }>;
            }
          ).__paritySockets?.[id];
          return entry?.ws.readyState === WebSocket.OPEN;
        }, socketId);
        if (ready) return;
        await sleep(25);
      }
      throw new Error("timeout waiting for ws open");
    },
    async readyState() {
      return (await this.info()).readyState;
    },
  };
}

async function openBrowserSocket(
  page: Page,
  url: string,
  options?: OpenSocketOptions,
): Promise<DownstreamSocket> {
  // Ensure WS init scripts from prior routeWebSocket calls are active.
  const helpersReady = await page.evaluate(harnessHelpersReady).catch(() => false);
  if (!helpersReady) {
    await ensureHarness(page);
  }

  const socketId = `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const connectOpts: {
    protocols?: string | string[];
    binaryType?: BinaryType;
  } = {};
  if (options?.protocols !== undefined) connectOpts.protocols = options.protocols;
  if (options?.binaryType !== undefined) connectOpts.binaryType = options.binaryType;
  const waitUntil = options?.waitUntil ?? "open";

  await page.evaluate(
    ({ url, connectOpts, socketId }) => {
      const connect = (
        globalThis as unknown as {
          connectWebSocket: (
            url: string,
            opts?: { protocols?: string | string[]; binaryType?: BinaryType },
          ) => WebSocket;
        }
      ).connectWebSocket;
      const store = ((
        globalThis as unknown as {
          __paritySockets?: Record<
            string,
            { ws: WebSocket; events: Array<Record<string, unknown>> }
          >;
        }
      ).__paritySockets ??= {});
      const ws = connect(url, connectOpts);
      const events: Array<Record<string, unknown>> = [];
      store[socketId] = { ws, events };
      ws.addEventListener("open", () => {
        events.push({ event: "open" });
      });
      ws.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          events.push({
            event: "message",
            data: event.data,
            encoding: "utf8",
          });
          return;
        }
        if (event.data instanceof ArrayBuffer) {
          const bytes = Array.from(new Uint8Array(event.data));
          const base64 = btoa(String.fromCharCode(...bytes));
          events.push({
            event: "message",
            data: base64,
            encoding: "base64",
            binaryType: "arraybuffer",
          });
          return;
        }
        if (typeof Blob !== "undefined" && event.data instanceof Blob) {
          void event.data.arrayBuffer().then((buffer) => {
            const bytes = Array.from(new Uint8Array(buffer));
            const base64 = btoa(String.fromCharCode(...bytes));
            events.push({
              event: "message",
              data: base64,
              encoding: "base64",
              binaryType: "blob",
            });
          });
        }
      });
      ws.addEventListener("close", (event) => {
        events.push({
          event: "close",
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });
      });
      ws.addEventListener("error", () => {
        events.push({ event: "error" });
      });
    },
    { url, connectOpts, socketId },
  );

  if (waitUntil === "open") {
    await page.waitForFunction((id) => {
      const store = (
        globalThis as unknown as {
          __paritySockets?: Record<string, { ws: WebSocket }>;
        }
      ).__paritySockets;
      return store?.[id]?.ws.readyState === WebSocket.OPEN;
    }, socketId);
  }

  const meta = await page.evaluate((id) => {
    const entry = (
      globalThis as unknown as {
        __paritySockets: Record<string, { ws: WebSocket }>;
      }
    ).__paritySockets[id];
    if (!entry) throw new Error(`missing socket ${id}`);
    return {
      protocol: entry.ws.protocol,
      extensions: entry.ws.extensions,
    };
  }, socketId);

  return createBrowserDownstreamSocket(page, socketId, meta.protocol, meta.extensions);
}

function createBrowserRouting(page: Page): ParityRouting {
  return {
    route: async (url, handler, options) => {
      const disposable = await page.route(url, handler, options);
      return routeDisposable(page, url, handler, disposable);
    },
    unroute: async (url, handler) => {
      if (url === undefined) {
        await page.unrouteAll();
        return;
      }
      await page.unroute(url, handler);
    },
    unrouteAll: async (options) => {
      await page.unrouteAll(options);
    },
    routeFromHAR: async (file, options) => {
      await page.routeFromHAR(file, options);
    },
    routeWebSocket: async (url, handler) => {
      await page.routeWebSocket(url, handler);
      // Next openDownstreamSocket / ensureHarness navigation picks up the init script.
      // If the harness is already loaded, mark it dirty so the next open reloads.
      harnessLoads.delete(page);
    },
    trigger: async (path, init = {}) => {
      const url = path.startsWith("http") ? path : `${UPSTREAM}${path}`;
      const payload = triggerPayload(init);
      await ensureHarness(page);
      const transport = init.transport ?? "fetch";
      if (transport === "xhr") {
        return withBrowserFailureText(page, url, () =>
          page.evaluate(
            ({ url, payload }) => {
              const triggerXhr = (
                globalThis as unknown as { triggerXhr: BrowserTriggerFn }
              ).triggerXhr;
              return triggerXhr(url, payload);
            },
            { url, payload },
          ),
        );
      }
      return withBrowserFailureText(page, url, () =>
        page.evaluate(
          ({ url, payload }) => {
            const trigger = (globalThis as unknown as { trigger: BrowserTriggerFn })
              .trigger;
            return trigger(url, payload);
          },
          { url, payload },
        ),
      );
    },
    openDownstreamSocket: async (url, options) => {
      // Reload if routeWebSocket dirty-deleted the cache, so WS mocks apply.
      const ready = await page.evaluate(harnessHelpersReady).catch(() => false);
      if (!ready) await ensureHarness(page);
      else if (!harnessLoads.has(page)) await reloadHarnessForWebSocket(page);
      return openBrowserSocket(page, url, options);
    },
    waitForRequest: (urlOrPredicate, options) =>
      page.waitForRequest(urlOrPredicate, options),
    waitForResponse: (urlOrPredicate, options) =>
      page.waitForResponse(urlOrPredicate, options),
  };
}

async function withIsolatedBrowserDownstream<T>(
  browser: Browser,
  options: { baseURL?: string },
  fn: (api: ParityRouting) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext(
    options.baseURL !== undefined ? { baseURL: options.baseURL } : {},
  );
  const page = await context.newPage();
  try {
    await ensureHarness(page);
    return await fn(createBrowserRouting(page));
  } finally {
    await context.close();
  }
}

export const test = base.extend<ParityFixtures>({
  harnessPage: async ({ page }, use) => {
    if (parityMode === "browser") {
      await ensureHarness(page);
    }
    await use(page);
  },

  // Shared browser routing handle. Depends on harnessPage so catch-all HTTP
  // routes cannot intercept the harness document load. routeWebSocket itself
  // does not require prior navigation; openDownstreamSocket reloads when dirty.
  browserRouting: async ({ page, harnessPage }, use) => {
    void harnessPage;
    if (parityMode !== "browser") {
      await use(null);
      return;
    }
    await use(createBrowserRouting(page));
  },

  nodeMocks: async ({ page }, use, testInfo) => {
    void page;
    if (parityMode !== "node") {
      await use(null);
      return;
    }
    const mocks = await createNodeMocksForTest({
      title: testInfo.title,
      file: testInfo.file,
    });
    await use(mocks);
    disposeNodeMocks(mocks);
  },

  nodeRouting: async ({ nodeMocks }, use) => {
    if (!nodeMocks) {
      await use(null);
      return;
    }
    await use(createNodeRouting(nodeMocks) as ParityRouting);
  },

  route: async ({ browserRouting, nodeRouting }, use) => {
    const routing = browserRouting ?? nodeRouting;
    if (!routing) {
      await use(async () => notWired("route"));
      return;
    }
    await use(routing.route);
  },

  unroute: async ({ browserRouting, nodeRouting }, use) => {
    const routing = browserRouting ?? nodeRouting;
    if (!routing) {
      await use(async () => notWired("unroute"));
      return;
    }
    await use(routing.unroute);
  },

  unrouteAll: async ({ browserRouting, nodeRouting }, use) => {
    const routing = browserRouting ?? nodeRouting;
    if (!routing) {
      await use(async () => notWired("unrouteAll"));
      return;
    }
    await use(routing.unrouteAll);
  },

  routeFromHAR: async ({ browserRouting, nodeRouting }, use) => {
    const routing = browserRouting ?? nodeRouting;
    if (!routing) {
      await use(async () => notWired("routeFromHAR"));
      return;
    }
    await use(routing.routeFromHAR);
  },

  // Must not depend on harnessPage / browserRouting — WS init scripts need to
  // be registered before the page that opens sockets is navigated.
  routeWebSocket: async ({ page, nodeRouting }, use) => {
    if (parityMode === "node") {
      if (!nodeRouting) {
        await use(async () => notWired("routeWebSocket"));
        return;
      }
      await use(nodeRouting.routeWebSocket);
      return;
    }
    await use(createBrowserRouting(page).routeWebSocket);
  },

  trigger: async ({ browserRouting, nodeRouting, page }, use) => {
    await use(async (path, init = {}) => {
      if (parityMode === "node") {
        if (!nodeRouting) return notWired("trigger");
        return nodeRouting.trigger(path, init);
      }

      return (browserRouting ?? createBrowserRouting(page)).trigger(path, init);
    });
  },

  // Must not depend on harnessPage — pairs with routeWebSocket registration order.
  openDownstreamSocket: async ({ page, nodeRouting }, use) => {
    await use(async (url, options) => {
      if (parityMode === "node") {
        if (!nodeRouting) return notWired("openDownstreamSocket");
        return nodeRouting.openDownstreamSocket(url, options);
      }

      return createBrowserRouting(page).openDownstreamSocket(url, options);
    });
  },

  waitForRequest: async ({ browserRouting, nodeRouting }, use) => {
    const routing = browserRouting ?? nodeRouting;
    if (!routing) {
      await use(async () => notWired("waitForRequest"));
      return;
    }
    await use(routing.waitForRequest);
  },

  waitForResponse: async ({ browserRouting, nodeRouting }, use) => {
    const routing = browserRouting ?? nodeRouting;
    if (!routing) {
      await use(async () => notWired("waitForResponse"));
      return;
    }
    await use(routing.waitForResponse);
  },

  upstream: async ({ page }, use) => {
    void page;
    await use((path = "") => {
      if (path.startsWith("http")) return path;
      return `${UPSTREAM}${path.startsWith("/") ? path : `/${path}`}`;
    });
  },

  withIsolatedDownstream: async ({ browser }, use, testInfo) => {
    await use(async (options, fn) => {
      if (parityMode === "node") {
        await resetNodeControl();
        const mocks = await createNodeMocksForTest({
          title: `${testInfo.title} (isolated)`,
          file: testInfo.file,
        });
        const api = createNodeRouting(mocks) as ParityRouting;
        try {
          return await fn(api);
        } finally {
          disposeNodeMocks(mocks);
          await resetNodeControl();
        }
      }
      return withIsolatedBrowserDownstream(browser, options, fn);
    });
  },
});

// Reset node control between tests so sockets don't leak across cases.
test.afterEach(async () => {
  if (parityMode === "node") {
    await resetNodeControl();
  }
});

export { expect, sleep };
export {
  ABORT_CODES,
  UPSTREAM,
  HARNESS,
  WS_UPSTREAM,
  WS_UPSTREAM_HTTP,
  NODE_DOWNSTREAM,
  bodyFromBase64,
  headerValue,
} from "./helpers.js";
