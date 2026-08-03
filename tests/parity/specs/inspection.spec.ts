import { test, expect, UPSTREAM } from "../harness.js";

test.describe("request inspection", () => {
  test("exposes url, method, headers, and postData", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/echo`, async (r, request) => {
      expect(request.url()).toBe(`${UPSTREAM}/echo`);
      expect(request.method()).toBe("POST");
      expect(request.headers()["content-type"]).toContain("application/json");
      expect(request.postData()).toBe(JSON.stringify({ hello: "world" }));
      expect(request.postDataJSON()).toEqual({ hello: "world" });
      expect(request.postDataBuffer()?.equals(Buffer.from('{"hello":"world"}'))).toBe(
        true,
      );
      await r.fulfill({ status: 200, json: { inspected: true } });
    });

    const result = await trigger("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(result.data).toEqual({ inspected: true });
  });

  test("allHeaders and headersArray are available", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      const all = await request.allHeaders();
      expect(Object.keys(all).length).toBeGreaterThan(0);
      // Cross-origin fetch from the harness includes an Origin header.
      expect(all.origin || all.accept || all["user-agent"]).toBeTruthy();
      const arr = await request.headersArray();
      expect(arr.length).toBeGreaterThan(0);
      await r.fulfill({ status: 200, json: { ok: true } });
    });

    const result = await trigger("/users");
    expect(result.data).toEqual({ ok: true });
  });

  test("resourceType is present for Ajax requests", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      // fetch/XHR show up as xhr or fetch depending on browser.
      expect(["xhr", "fetch"].includes(request.resourceType())).toBe(true);
      await r.continue();
    });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
  });

  test("frame is available on the request", async ({ route, trigger, page }) => {
    await route(`${UPSTREAM}/users`, async (r, request) => {
      expect(request.frame()).toBe(page.mainFrame());
      await r.fulfill({ status: 200, body: "framed" });
    });

    const result = await trigger("/users");
    expect(result.raw).toBe("framed");
  });
});
