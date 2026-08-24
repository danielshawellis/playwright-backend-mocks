import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { TestSocket } from "../helpers.js";
import {
  abortRequest,
  fulfill,
  passthrough,
  registerHttpRoute,
  registerWsRoute,
  reportRedirectHop,
  reportUpstreamResponse,
  setupPair,
  startHttpAndMatch,
  withDashboard,
  withProxy,
} from "../observability-helpers.js";

test.describe("observability dashboard", () => {
  test("serves health, config, and SPA pointed at the proxy", async ({ request }) => {
    await withProxy({}, async (proxy) => {
      await withDashboard(proxy.url, async (dashboardUrl) => {
        const health = await request.get(`${dashboardUrl}/health`);
        expect(health.status()).toBe(200);
        expect(await health.json()).toMatchObject({
          ok: true,
          proxyUrl: proxy.url,
        });

        const config = await request.get(`${dashboardUrl}/config.json`);
        expect(await config.json()).toEqual({ proxyUrl: proxy.url });

        const page = await request.get(`${dashboardUrl}/`);
        expect(page.status()).toBe(200);
        expect(page.headers()["content-type"]).toMatch(/text\/html/);
        expect(await page.text()).toContain("Playwright Backend Mocks");
      });
    });
  });

  test("UI chrome: nav, auto-refresh default on, and empty states", async ({ page }) => {
    await withProxy({}, async (proxy) => {
      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await expect(
          page.getByRole("heading", { name: "Playwright Backend Mocks" }),
        ).toBeVisible();
        await expect(page.getByRole("button", { name: "HTTP" })).toBeVisible();
        await expect(page.getByRole("button", { name: "WebSockets" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Connections" })).toBeVisible();
        await expect(page.getByLabel("Auto-refresh")).toBeChecked();
        await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
        await expect(page.getByText("Select a request")).toBeVisible();
        await expect(page.getByRole("link", { name: "Download HAR" })).toHaveCount(0);

        await page.getByRole("button", { name: "WebSockets" }).click();
        await expect(page.getByText("No WebSocket connections yet")).toBeVisible();

        await page.getByRole("button", { name: "Connections" }).click();
        await expect(page.getByText("Node agents", { exact: true })).toBeVisible();
        await expect(page.getByText("Playwright workers", { exact: true })).toBeVisible();
      });
    });
  });

  test("HTTP view shows fulfilled traffic, detail, HAR link, and copy controls", async ({
    page,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "dashboard pay",
        file: "/tests/dashboard-pay.spec.ts",
        matcher: "http://example.test/charges",
      });
      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/charges",
        method: "POST",
        body: { amount: 42 },
      });
      await fulfill(playwright, node, requestId, {
        status: 402,
        json: { error: "card_declined" },
      });

      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await expect(page.getByText("http://example.test/charges").first()).toBeVisible();
        await expect(page.getByText("fulfill").first()).toBeVisible();
        await expect(page.getByText("dashboard pay").first()).toBeVisible();

        await page.getByText("http://example.test/charges").first().click();
        await expect(page.getByText("Select a request")).toHaveCount(0);
        await expect(page.getByText("/tests/dashboard-pay.spec.ts")).toBeVisible();
        await expect(page.getByText("card_declined")).toBeVisible();
        await expect(page.getByRole("link", { name: "Download HAR" })).toBeVisible();
        await expect(page.getByRole("link", { name: "Download HAR" })).toHaveAttribute(
          "href",
          new RegExp(`/api/history/${requestId}/har`),
        );
        await expect(
          page.getByRole("button", { name: "Copy URL" }).first(),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Copy full history entry" }),
        ).toBeVisible();

        await page.getByRole("button", { name: "Connections" }).click();
        await expect(page.getByText("obs-node")).toBeVisible();
        await expect(page.getByText(/pw-obs-worker|playwright/i).first()).toBeVisible();
      });

      playwright.close();
      node.close();
    });
  });

  test("HTTP detail shows upstream responses, abort no-response, and redirect hops", async ({
    page,
  }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "dashboard abort",
        file: "/tests/dashboard-abort.spec.ts",
        matcher: "http://example.test/blocked",
      });

      const passthroughId = await passthrough(node, "http://example.test/redirect");
      const hopId = await reportRedirectHop(node, passthroughId, {
        url: "http://example.test/redirect",
        location: "http://example.test/final",
      });
      reportUpstreamResponse(node, hopId, {
        status: 200,
        body: { via: "hop" },
      });

      const abortId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/blocked",
      });
      await abortRequest(playwright, node, abortId, "aborted");

      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);

        await expect(page.getByText("http://example.test/redirect").first()).toBeVisible({
          timeout: 10_000,
        });
        await page.getByText("http://example.test/redirect").first().click();
        await expect(page.getByRole("heading", { name: "Redirect chain" })).toBeVisible();
        await expect(page.getByRole("button", { name: /final/ })).toBeVisible();
        await page.getByRole("button", { name: /final/ }).click();
        await expect(page.getByText('"via"')).toBeVisible();
        await expect(page.getByText("hop")).toBeVisible();

        await page.getByText("http://example.test/blocked").first().click();
        await expect(page.getByText(/aborted — aborted; no response/)).toBeVisible();
      });

      playwright.close();
      node.close();
    });
  });

  test("WebSocket view shows matched connection and copy controls", async ({ page }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerWsRoute(playwright, {
        title: "dashboard socket",
        file: "/tests/dashboard-ws.spec.ts",
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
      node.send({
        type: "ws:messageFromPage",
        socketId,
        data: JSON.stringify({ ping: 1 }),
        isBase64: false,
      });

      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await page.getByRole("button", { name: "WebSockets" }).click();
        await expect(page.getByText("ws://example.test/live").first()).toBeVisible();
        await expect(page.getByText("dashboard socket").first()).toBeVisible();

        await page.getByText("ws://example.test/live").first().click();
        await expect(page.getByText("Select a connection")).toHaveCount(0);
        await expect(
          page.getByText("/tests/dashboard-ws.spec.ts", { exact: true }),
        ).toBeVisible();
        await expect(page.getByText('"ping"')).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Copy URL" }).first(),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Copy full connection history" }),
        ).toBeVisible();
      });

      playwright.close();
      node.close();
    });
  });

  test("Refresh picks up newly recorded HTTP traffic", async ({ page }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "late request",
        file: "/tests/late.spec.ts",
        matcher: "http://example.test/late",
      });

      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await expect(page.getByText("No requests yet")).toBeVisible();

        // Pause auto-refresh so we explicitly exercise the Refresh button.
        await page.getByLabel("Auto-refresh").uncheck();

        const requestId = await startHttpAndMatch(node, playwright, {
          url: "http://example.test/late",
        });
        await fulfill(playwright, node, requestId, { status: 200, json: { ok: true } });

        await page.getByRole("button", { name: "Refresh" }).click();
        await expect(page.getByText("http://example.test/late").first()).toBeVisible();
        await expect(page.getByText("late request").first()).toBeVisible();
      });

      playwright.close();
      node.close();
    });
  });

  test("copy URL writes the request URL to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "copy me",
        file: "/tests/copy.spec.ts",
        matcher: "http://example.test/copy-target",
      });
      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/copy-target",
      });
      await fulfill(playwright, node, requestId, { status: 200 });

      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await page.getByText("http://example.test/copy-target").first().click();
        await page.getByRole("button", { name: "Copy URL" }).first().click();
        await expect(page.getByRole("status")).toContainText("URL copied");
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          "http://example.test/copy-target",
        );
      });

      playwright.close();
      node.close();
    });
  });

  test("time range filter can hide existing requests", async ({ page }) => {
    await withProxy({}, async (proxy) => {
      const { playwright, node } = await setupPair(proxy.url);
      await registerHttpRoute(playwright, {
        title: "range filter",
        file: "/tests/range.spec.ts",
        matcher: "http://example.test/range",
      });
      const requestId = await startHttpAndMatch(node, playwright, {
        url: "http://example.test/range",
      });
      await fulfill(playwright, node, requestId, { status: 200 });

      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await expect(page.getByText("http://example.test/range").first()).toBeVisible();

        // From far in the future → no matches.
        await page.getByLabel("From time").fill("2099-01-01T00:00");
        await expect(page.getByText("No matching requests")).toBeVisible();

        await page.getByLabel("From time").fill("");
        await expect(page.getByText("http://example.test/range").first()).toBeVisible();
      });

      playwright.close();
      node.close();
    });
  });

  test("ambiguous_route shows callout with claiming tests and docs link", async ({
    page,
  }) => {
    await withProxy({}, async (proxy) => {
      const workerA = await TestSocket.connect(proxy.url);
      const workerB = await TestSocket.connect(proxy.url);
      const node = await TestSocket.connect(proxy.url);

      expect((await workerA.hello({ role: "playwright", workerId: "dash-a" })).type).toBe(
        "hello:ok",
      );
      expect((await workerB.hello({ role: "playwright", workerId: "dash-b" })).type).toBe(
        "hello:ok",
      );
      expect((await node.hello({ role: "node", clientId: "obs-node" })).type).toBe(
        "hello:ok",
      );

      const testA = randomUUID();
      const testB = randomUUID();
      workerA.send({
        type: "test:register",
        testId: testA,
        title: "dashboard claim A",
        file: "/tests/dash-a.spec.ts",
        workerId: "dash-a",
      });
      workerA.send({
        type: "route:register",
        routeId: randomUUID(),
        testId: testA,
        matcher: { urlGlob: "http://example.test/collision" },
      });
      workerB.send({
        type: "test:register",
        testId: testB,
        title: "dashboard claim B",
        file: "/tests/dash-b.spec.ts",
        workerId: "dash-b",
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
          url: "http://example.test/collision",
          method: "GET",
          headers: {},
          bodyBase64: null,
        },
      });
      await node.waitForType("decision:error", 5_000);

      await withDashboard(proxy.url, async (dashboardUrl) => {
        await page.goto(dashboardUrl);
        await page.getByLabel("Auto-refresh").uncheck();
        await expect(page.getByText("ambiguous").first()).toBeVisible();
        await page.getByText("http://example.test/collision").first().click();

        const callout = page.locator(".callout--danger");
        await expect(
          callout.getByRole("heading", { name: "Ambiguous route" }),
        ).toBeVisible();
        await expect(callout).toContainText("dashboard claim A");
        await expect(callout).toContainText("dashboard claim B");
        await expect(callout).toContainText("/tests/dash-a.spec.ts");
        await expect(callout).toContainText("/tests/dash-b.spec.ts");
        await expect(
          callout.getByRole("link", { name: "How to fix ambiguous_route →" }),
        ).toHaveAttribute("href", /troubleshooting#ambiguous_route/);
      });

      workerA.close();
      workerB.close();
      node.close();
    });
  });
});
