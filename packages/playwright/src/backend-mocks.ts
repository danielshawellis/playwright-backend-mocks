// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  decodeBody,
  encodeBody,
  normalizeHeaders,
  resolveGlobToRegexPattern,
  type HistoryEntry,
  type ProxyToClientMessage,
  type RequestOverrides,
  type SerializedRequest,
  type SerializedResponse,
} from "@playwright-backend-mocks/protocol";
import type { PlaywrightProxyConnection } from "./connection.js";
import { matchRouteMatcher } from "./match.js";
import {
  createRouteFromHARSession,
  flushRouteFromHARSession,
  type RouteFromHARSession,
} from "./route-from-har.js";
import {
  createRouteFromJSONSession,
  flushRouteFromJSONSession,
  type RouteFromJSONSession,
} from "./route-from-json.js";
import {
  getRouteUrlPredicate,
  getRouteURLPattern,
  isURLPattern,
  toProtocolAbortCode,
  toSerializedMatcher,
  type BackendMocks,
  type BackendRequest,
  type BackendResponse,
  type BackendRoute,
  type ContinueOptions,
  type FetchOptions,
  type FulfillOptions,
  type HeaderArray,
  type RequestSizes,
  type ResourceTiming,
  type RouteFromHAROptions,
  type RouteFromJSONOptions,
  type RouteHandler,
  type RouteMatcherInput,
  type RouteOptions,
  type UnrouteAllOptions,
  type WaitForNetworkOptions,
  type WaitForRequestMatcher,
  type WaitForResponseMatcher,
} from "./types.js";

interface FallbackOverrides {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  postDataBuffer?: Buffer;
}

interface PendingFetch {
  request: BackendRequest;
  resolve(response: BackendResponse): void;
  reject(error: Error): void;
}

interface NetworkWaiter<T> {
  predicate(value: T): boolean | Promise<boolean>;
  resolve(value: T): void;
  reject(error: Error): void;
}

interface ActiveInvocation {
  complete: Promise<void>;
  resolveComplete: () => void;
  didThrow: boolean;
}

/**
 * Playwright-shaped Request with local fallback overrides.
 * Mirrored from Playwright `Request` at pin 26a9e47.
 */
class BackendRequestImpl implements BackendRequest {
  private readonly _url: string;
  private readonly _method: string;
  private readonly _headers: Record<string, string>;
  private readonly _postDataBuffer: Buffer | null;
  // DIVERGENCE: product addition for multi-app Node targeting
  readonly clientId: string;
  // DIVERGENCE END
  private _fallbackOverrides: FallbackOverrides = {};

  constructor(request: SerializedRequest, clientId: string) {
    this._url = request.url;
    this._method = request.method;
    this._headers = { ...request.headers };
    this._postDataBuffer = decodeBody(request.bodyBase64);
    this.clientId = clientId;
  }

  url(): string {
    return this._fallbackOverrides.url ?? this._url;
  }

  method(): string {
    return this._fallbackOverrides.method ?? this._method;
  }

  headers(): Record<string, string> {
    if (this._fallbackOverrides.headers !== undefined) {
      return { ...this._fallbackOverrides.headers };
    }
    return { ...this._headers };
  }

  async allHeaders(): Promise<Record<string, string>> {
    return this.headers();
  }

  async headersArray(): Promise<HeaderArray> {
    return Object.entries(this.headers()).map(([name, value]) => ({ name, value }));
  }

  async headerValue(name: string): Promise<string | null> {
    const lower = name.toLowerCase();
    for (const [key, value] of Object.entries(this.headers())) {
      if (key.toLowerCase() === lower) {
        return value;
      }
    }
    return null;
  }

  postData(): string | null {
    const buffer = this.postDataBuffer();
    return buffer?.toString("utf8") ?? null;
  }

  postDataBuffer(): Buffer | null {
    return this._fallbackOverrides.postDataBuffer ?? this._postDataBuffer;
  }

  postDataJSON(): unknown {
    const postData = this.postData();
    if (postData === null) {
      return null;
    }

    const contentType = this.headers()["content-type"];
    if (contentType?.includes("application/x-www-form-urlencoded")) {
      const entries: Record<string, string> = {};
      const parsed = new URLSearchParams(postData);
      for (const [key, value] of parsed.entries()) {
        entries[key] = value;
      }
      return entries;
    }

    try {
      return JSON.parse(postData) as unknown;
    } catch {
      throw new Error(`POST data is not a valid JSON object: ${postData}`);
    }
  }

  resourceType(): "fetch" | "other" {
    // DIVERGENCE: Node outbound traffic is not browser-typed; expose a stable stub.
    return "other";
  }

  frame(): never {
    throw new Error("Backend mock requests do not have an associated frame.");
  }

  serviceWorker(): null {
    return null;
  }

  isNavigationRequest(): boolean {
    return false;
  }

  redirectedFrom(): BackendRequest | null {
    return null;
  }

  redirectedTo(): BackendRequest | null {
    return null;
  }

  failure(): { errorText: string } | null {
    return null;
  }

  timing(): ResourceTiming {
    return {
      startTime: 0,
      domainLookupStart: -1,
      domainLookupEnd: -1,
      connectStart: -1,
      secureConnectionStart: -1,
      connectEnd: -1,
      requestStart: -1,
      responseStart: -1,
      responseEnd: -1,
    };
  }

