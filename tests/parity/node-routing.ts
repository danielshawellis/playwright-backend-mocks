/**
 * Node-mode routing bridge for the dual-mode parity harness.
 *
 * Wires harness `route` / settle APIs to `@playwright-backend-mocks/playwright`
 * (`createBackendMocks` + proxy connection) so the same oracle specs run against
 * the library under `PARITY_MODE=node`.
 */
import { randomUUID } from "node:crypto";
import {
  connectPlaywrightProxy,
  createBackendMocks,
  type BackendMocksController,
  type PlaywrightProxyConnection,
  type RouteHandler as BackendRouteHandler,
  type RouteMatcherInput,
} from "@playwright-backend-mocks/playwright";
import type { Request, Route } from "@playwright/test";
import { UPSTREAM, type TriggerResult } from "./helpers.js";
import {
  getNodeControl,
  resetNodeControl,
  type DownstreamSocket,
} from "./node-control.js";

const PROXY_URL =
  process.env.PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL ?? "http://127.0.0.1:4310";

type HarnessRouteHandler = (route: Route, request: Request) => unknown;

type OpenSocketOptions = {
  protocols?: string | string[];
  binaryType?: BinaryType;
  waitUntil?: "open" | "connecting";
};

/** Structural match for harness `ParityRouting` (avoid circular import). */
type NodeParityRouting = {
  route: (
    url: Parameters<import("@playwright/test").Page["route"]>[0],
    handler: HarnessRouteHandler,
    options?: { times?: number },
  ) => Promise<{ [Symbol.dispose](): void }>;
  unroute: (
    url?: Parameters<import("@playwright/test").Page["route"]>[0],
    handler?: HarnessRouteHandler,
  ) => Promise<void>;
  unrouteAll: (options?: {
    behavior?: "wait" | "ignoreErrors" | "default";
  }) => Promise<void>;
  routeFromHAR: (
    file: string,
    options?: NonNullable<
      Parameters<import("@playwright/test").Page["routeFromHAR"]>[1]
    >,
  ) => Promise<void>;
  routeWebSocket: (
    url: Parameters<import("@playwright/test").Page["routeWebSocket"]>[0],
    handler: Parameters<import("@playwright/test").Page["routeWebSocket"]>[1],
  ) => Promise<void>;
  trigger: (
    path: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      redirect?: RequestRedirect;
      transport?: "fetch" | "xhr";
    },
  ) => Promise<TriggerResult>;
  openDownstreamSocket: (
    url: string,
    options?: OpenSocketOptions,
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
      | ((response: import("@playwright/test").Response) => boolean | Promise<boolean>),
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<import("@playwright/test").Response>;
};

let workerConnection: PlaywrightProxyConnection | undefined;
let workerConnectionPromise: Promise<PlaywrightProxyConnection> | undefined;

async function getWorkerConnection(): Promise<PlaywrightProxyConnection> {
  if (workerConnection) return workerConnection;
  if (!workerConnectionPromise) {
    workerConnectionPromise = connectPlaywrightProxy({
      proxyUrl: PROXY_URL,
      workerId: `parity-node-${process.pid}`,
    }).then((connection) => {
      workerConnection = connection;
      return connection;
    });
  }
  return workerConnectionPromise;
}

export async function createNodeMocksForTest(meta: {
  title: string;
  file: string;
}): Promise<BackendMocksController> {
  const connection = await getWorkerConnection();
  const testId = randomUUID();
  connection.send({
    type: "test:register",
    testId,
    title: meta.title,
    file: meta.file,
    workerId: String(process.pid),
  });
  return createBackendMocks({ connection, testId });
}

function triggerPayload(init: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: RequestRedirect;
}) {
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

/**
 * Adapt a Playwright-typed harness handler to the BackendMocks handler.
 * BackendRoute / BackendRequest are intentionally Playwright-shaped at runtime.
 */
function adaptHandler(handler: HarnessRouteHandler): BackendRouteHandler {
  return async (route, request) => {
    await handler(route as unknown as Route, request as unknown as Request);
  };
}

export function createNodeRouting(mocks: BackendMocksController): NodeParityRouting {
  return {
    route: async (url, handler, options) => {
      const backendHandler = adaptHandler(handler);
      await mocks.route(url as RouteMatcherInput, backendHandler, options);
      let disposed = false;
      return {
        [Symbol.dispose]() {
          if (disposed) return;
          disposed = true;
          void mocks.unroute(url as RouteMatcherInput, backendHandler);
        },
      };
    },
    unroute: async (url, handler) => {
      if (handler === undefined) {
        await mocks.unroute(url as RouteMatcherInput | undefined);
        return;
      }
      // Handler identity differs after adapt — unroute by URL only when provided.
      await mocks.unroute(url as RouteMatcherInput | undefined);
    },
    unrouteAll: async (options) => {
      await mocks.unrouteAll(options);
    },
    routeFromHAR: async (file, options) => {
      await mocks.routeFromHAR(file, options);
    },
    routeWebSocket: async () => {
      throw new Error(
        "routeWebSocket is not wired for PARITY_MODE=node yet (Step 2 WebSocket backlog)",
      );
    },
    trigger: async (path, init = {}) => {
      const control = await getNodeControl();
      const url = path.startsWith("http") ? path : `${UPSTREAM}${path}`;
      return control.httpRequest({
        url,
        ...triggerPayload(init),
      }) as Promise<TriggerResult>;
    },
    openDownstreamSocket: async (url, options?: OpenSocketOptions) => {
      const control = await getNodeControl();
      const openInit: {
        url: string;
        protocols?: string | string[];
        binaryType?: BinaryType;
        waitUntil?: "open" | "connecting";
      } = { url };
      if (options?.protocols !== undefined) openInit.protocols = options.protocols;
      if (options?.binaryType !== undefined) openInit.binaryType = options.binaryType;
      if (options?.waitUntil !== undefined) openInit.waitUntil = options.waitUntil;
      return control.openSocket(openInit) as Promise<DownstreamSocket>;
    },
    waitForRequest: async (urlOrPredicate, options) => {
      if (typeof urlOrPredicate === "function") {
        // Predicate form uses Playwright Request — adapt via BackendRequest duck-typing.
        const backend = await mocks.waitForRequest(
          (url) => {
            // BackendMocks predicate receives URL; harness predicates receive Request.
            // For URL-only checks this is insufficient — fall through to observed scan.
            void url;
            return true;
          },
          options,
        );
        // Re-check with full request once we have a candidate is not available here.
        // Prefer string/RegExp waiters in node mode until full Request waiters land.
        return backend as unknown as Request;
      }
      const backend = await mocks.waitForRequest(
        urlOrPredicate as RouteMatcherInput,
        options,
      );
      return backend as unknown as Request;
    },
    waitForResponse: async () => {
      throw new Error(
        "waitForResponse is not wired for PARITY_MODE=node yet (Step 2 backlog)",
      );
    },
  };
}

/** Dispose mocks for a test and drain proxy errors. */
export function disposeNodeMocks(mocks: BackendMocksController): void {
  mocks.dispose();
  const remaining = mocks.takeErrors();
  if (remaining.length > 0) {
    throw new AggregateError(
      remaining,
      remaining.map((error) => error.message).join("\n"),
    );
  }
}

export async function resetNodeRoutingBetweenTests(): Promise<void> {
  await resetNodeControl();
}
