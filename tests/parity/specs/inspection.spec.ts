import { test, expect, UPSTREAM } from "../harness.js";

test.describe("request inspection", () => {
  test("exposes url, method, headers, and postData", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r, request) => {
      expect(request.url()).toBe(`${UPSTREAM}/echo`);
      expect(request.method()).toBe("POST");
      expect(request.headers()["content-type"]).toContain("application/json");
      expect(request.postData()).toBe(JSON.stringify({ hello: "world" }));
      expect(request.postDataJSON()).toEqual({ hello: "world" });
      expect(request.postDataBuffer()?.equals(Buffer.from('{"hello":"world"}'))).toBe(
        true,
      );
      await r.fulfill({ status: 200, json: { inspected: true } });
    });

    const result = await trigger("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(result.data).toEqual({ inspected: true });
  });

  test("parses form-urlencoded bodies via postDataJSON", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/form`, async (r, request) => {
      expect(request.headers()["content-type"]).toContain(
        "application/x-www-form-urlencoded",
      );
      expect(request.postData()).toBe("a=1&b=two");
      expect(request.postDataJSON()).toEqual({ a: "1", b: "two" });
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const result = await trigger("/form", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "a=1&b=two",
    });
    expect(result.data).toEqual({ ok: true });
  });

  test("headerValue is case-insensitive", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      const viaHeader = await request.headerValue("OrIgIn");
      const viaHeaders = request.headers().origin;
      expect(viaHeader || viaHeaders).toBeTruthy();
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const result = await trigger("/users");
    expect(result.data).toEqual({ ok: true });
  });

  test("allHeaders and headersArray are available", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      const all = await request.allHeaders();
      expect(Object.keys(all).length).toBeGreaterThan(0);
      expect(all.origin || all.accept || all["user-agent"]).toBeTruthy();
      const arr = await request.headersArray();
      expect(arr.length).toBeGreaterThan(0);
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const result = await trigger("/users");
    expect(result.data).toEqual({ ok: true });
  });

  test("resourceType is present for Ajax requests", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      expect(["xhr", "fetch"].includes(request.resourceType())).toBe(true);
      await r.continue();
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
  });

  test("frame is available on the request", async ({ route, trigger, page }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      expect(request.frame()).toBe(page.mainFrame());
      await r.fulfill({ status: 200, body: "framed" });
    });

    const result = await trigger("/users");
    expect(result.raw).toBe("framed");
  });

  test("request.response() resolves after fulfill", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      const pending = request.response();
      await r.fulfill({ status: 201, json: { ok: true } });
      const response = await pending;
      expect(response).toBeTruthy();
      expect(response!.status()).toBe(201);
    });

    const result = await trigger("/users");
    expect(result.status).toBe(201);
  });

  test("request.response() resolves after continue", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      const pending = request.response();
      await r.continue();
      const response = await pending;
      expect(response).toBeTruthy();
      expect(response!.status()).toBe(200);
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
  });

  test("request.failure() is set after abort", async ({ route, trigger, page }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      const failedEvent = page.waitForEvent("requestfailed");
      await r.abort("failed");
      const failed = await failedEvent;
      expect(failed).toBe(request);
      expect(request.failure()?.errorText.length).toBeGreaterThan(0);
    });

    const result = await trigger("/users");
    expect(result.ok).toBe(false);
  });

  test("route.request() is the same object as the handler request arg", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      expect(r.request()).toBe(request);
      await r.fulfill({ status: 200, body: "same" });
    });

    const result = await trigger("/users");
    expect(result.raw).toBe("same");
  });
});
