import { test, expect } from "@playwright-backend-mocks/playwright";
import { UPSTREAM, WORKER_URL, callVia, readProxyJson } from "../helpers.js";

test.describe("matchers", () => {
  test("matches Playwright-style URL globs", async ({ request, backendMocks }) => {
    await backendMocks.route("http://127.0.0.1:4001/**", async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 1, name: "Glob" }],
      });
    });

    const response = await callVia(request, "fetch", "/users");
    const body = await readProxyJson(response);
    expect(body.data).toEqual([{ id: 1, name: "Glob" }]);
  });

  test("matches RegExp URLs", async ({ request, backendMocks }) => {
    await backendMocks.route(/\/users$/, async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 2, name: "Regex" }],
      });
    });

    const response = await callVia(request, "http", "/users");
    const body = await readProxyJson(response);
    expect(body.data).toEqual([{ id: 2, name: "Regex" }]);
  });

  test("filters by method", async ({ request, backendMocks }) => {
    await backendMocks.route(
      { url: `${UPSTREAM}/echo`, method: "POST" },
      async (route) => {
        await route.fulfill({
          status: 200,
          json: { mocked: true, method: "POST" },
        });
      },
    );

    const getResponse = await callVia(request, "fetch", "/echo");
    const getBody = await readProxyJson(getResponse);
    expect(getBody.data).toMatchObject({ method: "GET" });
    expect(getBody.data).not.toMatchObject({ mocked: true });

    const postResponse = await callVia(request, "fetch", "/echo", {
      method: "POST",
      data: { hello: "world" },
    });
    const postBody = await readProxyJson(postResponse);
    expect(postBody.data).toEqual({ mocked: true, method: "POST" });
  });

  test("filters by clientId across processes", async ({ request, backendMocks }) => {
    await backendMocks.route(
      { url: `${UPSTREAM}/users`, clientId: "job-worker" },
      async (route) => {
        await route.fulfill({
          status: 200,
          json: [{ id: 3, name: "WorkerOnly" }],
        });
      },
    );

    const apiResponse = await callVia(request, "http", "/users");
    const apiBody = await readProxyJson(apiResponse);
    expect(apiBody.clientId).toBe("api-server");
    expect(apiBody.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);

    const workerResponse = await callVia(request, "http", "/users", {
      origin: WORKER_URL,
    });
    const workerBody = await readProxyJson(workerResponse);
    expect(workerBody.clientId).toBe("job-worker");
    expect(workerBody.data).toEqual([{ id: 3, name: "WorkerOnly" }]);
  });
});

test.describe("lifecycle", () => {
  test("unroute restores passthrough", async ({ request, backendMocks }) => {
    await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
      await route.fulfill({
        status: 200,
        json: [{ id: 1, name: "Temporary" }],
      });
    });

    const mocked = await readProxyJson(await callVia(request, "fetch", "/users"));
    expect(mocked.data).toEqual([{ id: 1, name: "Temporary" }]);

    await backendMocks.unroute(`${UPSTREAM}/users`);

    const passthrough = await readProxyJson(await callVia(request, "fetch", "/users"));
    expect(passthrough.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("ambiguous routes fail the Node request and notify Playwright", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
      await route.fulfill({ json: [{ id: 1, name: "A" }] });
    });
    await backendMocks.route(/users$/, async (route) => {
      await route.fulfill({ json: [{ id: 2, name: "B" }] });
    });

    const response = await callVia(request, "fetch", "/users");
    expect(response.status()).toBe(500);
    const body = await readProxyJson(response);
    // Fetch collapses the interceptor error to "fetch failed"; the actionable
    // ambiguity message is delivered to Playwright via proxy:error.
    expect(body.error).toBe("request_failed");
    expect(body.message?.length).toBeGreaterThan(0);

    const errors = backendMocks.takeErrors();
    expect(errors.length).toBe(1);
    expect(errors[0]?.message).toMatch(/Ambiguous backend mock routing/i);
  });
});
