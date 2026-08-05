import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { TestSocket } from "../helpers.js";
import {
  abortRequest,
  continueRequest,
  fulfill,
  getHistory,
  getWs,
  passthrough,
  registerHttpRoute,
  registerWsRoute,
  reportRedirectHop,
  reportUpstreamError,
  reportUpstreamResponse,
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

  test("all mode records continue (with overrides) and abort", async ({
    request: api,
  }) => {
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
      reportUpstreamResponse(node, continueId, {
        status: 200,
        body: { price: 9 },
        url: "http://example.test/prices-v2",
      });

      const abortId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/blocked",
      });
      await abortRequest(playwright, node, abortId, "aborted");

      await expect
        .poll(async () => {
          const entries = await getHistory(api, proxy.url);
          return entries.find((item) => item.id === continueId)?.outcome.response?.status;
        })
        .toBe(200);

      const entries = await getHistory(api, proxy.url);
      const continued = entries.find((item) => item.id === continueId);
      expect(continued).toMatchObject({
        action: "continue",
        title: "modify and abort",
        path: "/tests/actions.spec.ts",
        outcome: {
          kind: "continued",
          response: { status: 200 },
        },
        overrides: {
          url: "http://example.test/prices-v2",
          method: "GET",
        },
      });
      expect(continued?.events?.some((event) => event.kind === "response")).toBe(true);

      const aborted = entries.find((item) => item.id === abortId);
      expect(aborted).toMatchObject({
        action: "abort",
        title: "modify and abort",
        outcome: { kind: "aborted", errorCode: "aborted" },
      });
      expect(aborted?.outcome.response).toBeUndefined();

      playwright.close();
      node.close();
    });
  });

  test("passthrough and continue store upstream responses; abort has none", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "response matrix",
        file: "/tests/responses.spec.ts",
        matcher: "http://example.test/owned/**",
      });

      const passthroughId = await passthrough(node, "http://example.test/health");
      reportUpstreamResponse(node, passthroughId, {
        status: 204,
        statusText: "No Content",
        headers: { "x-from": "upstream" },
      });

      const continueId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/owned/continue",
      });
      await continueRequest(playwright, node, continueId);
      reportUpstreamResponse(node, continueId, {
        status: 201,
        body: { created: true },
      });

      const abortId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/owned/abort",
      });
      await abortRequest(playwright, node, abortId, "connectionrefused");

      const fulfillId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/owned/fulfill",
      });
      await fulfill(playwright, node, fulfillId, {
        status: 418,
        json: { teapot: true },
      });

      await expect
        .poll(async () => {
          const entries = await getHistory(api, proxy.url);
          return {
            passthrough: entries.find((e) => e.id === passthroughId)?.outcome.response
              ?.status,
            continued: entries.find((e) => e.id === continueId)?.outcome.response?.status,
          };
        })
        .toEqual({ passthrough: 204, continued: 201 });

      const entries = await getHistory(api, proxy.url);

      expect(entries.find((e) => e.id === passthroughId)).toMatchObject({
        action: "passthrough",
        outcome: {
          kind: "passthrough",
          response: { status: 204, headers: { "x-from": "upstream" } },
        },
      });
      expect(entries.find((e) => e.id === continueId)).toMatchObject({
        action: "continue",
        outcome: { kind: "continued", response: { status: 201 } },
      });
      expect(entries.find((e) => e.id === abortId)).toMatchObject({
        action: "abort",
        outcome: { kind: "aborted", errorCode: "connectionrefused" },
      });
      expect(entries.find((e) => e.id === abortId)?.outcome.response).toBeUndefined();
      expect(entries.find((e) => e.id === fulfillId)).toMatchObject({
        action: "fulfill",
        outcome: { kind: "mocked", response: { status: 418 } },
      });

      playwright.close();
      node.close();
    });
  });

  test("records redirect hop chains for passthrough with linked ids", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const rootId = await passthrough(node, "http://example.test/redirect");
      const hopId = await reportRedirectHop(node, rootId, {
        url: "http://example.test/redirect",
        location: "http://example.test/final",
      });
      reportUpstreamResponse(node, hopId, {
        status: 200,
        body: { ok: true },
        url: "http://example.test/final",
      });

      await expect
        .poll(async () => {
          const entries = await getHistory(api, proxy.url);
          return {
            rootTo: entries.find((e) => e.id === rootId)?.redirectedToId,
            hopFrom: entries.find((e) => e.id === hopId)?.redirectedFromId,
            hopStatus: entries.find((e) => e.id === hopId)?.outcome.response?.status,
            rootStatus: entries.find((e) => e.id === rootId)?.outcome.response?.status,
          };
        })
        .toEqual({
          rootTo: hopId,
          hopFrom: rootId,
          hopStatus: 200,
          rootStatus: 302,
        });

      const entries = await getHistory(api, proxy.url);
      const root = entries.find((e) => e.id === rootId);
      const hop = entries.find((e) => e.id === hopId);
      expect(root).toMatchObject({
        action: "passthrough",
        request: { url: "http://example.test/redirect" },
        outcome: { kind: "passthrough", response: { status: 302 } },
        redirectedToId: hopId,
      });
      expect(hop).toMatchObject({
        action: "passthrough",
        request: { url: "http://example.test/final" },
        outcome: { kind: "passthrough", response: { status: 200 } },
        redirectedFromId: rootId,
      });

      const rootHar = await api.get(`${proxy.url}/api/history/${rootId}/har`);
      const rootBody = (await rootHar.json()) as {
        log: { entries: Array<{ response: { status: number; redirectURL: string } }> };
      };
      expect(rootBody.log.entries[0]?.response).toMatchObject({
        status: 302,
        redirectURL: "http://example.test/final",
      });

      playwright.close();
      node.close();
    });
  });

  test("continue redirect hops inherit test metadata; handled omits passthrough hops", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "continue hops",
        file: "/tests/hops.spec.ts",
        matcher: "http://example.test/start",
      });

      const rootId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/start",
      });
      await continueRequest(playwright, node, rootId);
      const hopId = await reportRedirectHop(node, rootId, {
        url: "http://example.test/start",
        location: "http://example.test/end",
      });
      reportUpstreamResponse(node, hopId, { status: 200, body: { done: true } });

      await expect
        .poll(async () => (await getHistory(api, proxy.url)).find((e) => e.id === hopId))
        .toMatchObject({
          action: "continue",
          title: "continue hops",
          path: "/tests/hops.spec.ts",
          redirectedFromId: rootId,
          outcome: { kind: "continued", response: { status: 200 } },
        });

      playwright.close();
      node.close();
    });

    await withProxy({ historyCapture: "handled" }, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const rootId = await passthrough(node, "http://example.test/skip-redirect");
      const hopId = await reportRedirectHop(node, rootId, {
        url: "http://example.test/skip-redirect",
        location: "http://example.test/skip-final",
      });
      reportUpstreamResponse(node, hopId, { status: 200, body: {} });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const ids = (await getHistory(api, proxy.url)).map((e) => e.id);
      expect(ids).not.toContain(rootId);
      expect(ids).not.toContain(hopId);

      playwright.close();
      node.close();
    });
  });

  test("upstream failure on continue records timeline error without inventing a body", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "upstream fail",
        file: "/tests/fail.spec.ts",
        matcher: "http://example.test/**",
      });
      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/down",
      });
      await continueRequest(playwright, node, requestId);
      reportUpstreamError(node, requestId, "connect ECONNREFUSED");

      await expect
        .poll(async () => {
          const entry = (await getHistory(api, proxy.url)).find(
            (e) => e.id === requestId,
          );
          return entry?.events?.some((event) => event.kind === "upstream_error");
        })
        .toBe(true);

      const entry = (await getHistory(api, proxy.url)).find((e) => e.id === requestId);
      expect(entry).toMatchObject({
        action: "continue",
        outcome: { kind: "continued" },
      });
      expect(entry?.outcome.response).toBeUndefined();

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

  test("none mode records neither HTTP nor WebSocket history", async ({
    request: api,
  }) => {
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
  test("filters by q, testId, and action; ranks URL matches", async ({
    request: api,
  }) => {
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
          creator: { version: string };
          entries: Array<{
            request: { url: string; method: string };
            response: { status: number };
          }>;
        };
      };
      expect(body.log.creator.version).toBeTruthy();
      expect(body.log.entries).toHaveLength(1);
      expect(body.log.entries[0]).toMatchObject({
        request: { url: "http://example.test/charges", method: "POST" },
        response: { status: 201 },
      });

      playwright.close();
      node.close();
    });
  });

  test("HAR export rejects continue/abort without a recorded response", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "thin continue",
        file: "/tests/har-gate.spec.ts",
        matcher: "http://example.test/**",
      });

      const continueId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/continue",
      });
      await continueRequest(playwright, node, continueId, {
        url: "http://example.test/continued",
      });
      const continueHar = await api.get(`${proxy.url}/api/history/${continueId}/har`);
      expect(continueHar.status()).toBe(409);
      expect(await continueHar.json()).toMatchObject({ error: "har_unavailable" });

      const abortId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/abort",
      });
      await abortRequest(playwright, node, abortId);
      const abortHar = await api.get(`${proxy.url}/api/history/${abortId}/har`);
      expect(abortHar.status()).toBe(409);
      expect(await abortHar.json()).toMatchObject({ error: "har_unavailable" });

      playwright.close();
      node.close();
    });
  });

  test("HAR export allows continue after upstream response is recorded", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "continue with body",
        file: "/tests/har-gate-upstream.spec.ts",
        matcher: "http://example.test/with-body",
      });

      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/with-body",
      });
      await continueRequest(playwright, node, requestId);
      reportUpstreamResponse(node, requestId, {
        status: 200,
        body: { ok: true },
      });

      const har = await api.get(`${proxy.url}/api/history/${requestId}/har`);
      expect(har.status()).toBe(200);
      const body = (await har.json()) as {
        log: { entries: Array<{ response: { status: number } }> };
      };
      expect(body.log.entries).toHaveLength(1);
      expect(body.log.entries[0]?.response.status).toBe(200);

      playwright.close();
      node.close();
    });
  });

  test("test unregister while pending keeps title/path on history error", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      const { testId } = await registerHttpRoute(playwright, {
        title: "ends mid-flight",
        file: "/tests/unregister.spec.ts",
        matcher: "http://example.test/pending",
      });

      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/pending",
      });
      playwright.send({ type: "test:unregister", testId });
      const decision = await node.waitForType("decision:error", 5_000);
      expect(decision).toMatchObject({ code: "disconnected" });

      const entry = (await getHistory(api, proxy.url)).find(
        (item) => item.id === requestId,
      );
      expect(entry).toMatchObject({
        action: "error",
        title: "ends mid-flight",
        path: "/tests/unregister.spec.ts",
        testId,
        outcome: { kind: "error", code: "disconnected" },
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

  test("time range from/to filters history", async ({ request: api }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "time filter",
        file: "/tests/time.spec.ts",
        matcher: "http://example.test/**",
      });

      const firstId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/first",
      });
      await fulfill(playwright, node, firstId, { status: 200 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const secondId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/second",
      });
      await fulfill(playwright, node, secondId, { status: 200 });

      const all = await getHistory(api, proxy.url);
      const first = all.find((entry) => entry.id === firstId);
      const second = all.find((entry) => entry.id === secondId);
      expect(first?.timestamp).toBeTruthy();
      expect(second?.timestamp).toBeTruthy();

      const onlyFirst = await getHistory(
        api,
        proxy.url,
        `?from=${first!.timestamp}&to=${first!.timestamp}`,
      );
      expect(onlyFirst.map((entry) => entry.id)).toContain(firstId);
      expect(onlyFirst.map((entry) => entry.id)).not.toContain(secondId);

      const afterFirst = await getHistory(
        api,
        proxy.url,
        `?from=${(first!.timestamp ?? 0) + 1}`,
      );
      expect(afterFirst.map((entry) => entry.id)).toContain(secondId);
      expect(afterFirst.map((entry) => entry.id)).not.toContain(firstId);

      playwright.close();
      node.close();
    });
  });

  test("ambiguous_route history includes code and claiming tests", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const workerA = await TestSocket.connect(proxy.url);
      const workerB = await TestSocket.connect(proxy.url);
      const node = await TestSocket.connect(proxy.url);

      expect(
        (await workerA.hello({ role: "playwright", workerId: "ambig-a" })).type,
      ).toBe("hello:ok");
      expect(
        (await workerB.hello({ role: "playwright", workerId: "ambig-b" })).type,
      ).toBe("hello:ok");
      expect((await node.hello({ role: "node", clientId: "obs-node" })).type).toBe(
        "hello:ok",
      );

      const testA = randomUUID();
      const testB = randomUUID();
      workerA.send({
        type: "test:register",
        testId: testA,
        title: "claiming test A",
        file: "/tests/a.spec.ts",
        workerId: "ambig-a",
      });
      workerA.send({
        type: "route:register",
        routeId: randomUUID(),
        testId: testA,
        matcher: { urlGlob: "http://example.test/shared" },
      });
      workerB.send({
        type: "test:register",
        testId: testB,
        title: "claiming test B",
        file: "/tests/b.spec.ts",
        workerId: "ambig-b",
      });
      workerB.send({
        type: "route:register",
        routeId: randomUUID(),
        testId: testB,
        matcher: { urlGlob: "http://example.test/**" },
      });
      await new Promise((resolve) => setTimeout(resolve, 40));

      const requestId = randomUUID();
      node.send({
        type: "request:start",
        requestId,
        clientId: "obs-node",
        request: {
          url: "http://example.test/shared",
          method: "GET",
          headers: {},
          bodyBase64: null,
        },
      });
      const decision = await node.waitForType("decision:error", 5_000);
      expect(decision).toMatchObject({ code: "ambiguous_route" });

      const entry = (await getHistory(api, proxy.url)).find(
        (item) => item.id === requestId,
      );
      expect(entry).toMatchObject({
        action: "error",
        outcome: {
          kind: "error",
          code: "ambiguous_route",
        },
      });
      const titles = (entry?.outcome.matches ?? []).map((match) => match.title);
      expect(titles).toEqual(
        expect.arrayContaining(["claiming test A", "claiming test B"]),
      );

      workerA.close();
      workerB.close();
      node.close();
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

  test("Playwright disconnect settles matched WS history as error with ownership", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerWsRoute(playwright, {
        title: "live socket",
        file: "/tests/ws-disconnect.spec.ts",
        matcher: "ws://example.test/live",
      });

      const socketId = randomUUID();
      node.send({
        type: "ws:connection",
        socketId,
        url: "ws://example.test/live",
        protocols: [],
        clientId: "obs-node",
      });
      await playwright.waitForType("ws:matched", 5_000);

      playwright.close();
      const error = await node.waitForType("ws:error", 5_000);
      expect(error).toMatchObject({ socketId, code: "disconnected" });

      const entry = (await getWs(api, proxy.url)).find((item) => item.id === socketId);
      expect(entry).toMatchObject({
        outcome: "error",
        title: "live socket",
        path: "/tests/ws-disconnect.spec.ts",
        url: "ws://example.test/live",
      });
      expect(entry?.events.some((event) => event.kind === "error")).toBe(true);

      node.close();
    });
  });

  test("ambiguous_route WS history includes code and claiming tests", async ({
    request: api,
  }) => {
    await withProxy({}, async (proxy) => {
      const workerA = await TestSocket.connect(proxy.url);
      const workerB = await TestSocket.connect(proxy.url);
      const node = await TestSocket.connect(proxy.url);

      expect(
        (await workerA.hello({ role: "playwright", workerId: "ws-ambig-a" })).type,
      ).toBe("hello:ok");
      expect(
        (await workerB.hello({ role: "playwright", workerId: "ws-ambig-b" })).type,
      ).toBe("hello:ok");
      expect((await node.hello({ role: "node", clientId: "obs-node" })).type).toBe(
        "hello:ok",
      );

      const testA = randomUUID();
      const testB = randomUUID();
      workerA.send({
        type: "test:register",
        testId: testA,
        title: "ws claim A",
        file: "/tests/ws-a.spec.ts",
        workerId: "ws-ambig-a",
      });
      workerA.send({
        type: "route:register",
        routeId: randomUUID(),
        testId: testA,
        kind: "websocket",
        matcher: { urlGlob: "ws://example.test/shared" },
      });
      workerB.send({
        type: "test:register",
        testId: testB,
        title: "ws claim B",
        file: "/tests/ws-b.spec.ts",
        workerId: "ws-ambig-b",
      });
      workerB.send({
        type: "route:register",
        routeId: randomUUID(),
        testId: testB,
        kind: "websocket",
        matcher: { urlGlob: "ws://example.test/**" },
      });
      await new Promise((resolve) => setTimeout(resolve, 40));

      const socketId = randomUUID();
      node.send({
        type: "ws:connection",
        socketId,
        url: "ws://example.test/shared",
        protocols: [],
        clientId: "obs-node",
      });
      const decision = await node.waitForType("ws:error", 5_000);
      expect(decision).toMatchObject({ code: "ambiguous_route" });

      const detail = await api.get(`${proxy.url}/api/ws/${socketId}`);
      expect(detail.status()).toBe(200);
      const body = (await detail.json()) as {
        connection: {
          id: string;
          outcome: string;
          errorCode?: string;
          matches?: Array<{ title: string }>;
        };
      };
      expect(body.connection).toMatchObject({
        id: socketId,
        outcome: "error",
        errorCode: "ambiguous_route",
      });
      expect(body.connection.matches?.map((match) => match.title)).toEqual(
        expect.arrayContaining(["ws claim A", "ws claim B"]),
      );

      workerA.close();
      workerB.close();
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
