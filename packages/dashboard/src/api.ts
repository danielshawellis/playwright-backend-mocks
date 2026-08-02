import type { HistoryEntry } from "@playwright-backend-mocks/protocol";

export interface DashboardRuntimeConfig {
  readonly proxyUrl: string;
}

export interface ConnectionsResponse {
  readonly nodeAgents: Array<{
    readonly clientId: string;
    readonly connectionId: string;
  }>;
  readonly playwrightWorkers: Array<{
    readonly clientId: string;
    readonly connectionId: string;
    readonly workerId?: string;
    readonly testCount: number;
    readonly routeCount: number;
  }>;
}

export interface HistoryResponse {
  readonly entries: HistoryEntry[];
}

export async function loadRuntimeConfig(): Promise<DashboardRuntimeConfig> {
  const response = await fetch("/config.json");
  if (!response.ok) {
    throw new Error(`Failed to load dashboard config (${response.status})`);
  }
  return (await response.json()) as DashboardRuntimeConfig;
}

export async function fetchHistory(proxyUrl: string): Promise<HistoryEntry[]> {
  const response = await fetch(`${proxyUrl}/api/history`);
  if (!response.ok) {
    throw new Error(`GET /api/history failed (${response.status})`);
  }
  const body = (await response.json()) as HistoryResponse;
  return body.entries ?? [];
}

export async function fetchConnections(proxyUrl: string): Promise<ConnectionsResponse> {
  const response = await fetch(`${proxyUrl}/api/connections`);
  if (!response.ok) {
    throw new Error(`GET /api/connections failed (${response.status})`);
  }
  return (await response.json()) as ConnectionsResponse;
}
