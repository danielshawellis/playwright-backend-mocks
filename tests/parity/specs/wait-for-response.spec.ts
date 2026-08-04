import { test, expect, UPSTREAM, sleep } from "../harness.js";

test.describe("waitForResponse", () => {
  test("waits for a matching response by URL string", async ({
    route,
    trigger,
    waitForResponse,
  }) => {
    await route(`${UPSTREAM}/charges`, async (r) => {
      await r.fulfill({ status: 201, json: { id: "ch_spy", status: "ok" } });
    });

    const pending = waitForResponse(`${UPSTREAM}/charges`);
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

  test("waits for a matching response by RegExp", async ({
    route,
    trigger,
    waitForResponse,
  }) => {
    await route(/\/users$/, async (r) => {
      await r.fulfill({ status: 200, json: [{ id: 1 }] });
    });

    const pending = waitForResponse(/\/users$/);
    await trigger("/users");
    const response = await pending;
    expect(response.url()).toContain("/users");
    expect(await response.json()).toEqual([{ id: 1 }]);
  });

  test("waits for a matching response by predicate", async ({
    route,
    trigger,
    waitForResponse,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const pending = waitForResponse(
      (response) =>
        response.url() === `${UPSTREAM}/echo` && response.request().method() === "POST",
    );
    await trigger("/echo", { method: "POST", body: "hi" });
    const response = await pending;
    expect(response.request().method()).toBe("POST");
    expect(await response.json()).toEqual({ ok: true });
  });

  test("times out when no response matches", async ({ trigger, waitForResponse }) => {
    let message = "";
    try {
      await waitForResponse(`${UPSTREAM}/missing`, { timeout: 500 });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }

    await trigger("/users");
    expect(message).toMatch(/Timeout|timeout/i);
  });

  test("resolves for a continued upstream response", async ({
    route,
    trigger,
    waitForResponse,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue();
    });

    const pending = waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.status).toBe(200);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("timeout 0 waits indefinitely until a match", async ({
    route,
    trigger,
    waitForResponse,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, json: [] });
    });

    const pending = waitForResponse(`${UPSTREAM}/users`, { timeout: 0 });
    await sleep(100);
    await trigger("/users");
    const response = await pending;
    expect(response.url()).toContain("/users");
  });

  test("only observes responses that arrive after the waiter", async ({
    trigger,
    waitForResponse,
  }) => {
    await trigger("/echo?response=A");

    const pending = waitForResponse((response) =>
      response.url().includes("/echo?response="),
    );
    const beforeB = await Promise.race([
      pending.then(() => "resolved"),
      sleep(200).then(() => "pending"),
    ]);
    expect(beforeB).toBe("pending");

    const triggerB = trigger("/echo?response=B");
    const response = await pending;
    await triggerB;
    expect(response.url()).toBe(`${UPSTREAM}/echo?response=B`);
  });

  test("supports AbortSignal cancellation", async ({ waitForResponse }) => {
    const controller = new AbortController();
    const pending = waitForResponse(`${UPSTREAM}/missing`, {
      signal: controller.signal,
      timeout: 30_000,
    });
    controller.abort();

    await expect(pending).rejects.toThrow(/aborted/i);
  });

  test("waits for a matching response by glob pattern", async ({
    route,
    trigger,
    waitForResponse,
  }) => {
    await route("**/users", async (r) => {
      await r.fulfill({ status: 200, json: [{ id: 1 }] });
    });

    const pending = waitForResponse("**/users");
    await trigger("/users");
    const response = await pending;
    expect(await response.json()).toEqual([{ id: 1 }]);
  });

  test("awaits an async predicate", async ({ route, trigger, waitForResponse }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const pending = waitForResponse(async (response) => {
      await Promise.resolve();
      return response.url().includes("/echo") && response.status() === 200;
    });
    await trigger("/echo", { method: "POST", body: "async" });
    expect(await (await pending).json()).toEqual({ ok: true });
  });
});
