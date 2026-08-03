import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, UPSTREAM, headerValue, sleep } from "../harness.js";

/**
 * routeFromHAR oracle suite.
 *
 * Pins Playwright HAR record/replay control-flow. Step 2 dual-mode uses the
 * harness `routeFromHAR` seam → `backendMocks.routeFromHAR` with the same HAR
 * files and assertions (rewrite-spec §4).
 *
 * Tests that need a fresh downstream host for record/update use
 * `withIsolatedDownstream`; closing that host flushes HAR updates.
 */
const harPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/cassette.har",
);

test.describe("routeFromHAR", () => {
  test("fulfills from HAR matching the method", async ({
    trigger,
    routeFromHAR,
  }) => {
    await routeFromHAR(harPath, { url: "**/users", update: false });

    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.data).toEqual([{ id: 9, name: "FromHAR" }]);
    expect(headerValue(result.headers, "x-har")).toBe("replayed");
  });

  test("matches POST entries by method", async ({ routeFromHAR, trigger }) => {
    await routeFromHAR(harPath, { url: "**/charges", update: false });

    const result = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 7 }),
    });
    expect(result.status).toBe(201);
    expect(result.data).toEqual({ id: "ch_har", amount: 7, status: "ok" });
  });

  test("disambiguates POST entries by postData body", async ({
    routeFromHAR,
    trigger,
  }) => {
    await routeFromHAR(harPath, { url: "**/charges", update: false });

    const seven = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 7 }),
    });
    expect(seven.data).toEqual({ id: "ch_har", amount: 7, status: "ok" });

    const ninetyNine = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 99 }),
    });
    expect(ninetyNine.data).toEqual({
      id: "ch_har99",
      amount: 99,
      status: "ok",
    });
  });

  test("by default aborts requests not found in HAR", async ({
    routeFromHAR,
    trigger,
  }) => {
    await routeFromHAR(harPath, {
      url: "**/missing-from-har",
      update: false,
    });

    const result = await trigger("/missing-from-har");
    expect(result.ok).toBe(false);
  });

  test("notFound: fallback continues when not found in HAR", async ({
    routeFromHAR,
    trigger,
  }) => {
    await routeFromHAR(harPath, {
      url: "**/text",
      update: false,
      notFound: "fallback",
    });

    const result = await trigger("/text");
    expect(result.status).toBe(200);
    expect(result.raw).toBe("hello-text");
  });

  test("notFound: fallback reaches the next route handler", async ({
    route,
    routeFromHAR,
    trigger,
  }) => {
    let lowerHandlerCalled = false;
    await route(`${UPSTREAM}/missing-from-har`, async (r) => {
      lowerHandlerCalled = true;
      await r.fulfill({ status: 203, body: "lower-handler" });
    });
    await routeFromHAR(harPath, {
      url: "**/missing-from-har",
      update: false,
      notFound: "fallback",
    });

    const result = await trigger("/missing-from-har");
    expect(result.status).toBe(203);
    expect(result.raw).toBe("lower-handler");
    expect(lowerHandlerCalled).toBe(true);
  });

  test("notFound: fallback continues on a bad HAR file", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const badHar = testInfo.outputPath("bad.har");
    fs.writeFileSync(badHar, JSON.stringify({ log: {} }), "utf8");

    await routeFromHAR(badHar, {
      url: "**/users",
      notFound: "fallback",
    });

    const result = await trigger("/users");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("only handles requests matching the url filter", async ({
    routeFromHAR,
    trigger,
  }) => {
    await routeFromHAR(harPath, { url: "**/users", update: false });

    const users = await trigger("/users");
    expect(users.data).toEqual([{ id: 9, name: "FromHAR" }]);

    const charges = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 7 }),
    });
    expect(charges.data).toEqual({
      id: "ch_real",
      amount: 7,
      status: "succeeded",
    });
  });

  test("supports a regex url filter", async ({ routeFromHAR, trigger }) => {
    await routeFromHAR(harPath, { url: /\/users$/, update: false });

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 9, name: "FromHAR" }]);
  });

  test("supports a predicate url filter", async ({ routeFromHAR, trigger }) => {
    // Docs allow a predicate; published typings currently list string|RegExp only.
    await routeFromHAR(harPath, {
      // @ts-expect-error Playwright docs allow predicate; typings lag behind.
      url: (url: URL) => url.pathname === "/users",
      update: false,
    });

    const result = await trigger("/users");
    expect(result.data).toEqual([{ id: 9, name: "FromHAR" }]);
  });

  test("follows redirects recorded in HAR", async ({ routeFromHAR, trigger }) => {
    await routeFromHAR(harPath, {
      url: /\/(redirect-har|har-redirect-target)$/,
      update: false,
    });

    const result = await trigger("/redirect-har");
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ via: "har-redirect" });
  });

  test("disambiguates entries by request headers", async ({ routeFromHAR, trigger }) => {
    await routeFromHAR(harPath, { url: "**/echo", update: false });

    const alpha = await trigger("/echo", {
      headers: { "x-variant": "alpha" },
    });
    expect(alpha.data).toEqual({ variant: "alpha" });

    const beta = await trigger("/echo", {
      headers: { "x-variant": "beta" },
    });
    expect(beta.data).toEqual({ variant: "beta" });
  });

  test("applies fallback overrides before routing from HAR", async ({
    route,
    routeFromHAR,
    trigger,
  }) => {
    await routeFromHAR(harPath, {
      url: "**/har-script*",
      update: false,
    });
    await route(`${UPSTREAM}/har-script`, async (r) => {
      await r.fallback({ url: `${UPSTREAM}/har-script-alt` });
    });

    const result = await trigger("/har-script");
    expect(result.data).toEqual({ script: "alt" });
  });

  test("unrouteAll stops routeFromHAR", async ({
    routeFromHAR,
    trigger,
    unrouteAll,
  }) => {
    await routeFromHAR(harPath, { url: "**/users", update: false });
    await unrouteAll();

    const result = await trigger("/users");
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("update: true records traffic into a HAR file", async ({
    withIsolatedDownstream,
  }, testInfo) => {
    const outHar = testInfo.outputPath("recorded.har");
    await withIsolatedDownstream({}, async (api) => {
      await api.routeFromHAR(outHar, {
        url: "**/users",
        update: true,
        updateMode: "minimal",
      });

      const live = await api.trigger("/users");
      expect(live.data).toEqual([
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
      ]);
    });

    await withIsolatedDownstream({}, async (api) => {
      await api.routeFromHAR(outHar, { url: "**/users", update: false });

      const result = await api.trigger("/users");
      expect(result.status).toBe(200);
      expect(result.data).toEqual([
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
      ]);
    });
    expect(fs.existsSync(outHar)).toBe(true);
  });

  test("GET to a POST-only HAR entry does not reuse the wrong method", async ({
    routeFromHAR,
    trigger,
  }) => {
    await routeFromHAR(harPath, {
      url: "**/charges",
      update: false,
      notFound: "fallback",
    });

    const result = await trigger("/charges");
    expect(result.status).toBe(404);
  });

  test("picks the entry with the most matching headers when no exact match", async ({
    routeFromHAR,
    trigger,
  }) => {
    // Three cassette entries share foo+bar and differ only on baz.
    // An unknown baz value still matches foo+bar, so the first/best-scoring
    // entry (baz1) wins — Playwright's header scoring, not exact-only match.
    await routeFromHAR(harPath, { url: "**/echo-score", update: false });

    const fetchScore = async (baz: string) =>
      trigger("/echo-score", {
        method: "POST",
        headers: {
          foo: "foo-value",
          bar: "bar-value",
          baz,
        },
        body: "",
      });

    expect((await fetchScore("baz1")).raw).toBe("baz1");
    expect((await fetchScore("baz2")).raw).toBe("baz2");
    expect((await fetchScore("baz3")).raw).toBe("baz3");
    expect((await fetchScore("baz4")).raw).toBe("baz1");
  });

  test("ignores multipart boundary when matching the body", async ({
    routeFromHAR,
    trigger,
  }) => {
    await routeFromHAR(harPath, { url: "**/multipart", update: false });

    // Different boundary than the cassette, same field payload shape.
    const boundary = "----WebKitFormBoundaryBBBB";
    const body =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="field"\r\n\r\n` +
      `hello\r\n` +
      `--${boundary}--\r\n`;

    const result = await trigger("/multipart", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ multipart: "matched" });
  });

  test("update records with url filter and override options then replays", async ({
    withIsolatedDownstream,
  }, testInfo) => {
    const outHar = testInfo.outputPath("override-record.har");
    await withIsolatedDownstream({}, async (api) => {
      await api.routeFromHAR(outHar, {
        url: "**/echo*",
        update: true,
        updateMode: "minimal",
        updateContent: "embed",
      });

      // Record /echo-alt via a fallback url override into the HAR under that filter.
      await api.route(`${UPSTREAM}/echo`, async (r) => {
        await r.fallback({ url: `${UPSTREAM}/echo-alt` });
      });

      const live = await api.trigger("/echo");
      expect(live.data).toMatchObject({ variant: "alt" });
    });

    await withIsolatedDownstream({}, async (api) => {
      await api.routeFromHAR(outHar, {
        url: "**/echo-alt",
        update: false,
        notFound: "abort",
      });

      const result = await api.trigger("/echo-alt");
      expect(result.data).toMatchObject({ variant: "alt" });
    });
  });

  test("records aborted requests with a failure marker and does not replay success", async ({
    withIsolatedDownstream,
  }, testInfo) => {
    // Playwright 1.62 records aborted/reset traffic with status -1 + _failureText
    // rather than omitting the entry. Replaying that entry must not yield a
    // successful 200 body (request stalls / fails) — failed recordings must not
    // be treated as fulfillable in a Node HAR implementation.
    const outHar = testInfo.outputPath("aborted.har");

    await withIsolatedDownstream({}, async (api) => {
      await api.routeFromHAR(outHar, {
        url: "**/abort-me",
        update: true,
        updateMode: "minimal",
        updateContent: "embed",
      });

      const cancelled = await api.trigger("/abort-me");
      expect(cancelled.ok).toBe(false);
    });

    expect(fs.existsSync(outHar)).toBe(true);
    const raw = fs.readFileSync(outHar, "utf8");
    expect(raw).toContain("/abort-me");
    expect(raw).toMatch(/"status"\s*:\s*-1/);
    expect(raw).toContain("_failureText");
    expect(raw).not.toMatch(/"status"\s*:\s*200/);

    await withIsolatedDownstream({}, async (api) => {
      await api.routeFromHAR(outHar, {
        url: "**/abort-me",
        update: false,
        notFound: "abort",
      });

      const result = await Promise.race([
        api.trigger("/abort-me"),
        sleep(1000).then(() => ({ timeout: true as const })),
      ]);

      // Must not successfully fulfill from the failed HAR entry.
      if ("timeout" in result) {
        expect(result.timeout).toBe(true);
      } else {
        expect(result.ok).toBe(false);
      }
    });
  });
});
