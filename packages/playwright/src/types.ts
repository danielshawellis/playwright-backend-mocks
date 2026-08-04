// Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
import type {
  BackendErrorCode,
  SerializedMatcher,
} from "@playwright-backend-mocks/protocol";

/** Playwright-style URL predicate. Receives a parsed `URL` for the request. */
export type RouteUrlPredicate = (url: URL) => boolean;

/**
 * URL matcher accepted by `route()`.
 * `URLPattern` is supported when available in the runtime.
 */
export type RouteUrl = string | RegExp | RouteUrlPredicate | URLPattern;

export interface RouteMatcherObject {
  readonly url?: RouteUrl;
  readonly method?: string | readonly string[];
  // DIVERGENCE: product addition for multi-app Node targeting
  readonly clientId?: string | readonly string[];
  // DIVERGENCE END
}

export type RouteMatcherInput = RouteUrl | RouteMatcherObject;

export interface RouteOptions {
  readonly times?: number;
}

export interface UnrouteAllOptions {
  readonly behavior?: "wait" | "ignoreErrors" | "default";
}

/** Playwright abort error codes (Route.abort). */
export type RouteAbortErrorCode =
  | "aborted"
  | "accessdenied"
  | "addressunreachable"
  | "blockedbyclient"
  | "blockedbyresponse"
  | "connectionaborted"
  | "connectionclosed"
  | "connectionfailed"
  | "connectionrefused"
  | "connectionreset"
  | "internetdisconnected"
  | "namenotresolved"
  | "timedout"
  | "failed";

export type HeaderArray = Array<{ name: string; value: string }>;

export interface ResourceTiming {
  startTime: number;
  domainLookupStart: number;
  domainLookupEnd: number;
  connectStart: number;
  secureConnectionStart: number;
  connectEnd: number;
  requestStart: number;
  responseStart: number;
  responseEnd: number;
}

export interface RequestSizes {
  requestBodySize: number;
  requestHeadersSize: number;
  responseBodySize: number;
  responseHeadersSize: number;
}

/**
 * Playwright-shaped Request API used by route handlers and waiters.
 * Specs call `request.method()`, `request.postDataJSON()`, etc.
 */
export interface BackendRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  allHeaders(): Promise<Record<string, string>>;
  headersArray(): Promise<HeaderArray>;
  headerValue(name: string): Promise<string | null>;
  postData(): string | null;
  postDataBuffer(): Buffer | null;
  postDataJSON(): unknown;
  resourceType(): "fetch" | "other";
  frame(): never;
  serviceWorker(): null;
  isNavigationRequest(): boolean;
  redirectedFrom(): BackendRequest | null;
  redirectedTo(): BackendRequest | null;
  failure(): { errorText: string } | null;
  timing(): ResourceTiming;
  sizes(): Promise<RequestSizes>;
  response(): Promise<BackendResponse | null>;
  /**
   * Immediate response if already available; null before settlement.
   * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts (Request.existingResponse)
   */
  existingResponse(): BackendResponse | null;
  /**
   * DIVERGENCE: product addition for multi-app Node targeting.
   * Not present on Playwright's Request.
   * DIVERGENCE END
   */
  readonly clientId: string;
}

/**
 * Response returned from `route.fetch()` / `waitForResponse` / accepted by
 * `route.fulfill({ response })`.
 * Combines Playwright Response + APIResponse accessors used by the oracle.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/fetch.ts (APIResponse)
 */
export interface BackendResponse {
  ok(): boolean;
  url(): string;
  status(): number;
  statusText(): string;
  headers(): Record<string, string>;
  headersArray(): HeaderArray;
  headerValue(name: string): string | null;
  body(): Promise<Buffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  /** Present for waitForResponse / network Response; fetch associates the route request. */
  request(): BackendRequest;
  dispose(): Promise<void>;
  /** Buffered body for cassette / fulfill helpers (sync). */
  readonly bodyBuffer: Buffer;
}

/** Playwright `page.waitForRequest` urlOrPredicate. */
export type WaitForRequestPredicate = (
  request: BackendRequest,
) => boolean | Promise<boolean>;

export type WaitForRequestMatcher = string | RegExp | WaitForRequestPredicate;

/** Playwright `page.waitForResponse` urlOrPredicate. */
export type WaitForResponsePredicate = (
  response: BackendResponse,
) => boolean | Promise<boolean>;

