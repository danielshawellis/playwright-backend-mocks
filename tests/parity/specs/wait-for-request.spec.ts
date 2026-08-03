import { test, expect, UPSTREAM } from "../harness.js";

test.describe("waitForRequest", () => {
  test("waits for a matching request by URL string", async ({
    route,
    trigger,
    waitForRequest,
  }) => {
    await route(`${UPSTREAM}/charges`, async (r) => {
      await r.fulfill({ status: 201, json: { id: "ch_spy", status: "ok" } });
    });

    const pending = waitForRequest(`${UPSTREAM}/charges`);
    const result = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 99 }),
    });
    const seen = await pending;

    expect(result.status).toBe(201);
    expect(seen.method()).toBe("POST");
    expect(seen.url()).toBe(`${UPSTREAM}/charges`);
  });

  test("waits for a matching request by RegExp", async ({
    route,
    trigger,
    waitForRequest,
  }) => {
    await route(/\/users$/, async (r) => {
      await r.fulfill({ status: 200, json: [] });
    });

    const pending = waitForRequest(/\/users$/);
    await trigger("/users");
    const seen = await pending;
    expect(seen.url()).toContain("/users");
  });

  test("waits for a matching request by predicate", async ({
    route,
    trigger,
    waitForRequest,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const pending = waitForRequest(
      (request) => request.url() === `${UPSTREAM}/echo` && request.method() === "POST",
    );
    await trigger("/echo", {
      method: "POST",
      body: "hi",
    });
    const seen = await pending;
    expect(seen.method()).toBe("POST");
    expect(seen.postData()).toBe("hi");
  });

  test("times out when no request matches", async ({ waitForRequest, trigger }) => {
    let message = "";
    try {
      await waitForRequest(`${UPSTREAM}/missing`, { timeout: 500 });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    await trigger("/users");
    expect(message).toMatch(/Timeout|timeout/i);
  });

  test("supports AbortSignal cancellation", async ({ waitForRequest, trigger }) => {
    const controller = new AbortController();
    const pending = waitForRequest(`${UPSTREAM}/missing`, {
      signal: controller.signal,
      timeout: 30_000,
    });
    controller.abort();

    let message = "";
    try {
      await pending;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message.length).toBeGreaterThan(0);
    await trigger("/users");
  });

  test("timeout 0 waits indefinitely until a match", async ({
    route,
    trigger,
    waitForRequest,
    page,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, json: [] });
    });

    const pending = waitForRequest(`${UPSTREAM}/users`, { timeout: 0 });
    await page.waitForTimeout(100);
    await trigger("/users");
    const seen = await pending;
    expect(seen.url()).toContain("/users");
  });

  test("only observes requests that start after the waiter", async ({
    trigger,
    waitForRequest,
    page,
  }) => {
    await trigger("/echo?request=A");

    const pending = waitForRequest((request) => request.url().includes("/echo?request="));
    const beforeB = await Promise.race([
      pending.then(() => "resolved"),
      page.waitForTimeout(200).then(() => "pending"),
    ]);
    expect(beforeB).toBe("pending");

    const triggerB = trigger("/echo?request=B");
    const seen = await pending;
    await triggerB;
    expect(seen.url()).toBe(`${UPSTREAM}/echo?request=B`);
  });

  test("waits for a matching request by glob pattern", async ({
    route,
    trigger,
    waitForRequest,
  }) => {
    await route("**/users", async (r) => {
      await r.fulfill({ status: 200, json: [] });
    });

    const pending = waitForRequest("**/users");
    await trigger("/users");
    const seen = await pending;
    expect(seen.url()).toContain("/users");
  });

  test("awaits an async predicate", async ({ route, trigger, waitForRequest }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const pending = waitForRequest(async (request) => {
      await Promise.resolve();
      return request.url().includes("/echo") && request.method() === "POST";
    });
    await trigger("/echo", { method: "POST", body: "async" });
    const seen = await pending;
    expect(seen.postData()).toBe("async");
  });
});
