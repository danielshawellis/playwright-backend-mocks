/**
 * Issue 31: route() / unroute / dispose must not resolve until the proxy acks.
 * Fake connection — no real race, no delay hooks.
 */
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  connectPlaywrightProxy,
  createBackendMocks,
  sendAndWaitForAck,
  type PlaywrightProxyConnection,
} from "@playwright-backend-mocks/playwright";
import { startBackendMocks } from "@playwright-backend-mocks/node";
import type {
  ClientToProxyMessage,
  ProxyToClientMessage,
} from "@playwright-backend-mocks/protocol";
import { TestSocket, withProxy } from "../helpers.js";

function fakeConnection() {
  const handlers = new Set<(message: ProxyToClientMessage) => void>();
  const sent: ClientToProxyMessage[] = [];
  const connection: PlaywrightProxyConnection = {
    clientId: "pw-ack",
    send(message) {
      sent.push(message);
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    async close() {},
  };
  return {
    connection,
    sent,
    emit(message: ProxyToClientMessage) {
      for (const handler of handlers) {
        handler(message);
      }
    },
  };
}

async function expectPendingUntil(
  start: () => Promise<void>,
  ack: () => void,
): Promise<void> {
  let resolved = false;
  const pending = start().then(() => {
    resolved = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(resolved).toBe(false);
  ack();
  await pending;
  expect(resolved).toBe(true);
}

test.describe("route registration acks", () => {
  test("route() does not resolve until route:registered", async () => {
    const { connection, sent, emit } = fakeConnection();
    const mocks = createBackendMocks({ connection, testId: "t1" });

    await expectPendingUntil(
      () =>
        mocks.route("https://example.test/**", async (route) => {
          await route.fulfill({ status: 200, body: "ok" });
        }),
      () => {
        const register = sent.find((message) => message.type === "route:register");
        expect(register?.type).toBe("route:register");
        if (register?.type !== "route:register") {
          throw new Error("expected route:register");
        }
        emit({ type: "route:registered", routeId: register.routeId });
      },
    );
  });

  test("routeWebSocket() does not resolve until route:registered", async () => {
    const { connection, sent, emit } = fakeConnection();
    const mocks = createBackendMocks({ connection, testId: "t1" });

    await expectPendingUntil(
      () => mocks.routeWebSocket("wss://example.test/**", () => {}),
      () => {
        const register = sent.find((message) => message.type === "route:register");
        expect(register?.type).toBe("route:register");
        if (register?.type !== "route:register") {
          throw new Error("expected route:register");
        }
        emit({ type: "route:registered", routeId: register.routeId });
      },
    );
  });

  test("unroute() does not resolve until route:unregistered", async () => {
    const { connection, sent, emit } = fakeConnection();
    const mocks = createBackendMocks({ connection, testId: "t1" });
    const handler = async () => {};

    await expectPendingUntil(
      () => mocks.route("https://example.test/**", handler),
      () => {
        const register = sent.find((message) => message.type === "route:register");
        if (register?.type !== "route:register") {
          throw new Error("expected route:register");
        }
        emit({ type: "route:registered", routeId: register.routeId });
      },
    );

    await expectPendingUntil(
      () => mocks.unroute("https://example.test/**", handler),
      () => {
        const unregister = sent.find((message) => message.type === "route:unregister");
        expect(unregister?.type).toBe("route:unregister");
        if (unregister?.type !== "route:unregister") {
          throw new Error("expected route:unregister");
        }
        emit({
          type: "route:unregistered",
          routeId: unregister.routeId,
        });
      },
    );
  });

  test("dispose() does not resolve until unregister acks", async () => {
    const { connection, sent, emit } = fakeConnection();
    const mocks = createBackendMocks({ connection, testId: "t1" });

    await expectPendingUntil(
      () => mocks.dispose(),
      () => {
        expect(sent.map((message) => message.type)).toEqual([
          "route:unregister",
          "test:unregister",
        ]);
        emit({ type: "route:unregistered", testId: "t1" });
        emit({ type: "test:unregistered", testId: "t1" });
      },
    );
  });

  test("route() fails if the proxy does not ack", async () => {
    const { connection } = fakeConnection();
    const mocks = createBackendMocks({
      connection,
      testId: "t1",
      ackTimeoutMs: 50,
    });
    await expect(mocks.route("https://example.test/**", async () => {})).rejects.toThrow(
      /acknowledge route:register/,
    );
  });

  test("proxy acks test and route registration", async () => {
    await withProxy({}, async (proxy) => {
      const playwright = await TestSocket.connect(proxy.url);
      expect(
        (await playwright.hello({ role: "playwright", workerId: "ack-worker" })).type,
      ).toBe("hello:ok");

      const testId = randomUUID();
      const routeId = randomUUID();
      playwright.send({
        type: "test:register",
        testId,
        title: "ack",
        file: "route-register-ack.spec.ts",
        workerId: "ack-worker",
      });
      expect(await playwright.waitForType("test:registered")).toEqual({
        type: "test:registered",
        testId,
      });

      playwright.send({
        type: "route:register",
        routeId,
        testId,
        matcher: { urlGlob: "https://example.test/**" },
      });
      expect(await playwright.waitForType("route:registered")).toEqual({
        type: "route:registered",
        routeId,
      });

      playwright.send({
        type: "route:unregister",
        routeId,
      });
      expect(await playwright.waitForType("route:unregistered")).toEqual({
        type: "route:unregistered",
        routeId,
      });

      playwright.send({ type: "test:unregister", testId });
      expect(await playwright.waitForType("test:unregistered")).toEqual({
        type: "test:unregistered",
        testId,
      });
      playwright.close();
    });
  });

  test("await route() then fetch is fulfilled", async () => {
    await withProxy({}, async (proxy) => {
      const agent = await startBackendMocks({
        proxyUrl: proxy.url,
        clientId: "ack-node",
      });
      const connection = await connectPlaywrightProxy({
        proxyUrl: proxy.url,
        workerId: "ack-fetch",
      });
      const testId = randomUUID();
      await sendAndWaitForAck(
        connection,
        {
          type: "test:register",
          testId,
          title: "ack fetch",
          file: "route-register-ack.spec.ts",
          workerId: "ack-fetch",
        },
        (message) => message.type === "test:registered" && message.testId === testId,
      );
      const mocks = createBackendMocks({ connection, testId });
      try {
        await mocks.route("https://ack.example.test/**", async (route) => {
          await route.fulfill({ status: 200, json: { mocked: true } });
        });
        const response = await fetch("https://ack.example.test/v1");
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ mocked: true });
      } finally {
        await mocks.dispose();
        await connection.close();
        await agent.stop();
      }
    });
  });
});
