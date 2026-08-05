import {
  historyResponse,
  PACKAGE_VERSION,
  type HistoryEntry,
} from "@playwright-backend-mocks/protocol";

interface HarHeader {
  name: string;
  value: string;
}

function headersToHar(headers: Record<string, string>): HarHeader[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function decodeBody(bodyBase64: string | null | undefined): {
  text?: string;
  encoding?: string;
  size: number;
} {
  if (bodyBase64 === null || bodyBase64 === undefined) {
    return { size: 0 };
  }
  const buffer = Buffer.from(bodyBase64, "base64");
  try {
    const text = buffer.toString("utf8");
    // Round-trip check for binary-looking content.
    if (Buffer.from(text, "utf8").equals(buffer)) {
      return { text, size: buffer.length };
    }
  } catch {
    // fall through
  }
  return { text: bodyBase64, encoding: "base64", size: buffer.length };
}

function redirectUrlFromResponse(
  response: { headers: Record<string, string> } | null | undefined,
): string {
  if (response === undefined || response === null) {
    return "";
  }
  return response.headers["location"] ?? response.headers["Location"] ?? "";
}

/** True when the entry has a response usable with `routeFromHAR`. */
export function historyEntryHasExportableHar(entry: HistoryEntry): boolean {
  return historyResponse(entry) !== undefined;
}

/**
 * Build a single-entry HAR 1.2 document suitable for Playwright `routeFromHAR`.
 * Omits observability-only fields so the file stays a plain HTTP archive.
 * One hop per download — walk `redirectedToId` for the rest of a redirect chain.
 */
export function historyEntryToHar(entry: HistoryEntry): unknown {
  const requestBody = decodeBody(entry.request.bodyBase64);
  const response = historyResponse(entry) ?? null;
  const responseBody = decodeBody(response?.bodyBase64 ?? null);
  const mimeType =
    response?.headers["content-type"] ??
    response?.headers["Content-Type"] ??
    "application/octet-stream";
  const requestMime =
    entry.request.headers["content-type"] ??
    entry.request.headers["Content-Type"] ??
    "application/octet-stream";

  const harEntry = {
    startedDateTime: new Date(entry.timestamp).toISOString(),
    time: entry.durationMs ?? 0,
    request: {
      method: entry.request.method,
      url: entry.request.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(entry.request.headers),
      queryString: [],
      headersSize: -1,
      bodySize: requestBody.size,
      ...(requestBody.size > 0
        ? {
            postData: {
              mimeType: requestMime,
              text: requestBody.text ?? "",
              ...(requestBody.encoding !== undefined
                ? { encoding: requestBody.encoding }
                : {}),
            },
          }
        : {}),
    },
    response: {
      status: response?.status ?? 0,
      statusText: response?.statusText ?? "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(response?.headers ?? {}),
      content: {
        size: responseBody.size,
        mimeType,
        ...(responseBody.text !== undefined ? { text: responseBody.text } : {}),
        ...(responseBody.encoding !== undefined
          ? { encoding: responseBody.encoding }
          : {}),
      },
      redirectURL: redirectUrlFromResponse(response),
      headersSize: -1,
      bodySize: responseBody.size,
      ...(entry.outcome.kind === "aborted"
        ? { _failureText: entry.outcome.errorCode }
        : {}),
      ...(entry.outcome.kind === "error" ? { _failureText: entry.outcome.message } : {}),
    },
    cache: {},
    timings: {
      send: 0,
      wait: entry.durationMs ?? 0,
      receive: 0,
    },
  };

  return {
    log: {
      version: "1.2",
      creator: {
        name: "playwright-backend-mocks",
        version: PACKAGE_VERSION,
      },
      entries: [harEntry],
    },
  };
}
