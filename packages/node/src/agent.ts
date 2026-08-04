import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { BatchInterceptor } from "@mswjs/interceptors";
import nodeInterceptors from "@mswjs/interceptors/presets/node";
import {
  decodeBody,
  encodeBody,
  errorFromCode,
  normalizeHeaders,
  serializeError,
  type ProxyToClientMessage,
  type RequestOverrides,
  type SerializedResponse,
} from "@playwright-backend-mocks/protocol";
import { serializeRequest } from "./serialize-request.js";
import { installWebSocketBridge } from "./websocket-bridge.js";
import { connectToProxy, type ProxyConnection } from "./ws-client.js";

export interface StartBackendMocksOptions {
  readonly proxyUrl?: string;
  readonly clientId?: string;
  readonly token?: string;
}

export interface BackendMocksAgent {
  readonly clientId: string;
  stop(): Promise<void>;
}

interface PendingController {
  readonly controller: {
    respondWith(response: Response): void;
    errorWith(error?: Error): void;
  };
  readonly request: Request;
  resolve(): void;
}

const PROXY_URL_ENV = "PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL";
const TOKEN_ENV = "PLAYWRIGHT_BACKEND_MOCKS_TOKEN";

const DISCONNECTED_MESSAGE =
  "Lost connection to the Playwright Backend Mocks proxy. " +
  "Outbound requests cannot be mocked until the agent is restarted against a running proxy.";

