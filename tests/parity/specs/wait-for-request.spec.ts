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

    // Make sure the page is alive / harness works.
    await trigger("/users");
    expect(message).toMatch(/Timeout|timeout/i);
  });
});
