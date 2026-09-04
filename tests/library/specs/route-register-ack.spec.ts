/**
 * Issue 31: route() / unroute / dispose must not resolve until the proxy acks.
 * Fake connection — no real race, no delay hooks.
 */
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
        emit({
          type: "route:registered",
          routeId: register.routeId,
        } as ProxyToClientMessage);
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
        emit({
          type: "route:registered",
          routeId: register.routeId,
        } as ProxyToClientMessage);
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
        emit({
          type: "route:registered",
          routeId: register.routeId,
        } as ProxyToClientMessage);
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
        } as ProxyToClientMessage);
      },
    );
  });

  test("dispose() does not resolve until unregister acks", async () => {
    const { connection, sent, emit } = fakeConnection();
    const mocks = createBackendMocks({ connection, testId: "t1" });

    await expectPendingUntil(
      () => Promise.resolve(mocks.dispose()),
      () => {
        expect(sent.map((message) => message.type)).toEqual([
          "route:unregister",
          "test:unregister",
        ]);
        emit({
          type: "route:unregistered",
          testId: "t1",
        } as ProxyToClientMessage);
        emit({
          type: "test:unregistered",
          testId: "t1",
        } as ProxyToClientMessage);
      },
    );
  });
});
