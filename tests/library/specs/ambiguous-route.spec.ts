import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { TestSocket, withProxy } from "../helpers.js";

const request = {
  url: "http://example.test/users",
  method: "GET",
  headers: {},
  bodyBase64: null,
};

test.describe("cross-test ownership", () => {
  test("two tests claiming the same request fail with ambiguous_route", async () => {
    await withProxy({}, async (proxy) => {
      const workerA = await TestSocket.connect(proxy.url);
      const workerB = await TestSocket.connect(proxy.url);
      const node = await TestSocket.connect(proxy.url);

      expect(
        (await workerA.hello({ role: "playwright", workerId: "worker-a" })).type,
      ).toBe("hello:ok");
      expect(
        (await workerB.hello({ role: "playwright", workerId: "worker-b" })).type,
      ).toBe("hello:ok");
      expect((await node.hello({ role: "node", clientId: "node-1" })).type).toBe(
        "hello:ok",
      );

      const testA = randomUUID();
      const testB = randomUUID();
      const routeA = randomUUID();
      const routeB = randomUUID();

      workerA.send({
        type: "test:register",
        testId: testA,
        title: "test A",
        file: "ambiguous-route.spec.ts",
        workerId: "worker-a",
      });
      workerA.send({
        type: "route:register",
        routeId: routeA,
        testId: testA,
        matcher: { urlGlob: "http://example.test/users" },
      });

      workerB.send({
        type: "test:register",
        testId: testB,
        title: "test B",
        file: "ambiguous-route.spec.ts",
        workerId: "worker-b",
      });
      workerB.send({
        type: "route:register",
        routeId: routeB,
        testId: testB,
        matcher: { urlGlob: "http://example.test/**" },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const requestId = randomUUID();
      node.send({
        type: "request:start",
        requestId,
        clientId: "node-1",
        request,
      });

      const decision = await node.waitForOneOf(
        ["decision:error", "decision:passthrough", "decision:fulfill"],
        5_000,
      );
      expect(decision).toMatchObject({
        type: "decision:error",
        requestId,
        code: "ambiguous_route",
      });
      expect(String((decision as { message?: string }).message)).toMatch(
        /Ambiguous backend mock routing/i,
      );

      const errorA = await workerA.waitForType("proxy:error", 5_000);
      const errorB = await workerB.waitForType("proxy:error", 5_000);
      expect(errorA).toMatchObject({ code: "ambiguous_route", testId: testA });
      expect(errorB).toMatchObject({ code: "ambiguous_route", testId: testB });

      workerA.close();
      workerB.close();
      node.close();
    });
  });

  test("same-test multi-handler is one owner (not ambiguous_route)", async () => {
    await withProxy({}, async (proxy) => {
      const playwright = await TestSocket.connect(proxy.url);
      const node = await TestSocket.connect(proxy.url);

      expect(
        (
          await playwright.hello({
            role: "playwright",
            workerId: "same-test-worker",
          })
        ).type,
      ).toBe("hello:ok");
      expect((await node.hello({ role: "node", clientId: "node-1" })).type).toBe(
        "hello:ok",
      );

      const testId = randomUUID();
      const routeA = randomUUID();
      const routeB = randomUUID();

      playwright.send({
        type: "test:register",
        testId,
        title: "same test multi-handler",
        file: "ambiguous-route.spec.ts",
        workerId: "same-test-worker",
      });
      playwright.send({
        type: "route:register",
        routeId: routeA,
        testId,
        matcher: { urlGlob: "http://example.test/users" },
      });
      playwright.send({
        type: "route:register",
        routeId: routeB,
        testId,
        matcher: { urlGlob: "http://example.test/**" },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const requestId = randomUUID();
      node.send({
        type: "request:start",
        requestId,
        clientId: "node-1",
        request,
      });

      const matched = await playwright.waitForType("request:matched", 5_000);
      expect(matched.requestId).toBe(requestId);
      expect(matched.testId).toBe(testId);
      // Fixture picks LIFO among matches; proxy may deliver either routeId.
      expect([routeA, routeB]).toContain(matched.routeId);

      playwright.close();
      node.close();
    });
  });
});
