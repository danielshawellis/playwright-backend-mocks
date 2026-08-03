export const UPSTREAM = "http://127.0.0.1:4001";
export const HARNESS = "http://127.0.0.1:3000";
export const WS_UPSTREAM = "ws://127.0.0.1:4002";

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
      data: unknown;
      error?: undefined;
    }
  | {
      ok: false;
      error: string;
      status?: undefined;
      statusText?: undefined;
      headers?: undefined;
      raw?: undefined;
      data?: undefined;
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
