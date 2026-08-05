import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  abortRequest,
  continueRequest,
  fulfill,
  getHistory,
  getWs,
  passthrough,
  registerHttpRoute,
  registerWsRoute,
  setupPair,
  startHttpAndMatch,
  withProxy,
} from "../observability-helpers.js";

test.describe("observability REST — HTTP recording", () => {
  test("all mode records fulfill with action, title, path, and detail by id", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const health = await api.get(`${proxy.url}/health`);
      expect(await health.json()).toMatchObject({
        ok: true,
        historyCapture: "all",
      });

      const { playwright, node } = await setupPair(proxy.url);
      const { testId } = await registerHttpRoute(playwright, {
        title: "declined card",
        file: "/tests/pay.spec.ts",
        matcher: "http://example.test/charges",
      });

      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/charges",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { amount: 10 },
      });
      await fulfill(playwright, node, requestId, {
        status: 402,
        json: { error: "card_declined" },
      });

      const entries = await getHistory(api, proxy.url);
      const entry = entries.find((item) => item.id === requestId);
      expect(entry).toMatchObject({
        action: "fulfill",
        title: "declined card",
        path: "/tests/pay.spec.ts",
        testId,
        outcome: { kind: "mocked" },
        request: { url: "http://example.test/charges", method: "POST" },
      });
      expect(entry?.events?.some((event) => event.kind === "observed")).toBe(true);
      expect(entry?.events?.some((event) => event.kind === "fulfill")).toBe(true);

      const one = await api.get(`${proxy.url}/api/history/${requestId}`);
      expect(one.status()).toBe(200);
      expect(await one.json()).toMatchObject({
        entry: { id: requestId, action: "fulfill", title: "declined card" },
      });

      playwright.close();
      node.close();
    });
  });

  test("all mode records continue (with overrides) and abort", async ({ request: api }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "modify and abort",
        file: "/tests/actions.spec.ts",
        matcher: "http://example.test/**",
      });

      const continueId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/prices",
      });
      await continueRequest(playwright, node, continueId, {
        url: "http://example.test/prices-v2",
        method: "GET",
      });

      const abortId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/blocked",
      });
      await abortRequest(playwright, node, abortId, "aborted");

      const entries = await getHistory(api, proxy.url);
      const continued = entries.find((item) => item.id === continueId);
      expect(continued).toMatchObject({
        action: "continue",
        title: "modify and abort",
        path: "/tests/actions.spec.ts",
        outcome: { kind: "continued" },
        overrides: {
          url: "http://example.test/prices-v2",
          method: "GET",
        },
      });

      const aborted = entries.find((item) => item.id === abortId);
      expect(aborted).toMatchObject({
        action: "abort",
        title: "modify and abort",
        outcome: { kind: "aborted", errorCode: "aborted" },
      });

      playwright.close();
      node.close();
    });
  });

  test("all mode records passthrough; handled omits it but keeps test actions", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const passthroughId = await passthrough(node, "http://example.test/health");
      const entries = await getHistory(api, proxy.url);
      expect(entries.find((item) => item.id === passthroughId)).toMatchObject({
        action: "passthrough",
        outcome: { kind: "passthrough" },
      });
      playwright.close();
      node.close();
    });

    await withProxy({ historyCapture: "handled" }, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "handled only",
        file: "/tests/handled.spec.ts",
        matcher: "http://example.test/mock-*",
      });

      const passthroughId = await passthrough(node, "http://example.test/other");
      const mockId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/mock-fulfill",
      });
      await fulfill(playwright, node, mockId, { status: 200, json: { ok: true } });

      const continueId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/mock-continue",
      });
      await continueRequest(playwright, node, continueId);

      const abortId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/mock-abort",
      });
      await abortRequest(playwright, node, abortId);

      const ids = (await getHistory(api, proxy.url)).map((entry) => entry.id);
      expect(ids).toContain(mockId);
      expect(ids).toContain(continueId);
      expect(ids).toContain(abortId);
      expect(ids).not.toContain(passthroughId);

      playwright.close();
      node.close();
    });
  });

  test("none mode records neither HTTP nor WebSocket history", async ({ request: api }) => {
    await withProxy({ historyCapture: "none" }, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "ignored",
        file: "/tests/none.spec.ts",
        matcher: "http://example.test/**",
      });
      await registerWsRoute(playwright, {
        title: "ignored ws",
        file: "/tests/none-ws.spec.ts",
        matcher: "ws://example.test/**",
      });

      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/x",
      });
      await fulfill(playwright, node, requestId, { status: 200 });

      const socketId = randomUUID();
      node.send({
        type: "ws:connection",
        socketId,
        url: "ws://example.test/socket",
        protocols: [],
        clientId: "obs-node",
      });
      await playwright.waitForType("ws:matched", 5_000);

      expect(await getHistory(api, proxy.url)).toEqual([]);
      expect(await getWs(api, proxy.url)).toEqual([]);

      playwright.close();
      node.close();
    });
  });
});

