export const UPSTREAM = "http://127.0.0.1:4001";
export const HARNESS = "http://127.0.0.1:3000";
export const WS_UPSTREAM = "ws://127.0.0.1:4002";
export const WS_UPSTREAM_HTTP = "http://127.0.0.1:4002";
/** Node downstream HTTP + control-plane WebSocket host. */
export const NODE_DOWNSTREAM = "http://127.0.0.1:3001";
export const NODE_CONTROL_WS = "ws://127.0.0.1:3001/control";

export const ABORT_CODES = [
  "aborted",
  "accessdenied",
  "addressunreachable",
  "blockedbyclient",
  "blockedbyresponse",
  "connectionaborted",
  "connectionclosed",
  "connectionfailed",
  "connectionrefused",
  "connectionreset",
  "internetdisconnected",
  "namenotresolved",
  "timedout",
  "failed",
] as const;

export type AbortCode = (typeof ABORT_CODES)[number];

export type TriggerResult =
  | {
      ok: boolean;
      status: number;
      statusText: string;
      headers: Record<string, string>;
      raw: string;
      /** Raw response bytes as base64 (portable binary assertions). */
      bodyBase64: string;
      data: unknown;
      error?: undefined;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      statusText?: string;
      headers?: Record<string, string>;
      raw?: string;
      bodyBase64?: string;
      data?: unknown;
    };

export function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

/** Decode a trigger bodyBase64 payload to a Buffer. */
export function bodyFromBase64(bodyBase64: string | undefined): Buffer {
  return Buffer.from(bodyBase64 ?? "", "base64");
}

/** Small delay helper for stall / race assertions (not a Playwright page API). */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
