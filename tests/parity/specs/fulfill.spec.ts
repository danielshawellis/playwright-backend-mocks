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

  test("defaults status to 200 when omitted", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ body: "default-status" });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.raw).toBe("default-status");
  });

  test("infers content-type from path extension", async ({ route, trigger, page }) => {
    const jsonPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../testdata/payload.json",
    );
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ path: jsonPath });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.data).toEqual({ kind: "json-file" });
    expect(response.headers()["content-type"]).toContain("application/json");
  });

  test("infers text content-type from .txt path", async ({ route, trigger, page }) => {
    const txtPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../testdata/payload.txt",
    );
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ path: txtPath });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.raw?.trim()).toBe("plain-file-body");
    expect(response.headers()["content-type"]).toContain("text/plain");
  });

  test("coerces header values to strings", async ({ route, trigger, page }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 200,
        headers: {
          // Playwright docs: header values are converted to a string.
          "x-count": 42 as unknown as string,
          "access-control-expose-headers": "x-count",
        },
        body: "ok",
      });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    await trigger("/users");
    const response = await pending;
    expect(response.headers()["x-count"]).toBe("42");
  });

  test("json sets application/json when content-type is unset", async ({
    route,
    trigger,
    page,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ json: { a: 1 } });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.data).toEqual({ a: 1 });
    expect(response.headers()["content-type"]).toContain("application/json");
  });

  test("json respects an explicit content-type override", async ({
    route,
    trigger,
    page,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        contentType: "text/plain",
        json: { a: 1 },
      });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.raw).toBe(JSON.stringify({ a: 1 }));
    expect(response.headers()["content-type"]).toContain("text/plain");
  });

  test("can fulfill with a redirect status for the caller", async ({
    route,
    trigger,
    page,
  }) => {
    // Fulfilling with 302 returns that status to the intercepted request.
    // Browser fetch may follow it; we assert via Playwright's Response.
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 302,
        headers: {
          location: `${UPSTREAM}/echo`,
          "access-control-expose-headers": "*",
        },
        body: "",
      });
    });

    const pending = page.waitForResponse(
      (response) => response.url() === `${UPSTREAM}/users` && response.status() === 302,
    );
    void trigger("/users");
    const response = await pending;
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(`${UPSTREAM}/echo`);
  });

  test("fulfills with response body override as text", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      const response = await r.fetch();
      let body = await response.text();
      body = body.replace("Ada", "Ada-patched");
      await r.fulfill({
        response,
        body,
        headers: {
          ...response.headers(),
          "content-type": "application/json",
        },
      });
    });

    const result = await trigger("/users");
    expect(result.raw).toContain("Ada-patched");
  });
});
