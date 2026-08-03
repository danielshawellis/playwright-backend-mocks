import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  decodeBody,
  decodeBodyText,
  encodeBody,
  normalizeHeaders,
  type HistoryEntry,
  type ProxyToClientMessage,
  type RequestOverrides,
  type SerializedRequest,
  type SerializedResponse,
} from "@playwright-backend-mocks/protocol";
import type { PlaywrightProxyConnection } from "./connection.js";
import { matchRouteMatcher } from "./match.js";
import {
  createRouteFromJSONSession,
  flushRouteFromJSONSession,
  type RouteFromJSONSession,
} from "./route-from-json.js";
import {
  getRouteUrlPredicate,
  toSerializedMatcher,
  type BackendMocks,
  type BackendRequest,
  type BackendResponse,
  type BackendRoute,
  type ContinueOptions,
  type FetchOptions,
  type FulfillOptions,
  type RouteFromJSONOptions,
  type RouteHandler,
  type RouteMatcherInput,
} from "./types.js";

interface RouteRecord {
  readonly routeId: string;
  readonly matcherInput: RouteMatcherInput;
  readonly handler: RouteHandler;
}

interface PendingFetch {
  resolve(response: BackendResponse): void;
  reject(error: Error): void;
}

export interface BackendMocksController extends BackendMocks {
  dispose(): void;
}

