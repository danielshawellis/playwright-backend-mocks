import {
  test as base,
  expect,
  type Page,
  type Request,
  type Response,
  type Route,
} from "@playwright/test";
import { HARNESS, UPSTREAM, WS_UPSTREAM, type TriggerResult } from "./helpers.js";

export type ParityMode = "browser" | "backend";

export const parityMode: ParityMode =
  process.env.PARITY_MODE === "backend" ? "backend" : "browser";

type RouteHandler = (route: Route, request: Request) => unknown;
type RouteUrl = Parameters<Page["route"]>[0];

export type TriggerInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Defaults to fetch. XHR exercises the same routing surface via a second browser API. */
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
  /** Ensures the browser harness page is loaded once per test. */
  harnessPage: Page;
  /**
   * Register a route handler.
   * Browser mode → `page.route`. Backend mode (Step 2) → `backendMocks.route`.
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
   * Browser mode → `page.routeFromHAR`.
   * Backend mode (Step 2) → `backendMocks.routeFromHAR` if the library keeps HAR parity
   * (or a thin adapter if the product stays on JSON cassettes).
   */
  routeFromHAR: (file: string, options?: RouteFromHAROptions) => Promise<void>;
  /**
   * Trigger an outbound HTTP call from the downstream process.
   * Browser mode → Ajax from the harness page to the upstream fake.
   */
  trigger: (path: string, init?: TriggerInit) => Promise<TriggerResult>;
  waitForRequest: (
    urlOrPredicate: string | RegExp | ((request: Request) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<Request>;
  waitForResponse: (
    urlOrPredicate:
      string | RegExp | ((response: Response) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<Response>;
  /** Absolute upstream URL helper. */
  upstream: (path?: string) => string;
};

async function ensureHarness(page: Page) {
  if (!page.url().startsWith(HARNESS)) {
    await page.goto(HARNESS + "/", { waitUntil: "domcontentloaded" });
  }
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

export const test = base.extend<ParityFixtures>({
  harnessPage: async ({ page }, use) => {
    await ensureHarness(page);
    await use(page);
  },

  route: async ({ page, harnessPage }, use) => {
    void harnessPage;
    if (parityMode !== "browser") {
      throw new Error(
        "PARITY_MODE=backend is not wired yet (rewrite Step 2). Use PARITY_MODE=browser.",
      );
    }
    await use(async (url, handler, options) => {
      await page.route(url, handler, options);
    });
  },

  unroute: async ({ page, harnessPage }, use) => {
    void harnessPage;
    await use(async (url, handler) => {
      if (url === undefined) {
        await page.unrouteAll();
        return;
      }
      await page.unroute(url, handler);
    });
  },

  unrouteAll: async ({ page, harnessPage }, use) => {
    void harnessPage;
    await use(async (options) => {
      await page.unrouteAll(options);
    });
  },

  routeFromHAR: async ({ page, harnessPage }, use) => {
    void harnessPage;
    if (parityMode !== "browser") {
      throw new Error(
        "PARITY_MODE=backend is not wired yet (rewrite Step 2). Use PARITY_MODE=browser.",
      );
    }
    await use(async (file, options) => {
      await page.routeFromHAR(file, options);
    });
  },

  trigger: async ({ page, harnessPage }, use) => {
    void harnessPage;
    await use(async (path, init = {}) => {
      const url = path.startsWith("http") ? path : `${UPSTREAM}${path}`;
      const transport = init.transport ?? "fetch";
      const payload = triggerPayload(init);
      if (transport === "xhr") {
        return page.evaluate(
          ({ url, payload }) => {
            const triggerXhr = (globalThis as unknown as { triggerXhr: BrowserTriggerFn })
              .triggerXhr;
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

  waitForRequest: async ({ page, harnessPage }, use) => {
    void harnessPage;
    await use(async (urlOrPredicate, options) => {
      return page.waitForRequest(urlOrPredicate, options);
    });
  },

  waitForResponse: async ({ page, harnessPage }, use) => {
    void harnessPage;
    await use(async (urlOrPredicate, options) => {
      return page.waitForResponse(urlOrPredicate, options);
    });
  },

  upstream: async ({ harnessPage }, use) => {
    void harnessPage;
    await use((path = "") => {
      if (path.startsWith("http")) {
        return path;
      }
      return `${UPSTREAM}${path.startsWith("/") ? path : `/${path}`}`;
    });
  },
});

export { expect, UPSTREAM, HARNESS, WS_UPSTREAM };