  async sizes(): Promise<RequestSizes> {
    return {
      requestBodySize: 0,
      requestHeadersSize: 0,
      responseBodySize: 0,
      responseHeadersSize: 0,
    };
  }

  async response(): Promise<BackendResponse | null> {
    // TODO: wire response correlation when the proxy exposes it.
    return null;
  }

  _applyFallbackOverrides(overrides: ContinueOptions): void {
    // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts (_applyFallbackOverrides)
    if (overrides.url !== undefined) {
      this._fallbackOverrides.url = overrides.url;
    }
    if (overrides.method !== undefined) {
      this._fallbackOverrides.method = overrides.method;
    }
    if (overrides.headers !== undefined) {
      this._fallbackOverrides.headers = headersObjectLossy(overrides.headers);
    }
    if (overrides.postData !== undefined) {
      const buffer = postDataToBuffer(overrides.postData);
      if (buffer !== undefined) {
        this._fallbackOverrides.postDataBuffer = buffer;
      }
    }
  }

  /**
   * Playwright server `Route.continue` protocol check.
   * Compares against the original request URL (not prior fallback overrides applied
   * only on the client request view).
   * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/network.ts (Route.continue)
   */
  _checkContinueUrlProtocol(): void {
    const overrideUrl = this._fallbackOverrides.url;
    if (overrideUrl === undefined) {
      return;
    }
    const newUrl = new URL(overrideUrl);
    const oldUrl = new URL(this._url);
    if (oldUrl.protocol !== newUrl.protocol) {
      throw new Error("New URL must have same protocol as overridden URL");
    }
  }

  _fallbackOverridesForContinue(): RequestOverrides | undefined {
    const overrides = this._fallbackOverrides;
    const hasOverrides =
      overrides.url !== undefined ||
      overrides.method !== undefined ||
      overrides.headers !== undefined ||
      overrides.postDataBuffer !== undefined;
    if (!hasOverrides) {
      return undefined;
    }

    let headers: Record<string, string> | undefined;
    if (overrides.headers !== undefined) {
      // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/network.ts (applyHeadersOverrides)
      headers = applyHeadersOverrides(this._headers, overrides.headers);
    }

    const bodyBase64 =
      overrides.postDataBuffer !== undefined
        ? encodeBody(overrides.postDataBuffer)
        : undefined;

    if (bodyBase64 !== undefined) {
      // Chromium Fetch.continueRequest recalculates Content-Length from postData.
      headers = { ...(headers ?? this._headers) };
      const body = decodeBody(bodyBase64);
      if (body === null || body.length === 0) {
        delete headers["content-length"];
      } else {
        headers["content-length"] = String(body.length);
      }
    }

    return {
      ...(overrides.url !== undefined ? { url: overrides.url } : {}),
      ...(overrides.method !== undefined ? { method: overrides.method } : {}),
      ...(headers !== undefined ? { headers: normalizeHeaders(headers) } : {}),
      ...(bodyBase64 !== undefined ? { bodyBase64 } : {}),
    };
  }

  toMatchRequest(): SerializedRequest {
    return {
      url: this.url(),
      method: this.method(),
      headers: this.headers(),
      bodyBase64: encodeBody(this.postDataBuffer()),
    };
  }
}

/**
 * Playwright-shaped Route with fulfill / continue / abort / fallback / fetch.
 * Mirrored from Playwright `Route` at pin 26a9e47.
 */
class BackendRouteImpl implements BackendRoute {
  private _handlingPromise: {
    promise: Promise<boolean>;
    resolve: (handled: boolean) => void;
  } | null = null;
  private _terminalSettled = false;
  didThrow = false;

  constructor(
    private readonly _request: BackendRequestImpl,
    private readonly _requestId: string,
    private readonly _connection: PlaywrightProxyConnection,
    private readonly _pendingFetches: Map<string, PendingFetch>,
  ) {}

  request(): BackendRequest {
    return this._request;
  }

  isTerminalSettled(): boolean {
    return this._terminalSettled;
  }

  async _startHandling(): Promise<boolean> {
    let resolve!: (handled: boolean) => void;
    const promise = new Promise<boolean>((res) => {
      resolve = res;
    });
    this._handlingPromise = { promise, resolve };
    return promise;
  }

  async fallback(options: ContinueOptions = {}): Promise<void> {
    this._checkNotHandled();
    this._request._applyFallbackOverrides(options);
    this._reportHandled(false);
  }

  async abort(errorCode = "failed"): Promise<void> {
    await this._handleRoute(async () => {
      this._terminalSettled = true;
      this._connection.send({
        type: "handler:result",
        requestId: this._requestId,
        result: {
          action: "abort",
          errorCode: toProtocolAbortCode(errorCode),
        },
      });
    });
  }

