import { test, expect, UPSTREAM } from "../harness.js";
import { headerValue } from "../helpers.js";

test.describe("route.fetch", () => {
  test("fetches original request and fulfills", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      const response = await r.fetch();
      await r.fulfill({ response });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("fulfills with fetch result and overrides", async ({ route, trigger, page }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      const response = await r.fetch();
      const users = (await response.json()) as Array<{
        id: number;
        name: string;
      }>;
      users.push({ id: 100, name: "Loquat" });
      await r.fulfill({
        response,
        status: 201,
        headers: {
          "content-type": "application/json",
          foo: "bar",
        },
        json: users,
      });
    });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.status).toBe(201);
    expect(response.headers().foo).toBe("bar");
    expect(headerValue(result.headers, "foo")).toBe("bar");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
      { id: 100, name: "Loquat" },
    ]);
  });

  test("supports url / method / headers / postData overrides", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      const upstream = await r.fetch({
        url: `${UPSTREAM}/echo`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-fetch": "yes",
        },
        postData: JSON.stringify({ from: "fetch-override" }),
      });
      await r.fulfill({
        status: 200,
        json: { fetched: await upstream.json() },
      });
    });

    const result = await trigger("/users");
    expect(result.data).toMatchObject({
      fetched: {
        method: "POST",
        body: JSON.stringify({ from: "fetch-override" }),
      },
    });
    const fetched = (result.data as { fetched: { headers: Record<string, string> } })
      .fetched;
    expect(fetched.headers["x-fetch"]).toBe("yes");
  });

  test("gives access to the intercepted response", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/simple.json`, async (r) => {
      const response = await r.fetch();
      expect(response.status()).toBe(200);
      expect(response.ok()).toBe(true);
      expect(response.url()).toContain("/simple.json");
      expect(response.headers()["content-type"]).toContain("application/json");
      expect(await response.text()).toContain('"foo"');
      await r.fulfill({ response });
    });

    const result = await trigger("/simple.json");
    expect(result.data).toEqual({ foo: "bar" });
  });

  test("fulfills with an empty body override", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      const response = await r.fetch();
      await r.fulfill({
        response,
        headers: { "content-length": "0" },
        status: 201,
        body: "",
      });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(201);
    expect(result.raw).toBe("");
  });

  test("supports timeout option", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/slow`, async (r) => {
      let message = "";
      try {
        await r.fetch({ timeout: 500 });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toContain("Timeout");
      await r.fulfill({ status: 504, body: "timed out" });
    });

    const result = await trigger("/slow");
    expect(result.status).toBe(504);
    expect(result.raw).toBe("timed out");
  });

  test("does not follow redirects when maxRedirects is 0", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/redirect`, async (r) => {
      const response = await r.fetch({ maxRedirects: 0 });
      expect(response.status()).toBe(302);
      expect(response.headers().location).toBe("/users");
      await r.fulfill({ status: 200, body: "stopped-at-redirect" });
    });

    const result = await trigger("/redirect");
    expect(result.raw).toBe("stopped-at-redirect");
  });

  test("can fulfill with a separately fetched APIResponse", async ({
    route,
    trigger,
  }) => {
    // Acquire an APIResponse via route.fetch of a different URL (not page.request).
    await route(`${UPSTREAM}/users`, async (r) => {
      const sample = await r.fetch({ url: `${UPSTREAM}/simple.json` });
      await r.fulfill({
        response: sample,
        status: 201,
        contentType: "application/json",
      });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(201);
    expect(result.data).toEqual({ foo: "bar" });
  });

  test("reads back a gzip upstream body via fetch + fulfill", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/gzip`, async (r) => {
      const response = await r.fetch();
      const json = await response.json();
      await r.fulfill({ json });
    });

    const result = await trigger("/gzip");
    expect(result.data).toEqual({ gzipped: true, message: "hello" });
  });

  test("follows redirects by default", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/redirect`, async (r) => {
      const response = await r.fetch();
      expect(response.status()).toBe(200);
      expect(response.url()).toContain("/users");
      await r.fulfill({ response });
    });

    const result = await trigger("/redirect");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("supports maxRetries for transient connection resets", async ({
    route,
    trigger,
  }) => {
    const key = `retry-${Date.now()}`;
    await route(`**/flaky*`, async (r) => {
      const response = await r.fetch({ maxRetries: 2 });
      await r.fulfill({ response });
    });

    const result = await trigger(`/flaky?key=${key}&fail=1`);
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ ok: true });
  });

  test("maxRetries does not retry an HTTP 500 response", async ({ route, trigger }) => {
    const key = `http-500-${Date.now()}`;
    await route("**/counted-status*", async (r) => {
      const response = await r.fetch({ maxRetries: 3 });
      expect(response.status()).toBe(500);
      expect(await response.json()).toEqual({ status: 500, hits: 1, key });
      await r.fulfill({ response });
    });

    const result = await trigger(`/counted-status?code=500&key=${key}`);
    expect(result.status).toBe(500);
    expect(result.data).toEqual({ status: 500, hits: 1, key });
  });

  test("fails without maxRetries when the connection resets", async ({
    route,
    trigger,
  }) => {
    const key = `noretry-${Date.now()}`;
    await route(`**/flaky*`, async (r) => {
      let message = "";
      try {
        await r.fetch({ maxRetries: 0 });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message.length).toBeGreaterThan(0);
      await r.fulfill({ status: 502, body: "reset" });
    });

    const result = await trigger(`/flaky?key=${key}&fail=1`);
    expect(result.status).toBe(502);
  });

  test("supports AbortSignal cancellation", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/slow`, async (r) => {
      const controller = new AbortController();
      const pending = r.fetch({ signal: controller.signal, timeout: 0 });
      controller.abort();
      let message = "";
      try {
        await pending;
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message.length).toBeGreaterThan(0);
      await r.fulfill({ status: 499, body: "aborted-fetch" });
    });

    const result = await trigger("/slow");
    expect(result.status).toBe(499);
    expect(result.raw).toBe("aborted-fetch");
  });

  test("timeout 0 disables the fetch timeout", async ({ route, trigger }) => {
    // Pair with a fast upstream so we only assert that timeout:0 is accepted
    // and completes (a true hang would never finish).
    await route(`${UPSTREAM}/users`, async (r) => {
      const response = await r.fetch({ timeout: 0 });
      await r.fulfill({ response });
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
  });

  test("supports headers-only fetch override", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      const response = await r.fetch({
        headers: {
          ...r.request().headers(),
          "x-fetch-only": "1",
        },
      });
      await r.fulfill({ response });
    });

    const result = await trigger("/echo");
    expect(
      (result.data as { headers: Record<string, string> }).headers["x-fetch-only"],
    ).toBe("1");
  });

  test("fetch with headers: {} discards inherited request headers", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      expect(r.request().headers()["x-inherited"]).toBe("present");
      const response = await r.fetch({ headers: {} });
      await r.fulfill({ response });
    });

    const result = await trigger("/echo", {
      headers: { "x-inherited": "present" },
    });
    expect(result.status).toBe(200);
    const echoedHeaders = (result.data as { headers: Record<string, string> }).headers;
    expect(echoedHeaders["x-inherited"]).toBeUndefined();
  });

  test("supports method-only fetch override", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      const response = await r.fetch({ method: "POST" });
      await r.fulfill({ response });
    });

    const result = await trigger("/echo");
    expect(result.data).toMatchObject({ method: "POST" });
  });

  test("APIResponse exposes statusText, headersArray, and body buffer", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/simple.json`, async (r) => {
      const response = await r.fetch();
      expect(response.statusText().length).toBeGreaterThan(0);
      expect(response.headersArray().length).toBeGreaterThan(0);
      const buf = await response.body();
      expect(buf.includes(Buffer.from("foo")[0]!)).toBe(true);
      await r.fulfill({ response });
    });

    const result = await trigger("/simple.json");
    expect(result.data).toEqual({ foo: "bar" });
  });

  test("rejects url override that changes the protocol", async ({ route, trigger }) => {
    let message = "";
    await route(`${UPSTREAM}/users`, async (r) => {
      try {
        await r.fetch({ url: "file:///tmp/foo" });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      await r.fulfill({ status: 200, body: "fetch-protocol-rejected" });
    });

    const result = await trigger("/users");
    // route.fetch reports an unsupported-protocol error (wording differs from
    // continue/fallback's "same protocol" check).
    expect(message).toMatch(/protocol/i);
    expect(result.raw).toBe("fetch-protocol-rejected");
  });

  test("object postData defaults content-type to application/json", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      const response = await r.fetch({
        method: "POST",
        postData: { foo: "bar" },
      });
      await r.fulfill({ response });
    });

    const result = await trigger("/echo");
    const echoed = result.data as {
      body: string;
      headers: Record<string, string>;
    };
    expect(echoed.body).toBe(JSON.stringify({ foo: "bar" }));
    expect(echoed.headers["content-type"]).toContain("application/json");
  });

  test("non-object postData defaults content-type to application/octet-stream", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      // Clear any incoming content-type so the fetch default can be observed.
      const headers = { ...r.request().headers() };
      delete headers["content-type"];
      const response = await r.fetch({
        method: "POST",
        headers,
        postData: "raw-bytes",
      });
      await r.fulfill({ response });
    });

    const result = await trigger("/echo");
    const echoed = result.data as {
      body: string;
      headers: Record<string, string>;
    };
    expect(echoed.body).toBe("raw-bytes");
    expect(echoed.headers["content-type"]).toContain("application/octet-stream");
  });

  test("explicit content-type wins over postData defaults", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      const response = await r.fetch({
        method: "POST",
        headers: {
          ...r.request().headers(),
          "content-type": "text/plain",
        },
        postData: { foo: "bar" },
      });
      await r.fulfill({ response });
    });

    const result = await trigger("/echo");
    const echoed = result.data as {
      body: string;
      headers: Record<string, string>;
    };
    expect(echoed.body).toBe(JSON.stringify({ foo: "bar" }));
    expect(echoed.headers["content-type"]).toContain("text/plain");
  });

  test("throws when maxRedirects is exceeded", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/redirect1`, async (r) => {
      let message = "";
      try {
        await r.fetch({ maxRedirects: 1 });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toMatch(/Max redirect count exceeded/i);
      await r.fulfill({ status: 200, body: "redirects-exceeded" });
    });

    const result = await trigger("/redirect1");
    expect(result.raw).toBe("redirects-exceeded");
  });

  test("throws when maxRedirects is negative", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/redirect`, async (r) => {
      let message = "";
      try {
        await r.fetch({ maxRedirects: -1 });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toMatch(/maxRedirects/i);
      await r.fulfill({ status: 200, body: "negative-max" });
    });

    const result = await trigger("/redirect");
    expect(result.raw).toBe("negative-max");
  });

  test("postData-only fetch override preserves method and url", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      const response = await r.fetch({ postData: "fetch-only-body" });
      await r.fulfill({ response });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "original",
    });
    expect(result.data).toMatchObject({
      method: "POST",
      url: "/echo",
      body: "fetch-only-body",
    });
  });

  test("APIResponse.ok() is false for non-2xx and json() throws on non-JSON", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/status/500`, async (r) => {
      const response = await r.fetch();
      expect(response.status()).toBe(500);
      expect(response.ok()).toBe(false);
      await r.fulfill({ status: 200, body: "checked-500" });
    });
    expect((await trigger("/status/500")).raw).toBe("checked-500");

    await route(`${UPSTREAM}/not-json`, async (r) => {
      const response = await r.fetch();
      expect(response.ok()).toBe(true);
      let message = "";
      try {
        await response.json();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message.length).toBeGreaterThan(0);
      await r.fulfill({ status: 200, body: "checked-not-json" });
    });
    expect((await trigger("/not-json")).raw).toBe("checked-not-json");
  });

  test("APIResponse.dispose() prevents further body reads", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/simple.json`, async (r) => {
      const response = await r.fetch();
      expect(await response.json()).toEqual({ foo: "bar" });
      await response.dispose();
      let message = "";
      try {
        await response.text();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toMatch(/disposed/i);
      await r.fulfill({ status: 200, body: "disposed" });
    });

    const result = await trigger("/simple.json");
    expect(result.raw).toBe("disposed");
  });

  test("follows redirects up to the maxRedirects limit", async ({ route, trigger }) => {
    // redirect1 → redirect2 → redirect3 → users = 3 hops
    await route(`${UPSTREAM}/redirect1`, async (r) => {
      const response = await r.fetch({ maxRedirects: 3 });
      expect(response.status()).toBe(200);
      expect(response.url()).toContain("/users");
      await r.fulfill({ response });
    });

    const result = await trigger("/redirect1");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });
});
