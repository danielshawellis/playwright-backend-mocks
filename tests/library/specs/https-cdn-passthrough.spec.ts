/**
 * Live HTTPS smoke: Cloudflare-fronted origins negotiate HTTP/2.
 *
 * On Node 26+, nested undici `fetch` while MSW holds the app request fails with
 * HTTPParserError (h2 bytes on an HTTP/1.1 parser). The agent must settle
 * upstream via node:https instead. Local HTTP/1.1 fixtures cannot catch this.
 */
import { expect, test } from "@playwright/test";
import { startBackendMocks } from "@playwright-backend-mocks/node";
import { withProxy } from "../helpers.js";

test.describe("https CDN passthrough (HTTP/2-capable origins)", () => {
  test("fetch https://example.com succeeds through the agent", async () => {
    await withProxy({}, async (proxy) => {
      const agent = await startBackendMocks({
        proxyUrl: proxy.url,
        clientId: "https-cdn-smoke",
      });
      try {
        const response = await fetch("https://example.com/", {
          headers: { "accept-encoding": "br, gzip, deflate" },
        });
        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toContain("Example Domain");
        expect(response.headers.get("content-encoding")).toBeNull();
        const te = response.headers.get("transfer-encoding");
        const cl = response.headers.get("content-length");
        if (cl !== null && te !== null) {
          expect(te, "must not replay CL+TE together").toBeNull();
        }
      } finally {
        await agent.stop();
      }
    });
  });

  test("POST https://api.anthropic.com/v1/messages returns JSON through the agent", async () => {
    await withProxy({}, async (proxy) => {
      const agent = await startBackendMocks({
        proxyUrl: proxy.url,
        clientId: "https-anthropic-smoke",
      });
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "accept-encoding": "br, gzip, deflate, zstd",
          },
          body: JSON.stringify({
            model: "claude-3-5-haiku-20241022",
            max_tokens: 16,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        // No API key → 401 JSON; the point is we get a parseable HTTP response.
        expect(response.status).toBe(401);
        const json = (await response.json()) as {
          type?: string;
          error?: { type?: string };
        };
        expect(json.type).toBe("error");
        expect(json.error?.type).toBe("authentication_error");
        expect(response.headers.get("content-encoding")).toBeNull();
      } finally {
        await agent.stop();
      }
    });
  });
});
