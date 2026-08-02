export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export interface ProxyConfig {
  readonly host: string;
  readonly port: number;
  readonly token: string | undefined;
  readonly historyLimit: number;
  readonly heartbeatMs: number;
  readonly idleTimeoutMs: number;
  readonly logLevel: LogLevel;
}

export const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  host: "127.0.0.1",
  port: 4310,
  token: undefined,
  historyLimit: 1000,
  heartbeatMs: 15_000,
  idleTimeoutMs: 60_000,
  logLevel: "info",
};

export function createProxyConfig(overrides: Partial<ProxyConfig> = {}): ProxyConfig {
  return {
    ...DEFAULT_PROXY_CONFIG,
    ...overrides,
  };
}
