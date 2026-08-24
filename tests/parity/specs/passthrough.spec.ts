import { test, expect, parityMode } from "../harness.js";
import { bodyFromBase64, headerValue } from "../helpers.js";

test.describe("passthrough", () => {
  test("reaches the real upstream when no route matches", async ({ trigger }) => {
    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    expect(headerValue(result.headers, "x-upstream")).toBe("real");
  });

  test("reaches upstream for POST when unmatched", async ({ trigger }) => {
    const result = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 11 }),
    });
    expect(result.status).toBe(201);
    expect(result.data).toEqual({
      id: "ch_real",
      amount: 11,
      status: "succeeded",
    });
  });
});

/**
 * Unmatched settle must not mangle bodies/encodings. Node undici auto-decompresses
 * gzip/br/deflate but may leave `content-encoding` set; replaying that pair through
 * the agent historically caused ERR__ERROR_FORMAT_PADDING_2 (double Brotli decode).
 *
 * Body readability is the dual-mode oracle. Node mode additionally asserts the agent
 * strips stale content-encoding after undici decompression (browsers may still expose it).
 */
test.describe("passthrough response formats", () => {
  function expectNoStaleContentEncoding(headers: Record<string, string> | undefined) {
    if (parityMode === "node") {
      expect(headerValue(headers, "content-encoding")).toBeUndefined();
    }
  }

  test("gzip JSON is readable without a route", async ({ trigger }) => {
    const result = await trigger("/gzip", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ gzipped: true, message: "hello" });
    expectNoStaleContentEncoding(result.headers);
  });

  test("brotli JSON is readable without a route", async ({ trigger }) => {
    const result = await trigger("/brotli", {
      headers: { "accept-encoding": "br, gzip, deflate" },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ brotli: true, message: "hello" });
    expectNoStaleContentEncoding(result.headers);
  });

  test("deflate JSON is readable without a route", async ({ trigger }) => {
    const result = await trigger("/deflate", {
      headers: { "accept-encoding": "deflate" },
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ deflated: true, message: "hello" });
    expectNoStaleContentEncoding(result.headers);
  });

  test("large brotli JSON survives passthrough buffering", async ({ trigger }) => {
    const result = await trigger("/brotli-large", {
      headers: { "accept-encoding": "br" },
    });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      brotli: true,
      items: expect.arrayContaining([{ id: 0, name: "item-0" }]),
    });
    expectNoStaleContentEncoding(result.headers);
  });

  test("gzip text/plain is readable without a route", async ({ trigger }) => {
    const result = await trigger("/gzip-text", {
      headers: { "accept-encoding": "gzip" },
    });
    expect(result.ok).toBe(true);
    expect(result.raw).toBe("plain text, gzipped");
    expect(headerValue(result.headers, "content-type")).toMatch(/text\/plain/);
    expectNoStaleContentEncoding(result.headers);
  });

  test("chunked JSON without content-length is readable", async ({ trigger }) => {
    const result = await trigger("/chunked-json");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ chunked: true, message: "hello" });
  });

  test("binary octet-stream bytes are preserved", async ({ trigger }) => {
    const result = await trigger("/binary");
    expect(result.ok).toBe(true);
    expect(bodyFromBase64(result.bodyBase64)).toEqual(
      Buffer.from([0, 1, 2, 3, 254, 255]),
    );
  });

  test("uncompressed SSE body is preserved as text", async ({ trigger }) => {
    const result = await trigger("/sse");
    expect(result.ok).toBe(true);
    expect(headerValue(result.headers, "content-type")).toMatch(/text\/event-stream/);
    expect(result.raw).toContain("event: message");
    expect(result.raw).toContain('data: {"ok":true,"n":1}');
  });

  test("brotli-compressed SSE body is readable without a route", async ({ trigger }) => {
    const result = await trigger("/sse-brotli", {
      headers: { "accept-encoding": "br" },
    });
    expect(result.ok).toBe(true);
    expect(result.raw).toContain("event: message");
    expect(result.raw).toContain('data: {"ok":true}');
    expectNoStaleContentEncoding(result.headers);
  });
});
