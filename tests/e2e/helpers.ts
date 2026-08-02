import type { APIRequestContext, APIResponse } from "@playwright/test";

export const TRANSPORTS = ["fetch", "http"] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const UPSTREAM = "http://127.0.0.1:4001";
export const APP_URL = "http://127.0.0.1:3000";
export const WORKER_URL = "http://127.0.0.1:3001";

export const ABORT_CODES = [
  "failed",
  "aborted",
  "timedout",
  "connectionrefused",
  "connectionreset",
  "namenotresolved",
] as const;

export async function callVia(
  request: APIRequestContext,
  transport: Transport,
  upstreamPath: string,
  options: {
    method?: "GET" | "POST";
    data?: unknown;
    headers?: Record<string, string>;
    /** Defaults to the api-server app URL. Use WORKER_URL for the second process. */
    origin?: string;
  } = {},
): Promise<APIResponse> {
  const method = options.method ?? "GET";
  const origin = options.origin ?? APP_URL;
  const url = new URL(`/via/${transport}${upstreamPath}`, origin).toString();
  const init = {
    headers: {
      "content-type": "application/json",
      ...options.headers,
    },
  };

  if (method === "POST") {
    return request.post(url, { ...init, data: options.data });
  }
  return request.get(url, init);
}

export async function readProxyJson(response: APIResponse) {
  return (await response.json()) as {
    transport?: string;
    clientId?: string;
    status?: number;
    headers?: Record<string, string | string[] | undefined>;
    data?: unknown;
    raw?: string;
    error?: string;
    message?: string;
  };
}

export function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) {
    return direct[0];
  }
  return direct;
}
