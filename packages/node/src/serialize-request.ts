import {
  encodeBody,
  normalizeHeaders,
  type SerializedRequest,
} from "@playwright-backend-mocks/protocol";

export async function serializeRequest(request: Request): Promise<SerializedRequest> {
  const method = request.method.toUpperCase();
  const headers = normalizeHeaders(request.headers);

  let bodyBase64: string | null = null;
  if (method !== "GET" && method !== "HEAD") {
    // Fully buffer for v1. Streaming bodies are not supported.
    try {
      const buffer = await request.clone().arrayBuffer();
      bodyBase64 = encodeBody(buffer);
    } catch (error) {
      throw new Error(
        `Playwright Backend Mocks v1 does not support streaming request bodies. ` +
          `Failed to buffer ${method} ${request.url}: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  return {
    url: request.url,
    method,
    headers,
    bodyBase64,
  };
}
