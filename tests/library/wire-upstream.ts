/**
 * Ephemeral HTTP/1.1 upstream that speaks real on-the-wire response shapes.
 *
 * Controllable via query string so library E2E can cover encoding × framing
 * without hitting the public internet:
 *
 *   GET /wire?enc=identity|gzip|deflate|br&frame=length|chunked&type=json|html|bin|empty
 */
import { createServer, type Server } from "node:http";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";

export type WireEncoding = "identity" | "gzip" | "deflate" | "br";
export type WireFraming = "length" | "chunked";
export type WireBodyType = "json" | "html" | "bin" | "empty";

export interface WireUpstream {
  readonly url: string;
  readonly port: number;
  close(): Promise<void>;
  wireUrl(options: {
    enc: WireEncoding;
    frame: WireFraming;
    type?: WireBodyType;
  }): string;
}

/** Canonical bodies — stable bytes for assertions after passthrough/continue. */
export const WIRE_BODIES: Record<WireBodyType, Buffer> = {
  json: Buffer.from(JSON.stringify({ wire: true, message: "hello" }), "utf8"),
  html: Buffer.from(
    '<!doctype html><html lang="en"><head><title>Wire</title></head>' +
      "<body><h1>Wire Domain</h1><p>Local fixture.</p></body></html>\n",
    "utf8",
  ),
  bin: Buffer.from([0, 1, 2, 3, 254, 255]),
  empty: Buffer.alloc(0),
};

export const WIRE_CONTENT_TYPES: Record<WireBodyType, string | undefined> = {
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  bin: "application/octet-stream",
  empty: undefined,
};

function compress(enc: WireEncoding, body: Buffer): Buffer {
  switch (enc) {
    case "identity":
      return body;
    case "gzip":
      return gzipSync(body);
    case "deflate":
      return deflateSync(body);
    case "br":
      return brotliCompressSync(body);
    default: {
      const _exhaustive: never = enc;
      return _exhaustive;
    }
  }
}

function contentEncodingHeader(enc: WireEncoding): string | undefined {
  if (enc === "identity") return undefined;
  return enc;
}

export async function startWireUpstream(): Promise<WireUpstream> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== "GET" || url.pathname !== "/wire") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }

    const enc = (url.searchParams.get("enc") ?? "identity") as WireEncoding;
    const frame = (url.searchParams.get("frame") ?? "length") as WireFraming;
    const type = (url.searchParams.get("type") ?? "json") as WireBodyType;

    if (!["identity", "gzip", "deflate", "br"].includes(enc)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`invalid enc: ${enc}`);
      return;
    }
    if (!["length", "chunked"].includes(frame)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`invalid frame: ${frame}`);
      return;
    }
    if (!["json", "html", "bin", "empty"].includes(type)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`invalid type: ${type}`);
      return;
    }

    const plain = WIRE_BODIES[type];
    const onWire = compress(enc, plain);
    const headers: Record<string, string | number> = {
      "x-wire-enc": enc,
      "x-wire-frame": frame,
      "x-wire-type": type,
    };
    const contentType = WIRE_CONTENT_TYPES[type];
    if (contentType !== undefined) {
      headers["content-type"] = contentType;
    }
    const ce = contentEncodingHeader(enc);
    if (ce !== undefined) {
      headers["content-encoding"] = ce;
    }

    if (frame === "length") {
      headers["content-length"] = onWire.byteLength;
      res.writeHead(200, headers);
      res.end(onWire);
      return;
    }

    // Real chunked framing: no Content-Length, multiple writes.
    headers["transfer-encoding"] = "chunked";
    res.writeHead(200, headers);
    if (onWire.byteLength === 0) {
      res.end();
      return;
    }
    const split = Math.min(8, onWire.byteLength);
    res.write(onWire.subarray(0, split));
    if (split < onWire.byteLength) {
      res.write(onWire.subarray(split));
    }
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind wire upstream");
  }

  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    port: address.port,
    wireUrl({ enc, frame, type = "json" }) {
      const parsed = new URL("/wire", url);
      parsed.searchParams.set("enc", enc);
      parsed.searchParams.set("frame", frame);
      parsed.searchParams.set("type", type);
      return parsed.href;
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
