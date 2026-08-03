import {
  test as base,
  expect,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";
import {
  HARNESS,
  UPSTREAM,
  WS_UPSTREAM,
  type TriggerResult,
} from "./helpers.js";
import {
  getNodeControl,
  resetNodeControl,
  type DownstreamSocket,
} from "./node-control.js";

export type ParityMode = "browser" | "node";

export const parityMode: ParityMode =
  process.env.PARITY_MODE === "node" ? "node" : "browser";

type RouteHandler = (route: Route, request: Request) => unknown;
type RouteUrl = Parameters<Page["route"]>[0];

export type TriggerInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Browser-only. Node mode always uses shared fetch. */
  transport?: "fetch" | "xhr";
};

type BrowserTriggerFn = (
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<TriggerResult>;

type RouteFromHAROptions = NonNullable<Parameters<Page["routeFromHAR"]>[1]>;

type ParityFixtures = {
  /** Browser mode: ensures harness page is loaded. Node mode: no-op page. */
  harnessPage: Page;
  /**
   * Register a route handler.
   * Browser → `page.route`. Node/Step 2 → `backendMocks.route` (not wired yet).
   */
  route: (
    url: RouteUrl,
    handler: RouteHandler,
    options?: { times?: number },
  ) => Promise<void>;
  unroute: (url?: RouteUrl, handler?: RouteHandler) => Promise<void>;
  unrouteAll: (options?: {
    behavior?: "wait" | "ignoreErrors" | "default";
  }) => Promise<void>;
  /**
   * Record/replay via HAR.
   * Browser → `page.routeFromHAR`. Node/Step 2 → `backendMocks.routeFromHAR`.
   */
  routeFromHAR: (file: string, options?: RouteFromHAROptions) => Promise<void>;
  /**
   * Outbound HTTP from the downstream process (shared triggerHttp module).
   * Browser → page.evaluate; Node → control-plane WebSocket.
   */
  trigger: (path: string, init?: TriggerInit) => Promise<TriggerResult>;
  /**
   * Open an app WebSocket inside the downstream process.
   * Browser → page WebSocket; Node → control-plane command creating globalThis.WebSocket.
   */
  openDownstreamSocket: (
    url: string,
    options?: { protocols?: string | string[]; binaryType?: BinaryType },
  ) => Promise<DownstreamSocket>;
  waitForRequest: (
    urlOrPredicate:
      | string
      | RegExp
      | ((request: Request) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<Request>;
  waitForResponse: (
    urlOrPredicate:
      | string
      | RegExp
      | ((response: Response) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<Response>;
  upstream: (path?: string) => string;
};

async function ensureHarness(page: Page) {
  if (!page.url().startsWith(HARNESS)) {
    await page.goto(HARNESS + "/", { waitUntil: "domcontentloaded" });
  }
  // Module script is deferred past DOMContentLoaded — wait for shared helpers.
  await page.waitForFunction(
    () =>
      typeof (globalThis as unknown as { trigger?: unknown }).trigger ===
        "function" &&
      typeof (globalThis as unknown as { connectWebSocket?: unknown })
        .connectWebSocket === "function",
  );
}

function triggerPayload(init: TriggerInit): {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
} {
  const payload: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {};
  if (init.method !== undefined) payload.method = init.method;
  if (init.headers !== undefined) payload.headers = init.headers;
  if (init.body !== undefined) payload.body = init.body;
  return payload;
}

function notWired(api: string): never {
  throw new Error(
    `${api} is not wired for PARITY_MODE=node yet (rewrite Step 2: backendMocks). ` +
      `Passthrough smoke tests should not call this.`,
  );
}

export const test = base.extend<ParityFixtures>({
  harnessPage: async ({ page }, use) => {
    if (parityMode === "browser") {
      await ensureHarness(page);
    }
    await use(page);
  },

  route: async ({ page }, use) => {
    if (parityMode !== "browser") {
      await use(async () => notWired("route"));
      return;
    }
    await use(async (url, handler, options) => {
      await page.route(url, handler, options);
    });
  },

  unroute: async ({ page }, use) => {
    if (parityMode !== "browser") {
      await use(async () => notWired("unroute"));
      return;
    }
    await use(async (url, handler) => {
      if (url === undefined) {
        await page.unrouteAll();
        return;
      }
      await page.unroute(url, handler);
    });
  },

  unrouteAll: async ({ page }, use) => {
    if (parityMode !== "browser") {
      await use(async () => notWired("unrouteAll"));
      return;
    }
    await use(async (options) => {
      await page.unrouteAll(options);
    });
  },

  routeFromHAR: async ({ page }, use) => {
    if (parityMode !== "browser") {
      await use(async () => notWired("routeFromHAR"));
      return;
    }
    await use(async (file, options) => {
      await page.routeFromHAR(file, options);
    });
  },

  trigger: async ({ page }, use) => {
    await use(async (path, init = {}) => {
      const url = path.startsWith("http") ? path : `${UPSTREAM}${path}`;
      const payload = triggerPayload(init);

      if (parityMode === "node") {
        const control = await getNodeControl();
        return control.httpRequest({
          url,
          method: payload.method,
          headers: payload.headers,
          body: payload.body,
        });
      }

      await ensureHarness(page);
      const transport = init.transport ?? "fetch";
      if (transport === "xhr") {
        return page.evaluate(
          ({ url, payload }) => {
            const triggerXhr = (
              globalThis as unknown as { triggerXhr: BrowserTriggerFn }
            ).triggerXhr;
            return triggerXhr(url, payload);
          },
          { url, payload },
        );
      }
      return page.evaluate(
        ({ url, payload }) => {
          const trigger = (globalThis as unknown as { trigger: BrowserTriggerFn })
            .trigger;
          return trigger(url, payload);
        },
        { url, payload },
      );
    });
  },

  openDownstreamSocket: async ({ page }, use) => {
    await use(async (url, options) => {
      if (parityMode === "node") {
        const control = await getNodeControl();
        return control.openSocket({
          url,
          protocols: options?.protocols,
          binaryType: options?.binaryType,
        });
      }

      await ensureHarness(page);
      // Browser: drive a real page WebSocket, mirror the DownstreamSocket surface.
      const socketId = `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await page.evaluate(
        ({ url, protocols, binaryType, socketId }) => {
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
          const ws = connect(url, { protocols, binaryType });
          const events: Array<Record<string, unknown>> = [];
          store[socketId] = { ws, events };
          ws.addEventListener("message", (event) => {
            if (typeof event.data === "string") {
              events.push({
                event: "message",
                data: event.data,
                encoding: "utf8",
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
        {
          url,
          protocols: options?.protocols,
          binaryType: options?.binaryType,
          socketId,
        },
      );

      await page.waitForFunction((id) => {
        const store = (
          globalThis as unknown as {
            __paritySockets?: Record<string, { ws: WebSocket }>;
          }
        ).__paritySockets;
        return store?.[id]?.ws.readyState === WebSocket.OPEN;
      }, socketId);

      const meta = await page.evaluate((id) => {
        const entry = (
          globalThis as unknown as {
            __paritySockets: Record<string, { ws: WebSocket }>;
          }
        ).__paritySockets[id];
        return {
          protocol: entry.ws.protocol,
          extensions: entry.ws.extensions,
        };
      }, socketId);

      return {
        socketId,
        protocol: meta.protocol,
        extensions: meta.extensions,
        get events() {
          // Synchronous snapshot is not available across the page boundary;
          // use waitForMessage / info for browser mode.
          return [];
        },
        async send(data: string | Buffer) {
          const text = typeof data === "string" ? data : data.toString("utf8");
          await page.evaluate(
            ({ id, text }) => {
              const entry = (
                globalThis as unknown as {
                  __paritySockets: Record<string, { ws: WebSocket }>;
                }
              ).__paritySockets[id];
              entry.ws.send(text);
            },
            { id: socketId, text },
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
                  __paritySockets: Record<
                    string,
                    { events: Array<Record<string, unknown>> }
                  >;
                }
              ).__paritySockets[id];
              const idx = entry.events.findIndex((e) => e.event === "message");
              if (idx < 0) return null;
              return entry.events.splice(idx, 1)[0] ?? null;
            }, socketId);
            if (hit) {
              return {
                event: "message" as const,
                data: String(hit.data ?? ""),
                encoding: hit.encoding === "base64" ? "base64" : "utf8",
              };
            }
            await page.waitForTimeout(25);
          }
          throw new Error("timeout waiting for ws message");
        },
      } satisfies DownstreamSocket;
    });
  },

  waitForRequest: async ({ page }, use) => {
    if (parityMode !== "browser") {
      await use(async () => notWired("waitForRequest"));
      return;
    }
    await use(async (urlOrPredicate, options) => {
      return page.waitForRequest(urlOrPredicate, options);
    });
  },

  waitForResponse: async ({ page }, use) => {
    if (parityMode !== "browser") {
      await use(async () => notWired("waitForResponse"));
      return;
    }
    await use(async (urlOrPredicate, options) => {
      return page.waitForResponse(urlOrPredicate, options);
    });
  },

  upstream: async ({ page }, use) => {
    void page;
    await use((path = "") => {
      if (path.startsWith("http")) return path;
      return `${UPSTREAM}${path.startsWith("/") ? path : `/${path}`}`;
    });
  },
});

// Reset node control between tests so sockets don't leak across cases.
test.afterEach(async () => {
  if (parityMode === "node") {
    await resetNodeControl();
  }
});

export { expect };
export { UPSTREAM, HARNESS, WS_UPSTREAM, NODE_DOWNSTREAM } from "./helpers.js";
export { parityMode };
