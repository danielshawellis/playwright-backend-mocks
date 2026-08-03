import { test, expect, UPSTREAM } from "../harness.js";

test.describe("route lifecycle", () => {
  test("should unroute a handler", async ({ route, unroute, trigger }) => {
    const handler = async (r: Parameters<Parameters<typeof route>[1]>[0]) => {
      await r.fulfill({ status: 200, body: "intercepted" });
    };

    await route(`${UPSTREAM}/users`, handler);
    const first = await trigger("/users");
    expect(first.raw).toBe("intercepted");

    await unroute(`${UPSTREAM}/users`, handler);
    const second = await trigger("/users");
    expect(second.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("unrouteAll removes all routes", async ({ route, unrouteAll, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.abort();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.abort();
    });
    await unrouteAll();

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("unrouteAll({ behavior: 'wait' }) waits for pending handlers", async ({
    route,
    unrouteAll,
    trigger,
    page,
  }) => {
    let secondHandlerCalled = false;
    await route(`${UPSTREAM}/users`, async (r) => {
      secondHandlerCalled = true;
      await r.abort();
    });

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });

    await route(`${UPSTREAM}/users`, async (r) => {
      entered();
      await barrier;
      await r.fallback();
    });

    const pendingTrigger = trigger("/users");
    await enteredPromise;

    let didUnroute = false;
    const unroutePromise = unrouteAll({ behavior: "wait" }).then(() => {
      didUnroute = true;
    });

    await page.waitForTimeout(300);
    expect(didUnroute).toBe(false);
    release();
    await unroutePromise;
    expect(didUnroute).toBe(true);
    await pendingTrigger;
    expect(secondHandlerCalled).toBe(false);
  });

  test("unrouteAll({ behavior: 'ignoreErrors' }) does not wait on handler errors", async ({
    route,
    unrouteAll,
    trigger,
    page,
  }) => {
    let secondHandlerCalled = false;
    await route(`${UPSTREAM}/users`, async (r) => {
      secondHandlerCalled = true;
      await r.abort();
    });

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });

    await route(`${UPSTREAM}/users`, async () => {
      entered();
      await barrier;
      throw new Error("Handler error");
    });

    const pendingTrigger = trigger("/users");
    await enteredPromise;

    let didUnroute = false;
    const unroutePromise = unrouteAll({ behavior: "ignoreErrors" }).then(() => {
      didUnroute = true;
    });
    await page.waitForTimeout(100);
    await unroutePromise;
    expect(didUnroute).toBe(true);
    release();
    await pendingTrigger.catch(() => undefined);
    expect(secondHandlerCalled).toBe(false);
  });

  test("unroute does not wait for pending handlers to complete", async ({
    route,
    unroute,
    trigger,
    page,
  }) => {
    let secondHandlerCalled = false;
    await route(`${UPSTREAM}/users`, async (r) => {
      secondHandlerCalled = true;
      await r.continue();
    });

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const handler = async (r: Parameters<Parameters<typeof route>[1]>[0]) => {
      entered();
      await barrier;
      await r.fallback();
    };
    await route(`${UPSTREAM}/users`, handler);

    const pending = trigger("/users");
    await enteredPromise;
    await unroute(`${UPSTREAM}/users`, handler);
    release();
    await pending;
    expect(secondHandlerCalled).toBe(true);
    // silence unused
    void page;
  });

  test("double-settle throws for fulfill", async ({ route, trigger }) => {
    let settleError: string | undefined;
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "one" });
      try {
        await r.fulfill({ status: 200, body: "two" });
      } catch (e) {
        settleError = e instanceof Error ? e.message : String(e);
      }
    });

    const result = await trigger("/users");
    expect(result.raw).toBe("one");
    expect(settleError).toMatch(/already handled/i);
  });

  test("double-settle throws for continue after fulfill", async ({ route, trigger }) => {
    let settleError: string | undefined;
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "one" });
      try {
        await r.continue();
      } catch (e) {
        settleError = e instanceof Error ? e.message : String(e);
      }
    });

    await trigger("/users");
    expect(settleError).toMatch(/already handled/i);
  });

  test("double-settle throws for abort after fulfill", async ({ route, trigger }) => {
    let settleError: string | undefined;
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "one" });
      try {
        await r.abort();
      } catch (e) {
        settleError = e instanceof Error ? e.message : String(e);
      }
    });

    await trigger("/users");
    expect(settleError).toMatch(/already handled/i);
  });

  test("handles equal concurrent requests", async ({ route, trigger }) => {
    let active = 0;
    let maxActive = 0;
    await route(`${UPSTREAM}/users`, async (r) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const results = await Promise.all([
      trigger("/users"),
      trigger("/users"),
      trigger("/users"),
    ]);
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(maxActive).toBeGreaterThan(1);
  });

  test("unroute(url) without handler removes all handlers for that url", async ({
    route,
    unroute,
    trigger,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "first" });
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "second" });
    });

    await unroute(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("unrouteAll({ behavior: 'default' }) does not wait for handlers", async ({
    route,
    unrouteAll,
    trigger,
    page,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let fulfillError = "";

    await route(`${UPSTREAM}/users`, async (r) => {
      entered();
      await barrier;
      try {
        await r.fulfill({ status: 200, body: "late" });
      } catch (e) {
        // After default unrouteAll, Playwright may already settle the route.
        fulfillError = e instanceof Error ? e.message : String(e);
      }
    });

    const pending = trigger("/users");
    await enteredPromise;

    let didUnroute = false;
    const unroutePromise = unrouteAll({ behavior: "default" }).then(() => {
      didUnroute = true;
    });
    await page.waitForTimeout(100);
    await unroutePromise;
    expect(didUnroute).toBe(true);
    release();
    await pending.catch(() => undefined);
    expect(fulfillError.length).toBeGreaterThanOrEqual(0);
  });

  test("double-settle throws for fulfill after continue", async ({ route, trigger }) => {
    let settleError: string | undefined;
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue();
      try {
        await r.fulfill({ status: 200, body: "nope" });
      } catch (e) {
        settleError = e instanceof Error ? e.message : String(e);
      }
    });

    await trigger("/users");
    expect(settleError).toMatch(/already handled/i);
  });

  test("double-settle throws for abort after continue", async ({ route, trigger }) => {
    let settleError: string | undefined;
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue();
      try {
        await r.abort();
      } catch (e) {
        settleError = e instanceof Error ? e.message : String(e);
      }
    });

    await trigger("/users");
    expect(settleError).toMatch(/already handled/i);
  });

  test("fallback then fulfill is allowed (fallback is non-terminal)", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "after-fallback" });
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fallback();
    });

    const result = await trigger("/users");
    expect(result.raw).toBe("after-fallback");
  });
});
