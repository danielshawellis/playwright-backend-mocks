import {
  historyResponse,
  type HistoryEntry,
  type WsConnectionEntry,
} from "@playwright-backend-mocks/protocol";

export interface ObservabilityQuery {
  readonly q?: string;
  readonly from?: number;
  readonly to?: number;
  readonly testId?: string;
  readonly clientId?: string;
  readonly action?: string;
  readonly limit?: number;
  readonly offset?: number;
}

function decodeBody(bodyBase64: string | null | undefined): string {
  if (bodyBase64 === null || bodyBase64 === undefined || bodyBase64 === "") {
    return "";
  }
  try {
    return Buffer.from(bodyBase64, "base64").toString("utf8");
  } catch {
    return bodyBase64;
  }
}

function includesInsensitive(haystack: string | undefined, needle: string): boolean {
  if (haystack === undefined) {
    return false;
  }
  return haystack.toLowerCase().includes(needle);
}

function scoreHttp(entry: HistoryEntry, needle: string): number {
  const q = needle.toLowerCase();
  if (includesInsensitive(entry.request.url, q)) {
    return 100;
  }
  if (
    includesInsensitive(entry.request.method, q) ||
    includesInsensitive(entry.action, q) ||
    includesInsensitive(entry.title, q) ||
    includesInsensitive(entry.path, q) ||
    includesInsensitive(entry.testId, q) ||
    includesInsensitive(entry.outcome.kind, q)
  ) {
    return 70;
  }
  const response = historyResponse(entry);
  if (response !== undefined && includesInsensitive(String(response.status), q)) {
    return 70;
  }
  const headerBlob = Object.entries(entry.request.headers)
    .map(([k, v]) => `${k}:${v}`)
    .join("\n");
  if (includesInsensitive(headerBlob, q)) {
    return 40;
  }
  if (response !== undefined) {
    const responseHeaders = Object.entries(response.headers)
      .map(([k, v]) => `${k}:${v}`)
      .join("\n");
    if (includesInsensitive(responseHeaders, q)) {
      return 40;
    }
    if (includesInsensitive(decodeBody(response.bodyBase64), q)) {
      return 20;
    }
  }
  if (includesInsensitive(decodeBody(entry.request.bodyBase64), q)) {
    return 20;
  }
  for (const event of entry.events ?? []) {
    if (includesInsensitive(event.kind, q) || includesInsensitive(event.detail, q)) {
      return 20;
    }
  }
  return 0;
}

function scoreWs(entry: WsConnectionEntry, needle: string): number {
  const q = needle.toLowerCase();
  if (includesInsensitive(entry.url, q)) {
    return 100;
  }
  if (
    includesInsensitive(entry.outcome, q) ||
    includesInsensitive(entry.title, q) ||
    includesInsensitive(entry.path, q) ||
    includesInsensitive(entry.testId, q) ||
    includesInsensitive(entry.clientId, q)
  ) {
    return 70;
  }
  for (const event of entry.events) {
    if (
      includesInsensitive(event.kind, q) ||
      includesInsensitive(event.detail, q) ||
      includesInsensitive(event.data, q)
    ) {
      return 20;
    }
  }
  return 0;
}

function inTimeRange(timestamp: number, from?: number, to?: number): boolean {
  if (from !== undefined && timestamp < from) {
    return false;
  }
  if (to !== undefined && timestamp > to) {
    return false;
  }
  return true;
}

function paginate<T>(items: T[], limit?: number, offset?: number): T[] {
  const start = offset ?? 0;
  if (limit === undefined) {
    return items.slice(start);
  }
  return items.slice(start, start + limit);
}

export function filterHistory(
  entries: readonly HistoryEntry[],
  query: ObservabilityQuery,
): HistoryEntry[] {
  let filtered = entries.filter((entry) => {
    if (!inTimeRange(entry.timestamp, query.from, query.to)) {
      return false;
    }
    if (query.testId !== undefined && entry.testId !== query.testId) {
      return false;
    }
    if (query.clientId !== undefined && entry.clientId !== query.clientId) {
      return false;
    }
    if (query.action !== undefined && entry.action !== query.action) {
      return false;
    }
    return true;
  });

  const needle = query.q?.trim();
  if (needle) {
    filtered = filtered
      .map((entry) => ({ entry, score: scoreHttp(entry, needle) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp)
      .map((row) => row.entry);
  } else {
    filtered = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
  }

  return paginate(filtered, query.limit, query.offset);
}

export function filterWsConnections(
  entries: readonly WsConnectionEntry[],
  query: ObservabilityQuery,
): WsConnectionEntry[] {
  let filtered = entries.filter((entry) => {
    if (!inTimeRange(entry.timestamp, query.from, query.to)) {
      return false;
    }
    if (query.testId !== undefined && entry.testId !== query.testId) {
      return false;
    }
    if (query.clientId !== undefined && entry.clientId !== query.clientId) {
      return false;
    }
    if (query.action !== undefined && entry.outcome !== query.action) {
      return false;
    }
    return true;
  });

  const needle = query.q?.trim();
  if (needle) {
    filtered = filtered
      .map((entry) => ({ entry, score: scoreWs(entry, needle) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp)
      .map((row) => row.entry);
  } else {
    filtered = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
  }

  return paginate(filtered, query.limit, query.offset);
}

export function parseObservabilityQuery(url: URL): ObservabilityQuery {
  const q = url.searchParams.get("q") ?? undefined;
  const testId = url.searchParams.get("testId") ?? undefined;
  const clientId = url.searchParams.get("clientId") ?? undefined;
  const action = url.searchParams.get("action") ?? undefined;
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const limitRaw = url.searchParams.get("limit");
  const offsetRaw = url.searchParams.get("offset");

  const from = fromRaw !== null ? Number(fromRaw) : undefined;
  const to = toRaw !== null ? Number(toRaw) : undefined;
  const limit = limitRaw !== null ? Number(limitRaw) : undefined;
  const offset = offsetRaw !== null ? Number(offsetRaw) : undefined;

  return {
    ...(q !== undefined && q !== "" ? { q } : {}),
    ...(testId !== undefined ? { testId } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
    ...(action !== undefined ? { action } : {}),
    ...(from !== undefined && Number.isFinite(from) ? { from } : {}),
    ...(to !== undefined && Number.isFinite(to) ? { to } : {}),
    ...(limit !== undefined && Number.isInteger(limit) && limit >= 0 ? { limit } : {}),
    ...(offset !== undefined && Number.isInteger(offset) && offset >= 0
      ? { offset }
      : {}),
  };
}
