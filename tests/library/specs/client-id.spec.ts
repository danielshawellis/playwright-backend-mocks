import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { matchSerializedMatcher } from "@playwright-backend-mocks/protocol";
import { TestSocket, withProxy } from "../helpers.js";

const request = {
  url: "http://example.test/users",
  method: "GET",
  headers: {},
  bodyBase64: null,
};

test.describe("clientId matching", () => {
  test("matchSerializedMatcher filters by clientIds", () => {
    expect(
      matchSerializedMatcher(
        { urlGlob: "http://example.test/**", clientIds: ["job-worker"] },
        { request, clientId: "api-server" },
      ),
    ).toBe(false);

    expect(
      matchSerializedMatcher(
        { urlGlob: "http://example.test/**", clientIds: ["job-worker"] },
        { request, clientId: "job-worker" },
      ),
    ).toBe(true);

    expect(
      matchSerializedMatcher(
        { urlGlob: "http://example.test/**", clientIds: ["api-server", "job-worker"] },
        { request, clientId: "api-server" },
      ),
    ).toBe(true);
  });

  test("route with clientId filter only claims matching Node agents", async () => {
    await withProxy({}, async (proxy) => {
      const playwright = await TestSocket.connect(proxy.url);
      const node = await TestSocket.connect(proxy.url);

      expect(
        (
          await playwright.hello({
            role: "playwright",
            workerId: "client-id-worker",
          })
        ).type,
      ).toBe("hello:ok");
      expect((await node.hello({ role: "node", clientId: "api-server" })).type).toBe(
        "hello:ok",
      );

      const testId = randomUUID();
      const routeId = randomUUID();
      playwright.send({
        type: "test:register",
        testId,
        title: "clientId filter",
        file: "client-id.spec.ts",
        workerId: "client-id-worker",
      });
      playwright.send({
        type: "route:register",
        routeId,
        testId,
        matcher: {
          urlGlob: "http://example.test/users",
          clientIds: ["job-worker"],
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // api-server must not match a job-worker-only route → passthrough
      const passthroughId = randomUUID();
      node.send({
        type: "request:start",
        requestId: passthroughId,
        clientId: "api-server",
        request,
      });
      const passthrough = await node.waitForOneOf(
        ["decision:passthrough", "decision:error", "request:matched"],
        5_000,
      );
      expect(passthrough).toMatchObject({
        type: "decision:passthrough",
        requestId: passthroughId,
      });

      // Re-hello as job-worker (same socket keeps node role; send with clientId on request)
      const matchedId = randomUUID();
      node.send({
        type: "request:start",
        requestId: matchedId,
        clientId: "job-worker",
        request,
      });
      const matched = await playwright.waitForType("request:matched", 5_000);
      expect(matched).toMatchObject({
        requestId: matchedId,
        clientId: "job-worker",
        routeId,
        testId,
      });

      playwright.close();
      node.close();
    });
  });
});
