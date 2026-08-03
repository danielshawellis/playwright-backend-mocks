import { test, expect, UPSTREAM } from "../harness.js";
import { headerValue } from "../helpers.js";

test.describe("route.continue", () => {
  test("sends the request upstream", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue();
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    expect(headerValue(result.headers, "x-upstream")).toBe("real");
  });

  test("overrides the request url", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({ url: `${UPSTREAM}/echo-alt` });
    });

    const result = await trigger("/echo");
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ variant: "alt" });
  });

  test("overrides method, headers, and postData", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        method: "POST",
        headers: {
          ...r.request().headers(),
          "content-type": "application/json",
          "x-continue": "yes",
        },
        postData: JSON.stringify({ overridden: true }),
      });
    });

    const result = await trigger("/echo");
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({
      method: "POST",
      body: JSON.stringify({ overridden: true }),
    });
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    expect(echoHeaders["x-continue"]).toBe("yes");
  });

  test("can remove a header with an undefined value", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      const headers: Record<string, string> = { ...r.request().headers() };
      // Playwright treats an explicit undefined override as "delete this header".
      await r.continue({
        headers: { ...headers, foo: undefined } as unknown as Record<string, string>,
      });
    });

    const result = await trigger("/echo", {
      headers: { foo: "a", bar: "b" },
    });
    expect(result.status).toBe(200);
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    expect(echoHeaders.foo).toBeFalsy();
    expect(echoHeaders.bar).toBe("b");
  });

  test("amends post data to a longer value", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        method: "POST",
        postData: "doggo-was-here-and-is-longer",
      });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "birdy",
    });
    expect(result.data).toMatchObject({
      body: "doggo-was-here-and-is-longer",
    });
  });

  test("amends post data to an empty body", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        method: "POST",
        postData: "",
      });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "birdy",
    });
    expect(result.status).toBe(200);
    expect((result.data as { body: string | null }).body).toBeFalsy();
  });

  test("amends binary post data", async ({ route, trigger }) => {
    const bytes = Buffer.from(Array.from(Array(256).keys()));
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        method: "POST",
        postData: bytes,
      });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "birdy",
    });
    expect(result.status).toBe(200);
    const echoed = result.data as {
      body: string;
      bodyBase64: string;
      bodyByteLength: number;
    };
    expect(echoed.bodyByteLength).toBe(bytes.length);
    expect(Buffer.from(echoed.bodyBase64, "base64").equals(bytes)).toBe(true);
  });

  test("intercepts postData larger than 1MB", async ({ route, trigger }) => {
    const large = "x".repeat(2 * 1024 * 1024);
    let seenLength = 0;
    await route(`${UPSTREAM}/echo`, async (r) => {
      seenLength = r.request().postData()?.length ?? 0;
      await r.fulfill({ status: 200, json: { ok: true, length: seenLength } });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: large,
    });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ ok: true, length: large.length });
    expect(seenLength).toBe(large.length);
  });

  test("pauses a fetch request until continue", async ({ route, trigger, page }) => {
    let continueRoute: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      continueRoute = resolve;
    });

    await route(`${UPSTREAM}/users`, async (r) => {
      await barrier;
      await r.continue();
    });

    let settled = false;
    const pending = trigger("/users").then((result) => {
      settled = true;
      return result;
    });

    await page.waitForTimeout(200);
    expect(settled).toBe(false);
    continueRoute?.();
    const result = await pending;
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("amends json post data via Serializable", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        method: "POST",
        postData: { foo: "bar" },
      });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "birdy",
    });
    expect(result.data).toMatchObject({
      body: JSON.stringify({ foo: "bar" }),
    });
  });

  test("overrides method alone", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({ method: "POST" });
    });

    const result = await trigger("/echo");
    expect(result.data).toMatchObject({ method: "POST" });
  });

  test("overrides headers alone", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        headers: {
          ...r.request().headers(),
          "x-only": "header",
        },
      });
    });

    const result = await trigger("/echo");
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    expect(echoHeaders["x-only"]).toBe("header");
  });

  test("ignores forbidden Host header override", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        headers: {
          ...r.request().headers(),
          host: "evil.example",
        },
      });
    });

    const result = await trigger("/echo");
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    // Forbidden Host override is ignored; original host is used.
    expect(echoHeaders.host).toContain("127.0.0.1");
    expect(echoHeaders.host).not.toBe("evil.example");
  });

  test("headers overrides apply to the continued request", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        headers: {
          ...r.request().headers(),
          "x-continued": "yes",
        },
      });
    });

    const result = await trigger("/echo");
    expect(result.status).toBe(200);
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    expect(echoHeaders["x-continued"]).toBe("yes");
  });

  test("fetch header overrides apply across redirects", async ({ route, trigger }) => {
    // route.fetch uses APIRequestContext; its headers option applies to the
    // fetched request and redirects it initiates (per Route.fetch docs).
    await route(`${UPSTREAM}/redirect-echo`, async (r) => {
      const response = await r.fetch({
        headers: {
          ...r.request().headers(),
          "x-redirected": "yes",
        },
      });
      await r.fulfill({
        status: 200,
        json: await response.json(),
      });
    });

    const result = await trigger("/redirect-echo");
    expect(result.status).toBe(200);
    expect(
      (result.data as { headers: Record<string, string> }).headers["x-redirected"],
    ).toBe("yes");
  });

  test("url override does not carry onto redirected requests", async ({
    route,
    trigger,
  }) => {
    // Continue to /redirect with a url override already applied; after the
    // server 302, method/url overrides from the original continue do not apply
    // to the redirected hop — only the Location target is fetched.
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue({ url: `${UPSTREAM}/redirect` });
    });

    const result = await trigger("/users");
    // fetch follows redirect → /users real data
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("skips remaining handlers (unlike fallback)", async ({ route, trigger }) => {
    let laterCalled = false;
    await route(`${UPSTREAM}/users`, async () => {
      laterCalled = true;
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.continue();
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(laterCalled).toBe(false);
  });
});
