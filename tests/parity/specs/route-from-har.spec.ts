import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, UPSTREAM } from "../harness.js";

/**
 * Portable routeFromHAR behaviors that later map to routeFromJSON.
 * Not dual-mode: Step 2 rewrites these against routeFromJSON separately.
 */
const harPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/cassette.har",
);

test.describe("routeFromHAR (oracle for routeFromJSON)", () => {
  test("fulfills from HAR matching the method", async ({
    page,
    trigger,
    harnessPage,
  }) => {
    void harnessPage;
    await page.routeFromHAR(harPath, { url: "**/users", update: false });

    const pending = page.waitForResponse(`${UPSTREAM}/users`);
    const result = await trigger("/users");
    const response = await pending;
    expect(result.status).toBe(200);
    expect(result.data).toEqual([{ id: 9, name: "FromHAR" }]);
    // Custom HAR headers are visible on Playwright's Response; browser fetch may
    // hide them cross-origin without Access-Control-Expose-Headers.
    expect(response.headers()["x-har"]).toBe("replayed");
  });

  test("matches POST entries by method", async ({ page, trigger }) => {
    await page.routeFromHAR(harPath, { url: "**/charges", update: false });

    const result = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 7 }),
    });
    expect(result.status).toBe(201);
    expect(result.data).toEqual({ id: "ch_har", amount: 7, status: "ok" });
  });

  test("by default aborts requests not found in HAR", async ({ page, trigger }) => {
    await page.routeFromHAR(harPath, {
      url: "**/echo",
      update: false,
      notFound: "abort",
    });

    const result = await trigger("/echo");
    expect(result.ok).toBe(false);
  });

  test("notFound: fallback continues when not found in HAR", async ({
    page,
    trigger,
  }) => {
    await page.routeFromHAR(harPath, {
      url: "**/echo",
      update: false,
      notFound: "fallback",
    });

    const result = await trigger("/echo");
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ method: "GET" });
  });

  test("only handles requests matching the url filter", async ({ page, trigger }) => {
    await page.routeFromHAR(harPath, { url: "**/users", update: false });

    const users = await trigger("/users");
    expect(users.data).toEqual([{ id: 9, name: "FromHAR" }]);

    const charges = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 7 }),
    });
    // Filter excludes /charges — real upstream answers.
    expect(charges.data).toEqual({
      id: "ch_real",
      amount: 7,
      status: "succeeded",
    });
  });

  test("supports a regex url filter", async ({ page, trigger }) => {
    await page.routeFromHAR(harPath, { url: /\/users$/, update: false });

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 9, name: "FromHAR" }]);
  });

  test("unrouteAll stops routeFromHAR", async ({ page, trigger }) => {
    await page.routeFromHAR(harPath, { url: "**/users", update: false });
    await page.unrouteAll();

    const result = await trigger("/users");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });
});
