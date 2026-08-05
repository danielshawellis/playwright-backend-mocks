export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type HistoryCaptureMode = "all" | "handled" | "none";

export interface ProxyConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string | undefined;
  readonly historyLimit: number;
  readonly wsHistoryLimit: number;
  readonly historyCapture: HistoryCaptureMode;
  readonly heartbeatMs: number;
  readonly idleTimeoutMs: number;
  /** How long to wait for every Playwright test with routes to answer a claim. */
  readonly claimTimeoutMs: number;
  readonly logLevel: LogLevel;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  host: "127.0.0.1",
  port: 4310,
  token: undefined,
  historyLimit: 1000,
  wsHistoryLimit: 200,
  historyCapture: "all",
  heartbeatMs: 15_000,
  idleTimeoutMs: 60_000,
  claimTimeoutMs: 5_000,
  logLevel: "info",
};

export function createProxyConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    ...DEFAULT_PROXY_CONFIG,
    ...overrides,
  };
}
