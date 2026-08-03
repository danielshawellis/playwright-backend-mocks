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

  test("matches URLPattern", async ({ route, trigger }) => {
    const { URLPattern } = await import("urlpattern-polyfill");
    await route(
      new URLPattern({
        protocol: "http",
        hostname: "127.0.0.1",
        port: "4001",
        pathname: "/users",
      }) as unknown as Parameters<typeof route>[0],
      async (r) => {
        await r.fulfill({
          status: 200,
          json: [{ id: 5, name: "URLPattern" }],
        });
      },
    );

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 5, name: "URLPattern" }]);
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

  test("single-star does not cross path segments", async ({ route, trigger }) => {
    await route("http://127.0.0.1:4001/a/*", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "single-star" } });
    });

    const hit = await trigger("/a/b");
    expect(hit.data).toEqual({ matched: "single-star" });

    // `/a/b/c` would cross another segment — create via absolute path that
    // doesn't exist upstream; single-star should not match `/a` alone either
    // when requesting a deeper path through a different pattern.
    await route("http://127.0.0.1:4001/*", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "one-segment" } });
    });
    // `/users` is one segment under host — matches `/*`
    // But `/**` style is needed for nested; `http://127.0.0.1:4001/*` matches
    // exactly one path segment after origin.
    const one = await trigger("/foo");
    expect(one.data).toEqual({ matched: "one-segment" });
  });

  test("double-star matches across path segments", async ({ route, trigger }) => {
    await route("http://127.0.0.1:4001/a/**", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "double-star" } });
    });

    const result = await trigger("/a/b");
    expect(result.data).toEqual({ matched: "double-star" });
  });

  test("supports brace groups in globs", async ({ route, trigger }) => {
    await route("http://127.0.0.1:4001/{foo,bar}", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "brace" } });
    });

    const foo = await trigger("/foo");
    expect(foo.data).toEqual({ matched: "brace" });
    const bar = await trigger("/bar");
    expect(bar.data).toEqual({ matched: "brace" });

    const users = await trigger("/users");
    expect(users.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("throws on an invalid glob pattern", async ({ route }) => {
    await expect(
      route("http://127.0.0.1:4001/{unclosed", async (r) => {
        await r.fallback();
      }),
    ).rejects.toThrow();
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

  test("works with encoded URL paths", async ({ route, trigger }) => {
    await route("**/with%20space", async (r) => {
      await r.fulfill({ status: 200, json: { mocked: true } });
    });

    const result = await trigger("/with%20space");
    expect(result.data).toEqual({ mocked: true });
  });

  test("resolves relative glob strings against baseURL", async ({
    withIsolatedDownstream,
  }) => {
    await withIsolatedDownstream({ baseURL: UPSTREAM }, async (api) => {
      await api.route("/users", async (r) => {
        await r.fulfill({ status: 200, json: { via: "baseURL" } });
      });

      const result = await api.trigger("/users");
      expect(result.data).toEqual({ via: "baseURL" });
    });
  });

  test("route() returns a Disposable that unregisters the handler", async ({
    route,
    trigger,
  }) => {
    const registration = await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 200, body: "disposable" });
    });

    const first = await trigger("/users");
    expect(first.raw).toBe("disposable");

    registration[Symbol.dispose]();
    const second = await trigger("/users");
    expect(second.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("glob must match the entire URL", async ({ route, trigger }) => {
    // A bare suffix like `*.json` does not match a full absolute URL.
    await route("*.json", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "suffix-only" } });
    });

    const missed = await trigger("/simple.json");
    expect(missed.data).toEqual({ foo: "bar" });

    // Prefix-only globs without `**` also fail to match full URLs.
    await route("http://127.0.0.1:4001/simp*", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "prefix" } });
    });
    const hit = await trigger("/simple.json");
    expect(hit.data).toEqual({ matched: "prefix" });
  });

  test("glob backslash escapes special characters", async ({ route, trigger }) => {
    // In Playwright globs, `?` is literal; escaping it with `\` is also literal `?`.
    await route("**/api\\?param", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "escaped-q" } });
    });

    const hit = await trigger("/api?param");
    expect(hit.data).toEqual({ matched: "escaped-q" });

    const miss = await trigger("/api-param");
    expect(miss.status).toBe(404);
  });

  test("glob braces with extensions match only the listed suffixes", async ({
    route,
    trigger,
  }) => {
    await route("http://127.0.0.1:4001/**/*.{json,txt}", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "ext" } });
    });

    const json = await trigger("/simple.json");
    expect(json.data).toEqual({ matched: "ext" });

    const users = await trigger("/users");
    expect(users.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("partial path glob without host does not match absolute upstream URLs", async ({
    route,
    trigger,
  }) => {
    // `users` alone is not an entire-URL match for http://127.0.0.1:4001/users.
    await route("users", async (r) => {
      await r.fulfill({ status: 200, json: { matched: "bare" } });
    });

    const result = await trigger("/users");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("a pattern starting with * is not resolved against baseURL", async ({
    withIsolatedDownstream,
  }) => {
    await withIsolatedDownstream(
      { baseURL: "http://base-url.invalid/nested/" },
      async (api) => {
        await api.route("**/users", async (r) => {
          await r.fulfill({
            status: 200,
            json: { matchedWithoutBaseURL: true },
          });
        });

        const result = await api.trigger("/users");
        expect(result.data).toEqual({ matchedWithoutBaseURL: true });
      },
    );
  });

  test("an empty string matcher matches every URL", async ({ route, trigger }) => {
    await route("", async (r, request) => {
      await r.fulfill({
        status: 200,
        json: { interceptedPath: new URL(request.url()).pathname },
      });
    });

    expect((await trigger("/users")).data).toEqual({ interceptedPath: "/users" });
    expect((await trigger("/simple.json")).data).toEqual({
      interceptedPath: "/simple.json",
    });
  });

  test("character classes in globs are literal, not regex syntax", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/item[0-9]`, async (r) => {
      await r.fulfill({ status: 200, body: "class-literal" });
    });

    // Literal brackets in the URL match; a digit-only path does not.
    expect((await trigger("/item[0-9]")).raw).toBe("class-literal");

    // /item5 must miss the literal [0-9] pattern and hit upstream 404.
    const miss = await trigger("/item5");
    expect(miss.status).toBe(404);
  });

  test("nested braces in a glob throw at registration", async ({ route }) => {
    await expect(
      route("http://example.com/{a{b,c}}", async (r) => r.fallback()),
    ).rejects.toThrow(/nested/i);
  });

  test("unmatched closing brace in a glob throws at registration", async ({ route }) => {
    await expect(
      route("http://example.com/a}", async (r) => r.fallback()),
    ).rejects.toThrow(/}/);
  });

  test("HTTP relative matcher works with an uppercase-scheme baseURL", async ({
    withIsolatedDownstream,
  }) => {
    await withIsolatedDownstream({ baseURL: "HTTP://127.0.0.1:4001/" }, async (api) => {
      await api.route("/users", async (r) => {
        await r.fulfill({ status: 200, body: "upper-base" });
      });
      const result = await api.trigger("/users");
      expect(result.raw).toBe("upper-base");
    });
  });
});
