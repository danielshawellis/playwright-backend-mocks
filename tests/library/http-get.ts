/**
 * Minimal node:http GET helper for ClientRequest fidelity tests.
 * Surfaces parser errors (HPE_*) as `{ ok: false, error }` instead of throwing.
 */
import http from "node:http";
import https from "node:https";

export type HttpGetResult =
  | {
      ok: true;
      status: number;
      headers: Record<string, string>;
      raw: string;
      data: unknown;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      headers?: Record<string, string>;
      raw?: string;
      data?: unknown;
    };

export type HttpGetOptions = {
  /** Default true (Node http.Agent default). Pass false for issue #34 case 2. */
  keepAlive?: boolean;
};

/**
 * Issue outbound GET via ClientRequest (`http.get` / `https.get`).
 * This is the transport axios uses under the hood — not WHATWG fetch.
 */
export function httpGet(url: string, options: HttpGetOptions = {}): Promise<HttpGetResult> {
  const keepAlive = options.keepAlive ?? true;
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const agent =
    parsed.protocol === "https:"
      ? new https.Agent({ keepAlive })
      : new http.Agent({ keepAlive });

  return new Promise((resolve) => {
    const req = transport.get(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        agent,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            headers[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
          }
          let data: unknown = null;
          if (raw.length > 0) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = null;
            }
          }
          resolve({
            ok: true,
            status: response.statusCode ?? 0,
            headers,
            raw,
            data,
          });
        });
        response.on("error", (error) => {
          resolve({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      },
    );
    req.on("error", (error) => {
      resolve({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
