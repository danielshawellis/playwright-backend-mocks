import { test, expect, UPSTREAM } from "../harness.js";

test.describe("matchers", () => {
  test("matches Playwright-style URL globs", async ({ route, trigger }) => {
    await route("http://127.0.0.1:4001/**", async (r) => {
      await r.fulfill({
        status: 200,
        json: [{ id: 1, name: "Glob" }],
      });
    });

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 1, name: "Glob" }]);
  });

  test("matches RegExp URLs", async ({ route, trigger }) => {
    await route(/\/users$/, async (r) => {
      await r.fulfill({
        status: 200,
        json: [{ id: 2, name: "Regex" }],
      });
    });

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 2, name: "Regex" }]);
  });

  test("matches URL predicates", async ({ route, trigger }) => {
    await route(
      (url) => url.hostname === "127.0.0.1" && url.pathname === "/users",
      async (r) => {
        await r.fulfill({
          status: 200,
          json: [{ id: 4, name: "Predicate" }],
        });
      },
    );

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 4, name: "Predicate" }]);
  });

  test("does not treat ? as a single-character wildcard", async ({ route, trigger }) => {
    // In Playwright globs, `?` is literal — not a wildcard.
    await route("http://127.0.0.1:4001/user?", async (r) => {
      await r.fulfill({ status: 200, body: "question" });
    });

    const missed = await trigger("/users");
    expect(missed.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("throws on an invalid glob pattern", async ({ page }) => {
    // Playwright validates glob patterns at registration time.
    let error: Error | undefined;
    try {
      await page.route("http://127.0.0.1:4001/{unclosed", async (r) => {
        await r.fallback();
      });
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeTruthy();
  });

  test("only the matching handler runs", async ({ route, trigger }) => {
    let chargesHit = false;
    await route(`${UPSTREAM}/charges`, async (r) => {
      chargesHit = true;
      await r.fulfill({ status: 201, json: { ok: true } });
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, json: [{ id: 1, name: "OnlyUsers" }] });
    });

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 1, name: "OnlyUsers" }]);
    expect(chargesHit).toBe(false);
  });
});