export type WaitForResponseMatcher = string | RegExp | WaitForResponsePredicate;

/**
 * Playwright TimeoutOptions for waitForRequest / waitForResponse.
 * `timeout: 0` (falsy) disables the timeout — wait forever until match or abort.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/waiter.ts
 */
export interface WaitForNetworkOptions {
  readonly timeout?: number;
  readonly signal?: AbortSignal;
}

/** Options shared by continue / fallback / fetch (Playwright FallbackOverrides). */
export interface ContinueOptions {
  readonly url?: string;
  readonly method?: string;
  /** Header map; `undefined` values delete that header (Playwright lossy semantics). */
  readonly headers?: Record<string, string | undefined>;
  /** String / Buffer, or a JSON-serializable value (stringified like Playwright). */
  readonly postData?: string | Buffer | Uint8Array | object;
}

export interface FulfillOptions {
  readonly status?: number;
  /** Header values are coerced to strings (Playwright). */
  readonly headers?: Record<string, string | number | boolean | undefined>;
  readonly body?: string | Buffer | Uint8Array;
  readonly json?: unknown;
  readonly contentType?: string;
  readonly path?: string;
  readonly response?: BackendResponse;
}

export interface FetchOptions extends ContinueOptions {
  readonly timeout?: number;
  readonly maxRedirects?: number;
  readonly maxRetries?: number;
  /** Cancel the fetch; does not disable the default timeout (pass timeout: 0). */
  readonly signal?: AbortSignal;
}

export interface BackendRoute {
  request(): BackendRequest;
  fulfill(options?: FulfillOptions): Promise<void>;
  continue(options?: ContinueOptions): Promise<void>;
  /**
   * Non-terminal: apply local overrides and continue to the next matching handler.
   * Does not send `handler:result` on the wire.
   */
  fallback(options?: ContinueOptions): Promise<void>;
  fetch(options?: FetchOptions): Promise<BackendResponse>;
  abort(errorCode?: RouteAbortErrorCode | BackendErrorCode | string): Promise<void>;
}

export type RouteHandler = (
  route: BackendRoute,
  request: BackendRequest,
) => Promise<void> | void;

/**
 * Playwright-shaped `routeFromHAR` options.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/page.ts
 * Docs allow a URL predicate; published Playwright typings list string|RegExp only.
 */
export interface RouteFromHAROptions {
  readonly url?: string | RegExp | RouteUrlPredicate;
  readonly notFound?: "abort" | "fallback";
  readonly update?: boolean;
  readonly updateContent?: "attach" | "embed";
  readonly updateMode?: "minimal" | "full";
}

/**
 * Playwright-shaped WebSocketRoute (backendMocks.routeWebSocket).
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
 */
export interface BackendWebSocketRoute {
  url(): string;
  protocols(): string[];
  onMessage(handler: (message: string | Buffer) => unknown): void;
  onClose(
    handler: (code: number | undefined, reason: string | undefined) => unknown,
  ): void;
  send(message: string | Buffer): void;
  close(options?: { code?: number; reason?: string }): Promise<void>;
  connectToServer(): BackendWebSocketRoute;
}

export type WebSocketRouteHandler = (ws: BackendWebSocketRoute) => Promise<void> | void;

export interface BackendMocks {
  route(
    url: RouteMatcherInput,
    handler: RouteHandler,
    options?: RouteOptions,
  ): Promise<void>;
  unroute(url?: RouteMatcherInput, handler?: RouteHandler): Promise<void>;
  unrouteAll(options?: UnrouteAllOptions): Promise<void>;
  /**
   * Playwright-shaped HAR record/replay.
   * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/harRouter.ts
   */
  routeFromHAR(file: string, options?: RouteFromHAROptions): Promise<void>;
  /**
   * Playwright-shaped `routeWebSocket`.
   * Newest matching handler only; survives `unrouteAll`.
   * DIVERGENCE: intercepts `globalThis.WebSocket` only (not npm `ws`).
   * DIVERGENCE END
   * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/client/network.ts
   */
  routeWebSocket(url: RouteUrl, handler: WebSocketRouteHandler): Promise<void>;
  waitForRequest(
    urlOrPredicate: WaitForRequestMatcher,
    options?: WaitForNetworkOptions,
  ): Promise<BackendRequest>;
  waitForResponse(
    urlOrPredicate: WaitForResponseMatcher,
    options?: WaitForNetworkOptions,
  ): Promise<BackendResponse>;
  requests(url?: RouteMatcherInput): Promise<readonly BackendRequest[]>;
  /**
   * Return and clear proxy errors recorded for this test.
   * Useful when a test intentionally triggers an ambiguity/disconnect failure.
   * Any remaining errors are still thrown during fixture teardown.
   */
  takeErrors(): Error[];
}

