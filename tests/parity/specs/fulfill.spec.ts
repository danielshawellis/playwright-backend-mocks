import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, UPSTREAM } from "../harness.js";
import { headerValue } from "../helpers.js";

const fulfillBodyPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/fulfill-body.txt",
);

test.describe("route.fulfill", () => {
  test("mocks a GET JSON response", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 200,
        json: [{ id: 9, name: "Mocked" }],
      });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([{ id: 9, name: "Mocked" }]);
  });

  test("supports status, headers, contentType, and raw body", async ({
    route,
    trigger,
    page,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 418,
        headers: {
          "x-mock": "yes",
          // Expose custom headers to browser fetch (cross-origin).
          "access-control-expose-headers": "x-mock",
        },
        contentType: "text/plain",
        body: "teapot",
      });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.status).toBe(418);
    expect(result.raw).toBe("teapot");
    expect(response.headers()["x-mock"]).toBe("yes");
    expect(headerValue(result.headers, "x-mock")).toBe("yes");
  });

  test("accepts a Buffer body", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/text`, async (r) => {
      await r.fulfill({
        status: 200,
        contentType: "text/plain",
        body: Buffer.from("buffer-body"),
      });
    });

    const result = await trigger("/text");
    expect(result.status).toBe(200);
    expect(result.raw).toBe("buffer-body");
  });

  test("serves a local file via path", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 200,
        contentType: "text/plain",
        path: fulfillBodyPath,
      });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.raw?.trim()).toBe("hello-from-file");
  });

  test("works with status code 422", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 422, body: "unprocessable" });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(422);
    expect(result.raw).toBe("unprocessable");
  });

  test("fulfills with an unassigned status code", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 430, body: "custom" });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(430);
    expect(result.raw).toBe("custom");
  });

  test("stringifies response headers", async ({ route, trigger, page }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 200,
        headers: {
          foo: "true",
          "access-control-expose-headers": "foo",
        },
        body: "ok",
      });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.raw).toBe("ok");
    expect(response.headers().foo).toBe("true");
  });

  test("fulfills json convenience option", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/simple.json`, async (r) => {
      await r.fulfill({
        status: 201,
        headers: { foo: "bar" },
        json: { bar: "baz" },
      });
    });

    const result = await trigger("/simple.json");
    expect(result.status).toBe(201);
    expect(headerValue(result.headers, "content-type")).toContain("application/json");
    expect(result.data).toEqual({ bar: "baz" });
  });

  test("mocks a POST request body seen by the handler", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/charges`, async (r, request) => {
      expect(request.method()).toBe("POST");
      expect(request.postDataJSON()).toEqual({ amount: 42 });
      await r.fulfill({
        status: 201,
        json: { id: "ch_mock", amount: 42, status: "mocked" },
      });
    });

    const result = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 42 }),
    });
    expect(result.status).toBe(201);
    expect(result.data).toEqual({
      id: "ch_mock",
      amount: 42,
      status: "mocked",
    });
  });

  test("does not hit the network for a fulfilled request", async ({
    route,
    trigger,
    request,
  }) => {
    let hits = 0;
    // Probe helper: if fulfill leaked to network, upstream /users would still be reachable
    // via a separate APIRequestContext call after the mocked trigger.
    await route(`${UPSTREAM}/users`, async (r) => {
      hits += 1;
      await r.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "Not Found! (mocked)",
      });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(404);
    expect(result.raw).toBe("Not Found! (mocked)");
    expect(hits).toBe(1);

    // Control: real upstream still works outside the page route.
    const direct = await request.get(`${UPSTREAM}/users`);
    expect(direct.status()).toBe(200);
  });

  test("works via XHR as well as fetch", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, json: [{ id: 1, name: "XHR" }] });
    });

    const result = await trigger("/users", { transport: "xhr" });
    expect(result.status).toBe(200);
    expect(result.data).toEqual([{ id: 1, name: "XHR" }]);
  });
});
