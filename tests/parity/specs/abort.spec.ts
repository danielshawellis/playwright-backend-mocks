import { test, expect, UPSTREAM } from "../harness.js";
import { ABORT_CODES } from "../helpers.js";

test.describe("route.abort", () => {
  test("is abortable", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.abort();
    });

    const result = await trigger("/users");
    expect(result.ok).toBe(false);
    expect(result.error?.length).toBeGreaterThan(0);
  });

  for (const errorCode of ABORT_CODES) {
    test(`supports abort error code: ${errorCode}`, async ({ route, trigger }) => {
      await route(`${UPSTREAM}/users`, async (r) => {
        await r.abort(errorCode);
      });

      const result = await trigger("/users");
      expect(result.ok).toBe(false);
      expect(result.error?.length).toBeGreaterThan(0);
    });
  }

  test("works via XHR", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.abort("failed");
    });

    const result = await trigger("/users", { transport: "xhr" });
    expect(result.ok).toBe(false);
  });
});
