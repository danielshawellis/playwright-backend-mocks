import { test, expect, UPSTREAM } from "../harness.js";

test.describe("route.fallback", () => {
  test("falls through to the network", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fallback();
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("chains handlers in LIFO order", async ({ route, trigger }) => {
    const intercepted: number[] = [];

    await route(`${UPSTREAM}/users`, async (r) => {
      intercepted.push(1);
      await r.fallback();
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      intercepted.push(2);
      await r.fallback();
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      intercepted.push(3);
      await r.fallback();
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(intercepted).toEqual([3, 2, 1]);
  });

  test("chains async fallback handlers in LIFO order", async ({ route, trigger }) => {
    const intercepted: number[] = [];

    await route(`${UPSTREAM}/users`, async (r) => {
      intercepted.push(1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await r.fallback();
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      intercepted.push(2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await r.fallback();
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      intercepted.push(3);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await r.fallback();
    });

    await trigger("/users");
    expect(intercepted).toEqual([3, 2, 1]);
  });

  test("does not chain after fulfill", async ({ route, trigger }) => {
    let laterHandlerCalled = false;

    await route(`${UPSTREAM}/users`, async () => {
      laterHandlerCalled = true;
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "fulfilled" });
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fallback();
    });

    const result = await trigger("/users");
    expect(result.raw).toBe("fulfilled");
    expect(laterHandlerCalled).toBe(false);
  });

  test("does not chain after abort", async ({ route, trigger }) => {
    let laterHandlerCalled = false;

    await route(`${UPSTREAM}/users`, async () => {
      laterHandlerCalled = true;
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.abort();
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fallback();
    });

    const result = await trigger("/users");
    expect(result.ok).toBe(false);
    expect(laterHandlerCalled).toBe(false);
  });

  test("falls back after an exception in fulfill", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue();
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      try {
        // Missing file path makes fulfill reject; then we fallback.
        await r.fulfill({
          path: "/this/path/does/not/exist-parity-oracle.txt",
        });
      } catch {
        await r.fallback();
      }
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("chains once with times", async ({ route, trigger }) => {
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        await r.fulfill({ status: 200, body: "fulfilled one" });
      },
      { times: 1 },
    );
    await route(
      `${UPSTREAM}/users`,
      async (r) => {
        await r.fallback();
      },
      { times: 1 },
    );

    const result = await trigger("/users");
    expect(result.raw).toBe("fulfilled one");
  });

  test("amends HTTP headers for the next handler and network", async ({
    route,
    trigger,
  }) => {
    const values: string[] = [];

    await route(`${UPSTREAM}/echo`, async (r) => {
      values.push(r.request().headers().foo ?? "");
      values.push((await r.request().headerValue("FOO")) ?? "");
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fallback({
        headers: { ...r.request().headers(), foo: "bar" },
      });
    });

    const result = await trigger("/echo");
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    values.push(echoHeaders.foo ?? "");
    expect(values).toEqual(["bar", "bar", "bar"]);
  });

  test("deletes a header with an undefined value", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      const headers = await r.request().allHeaders();
      await r.fallback({
        headers: {
          ...headers,
          foo: undefined,
        } as unknown as Record<string, string>,
      });
    });

    const result = await trigger("/echo", {
      headers: { foo: "a", bar: "b" },
    });
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    expect(echoHeaders.foo).toBeFalsy();
    expect(echoHeaders.bar).toBe("b");
  });

  test("amends the method", async ({ route, trigger, waitForRequest }) => {
    let method = "";
    await route(`${UPSTREAM}/echo`, async (r) => {
      method = r.request().method();
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fallback({ method: "POST" });
    });

    const pending = waitForRequest(`${UPSTREAM}/echo`);
    const result = await trigger("/echo");
    const seen = await pending;
    expect(method).toBe("POST");
    expect(seen.method()).toBe("POST");
    expect(result.data).toMatchObject({ method: "POST" });
  });

  test("overrides the request url for the next handler", async ({ route, trigger }) => {
    let url = "";
    await route(`${UPSTREAM}/echo-alt`, async (r) => {
      url = r.request().url();
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fallback({ url: `${UPSTREAM}/echo-alt` });
    });

    const result = await trigger("/echo");
    expect(url).toBe(`${UPSTREAM}/echo-alt`);
    expect(result.data).toMatchObject({ variant: "alt" });
  });

  test("amends post data", async ({ route, trigger }) => {
    let postData = "";
    await route(`${UPSTREAM}/echo`, async (r) => {
      postData = r.request().postData() ?? "";
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fallback({ postData: "doggo" });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "birdy",
    });
    expect(postData).toBe("doggo");
    expect(result.data).toMatchObject({ body: "doggo" });
  });

  test("amends json post data", async ({ route, trigger }) => {
    let postData: unknown;
    await route(`${UPSTREAM}/echo`, async (r) => {
      postData = r.request().postDataJSON();
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fallback({ postData: { foo: "bar" } });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "birdy",
    });
    expect(postData).toEqual({ foo: "bar" });
    expect(result.data).toMatchObject({
      body: JSON.stringify({ foo: "bar" }),
    });
  });

  test("chains fallback with a dynamic URL change", async ({ route, trigger }) => {
    await route("**/echo-alt", async (r) => {
      await r.fulfill({ status: 200, json: { via: "dynamic" } });
    });
    await route("**/echo", async (r) => {
      await r.fallback({ url: `${UPSTREAM}/echo-alt` });
    });

    const result = await trigger("/echo");
    expect(result.data).toEqual({ via: "dynamic" });
  });
});
