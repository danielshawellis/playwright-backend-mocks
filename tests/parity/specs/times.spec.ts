import { test, expect, UPSTREAM } from "../harness.js";

test.describe("route times", () => {
  test("supports the times parameter with route matching", async ({ route, trigger }) => {
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        await r.fulfill({ status: 200, json: { mocked: true } });
      },
      { times: 1 },
    );

    const first = await trigger("/users");
    expect(first.data).toEqual({ mocked: true });

    const second = await trigger("/users");
    expect(second.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("supports async handler with times", async ({ route, trigger }) => {
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await r.fulfill({ status: 200, body: "once" });
      },
      { times: 1 },
    );

    const first = await trigger("/users");
    expect(first.raw).toBe("once");
    const second = await trigger("/users");
    expect(second.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("works if a times handler is removed from another handler", async ({
    route,
    unroute,
    trigger,
  }) => {
    const handler = async (r: Parameters<Parameters<typeof route>[1]>[0]) => {
      await r.fulfill({ status: 200, body: "limited" });
    };

    await route(`${UPSTREAM}/users`, handler, { times: 2 });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await unroute(`${UPSTREAM}/users`, handler);
      await r.fulfill({ status: 200, body: "echo" });
    });

    const echo = await trigger("/echo");
    expect(echo.raw).toBe("echo");

    const users = await trigger("/users");
    expect(users.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("times: 2 fires exactly twice then falls through", async ({ route, trigger }) => {
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        await r.fulfill({ status: 200, json: { mocked: true } });
      },
      { times: 2 },
    );

    expect((await trigger("/users")).data).toEqual({ mocked: true });
    expect((await trigger("/users")).data).toEqual({ mocked: true });
    expect((await trigger("/users")).data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("exhausted times handler does not block a later handler", async ({
    route,
    trigger,
  }) => {
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        await r.fulfill({ status: 200, body: "later" });
      },
      { times: 1 },
    );
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        await r.fulfill({ status: 200, body: "first" });
      },
      { times: 1 },
    );

    // LIFO: newest (first) runs once, then older (later) runs once.
    expect((await trigger("/users")).raw).toBe("first");
    expect((await trigger("/users")).raw).toBe("later");
    expect((await trigger("/users")).data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("times handler that falls back still consumes a use", async ({
    route,
    trigger,
  }) => {
    const seen: string[] = [];
    await route(`${UPSTREAM}/users`, async (r) => {
      seen.push("base");
      await r.fulfill({ status: 200, body: "base" });
    });
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        seen.push("limited");
        await r.fallback();
      },
      { times: 1 },
    );

    expect((await trigger("/users")).raw).toBe("base");
    expect(seen).toEqual(["limited", "base"]);

    seen.length = 0;
    expect((await trigger("/users")).raw).toBe("base");
    // Limited handler exhausted — only base runs.
    expect(seen).toEqual(["base"]);
  });

  test("concurrent times: 1 claims exactly one request at handler entry", async ({
    route,
    trigger,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const firstEntry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let invocations = 0;

    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        invocations += 1;
        entered();
        await barrier;
        await r.fulfill({ status: 200, json: { mocked: true } });
      },
      { times: 1 },
    );

    const pending = [trigger("/users"), trigger("/users")];
    await firstEntry;
    release();
    const results = await Promise.all(pending);

    expect(invocations).toBe(1);
    expect(
      results.filter(
        (result) =>
          typeof result.data === "object" &&
          result.data !== null &&
          "mocked" in result.data &&
          result.data.mocked === true,
      ),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          Array.isArray(result.data) &&
          result.data.some((user) => (user as { name?: string }).name === "Ada"),
      ),
    ).toHaveLength(1);
  });

  test("concurrent times: 2 claims exactly two of three requests", async ({
    route,
    trigger,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enteredTwice!: () => void;
    const twoEntries = new Promise<void>((resolve) => {
      enteredTwice = resolve;
    });
    let invocations = 0;

    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        invocations += 1;
        if (invocations === 2) {
          enteredTwice();
        }
        await barrier;
        await r.fulfill({ status: 200, json: { mocked: true } });
      },
      { times: 2 },
    );

    const pending = [trigger("/users"), trigger("/users"), trigger("/users")];
    await twoEntries;
    release();
    const results = await Promise.all(pending);

    expect(invocations).toBe(2);
    expect(
      results.filter(
        (result) =>
          typeof result.data === "object" &&
          result.data !== null &&
          "mocked" in result.data &&
          result.data.mocked === true,
      ),
    ).toHaveLength(2);
    expect(results.filter((result) => Array.isArray(result.data))).toHaveLength(1);
  });

  test("times: 0 still runs once and is then removed", async ({ route, trigger }) => {
    let invocations = 0;
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        invocations += 1;
        await r.fulfill({ status: 200, body: "zero-ran-once" });
      },
      { times: 0 },
    );

    expect((await trigger("/users")).raw).toBe("zero-ran-once");
    expect((await trigger("/users")).data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    expect(invocations).toBe(1);
  });

  test("times: -1 still runs once and is then removed", async ({ route, trigger }) => {
    let invocations = 0;
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        invocations += 1;
        await r.fulfill({ status: 200, body: "neg-ran-once" });
      },
      { times: -1 },
    );

    expect((await trigger("/users")).raw).toBe("neg-ran-once");
    expect((await trigger("/users")).data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    expect(invocations).toBe(1);
  });

  test("times: NaN never expires", async ({ route, trigger }) => {
    let invocations = 0;
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        invocations += 1;
        await r.fulfill({ status: 200, body: `nan-${invocations}` });
      },
      { times: Number.NaN },
    );

    expect((await trigger("/users")).raw).toBe("nan-1");
    expect((await trigger("/users")).raw).toBe("nan-2");
    expect((await trigger("/users")).raw).toBe("nan-3");
    expect(invocations).toBe(3);
  });
});