  async fetch(options: FetchOptions = {}): Promise<BackendResponse> {
    // fetch is non-terminal — does not settle the route and does not mutate
    // fallback overrides (Playwright passes options into the fetch call only).
    // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts (Route.fetch)
    // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/fetch.ts (_innerFetch)
    if (options.maxRedirects !== undefined && options.maxRedirects < 0) {
      throw new Error(`'maxRedirects' must be greater than or equal to '0'`);
    }
    if (options.maxRetries !== undefined && options.maxRetries < 0) {
      throw new Error(`'maxRetries' must be greater than or equal to '0'`);
    }
    assertFetchUrlProtocol(options.url, this._request.url());

    const fetchId = randomUUID();
    const overrides = fetchOverridesForRequest(this._request, options);
    const timeout = options.timeout ?? 30_000;
    const signal = options.signal;

    const responsePromise = new Promise<BackendResponse>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        cleanup();
        if (this._pendingFetches.delete(fetchId)) {
          const reason = signal?.reason;
          reject(
            reason instanceof Error
              ? reason
              : new Error(
                  typeof reason === "string" && reason.length > 0
                    ? reason
                    : "route.fetch aborted",
                ),
          );
        }
      };
      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer !== undefined) {
          clearTimeout(timer);
        }
        signal?.removeEventListener("abort", onAbort);
      };

      this._pendingFetches.set(fetchId, {
        request: this._request,
        resolve: (response) => {
          cleanup();
          resolve(response);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });

      // Playwright: timeout 0 disables the deadline (kNoTimeout).
      if (timeout > 0) {
        timer = setTimeout(() => {
          if (this._pendingFetches.delete(fetchId)) {
            cleanup();
            // Playwright TimeoutError message shape.
            reject(new Error(`Timeout ${timeout}ms exceeded.`));
          }
        }, timeout);
      }

      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });

    if (signal?.aborted) {
      return responsePromise;
    }

    this._connection.send({
      type: "handler:result",
      requestId: this._requestId,
      result: {
        action: "fetch",
        fetchId,
        ...(overrides !== undefined ? { overrides } : {}),
        ...(options.maxRedirects !== undefined
          ? { maxRedirects: options.maxRedirects }
          : {}),
        ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      },
    });

    return responsePromise;
  }

  async fulfill(options: FulfillOptions = {}): Promise<void> {
    await this._handleRoute(async () => {
      const response = await buildFulfillResponse(options, this._request.url());
      this._terminalSettled = true;
      this._connection.send({
        type: "handler:result",
        requestId: this._requestId,
        result: {
          action: "fulfill",
          response,
        },
      });
    });
  }

  async continue(options: ContinueOptions = {}): Promise<void> {
    await this._handleRoute(async () => {
      this._request._applyFallbackOverrides(options);
      // Throws on protocol mismatch — handler is marked thrown, network not sent.
      this._request._checkContinueUrlProtocol();
      const overrides = this._request._fallbackOverridesForContinue();
      this._terminalSettled = true;
      this._connection.send({
        type: "handler:result",
        requestId: this._requestId,
        result: {
          action: "continue",
          ...(overrides !== undefined ? { overrides } : {}),
        },
      });
    });
  }

  /** Final network continue after the handler chain falls through. */
  sendFinalContinue(): void {
    if (this._terminalSettled) {
      return;
    }
    // Playwright: continue({ isFallback: true }).catch(() => {}) — protocol
    // mismatch from fallback({ url }) stalls instead of throwing to the test.
    try {
      this._request._checkContinueUrlProtocol();
    } catch {
      this._terminalSettled = true;
      return;
    }
    this._terminalSettled = true;
    const overrides = this._request._fallbackOverridesForContinue();
    this._connection.send({
      type: "handler:result",
      requestId: this._requestId,
      result: {
        action: "continue",
        ...(overrides !== undefined ? { overrides } : {}),
      },
    });
  }

  sendAbortFailed(message: string): void {
    if (this._terminalSettled) {
      return;
    }
    this._terminalSettled = true;
    this._connection.send({
      type: "handler:result",
      requestId: this._requestId,
      result: {
        action: "abort",
        errorCode: "failed",
        message,
      },
    });
  }

  private async _handleRoute(callback: () => Promise<void>): Promise<void> {
    this._checkNotHandled();
    try {
      await callback();
      this._reportHandled(true);
    } catch (error) {
      this.didThrow = true;
      throw error;
    }
  }

  private _checkNotHandled(): void {
    if (this._handlingPromise === null) {
      throw new Error("Route is already handled!");
    }
  }

  private _reportHandled(done: boolean): void {
    const chain = this._handlingPromise;
    this._handlingPromise = null;
    chain!.resolve(done);
  }
}

/**
 * Playwright-shaped RouteHandler with `times` and active-invocation tracking.
 * Mirrored from Playwright `RouteHandler` at pin 26a9e47.
 */
class RouteHandlerRecord {
  readonly routeId: string;
  readonly matcherInput: RouteMatcherInput;
  readonly handler: RouteHandler;
  private readonly _baseURL: string | undefined;
  private handledCount = 0;
  private readonly _times: number;
  private _ignoreException = false;
  private readonly _activeInvocations = new Set<ActiveInvocation>();

  constructor(
    routeId: string,
    matcherInput: RouteMatcherInput,
    handler: RouteHandler,
    times: number = Number.MAX_SAFE_INTEGER,
    baseURL?: string,
  ) {
    this.routeId = routeId;
    this.matcherInput = matcherInput;
    this.handler = handler;
    this._times = times;
    this._baseURL = baseURL;
    // Playwright RouteHandler: eagerly validate string globs at registration.
    // https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
    const glob = extractGlobString(matcherInput);
    if (glob !== undefined) {
      resolveGlobToRegexPattern(baseURL, glob);
    }
  }

  matches(request: BackendRequestImpl): boolean {
    return matchRouteMatcher(this.matcherInput, {
      request: request.toMatchRequest(),
      clientId: request.clientId,
      baseURL: this._baseURL,
    });
  }

  willExpire(): boolean {
    return this.handledCount + 1 >= this._times;
  }

