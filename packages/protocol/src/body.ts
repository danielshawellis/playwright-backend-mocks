export function encodeBody(
  body: ArrayBuffer | Uint8Array | Buffer | string | null | undefined,
): string | null {
  if (body === null || body === undefined) {
    return null;
  }

  if (typeof body === "string") {
    if (body.length === 0) {
      return null;
    }
    return Buffer.from(body, "utf8").toString("base64");
  }

  const bytes =
    body instanceof ArrayBuffer
      ? Buffer.from(body)
      : Buffer.from(body.buffer, body.byteOffset, body.byteLength);

  if (bytes.byteLength === 0) {
    return null;
  }

  return bytes.toString("base64");
}

export function decodeBody(bodyBase64: string | null | undefined): Buffer | null {
  if (bodyBase64 === null || bodyBase64 === undefined || bodyBase64.length === 0) {
    return null;
  }
  return Buffer.from(bodyBase64, "base64");
}

export function decodeBodyText(bodyBase64: string | null | undefined): string | null {
  const buffer = decodeBody(bodyBase64);
  return buffer === null ? null : buffer.toString("utf8");
}
