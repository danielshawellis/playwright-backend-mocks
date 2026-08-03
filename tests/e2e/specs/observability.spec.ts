import { test, expect } from "@playwright-backend-mocks/playwright";
import { UPSTREAM, callVia, readProxyJson } from "../helpers.js";

test.describe("proxy observability", () => {
  test("health endpoint reports protocol version", async ({ request }) => {
    const health = await request.get("http://127.0.0.1:4310/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      protocolVersion: 1,
    });
  });

  test("proxy does not serve the dashboard UI", async ({ request }) => {
    const dashboard = await request.get("http://127.0.0.1:4310/dashboard");
    expect(dashboard.status()).toBe(404);
    expect(await dashboard.json()).toEqual({ error: "not_found" });
  });

  test("REST API enables CORS for separate dashboard origins", async ({ request }) => {
    const history = await request.get("http://127.0.0.1:4310/api/history");
    expect(history.status()).toBe(200);
    expect(history.headers()["access-control-allow-origin"]).toBe("*");

    const preflight = await request.fetch("http://127.0.0.1:4310/api/history", {
      method: "OPTIONS",
    });
    expect(preflight.status()).toBe(204);
    expect(preflight.headers()["access-control-allow-origin"]).toBe("*");
    expect(preflight.headers()["access-control-allow-methods"]).toMatch(/GET/i);
  });

  test("dashboard process serves UI and points at the proxy", async ({ request }) => {
    const health = await request.get("http://127.0.0.1:4311/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      proxyUrl: "http://127.0.0.1:4310",
    });

    const config = await request.get("http://127.0.0.1:4311/config.json");
    expect(config.status()).toBe(200);
    expect(await config.json()).toEqual({ proxyUrl: "http://127.0.0.1:4310" });

    const page = await request.get("http://127.0.0.1:4311/");
    expect(page.status()).toBe(200);
    expect(page.headers()["content-type"]).toMatch(/text\/html/);
    const html = await page.text();
    expect(html).toContain("Playwright Backend Mocks");
  });

  test("history and connections APIs reflect mocked traffic", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 1, name: "Dashboard" }],
      });
    });

    const proxied = await readProxyJson(await callVia(request, "fetch", "/users"));
    expect(proxied.data).toEqual([{ id: 1, name: "Dashboard" }]);

    const history = await request.get("http://127.0.0.1:4310/api/history");
    expect(history.status()).toBe(200);
    const body = (await history.json()) as {
      entries: Array<{
        request: { url: string; method: string };
        clientId: string;
        outcome: { kind: string };
      }>;
    };
    expect(body.entries.length).toBeGreaterThan(0);

    const mockedEntry = body.entries.find(
      (entry) => entry.request.url.includes("/users") && entry.outcome.kind === "mocked",
    );
    expect(mockedEntry).toBeTruthy();
    expect(mockedEntry?.clientId).toBe("api-server");
    expect(mockedEntry?.request.method).toBe("GET");

    const connections = await request.get("http://127.0.0.1:4310/api/connections");
    expect(connections.status()).toBe(200);
    const conn = (await connections.json()) as {
      nodeAgents: Array<{ clientId: string }>;
      playwrightWorkers: Array<{
        clientId: string;
        testCount: number;
        routeCount: number;
      }>;
    };
    expect(conn.nodeAgents.map((agent) => agent.clientId)).toEqual(
      expect.arrayContaining(["api-server", "job-worker"]),
    );
    expect(conn.playwrightWorkers.length).toBeGreaterThan(0);
    expect(conn.playwrightWorkers[0]?.routeCount).toBeGreaterThan(0);
  });

  test("history records passthrough outcomes", async ({ request }) => {
    await callVia(request, "http", "/echo");

    const history = await request.get("http://127.0.0.1:4310/api/history");
    const body = (await history.json()) as {
      entries: Array<{ request: { url: string }; outcome: { kind: string } }>;
    };
    expect(
      body.entries.some(
        (entry) =>
          entry.request.url.includes("/echo") && entry.outcome.kind === "passthrough",
      ),
    ).toBe(true);
  });
});