export function createBackendMocks(options: {
  connection: PlaywrightProxyConnection;
  testId: string;
}): BackendMocksController {
  const { connection, testId } = options;
  const routes: RouteRecord[] = [];
  const pendingFetches = new Map<string, PendingFetch>();
  const observed: BackendRequest[] = [];
  const errors: Error[] = [];
  const jsonSessions: RouteFromJSONSession[] = [];

  const unsubscribe = connection.onMessage((message) => {
    void handleMessage(message);
  });

  async function handleMessage(message: ProxyToClientMessage): Promise<void> {
    switch (message.type) {
      case "request:claim": {
        if (routes.length === 0) {
          return;
        }
        const matches: Array<{ routeId: string }> = [];
        for (const route of routes) {
          if (
            matchRouteMatcher(route.matcherInput, {
              request: message.request,
              clientId: message.clientId,
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
      case "request:matched": {
        if (message.testId !== testId) {
          return;
        }
        const route = routes.find((item) => item.routeId === message.routeId);
        if (route === undefined) {
          connection.send({
            type: "handler:result",
            requestId: message.requestId,
            result: {
              action: "abort",
              errorCode: "failed",
              message: `No local handler for route ${message.routeId}`,
            },
          });
          return;
        }

        const request = toBackendRequest(message.request, message.clientId);
        observed.push(request);
        const routeApi = createRouteApi(message.requestId, request);

        try {
          await route.handler(routeApi, request);
          if (!routeApi.isSettled()) {
            throw new Error(
              "Backend route handler finished without calling fulfill(), continue(), or abort()",
            );
          }
        } catch (error) {
          if (!routeApi.isSettled()) {
            connection.send({
              type: "handler:result",
              requestId: message.requestId,
              result: {
                action: "abort",
                errorCode: "failed",
                message: error instanceof Error ? error.message : String(error),
              },
            });
          }
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
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
        waiter.resolve(toBackendResponse(message.response));
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

  function createRouteApi(
    requestId: string,
    request: BackendRequest,
  ): BackendRoute & { isSettled(): boolean } {
    let settled = false;

    const markSettled = () => {
      if (settled) {
        throw new Error("Backend route already settled");
      }
      settled = true;
    };

    return {
      request: () => request,
      isSettled: () => settled,
      async fulfill(options: FulfillOptions = {}) {
        markSettled();
        const response = await buildFulfillResponse(options);
        connection.send({
          type: "handler:result",
          requestId,
          result: {
            action: "fulfill",
            response,
          },
        });
      },
      async continue(options: ContinueOptions = {}) {
        markSettled();
        const overrides = toOverrides(options);
        connection.send({
          type: "handler:result",
          requestId,
          result: {
            action: "continue",
            ...(overrides !== undefined ? { overrides } : {}),
          },
        });
      },
      async fetch(options: FetchOptions = {}) {
        // fetch is non-terminal
        const fetchId = randomUUID();
        const overrides = toOverrides(options);
        const responsePromise = new Promise<BackendResponse>((resolve, reject) => {
          pendingFetches.set(fetchId, { resolve, reject });
          const timeout = options.timeout ?? 30_000;
          setTimeout(() => {
            if (pendingFetches.delete(fetchId)) {
              reject(new Error(`route.fetch timed out after ${timeout}ms`));
            }
          }, timeout);
        });

        connection.send({
          type: "handler:result",
          requestId,
          result: {
            action: "fetch",
            fetchId,
            ...(overrides !== undefined ? { overrides } : {}),
          },
        });

        return responsePromise;
      },
      async abort(errorCode = "failed") {
        markSettled();
        connection.send({
          type: "handler:result",
          requestId,
          result: {
            action: "abort",
            errorCode,
          },
        });
      },
    };
  }

  const api: BackendMocksController = {
    async route(url, handler) {
      const routeId = randomUUID();
      routes.push({ routeId, matcherInput: url, handler });
      connection.send({
        type: "route:register",
        routeId,
        testId,
        matcher: toSerializedMatcher(url),
      });
    },

    async unroute(url, handler) {
      const remaining: RouteRecord[] = [];
      for (const route of routes) {
        const urlMatches = url === undefined || matcherEquals(route.matcherInput, url);
        const handlerMatches = handler === undefined || route.handler === handler;
        if (urlMatches && handlerMatches) {
          connection.send({
            type: "route:unregister",
            routeId: route.routeId,
          });
        } else {
          remaining.push(route);
        }
      }
      routes.length = 0;
      routes.push(...remaining);
    },

    async routeFromJSON(filePath, options: RouteFromJSONOptions = {}) {
      const session = createRouteFromJSONSession(filePath, options);
      jsonSessions.push(session);
      await api.route(session.matcher, session.handler);
    },

    async waitForRequest(url, options = {}) {
      const timeout = options.timeout ?? 30_000;
      const started = Date.now();

      while (Date.now() - started < timeout) {
        const found = observed.find((request) =>
          matchRouteMatcher(
            url,
            {
              request: {
                url: request.url,
                method: request.method,
                headers: { ...request.headers },
                bodyBase64: encodeBody(request.postDataBuffer),
              },
              clientId: request.clientId,
            },
            options.method,
          ),
        );
        if (found) {
          return found;
        }
        await delay(25);
      }

      throw new Error(
        `Timed out waiting for backend request matching ${describeMatcher(url, options.method)}`,
      );
    },

    async requests(url) {
      if (url === undefined) {
        return [...observed];
      }
      return observed.filter((request) =>
        matchRouteMatcher(url, {
          request: {
            url: request.url,
            method: request.method,
            headers: { ...request.headers },
            bodyBase64: encodeBody(request.postDataBuffer),
          },
          clientId: request.clientId,
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
    },
  };

  return api;
}

function matcherEquals(a: RouteMatcherInput, b: RouteMatcherInput): boolean {
  if (a === b) {
    return true;
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
  if (typeof input === "function") {
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
  if (getRouteUrlPredicate(input) !== undefined) {
    const serialized = toSerializedMatcher(input, methodFilter);
    return `predicate${serialized.methods ? ` methods=${serialized.methods.join(",")}` : ""}`;
  }
  return JSON.stringify(toSerializedMatcher(input, methodFilter));
}

function toBackendRequest(request: SerializedRequest, clientId: string): BackendRequest {
  const buffer = decodeBody(request.bodyBase64);
  const postData = decodeBodyText(request.bodyBase64);
  return {
    url: request.url,
    method: request.method,
    headers: request.headers,
    postData,
    postDataBuffer: buffer,
    clientId,
    json() {
      if (postData === null) {
        return null;
      }
      return JSON.parse(postData) as unknown;
    },
  };
}

function toBackendResponse(response: SerializedResponse): BackendResponse {
  const body = decodeBody(response.bodyBase64) ?? Buffer.alloc(0);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    body,
    text() {
      return body.toString("utf8");
    },
    json() {
      return JSON.parse(body.toString("utf8")) as unknown;
    },
  };
}

async function buildFulfillResponse(
  options: FulfillOptions,
): Promise<SerializedResponse> {
  if (options.response !== undefined) {
    const headers = stripBodyLengthHeaders({
      ...options.response.headers,
      ...options.headers,
    });
    let body = options.response.body;
    if (options.json !== undefined) {
      body = Buffer.from(JSON.stringify(options.json), "utf8");
      headers["content-type"] = headers["content-type"] ?? "application/json";
    } else if (options.body !== undefined) {
      body = toBuffer(options.body);
    }
    if (options.contentType !== undefined) {
      headers["content-type"] = options.contentType;
    }
    return {
      status: options.status ?? options.response.status,
      statusText: options.response.statusText,
      headers: normalizeHeaders(headers),
      bodyBase64: encodeBody(body),
    };
  }

  const headers = stripBodyLengthHeaders({ ...options.headers });
  let body: Buffer | null = null;

  if (options.json !== undefined) {
    body = Buffer.from(JSON.stringify(options.json), "utf8");
    headers["content-type"] = headers["content-type"] ?? "application/json";
  } else if (options.path !== undefined) {
    body = await readFile(options.path);
  } else if (options.body !== undefined) {
    body = toBuffer(options.body);
  }

  if (options.contentType !== undefined) {
    headers["content-type"] = options.contentType;
  }

  return {
    status: options.status ?? 200,
    statusText: "",
    headers: normalizeHeaders(headers),
    bodyBase64: encodeBody(body),
  };
}

function stripBodyLengthHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    const lower = key.toLowerCase();
    if (lower === "content-length" || lower === "transfer-encoding") {
      continue;
    }
    result[key] = value;
  }
  return result;
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

  return {
    ...(options.url !== undefined ? { url: options.url } : {}),
    ...(options.method !== undefined ? { method: options.method } : {}),
    ...(options.headers !== undefined
      ? { headers: normalizeHeaders(options.headers) }
      : {}),
    ...(options.postData !== undefined
      ? { bodyBase64: encodeBody(toBuffer(options.postData)) }
      : {}),
  };
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
