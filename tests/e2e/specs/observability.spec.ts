import { test, expect } from "@playwright-backend-mocks/playwright";
import { UPSTREAM, callVia } from "../helpers.js";

test.describe("proxy observability", () => {
  test("health endpoint reports protocol version", async ({ request }) => {
    const health = await request.get("http://127.0.0.1:4310/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({
      ok: true,
      protocolVersion: 1,
    });
  });

  test("dashboard and history APIs are available", async ({ request, backendMocks }) => {
    await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 1, name: "Dashboard" }],
      });
    });
    await callVia(request, "fetch", "/users");

    const dashboard = await request.get("http://127.0.0.1:4310/dashboard");
    expect(dashboard.status()).toBe(200);
    expect(await dashboard.text()).toContain("Playwright Backend Mocks");

    const history = await request.get("http://127.0.0.1:4310/api/history");
    expect(history.status()).toBe(200);
    const body = (await history.json()) as {
      entries: Array<{ request: { url: string }; outcome: { kind: string } }>;
    };
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries.some((entry) => entry.request.url.includes("/users"))).toBe(true);

    const connections = await request.get("http://127.0.0.1:4310/api/connections");
    expect(connections.status()).toBe(200);
    const conn = (await connections.json()) as {
      nodeAgents: Array<{ clientId: string }>;
      playwrightWorkers: unknown[];
    };
    expect(conn.nodeAgents.map((agent) => agent.clientId)).toEqual(
      expect.arrayContaining(["api-server", "job-worker"]),
    );
    expect(conn.playwrightWorkers.length).toBeGreaterThan(0);
  });
});
