/**
 * Minimal URLPattern typings for environments where the global is available
 * (Node ≥22 / Chromium) but `@types/node` does not yet expose it.
 */
interface URLPatternInit {
  baseURL?: string;
  username?: string;
  password?: string;
  protocol?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}

interface URLPatternResult {
  inputs: [URLPatternInit | string];
  protocol: { input: string; groups: Record<string, string | undefined> };
  username: { input: string; groups: Record<string, string | undefined> };
  password: { input: string; groups: Record<string, string | undefined> };
  hostname: { input: string; groups: Record<string, string | undefined> };
  port: { input: string; groups: Record<string, string | undefined> };
  pathname: { input: string; groups: Record<string, string | undefined> };
  search: { input: string; groups: Record<string, string | undefined> };
  hash: { input: string; groups: Record<string, string | undefined> };
}

declare class URLPattern {
  constructor(input?: string | URLPatternInit, baseURL?: string | URLPatternInit);
  test(input?: string | URLPatternInit, baseURL?: string): boolean;
  exec(input?: string | URLPatternInit, baseURL?: string): URLPatternResult | null;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}
