import type {
  BackendErrorCode,
  SerializedMatcher,
} from "@playwright-backend-mocks/protocol";

export type RouteUrl = string | RegExp;

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

export interface BackendMocks {
  route(url: RouteMatcherInput, handler: RouteHandler): Promise<void>;
  unroute(url?: RouteMatcherInput, handler?: RouteHandler): Promise<void>;
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
    typeof input === "object" && !(input instanceof RegExp)
      ? normalizeList(input.method)
      : undefined;
  const clientIds =
    typeof input === "object" && !(input instanceof RegExp)
      ? normalizeList(input.clientId)
      : undefined;

  const methodField =
    methods !== undefined
      ? { methods }
      : methodFilter !== undefined
        ? { methods: [methodFilter] }
        : {};

  const clientField = clientIds !== undefined ? { clientIds } : {};

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

function normalizeList(
  value: string | readonly string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" ? [value] : [...value];
}
