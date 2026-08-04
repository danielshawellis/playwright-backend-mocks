import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
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
    handleProxyMessage(connection, pending, message);
  });

  interceptor.on("request", async ({ request, requestId, controller }) => {
    if (upstreamBypass.getStore() === true) {
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
      item.resolve();
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
      // Overrides are applied by performing an upstream fetch, then responding.
      // If no overrides, fall through to the real network.
      if (message.overrides === undefined) {
        item.resolve();
        return;
      }
      void performUpstream(item.request, message.overrides)
        .then((response) => {
          item.controller.respondWith(response);
          item.resolve();
        })
        .catch((error: unknown) => {
          item.controller.errorWith(
            error instanceof Error ? error : new Error(String(error)),
          );
          item.resolve();
        });
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
      })
        .then(async (response) => {
          const serialized = await serializeResponse(response);
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
 * Perform an upstream request with continue/fetch overrides.
 * Redirect handling mirrors Playwright APIRequestContext / browser continue:
 * headers persist across hops; url/method/postData apply to the first hop only
 * (method/body rewrite on 301/302/303 per fetch spec).
 * Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/fetch.ts
 */
async function performUpstream(
  original: Request,
  overrides?: RequestOverrides,
  options: { maxRedirects?: number } = {},
): Promise<Response> {
  return upstreamBypass.run(true, async () => {
    // Playwright: maxRedirects ?? 20; 0 → -1 meaning "do not follow".
    let redirectsRemaining = options.maxRedirects ?? 20;
    if (options.maxRedirects === 0) {
      redirectsRemaining = -1;
    }

    let url = overrides?.url ?? original.url;
    let method = overrides?.method ?? original.method;
    const headers = new Headers(
      overrides?.headers ?? normalizeHeaders(original.headers),
    );

    let body: Uint8Array | null = null;
    if (overrides?.bodyBase64 !== undefined) {
      const decoded = decodeBody(overrides.bodyBase64);
      body = decoded === null ? null : new Uint8Array(decoded);
      // Chromium Fetch.continueRequest recalculates Content-Length from postData.
      syncContentLength(headers, body);
    } else if (method.toUpperCase() !== "GET" && method.toUpperCase() !== "HEAD") {
      body = new Uint8Array(await original.clone().arrayBuffer());
    }

    for (;;) {
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
        // Copy into a fresh ArrayBuffer-backed view for DOM BodyInit typings.
        init.body = Uint8Array.from(body);
      }

      const response = await fetch(url, init);

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
        headers.delete("content-encoding");
        headers.delete("content-language");
        headers.delete("content-length");
        headers.delete("content-location");
        headers.delete("content-type");
      }

      if (nextUrl.origin !== new URL(url).origin) {
        headers.delete("authorization");
      }
      headers.set("host", nextUrl.host);

      url = nextUrl.href;
      redirectsRemaining -= 1;
    }
  });
}

function syncContentLength(headers: Headers, body: Uint8Array | null): void {
  if (body === null || body.byteLength === 0) {
    headers.delete("content-length");
  } else {
    headers.set("content-length", String(body.byteLength));
  }
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

async function serializeResponse(response: Response): Promise<SerializedResponse> {
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    statusText: response.statusText,
    headers: normalizeHeaders(response.headers),
    bodyBase64: encodeBody(buffer),
  };
}
