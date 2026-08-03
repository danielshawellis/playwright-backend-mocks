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
});
