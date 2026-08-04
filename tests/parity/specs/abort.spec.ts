import { test, expect, UPSTREAM, ABORT_CODES } from "../harness.js";

test.describe("route.abort", () => {
  test("is abortable", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.abort();
    });

    const result = await trigger("/users");
    expect(result.ok).toBe(false);
    expect(result.error?.length).toBeGreaterThan(0);
  });

  test("accepts every documented abort error code", async ({
    route,
    trigger,
    unrouteAll,
  }) => {
    // API surface: each Playwright abort code is a valid argument. Downstream
    // failure *text* is environment-specific (non-goal: OS-level fidelity).
    for (const errorCode of ABORT_CODES) {
      await unrouteAll();
      await route(`${UPSTREAM}/users`, async (r) => {
        await r.abort(errorCode);
      });
      const result = await trigger("/users");
      expect(result.ok, errorCode).toBe(false);
      expect(result.error?.length, errorCode).toBeGreaterThan(0);
    }
  });

  test("different abort codes produce distinguishable failure text", async ({
    route,
    trigger,
    unrouteAll,
  }) => {
    const texts = new Map<string, string>();

    for (const code of ["timedout", "connectionrefused", "namenotresolved"] as const) {
      await unrouteAll();
      await route(`${UPSTREAM}/users`, async (r) => {
        await r.abort(code);
      });
      const result = await trigger("/users");
      texts.set(code, result.error ?? "");
    }

    expect(texts.get("timedout")).toBeTruthy();
    expect(texts.get("connectionrefused")).toBeTruthy();
    expect(texts.get("namenotresolved")).toBeTruthy();
    // At least two of the three should differ in Chromium's mapping.
    const unique = new Set(texts.values());
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });
});
