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

  test("fulfills with an unassigned status code", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 430, body: "custom" });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(430);
    expect(result.raw).toBe("custom");
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

  test("does not hit the network for a fulfilled request", async ({ route, trigger }) => {
    let hits = 0;
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
    const pendingTrigger = trigger("/users");
    const response = await pending;
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(`${UPSTREAM}/echo`);
    await pendingTrigger;
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

  test("derives exact status text for standard status codes", async ({
    route,
    trigger,
    page,
  }) => {
    await route("**/fulfill-status*", async (r, request) => {
      const status = Number(new URL(request.url()).searchParams.get("code"));
      await r.fulfill({ status, body: String(status) });
    });

    const cases = [
      [200, "OK"],
      [404, "Not Found"],
      [422, "Unprocessable Entity"],
    ] as const;

    for (const [status, expectedStatusText] of cases) {
      const url = `${UPSTREAM}/fulfill-status?code=${status}`;
      const pendingResponse = page.waitForResponse(url);
      const pendingTrigger = trigger(url);
      const response = await pendingResponse;
      await pendingTrigger;
      expect(response.status()).toBe(status);
      expect(response.statusText()).toBe(expectedStatusText);
    }
  });

  test("preserves every byte in a binary Buffer body", async ({
    route,
    trigger,
    page,
  }) => {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index));
    await route(`${UPSTREAM}/binary`, async (r) => {
      await r.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: bytes,
      });
    });

    const pendingResponse = page.waitForResponse(`${UPSTREAM}/binary`);
    const pendingTrigger = trigger("/binary");
    const response = await pendingResponse;
    await pendingTrigger;

    expect((await response.body()).equals(bytes)).toBe(true);
  });

  test("adds Content-Length for string and json bodies", async ({
    route,
    trigger,
    page,
  }) => {
    const stringBody = "π-body";
    const jsonBody = { value: "π" };

    await route("**/auto-content-length*", async (r, request) => {
      const kind = new URL(request.url()).searchParams.get("kind");
      if (kind === "string") {
        await r.fulfill({ body: stringBody });
      } else {
        await r.fulfill({ json: jsonBody });
      }
    });

    for (const [kind, expectedLength] of [
      ["string", Buffer.byteLength(stringBody)],
      ["json", Buffer.byteLength(JSON.stringify(jsonBody))],
    ] as const) {
      const url = `${UPSTREAM}/auto-content-length?kind=${kind}`;
      const pendingResponse = page.waitForResponse(url);
      const pendingTrigger = trigger(url);
      const response = await pendingResponse;
      await pendingTrigger;
      expect(response.headers()["content-length"]).toBe(String(expectedLength));
    }
  });

  test("contentType takes precedence over a content-type header", async ({
    route,
    trigger,
    page,
  }) => {
    await route(`${UPSTREAM}/text`, async (r) => {
      await r.fulfill({
        headers: { "content-type": "application/from-header" },
        contentType: "text/from-option",
        body: "precedence",
      });
    });

    const pendingResponse = page.waitForResponse(`${UPSTREAM}/text`);
    const pendingTrigger = trigger("/text");
    const response = await pendingResponse;
    await pendingTrigger;
    expect(response.headers()["content-type"]).toBe("text/from-option");
  });

  test("throws when json and body are specified together", async ({ route, trigger }) => {
    let message = "";
    await route(`${UPSTREAM}/users`, async (r) => {
      try {
        await r.fulfill({
          body: "body",
          json: { json: true },
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
        await r.abort();
      }
    });

    expect((await trigger("/users")).ok).toBe(false);
    expect(message).toMatch(/either body or json/i);
  });
});
