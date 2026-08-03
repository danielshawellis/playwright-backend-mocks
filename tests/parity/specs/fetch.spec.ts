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
          "access-control-expose-headers": "foo",
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
    request,
  }) => {
    const sample = await request.get(`${UPSTREAM}/simple.json`);
    await route(`${UPSTREAM}/users`, async (r) => {
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
      // APIRequestContext decompresses; page route fulfill serves decoded JSON.
      const json = await response.json();
      await r.fulfill({ json });
    });

    const result = await trigger("/gzip");
    expect(result.data).toEqual({ gzipped: true, message: "hello" });
  });
});