/** When true, interceptor listeners pass through without consulting the proxy. */
const upstreamBypass = new AsyncLocalStorage<true>();

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export async function startBackendMocks(
  options: StartBackendMocksOptions = {},
): Promise<BackendMocksAgent> {
  const proxyUrl = options.proxyUrl ?? process.env[PROXY_URL_ENV];
  if (proxyUrl === undefined || proxyUrl.length === 0) {
    return {
      clientId: options.clientId ?? `node-${process.pid}`,
      async stop() {
        /* no-op outside Playwright */
      },
    };
  }

  const clientId = options.clientId ?? `node-${process.pid}`;
  const token = options.token ?? process.env[TOKEN_ENV];

  const connection = await connectToProxy({
    proxyUrl,
    clientId,
    ...(token !== undefined ? { token } : {}),
  });

  const interceptor = new BatchInterceptor({
    name: "playwright-backend-mocks",
    interceptors: nodeInterceptors,
  });

  const pending = new Map<string, PendingController>();
  let stopped = false;

  // DIVERGENCE: App WebSockets only via globalThis.WebSocket (MSW WebSocketInterceptor).
  // Control-plane `ws` package sockets are not patched.
  // DIVERGENCE END
  const wsBridge = installWebSocketBridge(connection);

  const failPending = (message: string) => {
    for (const [id, item] of pending) {
      item.controller.errorWith(new Error(message));
      item.resolve();
      pending.delete(id);
    }
  };

  connection.onClose((reason) => {
    failPending(reason);
  });

  connection.onMessage((message) => {
    if (wsBridge.handleProxyMessage(message)) {
      return;
    }
    handleProxyMessage(connection, pending, message);
  });

  interceptor.on("request", async ({ request, requestId, controller }) => {
    if (upstreamBypass.getStore() === true) {
      return;
    }

    // WebSocket handshakes must not enter the HTTP claim pipeline.
    const upgrade = request.headers.get("upgrade");
    if (upgrade !== null && upgrade.toLowerCase() === "websocket") {
      return;
    }

    // Avoid intercepting traffic to the proxy itself.
    if (isProxyUrl(request.url, proxyUrl)) {
      return;
    }

    if (stopped || !connection.connected) {
      controller.errorWith(new Error(DISCONNECTED_MESSAGE));
      return;
    }

    let serialized;
    try {
      serialized = await serializeRequest(request);
    } catch (error) {
      controller.errorWith(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const id = requestId ?? randomUUID();
    await new Promise<void>((resolve) => {
      pending.set(id, {
        controller,
        request,
        resolve,
      });

      try {
        connection.send({
          type: "request:start",
          requestId: id,
          clientId: connection.clientId,
          request: serialized,
        });
      } catch (error) {
        pending.delete(id);
        controller.errorWith(error instanceof Error ? error : new Error(String(error)));
        resolve();
      }
    });
  });

  interceptor.apply();

  return {
    clientId: connection.clientId,
    async stop() {
      stopped = true;
      wsBridge.dispose();
      interceptor.dispose();
      failPending("Backend mocks agent stopped while a request was pending");
      await connection.close();
    },
  };
}

function isProxyUrl(requestUrl: string, proxyUrl: string): boolean {
  try {
    const request = new URL(requestUrl);
    const proxy = new URL(proxyUrl);
    return request.host === proxy.host;
  } catch {
    return false;
  }
}

function handleProxyMessage(
  connection: ProxyConnection,
  pending: Map<string, PendingController>,
  message: ProxyToClientMessage,
): void {
  switch (message.type) {
    case "decision:passthrough": {
      const item = pending.get(message.requestId);
      if (!item) return;
      pending.delete(message.requestId);
      // Always fetch upstream so we can echo the response for waitForResponse.
      // Equivalent to letting MSW continue, but captures the body for Playwright.
      void settleWithUpstream(connection, message.requestId, item);
      return;
    }
    case "decision:fulfill": {
      const item = pending.get(message.requestId);
      if (!item) return;
      pending.delete(message.requestId);
      item.controller.respondWith(responseFromSerialized(message.response));
      item.resolve();
      return;
    }
    case "decision:continue": {
      const item = pending.get(message.requestId);
      if (!item) return;
      pending.delete(message.requestId);
      // Always perform upstream (with optional overrides) and report the response
      // so waitForResponse can observe continue / network settlements.
      void settleWithUpstream(connection, message.requestId, item, message.overrides);
      return;
    }
    case "decision:abort": {
      const item = pending.get(message.requestId);
      if (!item) return;
      pending.delete(message.requestId);
      item.controller.errorWith(errorFromCode(message.errorCode, message.message));
      item.resolve();
      return;
    }
    case "decision:error": {
      const item = pending.get(message.requestId);
      if (!item) return;
      pending.delete(message.requestId);
      item.controller.errorWith(new Error(message.message));
      item.resolve();
      return;
    }
    case "decision:fetch": {
      const item = pending.get(message.requestId);
      if (!item) return;
      void performUpstream(item.request, message.overrides, {
        maxRedirects: message.maxRedirects,
        maxRetries: message.maxRetries,
      })
        .then(async (response) => {
          const serialized = await serializeResponse(
            response,
            message.overrides?.url ?? item.request.url,
          );
          connection.send({
            type: "fetch:result",
            requestId: message.requestId,
            fetchId: message.fetchId,
            ok: true,
            response: serialized,
          });
        })
        .catch((error: unknown) => {
          connection.send({
            type: "fetch:result",
            requestId: message.requestId,
            fetchId: message.fetchId,
            ok: false,
            error: serializeError(error),
          });
        });
      return;
    }
    default:
      return;
  }
}

/**
 * Continue/passthrough settlement: fetch upstream (following redirects with
 * Playwright hop rules), respond to the app with the final body, and report
 * each hop so waitForResponse / redirectedFrom linking still work.
 *
 * DIVERGENCE: Browser continue lets the page follow redirects as separate
 * intercepted requests. Undici does not preserve continue header overrides on
 * app-level redirect follows after respondWith(302), so we follow inside the
 * agent (headers persist; method/body first-hop only) and emit synthetic
 * request:observe observations for intermediate hops.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts
 */
function settleWithUpstream(
  connection: ProxyConnection,
  requestId: string,
  item: PendingController,
  overrides?: RequestOverrides,
): void {
  void settleContinueWithRedirectHops(connection, requestId, item, overrides);
}

async function settleContinueWithRedirectHops(
  connection: ProxyConnection,
  requestId: string,
  item: PendingController,
  overrides?: RequestOverrides,
): Promise<void> {
  try {
    const result = await performUpstreamWithHopReporting(
      connection,
      requestId,
      item.request,
      overrides,
      {
        // Header overrides replace the set (Playwright continue); use http/https so
        // undici does not re-inject Accept: */* and other fetch defaults.
        exactHeaders: overrides?.headers !== undefined,
        clientId: connection.clientId,
      },
    );
    item.controller.respondWith(responseFromSerialized(result.finalResponse));
    item.resolve();
    try {
      connection.send({
        type: "request:response",
        requestId: result.finalRequestId,
        ok: true,
        response: result.finalResponse,
      });
    } catch {
      // Connection may have closed after the app already received the response.
    }
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    item.controller.errorWith(err);
    item.resolve();
    try {
      connection.send({
        type: "request:response",
        requestId,
        ok: false,
        error: serializeError(error),
      });
    } catch {
      // ignore
    }
  }
}

/**
 * Perform an upstream request with continue/fetch overrides.
 * Redirect handling mirrors Playwright APIRequestContext / browser continue:
 * headers persist across hops; url/method/postData apply to the first hop only
 * (method/body rewrite on 301/302/303 per fetch spec).
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts
 */
async function performUpstream(
  original: Request,
  overrides?: RequestOverrides,
  options: {
    maxRedirects?: number;
    maxRetries?: number;
    exactHeaders?: boolean;
  } = {},
): Promise<Response> {
  return upstreamBypass.run(true, async () => {
    // Playwright: maxRetries ?? 0; retry only ECONNRESET with exponential backoff.
    // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts (_sendRequestWithRetries)
    const maxRetries = options.maxRetries ?? 0;
    let backoff = 250;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await performUpstreamOnce(original, overrides, options);
      } catch (error) {
        if (maxRetries === 0) {
          throw error;
        }
        if (attempt === maxRetries) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed after ${attempt + 1} attempt(s): ${message}`);
        }
        if (!isConnectionResetError(error)) {
          throw error;
        }
        await delay(backoff);
        backoff *= 2;
      }
    }
    throw new Error("Unreachable");
  });
}

/**
 * Continue path: follow redirects while reporting each hop for inspection.
 * Intermediate 302s get request:response on the prior id; the next hop is
 * announced via request:observe so redirectedFrom/To can link.
 */
async function performUpstreamWithHopReporting(
  connection: ProxyConnection,
  initialRequestId: string,
  original: Request,
  overrides: RequestOverrides | undefined,
  options: { exactHeaders?: boolean; clientId: string },
): Promise<{ finalRequestId: string; finalResponse: SerializedResponse }> {
  return upstreamBypass.run(true, async () => {
    let redirectsRemaining = 20;
    let url = overrides?.url ?? original.url;
    let method = overrides?.method ?? original.method;
    const headerRecord = {
      ...(overrides?.headers ?? normalizeHeaders(original.headers)),
    };

    let body: Uint8Array | null = null;
    if (overrides?.bodyBase64 !== undefined) {
      const decoded = decodeBody(overrides.bodyBase64);
      body = decoded === null ? null : new Uint8Array(decoded);
      syncContentLengthRecord(headerRecord, body);
    } else if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
      body = new Uint8Array(await original.clone().arrayBuffer());
    }

    let currentRequestId = initialRequestId;
    let currentUrl = url;

    for (;;) {
      const response = options.exactHeaders
        ? await httpRequestExact(url, method, headerRecord, body)
        : await fetchRequest(url, method, headerRecord, body);

      if (!REDIRECT_STATUS.has(response.status) || redirectsRemaining <= 0) {
        const finalResponse = await serializeResponse(response, currentUrl);
        return { finalRequestId: currentRequestId, finalResponse };
      }

      const locationHeader = response.headers.get("location");
      if (locationHeader === null || locationHeader.length === 0) {
        const finalResponse = await serializeResponse(response, currentUrl);
        return { finalRequestId: currentRequestId, finalResponse };
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(locationHeader, url);
      } catch {
        throw new Error(
          `uri requested responds with an invalid redirect URL: ${locationHeader}`,
        );
      }

      // Report the redirect response on this hop, then observe the next hop.
      const redirectSerialized = await serializeResponse(response, currentUrl);
      try {
        connection.send({
          type: "request:response",
          requestId: currentRequestId,
          ok: true,
          response: redirectSerialized,
        });
      } catch {
        // ignore
      }

      await response.arrayBuffer().catch(() => undefined);

      const status = response.status;
      const upperMethod = method.toUpperCase();
      if (
        ((status === 301 || status === 302) && upperMethod === "POST") ||
        (status === 303 && upperMethod !== "GET" && upperMethod !== "HEAD")
      ) {
        method = "GET";
        body = null;
        deleteHeaderRecord(headerRecord, "content-encoding");
        deleteHeaderRecord(headerRecord, "content-language");
        deleteHeaderRecord(headerRecord, "content-length");
        deleteHeaderRecord(headerRecord, "content-location");
        deleteHeaderRecord(headerRecord, "content-type");
      }

      if (nextUrl.origin !== new URL(url).origin) {
        deleteHeaderRecord(headerRecord, "authorization");
      }
      headerRecord.host = nextUrl.host;

      url = nextUrl.href;
      currentUrl = url;
      currentRequestId = randomUUID();
      try {
        connection.send({
          type: "request:observe",
          requestId: currentRequestId,
          clientId: options.clientId,
          request: {
            url,
            method,
            headers: { ...headerRecord },
            bodyBase64: encodeBody(body === null ? null : Buffer.from(body)),
          },
        });
      } catch {
        // ignore
      }

      redirectsRemaining -= 1;
    }
  });
}

async function performUpstreamOnce(
  original: Request,
  overrides: RequestOverrides | undefined,
  options: { maxRedirects?: number; exactHeaders?: boolean },
): Promise<Response> {
  // Playwright: maxRedirects ?? 20; 0 → -1 meaning "do not follow".
  let redirectsRemaining = options.maxRedirects ?? 20;
  if (options.maxRedirects === 0) {
    redirectsRemaining = -1;
  }

  let url = overrides?.url ?? original.url;
  let method = overrides?.method ?? original.method;
  const headerRecord = {
    ...(overrides?.headers ?? normalizeHeaders(original.headers)),
  };

  let body: Uint8Array | null = null;
  if (overrides?.bodyBase64 !== undefined) {
    const decoded = decodeBody(overrides.bodyBase64);
    body = decoded === null ? null : new Uint8Array(decoded);
    // Chromium Fetch.continueRequest recalculates Content-Length from postData.
    syncContentLengthRecord(headerRecord, body);
  } else if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
    body = new Uint8Array(await original.clone().arrayBuffer());
  }

  for (;;) {
    const response = options.exactHeaders
      ? await httpRequestExact(url, method, headerRecord, body)
      : await fetchRequest(url, method, headerRecord, body);

    if (!REDIRECT_STATUS.has(response.status) || redirectsRemaining < 0) {
      return response;
    }
    if (redirectsRemaining === 0) {
      throw new Error("Max redirect count exceeded");
    }

    const locationHeader = response.headers.get("location");
    if (locationHeader === null || locationHeader.length === 0) {
      return response;
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(locationHeader, url);
    } catch {
      throw new Error(
        `uri requested responds with an invalid redirect URL: ${locationHeader}`,
      );
    }

    // Drain the redirect body so the socket can be reused.
    await response.arrayBuffer().catch(() => undefined);

    const status = response.status;
    const upperMethod = method.toUpperCase();
    if (
      ((status === 301 || status === 302) && upperMethod === "POST") ||
      (status === 303 && upperMethod !== "GET" && upperMethod !== "HEAD")
    ) {
      method = "GET";
      body = null;
      deleteHeaderRecord(headerRecord, "content-encoding");
      deleteHeaderRecord(headerRecord, "content-language");
      deleteHeaderRecord(headerRecord, "content-length");
      deleteHeaderRecord(headerRecord, "content-location");
      deleteHeaderRecord(headerRecord, "content-type");
    }

    if (nextUrl.origin !== new URL(url).origin) {
      deleteHeaderRecord(headerRecord, "authorization");
    }
    headerRecord.host = nextUrl.host;

    url = nextUrl.href;
    redirectsRemaining -= 1;
  }
}

async function fetchRequest(
  url: string,
  method: string,
  headerRecord: Record<string, string>,
  body: Uint8Array | null,
): Promise<Response> {
  const headers = new Headers(headerRecord);
  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };
  if (
    body !== null &&
    method.toUpperCase() !== "GET" &&
    method.toUpperCase() !== "HEAD"
  ) {
    init.body = Uint8Array.from(body);
  }
  return fetch(url, init);
}

/**
 * node:http/https request with exact header set — no undici fetch default headers
 * (Accept star-slash-star, etc.). Used for continue() header replacement parity
 * with Chromium Fetch.continueRequest.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts
 */
function httpRequestExact(
  url: string,
  method: string,
  headerRecord: Record<string, string>,
  body: Uint8Array | null,
): Promise<Response> {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const headers: Record<string, string> = { ...headerRecord };
  if (!hasHeaderRecord(headers, "host")) {
    headers.host = parsed.host;
  }

  const canHaveBody =
    body !== null &&
    method.toUpperCase() !== "GET" &&
    method.toUpperCase() !== "HEAD";

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const entry of value) {
                responseHeaders.append(name, entry);
              }
            } else {
              responseHeaders.set(name, value);
            }
          }
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers: responseHeaders,
            }),
          );
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (canHaveBody && body !== null) {
      req.write(body);
    }
    req.end();
  });
}

function syncContentLengthRecord(
  headers: Record<string, string>,
  body: Uint8Array | null,
): void {
  deleteHeaderRecord(headers, "content-length");
  if (body !== null && body.byteLength > 0) {
    headers["content-length"] = String(body.byteLength);
  }
}

function deleteHeaderRecord(headers: Record<string, string>, name: string): void {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      delete headers[key];
    }
  }
}

function hasHeaderRecord(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/**
 * Whether an upstream failure is a transient connection reset worth retrying.
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts (_sendRequestWithRetries)
 */
function isConnectionResetError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (typeof current === "object" && current !== null) {
      const code = "code" in current ? (current as { code?: unknown }).code : undefined;
      // Playwright retries ECONNRESET (also treats EPIPE/ECONNABORTED as network).
      if (code === "ECONNRESET" || code === "EPIPE" || code === "ECONNABORTED") {
        return true;
      }
      // DIVERGENCE: undici fetch surfaces socket destroy as UND_ERR_SOCKET /
      // "other side closed" rather than Node http's ECONNRESET.
      if (code === "UND_ERR_SOCKET") {
        return true;
      }
      const message =
        current instanceof Error
          ? current.message
          : "message" in current && typeof (current as { message?: unknown }).message === "string"
            ? (current as { message: string }).message
            : "";
      if (/other side closed/i.test(message)) {
        return true;
      }
      // DIVERGENCE END
      if (/ECONNRESET/i.test(message)) {
        return true;
      }
    }
    if (typeof current === "object" && current !== null && "cause" in current) {
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseFromSerialized(response: SerializedResponse): Response {
  const decoded = decodeBody(response.bodyBase64);
  const body = decoded === null ? null : Uint8Array.from(decoded);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function serializeResponse(
  response: Response,
  fallbackUrl?: string,
): Promise<SerializedResponse> {
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    statusText: response.statusText,
    headers: normalizeHeaders(response.headers),
    bodyBase64: encodeBody(buffer),
    // node:http-backed Response has an empty url; prefer the request URL.
    url: response.url || fallbackUrl || "",
  };
}
