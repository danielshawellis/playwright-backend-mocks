import {
  historyResponse,
  type HistoryEntry,
  type WsConnectionEntry,
} from "@playwright-backend-mocks/protocol";

export interface RuntimeConfig {
  readonly proxyUrl: string;
}

export interface ConnectionsResponse {
  readonly nodeAgents: Array<{ clientId: string; connectionId: string }>;
  readonly playwrightWorkers: Array<{
    clientId: string;
    connectionId: string;
    workerId?: string;
    testCount: number;
    routeCount: number;
  }>;
}

export interface HistoryQuery {
  readonly q?: string;
  readonly from?: string;
  readonly to?: string;
}

function buildQuery(params: HistoryQuery): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.from) {
    const ms = Date.parse(params.from);
    if (!Number.isNaN(ms)) search.set("from", String(ms));
  }
  if (params.to) {
    const ms = Date.parse(params.to);
    if (!Number.isNaN(ms)) search.set("to", String(ms));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch("./config.json");
  if (!response.ok) {
    throw new Error(`Failed to load config.json (${response.status})`);
  }
  return (await response.json()) as RuntimeConfig;
}

export async function fetchHistory(
  proxyUrl: string,
  query: HistoryQuery = {},
): Promise<HistoryEntry[]> {
  const response = await fetch(`${proxyUrl}/api/history${buildQuery(query)}`);
  if (!response.ok) {
    throw new Error(`GET /api/history failed (${response.status})`);
  }
  const body = (await response.json()) as { entries: HistoryEntry[] };
  return body.entries;
}

export async function fetchWsConnections(
  proxyUrl: string,
  query: HistoryQuery = {},
): Promise<WsConnectionEntry[]> {
  const response = await fetch(`${proxyUrl}/api/ws${buildQuery(query)}`);
  if (!response.ok) {
    throw new Error(`GET /api/ws failed (${response.status})`);
  }
  const body = (await response.json()) as { connections: WsConnectionEntry[] };
  return body.connections;
}

export async function fetchConnections(proxyUrl: string): Promise<ConnectionsResponse> {
  const response = await fetch(`${proxyUrl}/api/connections`);
  if (!response.ok) {
    throw new Error(`GET /api/connections failed (${response.status})`);
  }
  return (await response.json()) as ConnectionsResponse;
}

/** Single-request HAR for use with Playwright `routeFromHAR`. */
export function harDownloadUrl(proxyUrl: string, requestId: string): string {
  return `${proxyUrl}/api/history/${encodeURIComponent(requestId)}/har`;
}

/** HAR is only useful when a response was recorded (fulfill, or continue/passthrough with upstream). */
export function historyEntryHasExportableHar(entry: HistoryEntry): boolean {
  return historyResponse(entry) !== undefined;
}

export function decodeBody(bodyBase64: string | null | undefined): string {
  if (bodyBase64 === null || bodyBase64 === undefined || bodyBase64 === "") {
    return "";
  }
  try {
    return atob(bodyBase64);
  } catch {
    return bodyBase64;
  }
}

export function prettyBody(bodyBase64: string | null | undefined): string {
  const text = decodeBody(bodyBase64);
  if (!text) return "(empty)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
