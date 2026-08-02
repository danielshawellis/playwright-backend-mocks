import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright-backend-mocks/playwright";
import { TestSocket, withProxy } from "../ws-helpers.js";

test.describe("proxy auth and protocol", () => {
  test("accepts a correct connection token", async () => {
    await withProxy({ token: "secret-token" }, async (proxy) => {
      const socket = await TestSocket.connect(proxy.url);
      const hello = await socket.hello({
        role: "playwright",
        workerId: "1",
        token: "secret-token",
      });
      expect(hello.type).toBe("hello:ok");
      socket.close();
    });
  });

  test("rejects a missing or invalid connection token", async () => {
    await withProxy({ token: "secret-token" }, async (proxy) => {
      const missing = await TestSocket.connect(proxy.url);
      const missingHello = await missing.hello({
        role: "node",
        clientId: "no-token",
      });
      expect(missingHello).toMatchObject({
        type: "hello:error",
        code: "unauthorized",
      });
      missing.close();

      const wrong = await TestSocket.connect(proxy.url);
      const wrongHello = await wrong.hello({
        role: "node",
        clientId: "bad-token",
        token: "nope",
      });
      expect(wrongHello).toMatchObject({
        type: "hello:error",
        code: "unauthorized",
      });
      wrong.close();
    });
  });

  test("rejects an incompatible protocol version", async () => {
    await withProxy({}, async (proxy) => {
      const socket = await TestSocket.connect(proxy.url);
      const hello = await socket.hello({
        role: "playwright",
        workerId: "1",
        protocolVersion: 999,
      });
      expect(hello).toMatchObject({
        type: "hello:error",
        code: "protocol_mismatch",
      });
      socket.close();
    });
  });
});

test.describe("disconnect handling", () => {
  test("Playwright disconnect fails pending Node requests", async () => {
    await withProxy({}, async (proxy) => {
      const playwright = await TestSocket.connect(proxy.url);
      const node = await TestSocket.connect(proxy.url);

      const pwHello = await playwright.hello({
        role: "playwright",
        workerId: "disconnect-worker",
        clientId: "pw-1",
      });
      expect(pwHello.type).toBe("hello:ok");

      const nodeHello = await node.hello({
        role: "node",
        clientId: "node-1",
      });
      expect(nodeHello.type).toBe("hello:ok");

      const testId = randomUUID();
      const routeId = randomUUID();
      const requestId = randomUUID();

      playwright.send({
        type: "test:register",
        testId,
        title: "disconnect test",
        file: "security-disconnect.spec.ts",
        workerId: "disconnect-worker",
      });
      playwright.send({
        type: "route:register",
        routeId,
        testId,
        matcher: { urlGlob: "http://example.test/pending" },
      });

      // Allow registration to land before the request.
      await new Promise((resolve) => setTimeout(resolve, 50));

      node.send({
        type: "request:start",
        requestId,
        clientId: "node-1",
        request: {
          url: "http://example.test/pending",
          method: "GET",
          headers: {},
          bodyBase64: null,
        },
      });

      const matched = await playwright.waitForType("request:matched");
      expect(matched.requestId).toBe(requestId);

      // Drop the Playwright connection while the handler has not settled.
      playwright.close();

      const decision = await node.waitForOneOf(
        ["decision:error", "decision:passthrough", "decision:fulfill"],
        5_000,
      );
      expect(decision).toMatchObject({
        type: "decision:error",
        requestId,
        code: "disconnected",
      });

      node.close();
    });
  });

  test("Node disconnect is reflected in connection listing", async () => {
    await withProxy({}, async (proxy) => {
      const node = await TestSocket.connect(proxy.url);
      const hello = await node.hello({
        role: "node",
        clientId: "ephemeral-node",
      });
      expect(hello.type).toBe("hello:ok");

      const before = await fetch(`${proxy.url}/api/connections`).then(
        (response) =>
          response.json() as Promise<{ nodeAgents: Array<{ clientId: string }> }>,
      );
      expect(before.nodeAgents.map((agent) => agent.clientId)).toContain(
        "ephemeral-node",
      );

      node.close();
      await new Promise((resolve) => setTimeout(resolve, 100));

      const after = await fetch(`${proxy.url}/api/connections`).then(
        (response) =>
          response.json() as Promise<{ nodeAgents: Array<{ clientId: string }> }>,
      );
      expect(after.nodeAgents.map((agent) => agent.clientId)).not.toContain(
        "ephemeral-node",
      );
    });
  });
});