  async handle(route: BackendRouteImpl): Promise<boolean> {
    let resolveComplete!: () => void;
    const complete = new Promise<void>((resolve) => {
      resolveComplete = resolve;
    });
    const invocation: ActiveInvocation = {
      complete,
      resolveComplete,
      didThrow: false,
    };
    this._activeInvocations.add(invocation);
    try {
      return await this._handleInternal(route);
    } catch (error) {
      invocation.didThrow = true;
      if (this._ignoreException) {
        return false;
      }
      throw error;
    } finally {
      resolveComplete();
      this._activeInvocations.delete(invocation);
    }
  }

  async stop(behavior: "wait" | "ignoreErrors"): Promise<void> {
    if (behavior === "ignoreErrors") {
      this._ignoreException = true;
      return;
    }
    const promises: Array<Promise<void>> = [];
    for (const activation of this._activeInvocations) {
      if (!activation.didThrow) {
        promises.push(activation.complete);
      }
    }
    await Promise.all(promises);
  }

  private async _handleInternal(route: BackendRouteImpl): Promise<boolean> {
    ++this.handledCount;
    const handledPromise = route._startHandling();
    // Extract handler into a variable to avoid [RouteHandler.handler] in the stack.
    const handler = this.handler;
    const [handled] = await Promise.all([
      handledPromise,
      Promise.resolve(handler(route, route.request())),
    ]);
    return handled;
  }
}

export interface BackendMocksController extends BackendMocks {
  dispose(): void;
}

