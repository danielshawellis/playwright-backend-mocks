import { test, expect } from "@playwright-backend-mocks/playwright";

test("mocks a declined payment from the Node server", async ({ page, backendMocks }) => {
  await backendMocks.route("http://127.0.0.1:4001/charges", async (route) => {
    await route.fulfill({
      status: 402,
      json: { error: "card_declined" },
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByText("Your card was declined")).toBeVisible();
});

test("passthrough reaches the real upstream", async ({ request, backendMocks }) => {
  // No route registered — should pass through.
  const response = await request.get("/api/users");
  expect(response.status()).toBe(200);
  const json = (await response.json()) as Array<{ name: string }>;
  expect(json.map((user) => user.name)).toEqual(["Ada", "Grace"]);

  // Sanity: history API still available through wait helper after a routed call.
  await backendMocks.route("http://127.0.0.1:4001/users", async (route) => {
    await route.fulfill({
      status: 200,
      json: [{ id: 9, name: "Mocked" }],
    });
  });

  const mocked = await request.get("/api/users");
  expect(await mocked.json()).toEqual([{ id: 9, name: "Mocked" }]);
});

test("supports fetch + modify + fulfill", async ({ request, backendMocks }) => {
  await backendMocks.route("http://127.0.0.1:4001/users", async (route) => {
    const response = await route.fetch();
    const users = response.json() as Array<{ id: number; name: string }>;
    users.push({ id: 100, name: "Loquat" });
    await route.fulfill({ response, json: users });
  });

  const response = await request.get("/api/users");
  expect(await response.json()).toEqual([
    { id: 1, name: "Ada" },
    { id: 2, name: "Grace" },
    { id: 100, name: "Loquat" },
  ]);
});

test("aborts a request with a network error", async ({ request, backendMocks }) => {
  await backendMocks.route("http://127.0.0.1:4001/users", async (route) => {
    await route.abort("connectionrefused");
  });

  const response = await request.get("/api/users");
  // Fetch surfaces interceptor errors as TypeError("fetch failed").
  expect(response.status()).toBe(500);
  const body = (await response.json()) as { error: string; message: string };
  expect(body.error).toBe("request_failed");
  expect(body.message.length).toBeGreaterThan(0);
});

test("waits for and inspects backend requests", async ({ request, backendMocks }) => {
  await backendMocks.route("http://127.0.0.1:4001/charges", async (route, req) => {
    expect(req.method).toBe("POST");
    expect(req.json()).toEqual({ amount: 2500 });
    await route.fulfill({
      status: 201,
      json: { id: "ch_mock", status: "succeeded" },
    });
  });

  const pending = backendMocks.waitForRequest("http://127.0.0.1:4001/charges");
  const response = await request.post("/api/pay");
  const seen = await pending;

  expect(response.status()).toBe(201);
  expect(seen.clientId).toBe("api-server");
  expect(seen.postData).toContain("2500");

  const all = await backendMocks.requests("http://127.0.0.1:4001/charges");
  expect(all.length).toBeGreaterThanOrEqual(1);
});

test("mocks axios traffic from the api server", async ({ request, backendMocks }) => {
  await backendMocks.route("http://127.0.0.1:4001/users", async (route) => {
    await route.fulfill({
      status: 200,
      json: [{ id: 7, name: "Axios" }],
    });
  });

  const response = await request.get("/api/users-axios");
  expect(await response.json()).toEqual([{ id: 7, name: "Axios" }]);
});

test("mocks node:http traffic from a second process", async ({
  request,
  backendMocks,
}) => {
  await backendMocks.route(
    {
      url: "http://127.0.0.1:4001/users",
      clientId: "job-worker",
    },
    async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 3, name: "Worker" }],
      });
    },
  );

  const response = await request.post("http://127.0.0.1:3001/run");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    source: "node:http",
    data: [{ id: 3, name: "Worker" }],
  });
});

test("proxy health and dashboard are available", async ({ request }) => {
  const health = await request.get("http://127.0.0.1:4310/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({
    ok: true,
    protocolVersion: 1,
  });

  const dashboard = await request.get("http://127.0.0.1:4310/dashboard");
  expect(dashboard.status()).toBe(200);
  expect(await dashboard.text()).toContain("Playwright Backend Mocks");

  const history = await request.get("http://127.0.0.1:4310/api/history");
  expect(history.status()).toBe(200);
  const body = (await history.json()) as { entries: unknown[] };
  expect(Array.isArray(body.entries)).toBe(true);
});
