import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { encodeBody } from "@playwright-backend-mocks/protocol";
import { TestSocket, withProxy } from "../helpers.js";

const request = {
  url: "http://example.test/charges",
  method: "POST",
  headers: { "content-type": "application/json" },
  bodyBase64: encodeBody(JSON.stringify({ amount: 10 })),
};

async function setupPair(proxyUrl: string) {
  const playwright = await TestSocket.connect(proxyUrl);
  const node = await TestSocket.connect(proxyUrl);
  expect(
    (await playwright.hello({ role: "playwright", workerId: "obs-worker" })).type,
  ).toBe("hello:ok");
  expect((await node.hello({ role: "node", clientId: "obs-node" })).type).toBe(
    "hello:ok",
  );
  return { playwright, node };
}

test.describe("observability REST", () => {
  test("health reports historyCapture and history records fulfill with title/path", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const health = await api.get(`${proxy.url}/health`);
      expect(health.status()).toBe(200);
      expect(await health.json()).toMatchObject({
        ok: true,
        historyCapture: "all",
      });

      const { playwright, node } = await setupPair(proxy.url);
      const testId = randomUUID();
      const routeId = randomUUID();
      const requestId = randomUUID();

      playwright.send({
        type: "test:register",
        testId,
        title: "declined card",
        file: "/tests/pay.spec.ts",
        workerId: "obs-worker",
      });
      playwright.send({
        type: "route:register",
        routeId,
        testId,
        matcher: { urlGlob: "http://example.test/charges" },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      node.send({
        type: "request:start",
        requestId,
        clientId: "obs-node",
        request,
      });

      const matched = await playwright.waitForType("request:matched", 5_000);
      expect(matched.requestId).toBe(requestId);

      playwright.send({
        type: "handler:result",
        requestId,
        result: {
          action: "fulfill",
          response: {
            status: 402,
            statusText: "Payment Required",
            headers: { "content-type": "application/json" },
            bodyBase64: encodeBody(JSON.stringify({ error: "card_declined" })),
          },
        },
      });

      const decision = await node.waitForType("decision:fulfill", 5_000);
      expect(decision.requestId).toBe(requestId);

      const history = await api.get(`${proxy.url}/api/history`);
      expect(history.status()).toBe(200);
      const body = (await history.json()) as {
        entries: Array<{
          id: string;
          action?: string;
          title?: string;
          path?: string;
          outcome: { kind: string };
        }>;
      };
      const entry = body.entries.find((item) => item.id === requestId);
      expect(entry).toMatchObject({
        action: "fulfill",
        title: "declined card",
        path: "/tests/pay.spec.ts",
        outcome: { kind: "mocked" },
      });

      const one = await api.get(`${proxy.url}/api/history/${requestId}`);
      expect(one.status()).toBe(200);
      expect(await one.json()).toMatchObject({
        entry: { id: requestId, action: "fulfill" },
      });

      playwright.close();
      node.close();
    });
  });

  test("search ranks URL matches and capture handled omits passthrough", async ({
    request: api,
  }) => {
    await withProxy({ historyCapture: "handled" }, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const testId = randomUUID();
      const routeId = randomUUID();

      playwright.send({
        type: "test:register",
        testId,
        title: "handled only",
        file: "/tests/handled.spec.ts",
        workerId: "obs-worker",
      });
      playwright.send({
        type: "route:register",
        routeId,
        testId,
        matcher: { urlGlob: "http://example.test/mock-me" },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      const passthroughId = randomUUID();
      node.send({
        type: "request:start",
        requestId: passthroughId,
        clientId: "obs-node",
        request: {
          url: "http://example.test/other",
          method: "GET",
          headers: {},
          bodyBase64: null,
        },
      });
      await node.waitForType("decision:passthrough", 5_000);

      const mockId = randomUUID();
      node.send({
        type: "request:start",
        requestId: mockId,
        clientId: "obs-node",
        request: {
          url: "http://example.test/mock-me",
          method: "GET",
          headers: {},
          bodyBase64: null,
        },
      });
      await playwright.waitForType("request:matched", 5_000);
      playwright.send({
        type: "handler:result",
        requestId: mockId,
        result: {
          action: "fulfill",
          response: {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
            bodyBase64: encodeBody(JSON.stringify({ ok: true })),
          },
        },
      });
      await node.waitForType("decision:fulfill", 5_000);

      const history = await api.get(`${proxy.url}/api/history`);
      const body = (await history.json()) as { entries: Array<{ id: string }> };
      expect(body.entries.map((entry) => entry.id)).toContain(mockId);
      expect(body.entries.map((entry) => entry.id)).not.toContain(passthroughId);

      const searched = await api.get(`${proxy.url}/api/history?q=mock-me`);
      const searchedBody = (await searched.json()) as {
        entries: Array<{ id: string; request: { url: string } }>;
      };
      expect(searchedBody.entries[0]?.request.url).toContain("mock-me");

      playwright.close();
      node.close();
    });
  });

  test("history-capture none keeps history empty", async ({ request: api }) => {
    await withProxy({ historyCapture: "none" }, async (proxy) => {
      const node = await TestSocket.connect(proxy.url);
      expect((await node.hello({ role: "node", clientId: "obs-node" })).type).toBe(
        "hello:ok",
      );
      node.send({
        type: "request:start",
        requestId: randomUUID(),
        clientId: "obs-node",
        request: {
          url: "http://example.test/x",
          method: "GET",
          headers: {},
          bodyBase64: null,
        },
      });
      await node.waitForType("decision:passthrough", 5_000);
      const history = await api.get(`${proxy.url}/api/history`);
      expect(await history.json()).toEqual({ entries: [] });
      node.close();
    });
  });

  test("HAR export returns HTTP archive JSON", async ({ request: api }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const testId = randomUUID();
      const routeId = randomUUID();
      const requestId = randomUUID();

      playwright.send({
        type: "test:register",
        testId,
        title: "har export",
        file: "/tests/har.spec.ts",
        workerId: "obs-worker",
      });
      playwright.send({
        type: "route:register",
        routeId,
        testId,
        matcher: { urlGlob: "**/charges" },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      node.send({
        type: "request:start",
        requestId,
        clientId: "obs-node",
        request,
      });
      await playwright.waitForType("request:matched", 5_000);
      playwright.send({
        type: "handler:result",
        requestId,
        result: {
          action: "fulfill",
          response: {
            status: 201,
            statusText: "Created",
            headers: { "content-type": "application/json" },
            bodyBase64: encodeBody("{}"),
          },
        },
      });
      await node.waitForType("decision:fulfill", 5_000);

      const har = await api.get(`${proxy.url}/api/export/har`);
      expect(har.status()).toBe(200);
      expect(har.headers()["content-disposition"]).toMatch(/\.har/);
      const body = (await har.json()) as {
        log: { entries: Array<{ request: { url: string }; _action?: string }> };
      };
      expect(body.log.entries.some((entry) => entry.request.url.includes("charges"))).toBe(
        true,
      );
      expect(body.log.entries.some((entry) => entry._action === "fulfill")).toBe(true);

      playwright.close();
      node.close();
    });
  });

  test("WebSocket connections appear on /api/ws with title and path", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const testId = randomUUID();
      const routeId = randomUUID();
      const socketId = randomUUID();

      playwright.send({
        type: "test:register",
        testId,
        title: "socket test",
        file: "/tests/ws.spec.ts",
        workerId: "obs-worker",
      });
      playwright.send({
        type: "route:register",
        routeId,
        testId,
        kind: "websocket",
        matcher: { urlGlob: "ws://example.test/socket" },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));

      node.send({
        type: "ws:connection",
        socketId,
        url: "ws://example.test/socket",
        protocols: [],
        clientId: "obs-node",
      });

      const matched = await playwright.waitForType("ws:matched", 5_000);
      expect(matched.socketId).toBe(socketId);

      node.send({
        type: "ws:messageFromPage",
        socketId,
        data: JSON.stringify({ hello: true }),
        isBase64: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      const list = await api.get(`${proxy.url}/api/ws`);
      expect(list.status()).toBe(200);
      const body = (await list.json()) as {
        connections: Array<{
          id: string;
          outcome: string;
          title?: string;
          path?: string;
          events: Array<{ kind: string }>;
        }>;
      };
      const entry = body.connections.find((item) => item.id === socketId);
      expect(entry).toMatchObject({
        outcome: "matched",
        title: "socket test",
        path: "/tests/ws.spec.ts",
      });
      expect(entry?.events.some((event) => event.kind === "frame")).toBe(true);

      playwright.close();
      node.close();
    });
  });

  test("CORS is enabled for observability paths", async ({ request: api }) => {
    await withProxy({}, async (proxy) => {
      const history = await api.get(`${proxy.url}/api/history`);
      expect(history.headers()["access-control-allow-origin"]).toBe("*");
      const preflight = await api.fetch(`${proxy.url}/api/ws`, { method: "OPTIONS" });
      expect(preflight.status()).toBe(204);
    });
  });
});
