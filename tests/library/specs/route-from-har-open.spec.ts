/**
 * Issue 37: routeFromHAR open/load must fail loudly for zip / missing /
 * unreadable / invalid JSON. Parseable-but-incomplete HAR still registers
 * (Playwright-shaped soft path → notFound at request time).
 *
 * Fake connection — loud failures throw before route:register; soft cases ack.
 */
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  createBackendMocks,
  type PlaywrightProxyConnection,
} from "@playwright-backend-mocks/playwright";
import type {
  ClientToProxyMessage,
  ProxyToClientMessage,
} from "@playwright-backend-mocks/protocol";

function fakeConnection() {
  const handlers = new Set<(message: ProxyToClientMessage) => void>();
  const sent: ClientToProxyMessage[] = [];
  const connection: PlaywrightProxyConnection = {
    clientId: "pw-har-open",
    send(message) {
      sent.push(message);
      if (message.type === "route:register") {
        queueMicrotask(() => {
          for (const handler of handlers) {
            handler({ type: "route:registered", routeId: message.routeId });
          }
        });
      }
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    async close() {},
  };
  return { connection, sent };
}

function mocks() {
  return createBackendMocks({
    connection: fakeConnection().connection,
    testId: "har-open",
  });
}

test.describe("routeFromHAR open failures", () => {
  test("rejects a .har.zip path as unsupported", async ({}, testInfo) => {
    const zipPath = testInfo.outputPath("recording.har.zip");

    await expect(mocks().routeFromHAR(zipPath)).rejects.toThrow(/zip/i);
  });

  test("rejects zip magic even when the path ends in .har", async ({}, testInfo) => {
    const disguised = testInfo.outputPath("disguised.har");
    fs.writeFileSync(
      disguised,
      Buffer.from("504b030400000000000000000000000000000000000000000000000000000000", "hex"),
    );

    await expect(mocks().routeFromHAR(disguised)).rejects.toThrow(/zip/i);
  });

  test("rejects a missing HAR file", async ({}, testInfo) => {
    const missing = testInfo.outputPath("missing.har");

    await expect(mocks().routeFromHAR(missing)).rejects.toThrow(
      /ENOENT|no such file|not found/i,
    );
  });

  test("rejects invalid JSON in a plain .har", async ({}, testInfo) => {
    const corrupt = testInfo.outputPath("corrupt.har");
    fs.writeFileSync(corrupt, "{ not json", "utf8");

    await expect(mocks().routeFromHAR(corrupt)).rejects.toThrow(/JSON|Unexpected|parse/i);
  });

  test("registers parseable incomplete HAR without throwing", async ({}, testInfo) => {
    const incomplete = testInfo.outputPath("incomplete.har");
    fs.writeFileSync(incomplete, JSON.stringify({ log: {} }), "utf8");

    const { connection, sent } = fakeConnection();
    const api = createBackendMocks({ connection, testId: "har-open-soft" });

    await expect(
      api.routeFromHAR(incomplete, { url: "**/users", notFound: "abort" }),
    ).resolves.toBeUndefined();
    expect(sent.some((message) => message.type === "route:register")).toBe(true);
  });
});
