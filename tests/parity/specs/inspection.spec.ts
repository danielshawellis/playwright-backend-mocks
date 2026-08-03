import type { Request } from "@playwright/test";
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
    await route(`${UPSTREAM}/echo`, async (r, request) => {
      expect(await request.headerValue("CoNtEnT-TyPe")).toContain("application/json");
      expect(await request.headerValue("content-type")).toContain("application/json");
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const result = await trigger("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(result.data).toEqual({ ok: true });
  });

  test("allHeaders and headersArray are available", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r, request) => {
      const all = await request.allHeaders();
      expect(Object.keys(all).length).toBeGreaterThan(0);
      expect(all["content-type"]).toContain("application/json");
      const arr = await request.headersArray();
      expect(arr.length).toBeGreaterThan(0);
      expect(arr.some((h) => h.name.toLowerCase() === "content-type")).toBe(true);
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const result = await trigger("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(result.data).toEqual({ ok: true });
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

  test("handler can inspect postData then continue with an amendment", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r, request) => {
      const original = request.postDataJSON() as { a: number };
      expect(original).toEqual({ a: 1 });
      await r.continue({
        postData: { ...original, a: 2, inspected: true },
      });
    });

    const result = await trigger("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
    expect(result.data).toMatchObject({
      body: JSON.stringify({ a: 2, inspected: true }),
    });
  });

  test("postData() is null when the request has no body", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      expect(request.postData()).toBeNull();
      await r.fulfill({ status: 200, body: "no-body" });
    });

    expect((await trigger("/users")).raw).toBe("no-body");
  });

  test("request.response() resolves to null after abort", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      const pendingResponse = request.response();
      await r.abort();
      expect(await pendingResponse).toBeNull();
    });

    expect((await trigger("/users")).ok).toBe(false);
  });

  test("existingResponse() returns immediately before and after a response", async ({
    route,
    trigger,
    page,
  }) => {
    let interceptedRequest: Request | undefined;
    await route(`${UPSTREAM}/users`, async (r, request) => {
      interceptedRequest = request;
      expect(request.existingResponse()).toBeNull();
      await r.fulfill({ status: 202, body: "accepted" });
    });

    const pendingResponse = page.waitForResponse(`${UPSTREAM}/users`);
    const pendingTrigger = trigger("/users");
    const response = await pendingResponse;
    await pendingTrigger;

    expect(interceptedRequest?.existingResponse()).toBe(response);
    expect(interceptedRequest?.existingResponse()?.status()).toBe(202);
  });
});