test.describe("observability REST — filters and HAR", () => {
  test("filters by q, testId, and action; ranks URL matches", async ({ request: api }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const { testId } = await registerHttpRoute(playwright, {
        title: "filter suite",
        file: "/tests/filter.spec.ts",
        matcher: "http://example.test/**",
      });

      const chargesId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/charges",
        method: "POST",
        body: { secret: "body-token-xyz" },
      });
      await fulfill(playwright, node, chargesId, { status: 201, json: { id: 1 } });

      const pricesId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/prices",
      });
      await abortRequest(playwright, node, pricesId);

      const byUrl = await getHistory(api, proxy.url, "?q=charges");
      expect(byUrl.map((entry) => entry.id)).toContain(chargesId);
      expect(byUrl[0]?.request.url).toContain("charges");

      const byBody = await getHistory(api, proxy.url, "?q=body-token-xyz");
      expect(byBody.map((entry) => entry.id)).toContain(chargesId);

      const byTest = await getHistory(api, proxy.url, `?testId=${testId}`);
      expect(byTest.every((entry) => entry.testId === testId)).toBe(true);
      expect(byTest.map((entry) => entry.id)).toEqual(
        expect.arrayContaining([chargesId, pricesId]),
      );

      const byAction = await getHistory(api, proxy.url, "?action=abort");
      expect(byAction).toHaveLength(1);
      expect(byAction[0]?.id).toBe(pricesId);

      playwright.close();
      node.close();
    });
  });

  test("per-request HAR is a single-entry archive for routeFromHAR", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "har export",
        file: "/tests/har.spec.ts",
        matcher: "**/charges",
      });

      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/charges",
        method: "POST",
        body: { amount: 10 },
      });
      await fulfill(playwright, node, requestId, { status: 201, json: {} });

      expect((await api.get(`${proxy.url}/api/history/missing/har`)).status()).toBe(404);

      const har = await api.get(`${proxy.url}/api/history/${requestId}/har`);
      expect(har.status()).toBe(200);
      expect(har.headers()["content-disposition"]).toMatch(/\.har/);
      const body = (await har.json()) as {
        log: {
          entries: Array<{
            request: { url: string; method: string };
            response: { status: number };
          }>;
        };
      };
      expect(body.log.entries).toHaveLength(1);
      expect(body.log.entries[0]).toMatchObject({
        request: { url: "http://example.test/charges", method: "POST" },
        response: { status: 201 },
      });

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
      const harPreflight = await api.fetch(`${proxy.url}/api/history/x/har`, {
        method: "OPTIONS",
      });
      expect(harPreflight.status()).toBe(204);
    });
  });
});

test.describe("observability REST — WebSockets", () => {
  test("matched sockets record title/path/frames and are readable by id", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerWsRoute(playwright, {
        title: "socket test",
        file: "/tests/ws.spec.ts",
        matcher: "ws://example.test/socket",
      });

      const socketId = randomUUID();
      node.send({
        type: "ws:connection",
        socketId,
        url: "ws://example.test/socket",
        protocols: [],
        clientId: "obs-node",
      });
      await playwright.waitForType("ws:matched", 5_000);

      node.send({
        type: "ws:messageFromPage",
        socketId,
        data: JSON.stringify({ hello: true }),
        isBase64: false,
      });
      playwright.send({
        type: "ws:sendToPage",
        socketId,
        data: JSON.stringify({ ok: true }),
        isBase64: false,
      });
      node.send({
        type: "ws:closePage",
        socketId,
        code: 1000,
        reason: "done",
        wasClean: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 40));

      const list = await getWs(api, proxy.url);
      const entry = list.find((item) => item.id === socketId);
      expect(entry).toMatchObject({
        outcome: "matched",
        title: "socket test",
        path: "/tests/ws.spec.ts",
        url: "ws://example.test/socket",
      });
      expect(entry?.events.some((event) => event.kind === "open")).toBe(true);
      expect(entry?.events.some((event) => event.kind === "frame")).toBe(true);
      expect(entry?.events.some((event) => event.kind === "close")).toBe(true);

      const one = await api.get(`${proxy.url}/api/ws/${socketId}`);
      expect(one.status()).toBe(200);
      expect(await one.json()).toMatchObject({
        connection: { id: socketId, outcome: "matched", title: "socket test" },
      });

      const searched = await getWs(api, proxy.url, "?q=socket");
      expect(searched.map((item) => item.id)).toContain(socketId);

      playwright.close();
      node.close();
    });
  });

  test("all records WS passthrough; handled omits passthrough sockets", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const socketId = randomUUID();
      node.send({
        type: "ws:connection",
        socketId,
        url: "ws://example.test/open",
        protocols: [],
        clientId: "obs-node",
      });
      await node.waitForType("ws:passthrough", 5_000);
      const entries = await getWs(api, proxy.url);
      expect(entries.find((item) => item.id === socketId)).toMatchObject({
        outcome: "passthrough",
      });
      playwright.close();
      node.close();
    });

    await withProxy({ historyCapture: "handled" }, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerWsRoute(playwright, {
        title: "matched only",
        file: "/tests/ws-handled.spec.ts",
        matcher: "ws://example.test/matched",
      });

      const passthroughId = randomUUID();
      node.send({
        type: "ws:connection",
        socketId: passthroughId,
        url: "ws://example.test/other",
        protocols: [],
        clientId: "obs-node",
      });
      await node.waitForType("ws:passthrough", 5_000);

      const matchedId = randomUUID();
      node.send({
        type: "ws:connection",
        socketId: matchedId,
        url: "ws://example.test/matched",
        protocols: [],
        clientId: "obs-node",
      });
      await playwright.waitForType("ws:matched", 5_000);

      const ids = (await getWs(api, proxy.url)).map((item) => item.id);
      expect(ids).toContain(matchedId);
      expect(ids).not.toContain(passthroughId);

      playwright.close();
      node.close();
    });
  });
});
