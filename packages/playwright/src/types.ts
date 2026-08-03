import type {
  BackendErrorCode,
  SerializedMatcher,
} from "@playwright-backend-mocks/protocol";

/** Playwright-style URL predicate. Receives a parsed `URL` for the request. */
export type RouteUrlPredicate = (url: URL) => boolean;

export type RouteUrl = string | RegExp | RouteUrlPredicate;

export interface RouteMatcherObject {
  readonly url?: RouteUrl;
  readonly method?: string | readonly string[];
  readonly clientId?: string | readonly string[];
}

export type RouteMatcherInput = RouteUrl | RouteMatcherObject;

export interface BackendRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly postData: string | null;
  readonly postDataBuffer: Buffer | null;
  readonly clientId: string;
  json(): unknown;
}

export interface BackendResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  text(): string;
  json(): unknown;
}

export interface FulfillOptions {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: string | Buffer | Uint8Array;
  readonly json?: unknown;
  readonly contentType?: string;
  readonly path?: string;
  readonly response?: BackendResponse;
}

export interface ContinueOptions {
  readonly url?: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  readonly postData?: string | Buffer | Uint8Array;
}

export interface FetchOptions extends ContinueOptions {
  readonly timeout?: number;
}

export interface BackendRoute {
  request(): BackendRequest;
  fulfill(options?: FulfillOptions): Promise<void>;
  continue(options?: ContinueOptions): Promise<void>;
  fetch(options?: FetchOptions): Promise<BackendResponse>;
  abort(errorCode?: BackendErrorCode): Promise<void>;
}

export type RouteHandler = (
  route: BackendRoute,
  request: BackendRequest,
) => Promise<void> | void;

export interface RouteFromJSONOptions {
  /**
   * Only record or replay requests whose URL matches this glob or RegExp.
   * When omitted, every request is included.
   */
  readonly url?: string | RegExp;
  /**
   * When `true`, record live upstream traffic into the JSON file instead of
   * serving from it. The file is rewritten when the test fixture disposes.
   */
  readonly update?: boolean;
  /**
   * What to do when a request has no matching entry during replay.
   * Defaults to `"abort"`.
   */
  readonly notFound?: "abort" | "fallback";
}

export interface BackendMocks {
  route(url: RouteMatcherInput, handler: RouteHandler): Promise<void>;
  unroute(url?: RouteMatcherInput, handler?: RouteHandler): Promise<void>;
  /**
   * Record or replay outbound backend requests from a JSON cassette file.
   * Mirrors Playwright's `routeFromHAR` developer experience.
   */
  routeFromJSON(path: string, options?: RouteFromJSONOptions): Promise<void>;
  waitForRequest(
    url: RouteMatcherInput,
    options?: { timeout?: number; method?: string },
  ): Promise<BackendRequest>;
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
    typeof input === "object" && !(input instanceof RegExp) && typeof input !== "function"
      ? normalizeList(input.method)
      : undefined;
  const clientIds =
    typeof input === "object" && !(input instanceof RegExp) && typeof input !== "function"
      ? normalizeList(input.clientId)
      : undefined;

  const methodField =
    methods !== undefined
      ? { methods }
      : methodFilter !== undefined
        ? { methods: [methodFilter] }
        : {};

  const clientField = clientIds !== undefined ? { clientIds } : {};

  if (typeof input === "function") {
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

  if (typeof input.url === "function") {
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
    typeof input.url === "function"
  ) {
    return input.url;
  }
  return undefined;
}

function normalizeList(
  value: string | readonly string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? [value] : [...value];
}
