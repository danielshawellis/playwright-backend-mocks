import { test, expect, UPSTREAM } from "../harness.js";

test.describe("waitForResponse", () => {
  test("waits for a matching response by URL string", async ({
    page,
    route,
    trigger,
    harnessPage,
  }) => {
    void harnessPage;
    await route(`${UPSTREAM}/charges`, async (r) => {
      await r.fulfill({ status: 201, json: { id: "ch_spy", status: "ok" } });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/charges`);
    const result = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 99 }),
    });
    const response = await pending;

    expect(result.status).toBe(201);
    expect(response.status()).toBe(201);
    expect(response.url()).toBe(`${UPSTREAM}/charges`);
    expect(await response.json()).toEqual({ id: "ch_spy", status: "ok" });
  });

  test("waits for a matching response by RegExp", async ({ page, route, trigger }) => {
    await route(/\/users$/, async (r) => {
      await r.fulfill({ status: 200, json: [{ id: 1 }] });
    });

    const pending = page.waitForResponse(/\/users$/);
    await trigger("/users");
    const response = await pending;
    expect(response.url()).toContain("/users");
    expect(await response.json()).toEqual([{ id: 1 }]);
  });

  test("waits for a matching response by predicate", async ({ page, route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const pending = page.waitForResponse(
      (response) =>
        response.url() === `${UPSTREAM}/echo` && response.request().method() === "POST",
    );
    await trigger("/echo", { method: "POST", body: "hi" });
    const response = await pending;
    expect(response.request().method()).toBe("POST");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("times out when no response matches", async ({ page, trigger }) => {
    let message = "";
    try {
      await page.waitForResponse(`${UPSTREAM}/missing`, { timeout: 500 });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    await trigger("/users");
    expect(message).toMatch(/Timeout|timeout/i);
  });

  test("resolves for a continued upstream response", async ({ page, route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue();
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.status).toBe(200);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("timeout 0 waits indefinitely until a match", async ({ page, route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, json: [] });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`, { timeout: 0 });
    await page.waitForTimeout(100);
    await trigger("/users");
    const response = await pending;
    expect(response.url()).toContain("/users");
  });

  test("only observes responses that arrive after the waiter", async ({
    page,
    trigger,
  }) => {
    await trigger("/echo?response=A");

    const pending = page.waitForResponse((response) =>
      response.url().includes("/echo?response="),
    );
    const beforeB = await Promise.race([
      pending.then(() => "resolved"),
      page.waitForTimeout(200).then(() => "pending"),
    ]);
    expect(beforeB).toBe("pending");

    const triggerB = trigger("/echo?response=B");
    const response = await pending;
    await triggerB;
    expect(response.url()).toBe(`${UPSTREAM}/echo?response=B`);
  });

  test("supports AbortSignal cancellation", async ({ page }) => {
    const controller = new AbortController();
    const pending = page.waitForResponse(`${UPSTREAM}/missing`, {
      signal: controller.signal,
      timeout: 30_000,
    });
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/i);
  });
});