export function createBackendMocks(options: {
  connection: PlaywrightProxyConnection;
  testId: string;
  /** Playwright context/page `baseURL` for relative glob resolution. */
  baseURL?: string;
}): BackendMocksController {
  const { connection, testId, baseURL } = options;
  const routes: RouteHandlerRecord[] = [];
  const pendingFetches = new Map<string, PendingFetch>();
  const observed: BackendRequest[] = [];
  const requestsById = new Map<string, BackendRequestImpl>();
  const requestWaiters = new Set<NetworkWaiter<BackendRequest>>();
  const responseWaiters = new Set<NetworkWaiter<BackendResponse>>();
  const errors: Error[] = [];
  const jsonSessions: RouteFromJSONSession[] = [];
  const harSessions: RouteFromHARSession[] = [];

  const unsubscribe = connection.onMessage((message) => {
    void handleMessage(message);
  });

  /**
   * Deduplicate request:observed / request:matched into one BackendRequest and
   * notify future-only waitForRequest waiters (Playwright Page.Request event).
   * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/page.ts
   */
  function observeRequest(
    requestId: string,
    serialized: SerializedRequest,
    clientId: string,
  ): BackendRequestImpl {
    let request = requestsById.get(requestId);
    if (request === undefined) {
      request = new BackendRequestImpl(serialized, clientId);
      requestsById.set(requestId, request);
      observed.push(request);
      void notifyRequestWaiters(request);
    }
    return request;
  }

  async function notifyRequestWaiters(request: BackendRequest): Promise<void> {
    for (const waiter of [...requestWaiters]) {
      try {
        if (await waiter.predicate(request)) {
          requestWaiters.delete(waiter);
          waiter.resolve(request);
        }
      } catch (error) {
        requestWaiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async function notifyResponseWaiters(response: BackendResponse): Promise<void> {
    for (const waiter of [...responseWaiters]) {
      try {
        if (await waiter.predicate(response)) {
          responseWaiters.delete(waiter);
          waiter.resolve(response);
        }
      } catch (error) {
        responseWaiters.delete(waiter);
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  async function handleMessage(message: ProxyToClientMessage): Promise<void> {
    switch (message.type) {
      case "request:claim": {
        // Report ALL currently matching routeIds (LIFO registration order).
        // Proxy groups by testId; ignore wire routeId during later orchestration.
        const matches: Array<{ routeId: string }> = [];
        for (const route of routes) {
          if (
            matchRouteMatcher(route.matcherInput, {
              request: message.request,
              clientId: message.clientId,
              baseURL,
            })
          ) {
            matches.push({ routeId: route.routeId });
          }
        }
        connection.send({
          type: "request:claim-result",
          requestId: message.requestId,
          testId,
          matches,
        });
        return;
      }
      case "request:observed": {
        // All Node traffic (routed or passthrough) — future-only waitForRequest.
        observeRequest(message.requestId, message.request, message.clientId);
        return;
      }
      case "request:matched": {
        if (message.testId !== testId) {
          return;
        }
        // Ignore message.routeId for orchestration — re-evaluate all local routes (LIFO).
        await handleMatchedRequest(message);
        return;
      }
      case "request:response": {
        if (!message.ok || message.response === undefined) {
          return;
        }
        const request = requestsById.get(message.requestId);
        if (request === undefined) {
          return;
        }
        const response = toBackendResponse(message.response, request);
        void notifyResponseWaiters(response);
        return;
      }
      case "fetch:done": {
        const waiter = pendingFetches.get(message.fetchId);
        if (waiter === undefined) {
          return;
        }
        pendingFetches.delete(message.fetchId);
        if (!message.ok || message.response === undefined) {
          waiter.reject(
            new Error(
              message.error?.message ?? "Upstream fetch failed for backend mock route",
            ),
          );
          return;
        }
        waiter.resolve(toBackendResponse(message.response, waiter.request));
        return;
      }
      case "proxy:error": {
        if (message.testId !== undefined && message.testId !== testId) {
          return;
        }
        errors.push(new Error(message.message));
        return;
      }
      default:
        return;
    }
  }

  /**
   * Playwright `Page._onRoute` / `BrowserContext._onRoute` analogue.
   * Walk matching handlers newest-first; fallback continues the chain;
   * unsettled handler return stalls; exhausted chain continues to the network.
   */
  async function handleMatchedRequest(
    message: Extract<ProxyToClientMessage, { type: "request:matched" }>,
  ): Promise<void> {
    const request = observeRequest(
      message.requestId,
      message.request,
      message.clientId,
    );
    const routeApi = new BackendRouteImpl(
      request,
      message.requestId,
      connection,
      pendingFetches,
    );

    const routeHandlers = routes.slice();
    for (const routeHandler of routeHandlers) {
      if (!routeHandler.matches(request)) {
        continue;
      }
      const index = routes.indexOf(routeHandler);
      if (index === -1) {
        continue;
      }
      if (routeHandler.willExpire()) {
        routes.splice(index, 1);
        connection.send({
          type: "route:unregister",
          routeId: routeHandler.routeId,
        });
      }

      try {
        const handled = await routeHandler.handle(routeApi);
        if (handled) {
          return;
        }
        // fallback → try next matcher (overrides already applied on request)
      } catch (error) {
        // DIVERGENCE: Playwright stalls + fails the test; we abort the paused
        // Node request so the app is not left hanging, and still record the error.
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);
        if (!routeApi.isTerminalSettled()) {
          routeApi.sendAbortFailed(err.message);
        }
        return;
      }
    }

    // No handler settled — final fallback continues to the network (Playwright).
    if (!routeApi.isTerminalSettled()) {
      routeApi.sendFinalContinue();
    }
  }

  function unregisterRoute(routeId: string): void {
    connection.send({
      type: "route:unregister",
      routeId,
    });
  }

  const api: BackendMocksController = {
    async route(url, handler, options: RouteOptions = {}) {
      const routeId = randomUUID();
      const times = options.times ?? Number.MAX_SAFE_INTEGER;
      // LIFO: newest handler first (Playwright unshift).
      // RouteHandlerRecord constructor eagerly validates string globs (throws).
      routes.unshift(
        new RouteHandlerRecord(routeId, url, handler, times, baseURL),
      );
      connection.send({
        type: "route:register",
        routeId,
        testId,
        matcher: toSerializedMatcher(url),
      });
    },

    async unroute(url, handler) {
      const remaining: RouteHandlerRecord[] = [];
      for (const route of routes) {
        const urlMatches =
          url === undefined || matcherEquals(route.matcherInput, url);
        const handlerMatches = handler === undefined || route.handler === handler;
        if (urlMatches && handlerMatches) {
          unregisterRoute(route.routeId);
        } else {
          remaining.push(route);
        }
      }
      routes.length = 0;
      routes.push(...remaining);
    },

    async unrouteAll(options: UnrouteAllOptions = {}) {
      const removed = [...routes];
      routes.length = 0;
      for (const route of removed) {
        unregisterRoute(route.routeId);
      }

      const behavior = options.behavior;
      if (behavior === "wait" || behavior === "ignoreErrors") {
        await Promise.all(removed.map((route) => route.stop(behavior)));
      }
    },

    async routeFromJSON(filePath, options: RouteFromJSONOptions = {}) {
      // Legacy JSON cassette helper — prefer routeFromHAR for new callers.
      const session = createRouteFromJSONSession(filePath, options);
      jsonSessions.push(session);
      await api.route(session.matcher, session.handler);
    },

    async routeFromHAR(file: string, options: RouteFromHAROptions = {}) {
      // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/harRouter.ts
      // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/page.ts (routeFromHAR)
      // Registers as a normal route so LIFO / unrouteAll match Playwright replay.
      // DIVERGENCE: Playwright `update: true` records via tracing without a route;
      // Node records by fetch → write entry → fulfill/abort inside the handler.
      // DIVERGENCE END
      const session = createRouteFromHARSession(file, options);
      harSessions.push(session);
      await api.route(session.matcher, session.handler);
    },

    /**
     * Playwright-shaped waitForRequest — future-only, timeout 0 = forever, AbortSignal.
     * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/page.ts
     * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/waiter.ts
     */
    async waitForRequest(urlOrPredicate, options = {}) {
      const predicate = createRequestWaitPredicate(urlOrPredicate, baseURL);
      return waitForNetworkEvent(
        requestWaiters,
        predicate,
        options,
        `Timeout ${options.timeout ?? 30_000}ms exceeded while waiting for event "request"`,
      );
    },

    /**
     * Playwright-shaped waitForResponse — future-only, timeout 0 = forever, AbortSignal.
     * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/page.ts
     * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/waiter.ts
     */
    async waitForResponse(urlOrPredicate, options = {}) {
      const predicate = createResponseWaitPredicate(urlOrPredicate, baseURL);
      return waitForNetworkEvent(
        responseWaiters,
        predicate,
        options,
        `Timeout ${options.timeout ?? 30_000}ms exceeded while waiting for event "response"`,
      );
    },

    async requests(url) {
      if (url === undefined) {
        return [...observed];
      }
      return observed.filter((request) =>
        matchRouteMatcher(url, {
          request: {
            url: request.url(),
            method: request.method(),
            headers: { ...request.headers() },
            bodyBase64: encodeBody(request.postDataBuffer()),
          },
          clientId: request.clientId,
          baseURL,
        }),
      );
    },

    takeErrors() {
      const drained = [...errors];
      errors.length = 0;
      return drained;
    },

    dispose() {
      for (const session of jsonSessions) {
        flushRouteFromJSONSession(session);
      }
      jsonSessions.length = 0;

      for (const session of harSessions) {
        flushRouteFromHARSession(session);
      }
      harSessions.length = 0;

      unsubscribe();
      connection.send({
        type: "route:unregister",
        testId,
      });
      connection.send({
        type: "test:unregister",
        testId,
      });
      for (const [, waiter] of pendingFetches) {
        waiter.reject(new Error("Test ended while route.fetch was pending"));
      }
      pendingFetches.clear();
      for (const waiter of requestWaiters) {
        waiter.reject(new Error("Test ended while waitForRequest was pending"));
      }
      requestWaiters.clear();
      for (const waiter of responseWaiters) {
        waiter.reject(new Error("Test ended while waitForResponse was pending"));
      }
      responseWaiters.clear();
      requestsById.clear();
    },
  };

  return api;
}

/** String glob from a route matcher, if any (for eager validation). */
function extractGlobString(input: RouteMatcherInput): string | undefined {
  if (typeof input === "string") {
    return input;
  }
  if (
    typeof input === "object" &&
    input !== null &&
    !(input instanceof RegExp) &&
    !isURLPattern(input) &&
    typeof input !== "function" &&
    typeof input.url === "string"
  ) {
    return input.url;
  }
  return undefined;
}

function matcherEquals(a: RouteMatcherInput, b: RouteMatcherInput): boolean {
  if (a === b) {
    return true;
  }

  const patternA = getRouteURLPattern(a);
  const patternB = getRouteURLPattern(b);
  if (patternA !== undefined || patternB !== undefined) {
    return patternA === patternB;
  }

  const predicateA = getRouteUrlPredicate(a);
  const predicateB = getRouteUrlPredicate(b);
  if (predicateA !== undefined || predicateB !== undefined) {
    if (predicateA !== predicateB) {
      return false;
    }
    return (
      JSON.stringify(toSerializedMatcher(stripMatcherUrl(a))) ===
      JSON.stringify(toSerializedMatcher(stripMatcherUrl(b)))
    );
  }

  return (
    JSON.stringify(toSerializedMatcher(a)) === JSON.stringify(toSerializedMatcher(b))
  );
}

function stripMatcherUrl(input: RouteMatcherInput): RouteMatcherInput {
  if (typeof input === "function" || isURLPattern(input)) {
    return {};
  }
  if (typeof input === "object" && !(input instanceof RegExp)) {
    return {
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
    };
  }
  return input;
}

function describeMatcher(input: RouteMatcherInput, methodFilter?: string): string {
  if (
    getRouteUrlPredicate(input) !== undefined ||
    getRouteURLPattern(input) !== undefined
  ) {
    const serialized = toSerializedMatcher(input, methodFilter);
    return `predicate${serialized.methods ? ` methods=${serialized.methods.join(",")}` : ""}`;
  }
  return JSON.stringify(toSerializedMatcher(input, methodFilter));
}

function toBackendResponse(
  response: SerializedResponse,
  request?: BackendRequest,
): BackendResponse {
  // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/fetch.ts (APIResponse)
  // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts (Response)
  const bodyBuffer = decodeBody(response.bodyBase64) ?? Buffer.alloc(0);
  const headerMap = { ...response.headers };
  let disposed = false;
  const assertNotDisposed = () => {
    if (disposed) {
      throw new Error("Response has been disposed");
    }
  };

  return {
    bodyBuffer,
    ok() {
      return response.status >= 200 && response.status <= 299;
    },
    url() {
      return response.url ?? request?.url() ?? "";
    },
    status() {
      return response.status;
    },
    statusText() {
      return response.statusText;
    },
    headers() {
      return { ...headerMap };
    },
    headersArray() {
      return Object.entries(headerMap).map(([name, value]) => ({ name, value }));
    },
    headerValue(name: string) {
      const lower = name.toLowerCase();
      for (const [key, value] of Object.entries(headerMap)) {
        if (key.toLowerCase() === lower) {
          return value;
        }
      }
      return null;
    },
    request() {
      if (request === undefined) {
        throw new Error("Response is not associated with a request");
      }
      return request;
    },
    async body() {
      assertNotDisposed();
      return bodyBuffer;
    },
    async text() {
      assertNotDisposed();
      return bodyBuffer.toString("utf8");
    },
    async json() {
      assertNotDisposed();
      return JSON.parse(bodyBuffer.toString("utf8")) as unknown;
    },
    async dispose() {
      disposed = true;
    },
  };
}

/**
 * Playwright Waiter.rejectOnTimeout + AbortSignal for network waiters.
 * `timeout: 0` (falsy) disables the deadline.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/waiter.ts
 */
function waitForNetworkEvent<T>(
  waiters: Set<NetworkWaiter<T>>,
  predicate: (value: T) => boolean | Promise<boolean>,
  options: WaitForNetworkOptions,
  timeoutMessage: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = options.timeout ?? 30_000;
    const signal = options.signal;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      waiters.delete(waiter);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", onAbort);
    };

    const waiter: NetworkWaiter<T> = {
      predicate,
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    };

    const onAbort = () => {
      const reason = signal?.reason;
      waiter.reject(
        reason instanceof Error
          ? reason
          : new Error(
              typeof reason === "string" && reason.length > 0
                ? reason
                : "The operation was aborted",
            ),
      );
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    waiters.add(waiter);

    // Playwright: `if (timeout)` — falsy 0 means wait forever.
    if (timeout) {
      timer = setTimeout(() => {
        waiter.reject(new Error(timeoutMessage));
      }, timeout);
    }

    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function createRequestWaitPredicate(
  urlOrPredicate: WaitForRequestMatcher,
  baseURL: string | undefined,
): (request: BackendRequest) => boolean | Promise<boolean> {
  if (typeof urlOrPredicate === "function") {
    return urlOrPredicate;
  }
  return (request) =>
    matchRouteMatcher(urlOrPredicate, {
      request: {
        url: request.url(),
        method: request.method(),
        headers: { ...request.headers() },
        bodyBase64: encodeBody(request.postDataBuffer()),
      },
      clientId: request.clientId,
      baseURL,
    });
}

function createResponseWaitPredicate(
  urlOrPredicate: WaitForResponseMatcher,
  baseURL: string | undefined,
): (response: BackendResponse) => boolean | Promise<boolean> {
  if (typeof urlOrPredicate === "function") {
    return urlOrPredicate;
  }
  return (response) => {
    let clientId = "";
    try {
      clientId = response.request().clientId;
    } catch {
      clientId = "";
    }
    return matchRouteMatcher(urlOrPredicate, {
      request: {
        url: response.url(),
        method: "GET",
        headers: {},
        bodyBase64: null,
      },
      clientId,
      baseURL,
    });
  };
}

/**
 * Merge accumulated request overrides with per-fetch options for the wire.
 * Applies Playwright APIRequestContext postData content-type defaults.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts (serializePostData)
 */
function fetchOverridesForRequest(
  request: BackendRequestImpl,
  options: FetchOptions,
): RequestOverrides | undefined {
  const base = request._fallbackOverridesForContinue() ?? {};
  const fromOptions = toFetchOverrides(request, options);
  if (fromOptions === undefined && Object.keys(base).length === 0) {
    return undefined;
  }
  return {
    ...base,
    ...fromOptions,
  };
}

function toFetchOverrides(
  request: BackendRequestImpl,
  options: FetchOptions,
): RequestOverrides | undefined {
  const hasOverrides =
    options.url !== undefined ||
    options.method !== undefined ||
    options.headers !== undefined ||
    options.postData !== undefined;

  if (!hasOverrides) {
    return undefined;
  }

  const postDataBuffer =
    options.postData !== undefined ? postDataToBuffer(options.postData) : undefined;

  let headers: Record<string, string> | undefined;
  if (options.headers !== undefined) {
    headers = normalizeHeaders(headersObjectLossy(options.headers));
  } else if (options.postData !== undefined) {
    // Inherit request headers so content-type defaults can layer on top.
    headers = normalizeHeaders({ ...request.headers() });
  }

  if (options.postData !== undefined && headers !== undefined) {
    applyPostDataContentTypeDefault(headers, options.postData);
  }

  return {
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.method !== undefined ? { method: options.method } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(postDataBuffer !== undefined ? { bodyBase64: encodeBody(postDataBuffer) } : {}),
  };
}

function toOverrides(options: ContinueOptions): RequestOverrides | undefined {
  const hasOverrides =
    options.url !== undefined ||
    options.method !== undefined ||
    options.headers !== undefined ||
    options.postData !== undefined;

  if (!hasOverrides) {
    return undefined;
  }

  const postDataBuffer =
    options.postData !== undefined ? postDataToBuffer(options.postData) : undefined;

  return {
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.method !== undefined ? { method: options.method } : {}),
    ...(options.headers !== undefined
      ? { headers: normalizeHeaders(headersObjectLossy(options.headers)) }
      : {}),
    ...(postDataBuffer !== undefined ? { bodyBase64: encodeBody(postDataBuffer) } : {}),
  };
}

/**
 * Playwright serializePostData content-type defaults (keepExisting).
 * Object → application/json; string/Buffer/Uint8Array → application/octet-stream.
 */
function applyPostDataContentTypeDefault(
  headers: Record<string, string>,
  postData: string | Buffer | Uint8Array | object,
): void {
  if (hasHeader(headers, "content-type")) {
    return;
  }
  if (isJsonPostData(postData)) {
    headers["content-type"] = "application/json";
  } else {
    headers["content-type"] = "application/octet-stream";
  }
}

function isJsonPostData(postData: string | Buffer | Uint8Array | object): boolean {
  if (typeof postData === "string" || Buffer.isBuffer(postData) || postData instanceof Uint8Array) {
    return false;
  }
  return typeof postData === "object" && postData !== null;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/**
 * route.fetch URL overrides only support http(s), matching Playwright's
 * APIRequestContext (Node http/https). file: and other schemes are rejected.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts
 */
function assertFetchUrlProtocol(overrideUrl: string | undefined, requestUrl: string): void {
  if (overrideUrl === undefined) {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(overrideUrl, requestUrl);
  } catch {
    throw new Error(`Invalid fetch URL: ${overrideUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Protocol "${parsed.protocol}" is not supported. Expected "http:" or "https:"`,
    );
  }
}

async function buildFulfillResponse(
  options: FulfillOptions,
  requestUrl?: string,
): Promise<SerializedResponse> {
  // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts (_innerFulfill)
  if (options.json !== undefined && options.body !== undefined) {
    throw new Error("Can specify either body or json parameters");
  }

  if (options.response !== undefined) {
    // Playwright: headersOption ??= response.headers() — provided headers replace,
    // they are not merged with the fetched response headers.
    const headers = coerceFulfillHeaders(
      options.headers !== undefined ? options.headers : options.response.headers(),
    );
    let body = options.response.bodyBuffer;
    if (options.json !== undefined) {
      body = Buffer.from(JSON.stringify(options.json), "utf8");
      if (!("content-type" in headers)) headers["content-type"] = "application/json";
    } else if (options.body !== undefined) {
      body = toBuffer(options.body);
    }
    if (options.contentType !== undefined) {
      headers["content-type"] = String(options.contentType);
    }
    if (body.length > 0 && !("content-length" in headers)) {
      headers["content-length"] = String(body.length);
    }
    return {
      // Playwright: statusOption || 200 (status 0 → 200)
      status: options.status || options.response.status() || 200,
      statusText: options.response.statusText(),
      headers: normalizeHeaders(headers),
      bodyBase64: encodeBody(body),
      url: options.response.url() || requestUrl,
    };
  }

  const headers = coerceFulfillHeaders({ ...options.headers });
  let body: Buffer | null = null;

  if (options.json !== undefined) {
    body = Buffer.from(JSON.stringify(options.json), "utf8");
    if (!("content-type" in headers)) headers["content-type"] = "application/json";
  } else if (options.path !== undefined) {
    body = await readFile(options.path);
    if (!("content-type" in headers)) {
      headers["content-type"] =
        getMimeTypeForPath(options.path) || "application/octet-stream";
    }
  } else if (options.body !== undefined) {
    body = toBuffer(options.body);
  }

  if (options.contentType !== undefined) {
    headers["content-type"] = String(options.contentType);
  }

  const length = body?.length ?? 0;
  if (length > 0 && !("content-length" in headers)) {
    headers["content-length"] = String(length);
  }

  return {
    // Playwright: statusOption || 200 (status 0 → 200)
    status: options.status || 200,
    statusText: "",
    headers: normalizeHeaders(headers),
    bodyBase64: encodeBody(body),
    ...(requestUrl !== undefined ? { url: requestUrl } : {}),
  };
}

/**
 * Coerce fulfill header values to strings and lowercase keys (Playwright).
 * Drops transfer-encoding; keeps content-length when caller set it.
 */
function coerceFulfillHeaders(
  headers: Record<string, string | number | boolean | undefined> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === "transfer-encoding") continue;
    result[lower] = String(value);
  }
  return result;
}

/**
 * Minimal mime map for fulfill({ path }) — mirrors Playwright getMimeTypeForPath
 * for the extensions the oracle exercises; unknown → application/octet-stream at call site.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/isomorphic/mimeType.ts
 */
function getMimeTypeForPath(filePath: string): string | null {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return null;
  const ext = filePath.slice(dot + 1).toLowerCase();
  const types: Record<string, string> = {
    json: "application/json",
    txt: "text/plain",
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    pdf: "application/pdf",
    xml: "application/xml",
    bin: "application/octet-stream",
  };
  return types[ext] ?? null;
}

function headersObjectLossy(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    result[key.toLowerCase()] = String(value);
  }
  return result;
}

/**
 * Forbidden request headers — cannot be overridden via continue/fallback.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/network.ts
 */
const FORBIDDEN_HEADER_NAMES = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

const FORBIDDEN_METHODS = new Set(["CONNECT", "TRACE", "TRACK"]);

function isForbiddenHeader(name: string, value?: string): boolean {
  const lowerName = name.toLowerCase();
  if (FORBIDDEN_HEADER_NAMES.has(lowerName)) {
    return true;
  }
  if (lowerName.startsWith("proxy-") || lowerName.startsWith("sec-")) {
    return true;
  }
  if (
    lowerName === "x-http-method" ||
    lowerName === "x-http-method-override" ||
    lowerName === "x-method-override"
  ) {
    if (value && FORBIDDEN_METHODS.has(value.toUpperCase())) {
      return true;
    }
  }
  return false;
}

/** Keep allowed override headers; restore forbidden names from the original request. */
function applyHeadersOverrides(
  original: Record<string, string>,
  overrides: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(overrides)) {
    if (!isForbiddenHeader(name, value)) {
      result[name.toLowerCase()] = value;
    }
  }
  for (const [name, value] of Object.entries(original)) {
    if (isForbiddenHeader(name, value)) {
      result[name.toLowerCase()] = value;
    }
  }
  return result;
}

/**
 * Playwright `_applyFallbackOverrides` postData coercion.
 * `0` / `false` / `null` are ignored; empty Buffer clears the body.
 */
function postDataToBuffer(
  postData: string | Buffer | Uint8Array | object,
): Buffer | undefined {
  if (typeof postData === "string") {
    return Buffer.from(postData, "utf8");
  }
  if (Buffer.isBuffer(postData)) {
    return postData;
  }
  if (postData instanceof Uint8Array) {
    return Buffer.from(postData);
  }
  if (postData) {
    return Buffer.from(JSON.stringify(postData), "utf8");
  }
  return undefined;
}

function toBuffer(value: string | Buffer | Uint8Array): Buffer {
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  if (Buffer.isBuffer(value)) {
    return value;
  }
  return Buffer.from(value);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { HistoryEntry };
