import { test, expect, UPSTREAM } from "../harness.js";
import { ABORT_CODES } from "../helpers.js";

test.describe("route.abort", () => {
  test("is abortable", async ({ route, trigger, page }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.abort();
    });

    const failed = page.waitForEvent("requestfailed");
    const result = await trigger("/users");
    const request = await failed;
    expect(result.ok).toBe(false);
    expect(result.error?.length).toBeGreaterThan(0);
    expect(request.failure()?.errorText.length).toBeGreaterThan(0);
  });

  test("accepts every documented abort error code", async ({ route, trigger }) => {
    // API surface: each Playwright abort code is a valid argument. Downstream
    // failure *text* is environment-specific (non-goal: OS-level fidelity).
    for (const errorCode of ABORT_CODES) {
      await route(`${UPSTREAM}/users`, async (r) => {
        await r.abort(errorCode);
      });
      const result = await trigger("/users");
      expect(result.ok, errorCode).toBe(false);
      expect(result.error?.length, errorCode).toBeGreaterThan(0);
    }
  });

  test("different abort codes produce distinguishable failure text", async ({
    page,
    trigger,
    harnessPage,
  }) => {
    void harnessPage;
    const texts = new Map<string, string>();

    for (const code of ["timedout", "connectionrefused", "namenotresolved"] as const) {
      await page.unrouteAll();
      await page.route(`${UPSTREAM}/users`, async (r) => {
        await r.abort(code);
      });
      const failed = page.waitForEvent("requestfailed");
      await trigger("/users");
      const request = await failed;
      texts.set(code, request.failure()?.errorText ?? "");
    }

    expect(texts.get("timedout")).toBeTruthy();
    expect(texts.get("connectionrefused")).toBeTruthy();
    expect(texts.get("namenotresolved")).toBeTruthy();
    // At least two of the three should differ in Chromium's mapping.
    const unique = new Set(texts.values());
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});