export function toSerializedMatcher(
  input: RouteMatcherInput,
  methodFilter?: string,
): SerializedMatcher {
  const methods =
    typeof input === "object" &&
    !(input instanceof RegExp) &&
    !isURLPattern(input) &&
    typeof input !== "function"
      ? normalizeList(input.method)
      : undefined;
  const clientIds =
    typeof input === "object" &&
    !(input instanceof RegExp) &&
    !isURLPattern(input) &&
    typeof input !== "function"
      ? normalizeList(input.clientId)
      : undefined;

  const methodField =
    methods !== undefined
      ? { methods }
      : methodFilter !== undefined
        ? { methods: [methodFilter] }
        : {};

  const clientField = clientIds !== undefined ? { clientIds } : {};

  if (typeof input === "function" || isURLPattern(input)) {
    // Predicates / URLPattern are evaluated only in the Playwright worker.
    return { predicate: true, ...methodField, ...clientField };
  }

  if (typeof input === "string") {
    return { urlGlob: input, ...methodField, ...clientField };
  }

  if (input instanceof RegExp) {
    return {
      urlRegex: { source: input.source, flags: input.flags },
      ...methodField,
      ...clientField,
    };
  }

  if (typeof input.url === "function" || isURLPattern(input.url)) {
    return { predicate: true, ...methodField, ...clientField };
  }

  if (typeof input.url === "string") {
    return { urlGlob: input.url, ...methodField, ...clientField };
  }

  if (input.url instanceof RegExp) {
    return {
      urlRegex: { source: input.url.source, flags: input.url.flags },
      ...methodField,
      ...clientField,
    };
  }

  return { ...methodField, ...clientField };
}

export function getRouteUrlPredicate(
  input: RouteMatcherInput,
): RouteUrlPredicate | undefined {
  if (typeof input === "function") {
    return input;
  }
  if (
    typeof input === "object" &&
    !(input instanceof RegExp) &&
    !isURLPattern(input) &&
    typeof input.url === "function"
  ) {
    return input.url;
  }
  return undefined;
}

export function getRouteURLPattern(input: RouteMatcherInput): URLPattern | undefined {
  if (isURLPattern(input)) {
    return input;
  }
  if (
    typeof input === "object" &&
    !(input instanceof RegExp) &&
    !isURLPattern(input) &&
    isURLPattern(input.url)
  ) {
    return input.url;
  }
  return undefined;
}

/**
 * Detect URLPattern instances, including urlpattern-polyfill objects.
 *
 * Playwright pin uses `instanceof globalThis.URLPattern` only:
 * https://github.com/microsoft/playwright/blob/26a9e47/packages/isomorphic/urlMatch.ts
 *
 * DIVERGENCE: also duck-type `{ test, pathname, hostname }` so polyfill
 * instances work when the global constructor is missing or differs.
 * DIVERGENCE END
 */
export function isURLPattern(value: unknown): value is URLPattern {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (typeof (value as { test?: unknown }).test !== "function") {
    return false;
  }
  const URLPatternCtor = (
    globalThis as { URLPattern?: new (...args: never[]) => unknown }
  ).URLPattern;
  if (typeof URLPatternCtor === "function" && value instanceof URLPatternCtor) {
    return true;
  }
  return "pathname" in value && "hostname" in value;
}

/**
 * Map Playwright abort strings onto the protocol's narrower enum.
 * DIVERGENCE: protocol currently accepts a subset of Playwright codes.
 * Unsupported Playwright codes collapse to `failed` on the wire.
 * DIVERGENCE END
 */
export function toProtocolAbortCode(errorCode: string | undefined): BackendErrorCode {
  const code = errorCode ?? "failed";
  switch (code) {
    case "failed":
    case "aborted":
    case "timedout":
    case "connectionrefused":
    case "connectionreset":
    case "namenotresolved":
      return code;
    default:
      return "failed";
  }
}

function normalizeList(
  value: string | readonly string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? [value] : [...value];
}
