import { test, expect, UPSTREAM, sleep } from "../harness.js";

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

  test("amends binary post data", async ({ route, trigger }) => {
    const bytes = Buffer.from(Array.from(Array(256).keys()));
    let observed: Buffer | undefined;
    await route(`${UPSTREAM}/echo`, async (r) => {
      observed = r.request().postDataBuffer() ?? undefined;
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fallback({ postData: bytes });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "birdy",
    });
    expect(observed).toBeTruthy();
    expect(observed!.equals(bytes)).toBe(true);
    const echoed = result.data as {
      bodyBase64: string;
      bodyByteLength: number;
    };
    expect(echoed.bodyByteLength).toBe(bytes.length);
    expect(Buffer.from(echoed.bodyBase64, "base64").equals(bytes)).toBe(true);
  });

  test("URL override re-targets subsequent handler matching", async ({
    route,
    trigger,
  }) => {
    // Observed Playwright behavior: after fallback({ url }), later handlers are
    // considered against the overridden URL (echo-alt handler runs next).
    // Docs historically said URL overrides do not affect matching; the runtime
    // rematches — this oracle pins the observed behavior for the rewrite.
    const seen: string[] = [];

    await route(`${UPSTREAM}/echo-alt`, async (r) => {
      seen.push("echo-alt-only");
      await r.fulfill({ status: 200, json: { via: "echo-alt-only" } });
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      seen.push("echo-continue");
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      seen.push("echo-fallback");
      await r.fallback({ url: `${UPSTREAM}/echo-alt` });
    });

    const result = await trigger("/echo");
    expect(seen).toEqual(["echo-fallback", "echo-alt-only"]);
    expect(result.data).toEqual({ via: "echo-alt-only" });
  });

  test("fallback url rematch skips handlers that only matched the original URL", async ({
    route,
    trigger,
  }) => {
    const seen: string[] = [];

    await route(`${UPSTREAM}/echo`, async (r) => {
      seen.push("original-url-handler");
      await r.fulfill({ status: 200, json: { via: "should-not-run" } });
    });
    await route(`${UPSTREAM}/echo-alt`, async (r) => {
      seen.push("alt-handler");
      await r.fulfill({ status: 200, json: { via: "alt" } });
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      seen.push("fallback");
      await r.fallback({ url: `${UPSTREAM}/echo-alt` });
    });

    const result = await trigger("/echo");
    // After URL override, the remaining `**/echo` handler is not invoked;
    // only handlers matching the new URL run.
    expect(seen).toEqual(["fallback", "alt-handler"]);
    expect(result.data).toEqual({ via: "alt" });
  });

  test("handler can fall back based on method", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      if (r.request().method() !== "GET") {
        await r.fallback();
        return;
      }
      await r.fulfill({ status: 200, json: { only: "GET" } });
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      if (r.request().method() !== "POST") {
        await r.fallback();
        return;
      }
      await r.fulfill({ status: 200, json: { only: "POST" } });
    });

    const getResult = await trigger("/echo");
    // LIFO: POST handler runs first, falls back; GET handler fulfills.
    expect(getResult.data).toEqual({ only: "GET" });

    const postResult = await trigger("/echo", { method: "POST", body: "x" });
    expect(postResult.data).toEqual({ only: "POST" });
  });

  test("fallback url override with a different protocol does not throw", async ({
    route,
    trigger,
    unrouteAll,
  }) => {
    // Observed Playwright behavior: unlike continue(), fallback({ url }) with a
    // different protocol resolves without throwing, but the request does not
    // complete successfully (stalls). Pin that asymmetry for the rewrite.
    let threw = false;
    let fallbackResolved = false;
    await route(`${UPSTREAM}/users`, async (r) => {
      try {
        await r.fallback({ url: "file:///tmp/foo" });
        fallbackResolved = true;
      } catch {
        threw = true;
        await r.fulfill({ status: 200, body: "unexpected-throw" });
      }
    });

    const result = await Promise.race([
      trigger("/users"),
      sleep(1000).then(() => ({ timeout: true as const })),
    ]);

    expect(threw).toBe(false);
    expect(fallbackResolved).toBe(true);
    expect(result).toEqual({ timeout: true });
    await unrouteAll({ behavior: "ignoreErrors" });
  });
});
