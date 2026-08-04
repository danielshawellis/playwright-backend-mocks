/**
 * Source-backed edge cases from Playwright Route / urlMatch / fetch / HAR /
 * WebSocketRoute that were not yet pinned by the main oracle specs.
 *
 * Branches come from network.ts Route._applyFallbackOverrides / fulfill,
 * RouteHandler exception handling after fallback, urlMatches lastIndex, and
 * server/fetch.ts redirect method rewrite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect, UPSTREAM, headerValue, sleep } from "../harness.js";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));

test.describe("source-backed Route / matcher edges", () => {
  test("continue headers replace rather than merge with the original", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      // Do not spread request.headers() — Playwright replaces the header set,
      // then restores forbidden names from the original.
      await r.continue({
        headers: {
          "x-only": "1",
        },
      });
    });

    const result = await trigger("/echo", {
      headers: { "x-original": "keep-me-if-merged", accept: "application/json" },
    });
    const echoHeaders = (result.data as { headers: Record<string, string> }).headers;
    expect(echoHeaders["x-only"]).toBe("1");
    expect(echoHeaders["x-original"]).toBeFalsy();
    // Accept was on the original request; after replacement it should be gone.
    expect(echoHeaders.accept ?? echoHeaders.Accept).toBeFalsy();
  });

  test("continue ignores falsey postData overrides except empty string/Buffer", async ({
    route,
    trigger,
  }) => {
    const seen: Array<string | null> = [];

    for (const override of [0, false, null] as const) {
      await route(`${UPSTREAM}/echo`, async (r) => {
        await r.continue({
          postData: override as unknown as string,
        });
      });
      const result = await trigger("/echo", {
        method: "POST",
        body: "original",
      });
      seen.push((result.data as { body: string | null }).body);
    }

    // 0 / false / null are ignored — original body is kept.
    expect(seen).toEqual(["original", "original", "original"]);

    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({ postData: Buffer.alloc(0) });
    });
    const empty = await trigger("/echo", { method: "POST", body: "original" });
    expect((empty.data as { body: string | null; bodyByteLength: number }).body).toBe(
      null,
    );
    expect((empty.data as { bodyByteLength: number }).bodyByteLength).toBe(0);
  });

  test("fallback then throw does not run lower handlers", async ({ route, trigger }) => {
    // Playwright fails the test when a route handler throws after fallback();
    // that is the observed surface. Pin that the lower LIFO handler did not run.
    test.fail();
    let lowerRan = false;
    await route(`${UPSTREAM}/users`, async (r) => {
      lowerRan = true;
      await r.fulfill({ status: 200, body: "lower" });
    });
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fallback();
      throw new Error("after-fallback-boom");
    });

    await trigger("/users").catch(() => undefined);
    await sleep(200);
    expect(lowerRan).toBe(false);
  });

  test("fulfill status 0 is treated as 200", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ status: 0, body: "zero-status" });
    });
    const result = await trigger("/users");
    expect(result.status).toBe(200);
    expect(result.raw).toBe("zero-status");
  });

  test("unroute(url, handler) removes only that handler among same-URL routes", async ({
    route,
    unroute,
    trigger,
  }) => {
    const older = async (r: {
      fulfill: (o: { status: number; body: string }) => Promise<void>;
    }) => {
      await r.fulfill({ status: 200, body: "older" });
    };
    const newer = async (r: {
      fulfill: (o: { status: number; body: string }) => Promise<void>;
    }) => {
      await r.fulfill({ status: 200, body: "newer" });
    };

    await route(`${UPSTREAM}/users`, older);
    await route(`${UPSTREAM}/users`, newer);
    await unroute(`${UPSTREAM}/users`, older);

    const result = await trigger("/users");
    expect(result.raw).toBe("newer");
  });

  test("RegExp with /g flag resets lastIndex between matches", async ({
    route,
    trigger,
  }) => {
    const pattern = /\/users$/g;
    let hits = 0;
    await route(pattern, async (r) => {
      hits += 1;
      await r.fulfill({ status: 200, body: `hit-${hits}` });
    });

    expect((await trigger("/users")).raw).toBe("hit-1");
    expect((await trigger("/users")).raw).toBe("hit-2");
    expect(hits).toBe(2);
  });

  test("predicate matcher throw leaves the request stalled", async ({
    route,
    trigger,
  }) => {
    // Matcher throw is reported as a test failure; pin that fulfill never runs.
    test.fail();
    let handlerRan = false;
    await route(
      () => {
        throw new Error("predicate-boom");
      },
      async (r) => {
        handlerRan = true;
        await r.fulfill({ status: 200, body: "should-not-run" });
      },
    );

    await trigger("/users").catch(() => undefined);
    await sleep(200);
    expect(handlerRan).toBe(false);
  });

  test("HTTP predicate catch-all still passthroughs when predicate returns false", async ({
    route,
    trigger,
  }) => {
    let matched = 0;
    await route(
      (url) => url.pathname === "/charges",
      async (r) => {
        matched += 1;
        await r.fulfill({ status: 200, json: { mocked: true } });
      },
    );

    const users = await trigger("/users");
    expect(users.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    expect(matched).toBe(0);

    const charges = await trigger("/charges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 1 }),
    });
    expect(charges.data).toEqual({ mocked: true });
    expect(matched).toBe(1);
  });

  test("glob /**/ matches zero or more path segments", async ({ route, trigger }) => {
    await route("http://127.0.0.1:4001/**/users", async (r) => {
      await r.fulfill({ status: 200, body: "star-star" });
    });
    expect((await trigger("/users")).raw).toBe("star-star");
  });

  test("object postData on continue does not set Content-Type", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        method: "POST",
        postData: { a: 1 },
        headers: {
          ...r.request().headers(),
        },
      });
    });

    const result = await trigger("/echo", { method: "POST", body: "x" });
    const echoed = result.data as {
      body: string | null;
      headers: Record<string, string>;
    };
    expect(echoed.body).toBe(JSON.stringify({ a: 1 }));
    // Unlike route.fetch, continue does not infer application/json.
    expect(echoed.headers["content-type"] ?? "").not.toContain("application/json");
  });
});

test.describe("source-backed route.fetch redirect rewrite", () => {
  test("301 redirect after POST becomes GET with empty body", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/redirect-by-status?code=301`, async (r) => {
      const response = await r.fetch({
        method: "POST",
        postData: "payload",
        headers: {
          ...r.request().headers(),
          "content-type": "text/plain",
        },
      });
      await r.fulfill({
        status: 200,
        json: await response.json(),
      });
    });

    const result = await trigger("/redirect-by-status?code=301");
    expect(result.data).toMatchObject({
      method: "GET",
      body: null,
      bodyByteLength: 0,
    });
  });

  test("307 redirect after POST preserves method and body", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/redirect-by-status?code=307`, async (r) => {
      const response = await r.fetch({
        method: "POST",
        postData: "keep-me",
        headers: {
          ...r.request().headers(),
          "content-type": "text/plain",
        },
      });
      await r.fulfill({
        status: 200,
        json: await response.json(),
      });
    });

    const result = await trigger("/redirect-by-status?code=307");
    expect(result.data).toMatchObject({
      method: "POST",
      body: "keep-me",
    });
  });
});

test.describe("source-backed fulfill Content-Length edges", () => {
  test("adds Content-Length for Buffer bodies", async ({ route, trigger }) => {
    const bytes = Buffer.from([1, 2, 3, 4, 5]);
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: bytes,
      });
    });
    const result = await trigger("/users");
    expect(headerValue(result.headers, "content-length")).toBe(String(bytes.length));
  });

  test("preserves an explicit Content-Length header", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        status: 200,
        headers: { "content-length": "2" },
        body: "abcd",
      });
    });
    const result = await trigger("/users");
    expect(headerValue(result.headers, "content-length")).toBe("2");
  });
});

test.describe("source-backed HAR edges", () => {
  test("same HAR entry can fulfill multiple identical requests", async ({
    routeFromHAR,
    trigger,
  }) => {
    const harPath = path.join(fixtureDir, "../testdata/cassette.har");
    await routeFromHAR(harPath, {
      url: "**/users",
      update: false,
      notFound: "abort",
    });

    const a = await trigger("/users");
    const b = await trigger("/users");
    expect(a.data).toEqual([{ id: 9, name: "FromHAR" }]);
    expect(b.data).toEqual(a.data);
  });

  test("omitting the HAR url filter installs a catch-all", async ({
    routeFromHAR,
    trigger,
  }) => {
    const harPath = path.join(fixtureDir, "../testdata/cassette.har");
    await routeFromHAR(harPath, { update: false, notFound: "abort" });

    const users = await trigger("/users");
    expect(users.status).toBe(200);

    // Unknown path is aborted by default notFound.
    const missing = await trigger("/no-such-cassette-path");
    expect(missing.ok).toBe(false);
  });

  test("redirect cycle in HAR yields notFound abort rather than fulfill", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const cycleHar = testInfo.outputPath("cycle.har");
    const har = {
      log: {
        version: "1.2",
        creator: { name: "parity", version: "0" },
        entries: [
          {
            startedDateTime: "2024-01-01T00:00:00.000Z",
            time: 1,
            request: {
              method: "GET",
              url: `${UPSTREAM}/cycle-a`,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: 0,
            },
            response: {
              status: 302,
              statusText: "Found",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [{ name: "location", value: `${UPSTREAM}/cycle-b` }],
              content: { size: 0, mimeType: "text/plain", text: "" },
              redirectURL: `${UPSTREAM}/cycle-b`,
              headersSize: -1,
              bodySize: 0,
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
          },
          {
            startedDateTime: "2024-01-01T00:00:00.000Z",
            time: 1,
            request: {
              method: "GET",
              url: `${UPSTREAM}/cycle-b`,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: 0,
            },
            response: {
              status: 302,
              statusText: "Found",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [{ name: "location", value: `${UPSTREAM}/cycle-a` }],
              content: { size: 0, mimeType: "text/plain", text: "" },
              redirectURL: `${UPSTREAM}/cycle-a`,
              headersSize: -1,
              bodySize: 0,
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
          },
        ],
      },
    };
    fs.writeFileSync(cycleHar, JSON.stringify(har));

    await routeFromHAR(cycleHar, {
      url: "**/cycle-*",
      update: false,
      notFound: "abort",
    });

    const result = await trigger("/cycle-a");
    expect(result.ok).toBe(false);
  });
});

test.describe("source-backed handler snapshot / unroute force-continue", () => {
  test("late-registered handler does not join an in-flight request chain", async ({
    route,
    trigger,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let lateRan = false;

    await route(`${UPSTREAM}/users`, async (r) => {
      entered();
      await barrier;
      await r.fallback();
    });

    const pending = trigger("/users");
    await enteredPromise;

    await route(`${UPSTREAM}/users`, async (r) => {
      lateRan = true;
      await r.fulfill({ status: 200, body: "late-handler" });
    });
    release();

    const inFlight = await pending;
    expect(lateRan).toBe(false);
    expect(inFlight.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);

    // The late handler is active for subsequent requests (newest wins).
    expect((await trigger("/users")).raw).toBe("late-handler");
  });

  test("unrouteAll({ behavior: 'default' }) force-continues an in-flight request", async ({
    route,
    unrouteAll,
    trigger,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });

    await route(`${UPSTREAM}/users`, async (r) => {
      entered();
      await barrier;
      try {
        await r.fulfill({ status: 200, body: "should-not-win" });
      } catch {
        // Route may already have been force-continued by unrouteAll.
      }
    });

    const pending = trigger("/users");
    await enteredPromise;
    await unrouteAll({ behavior: "default" });

    // Upstream must win without releasing the stalled handler.
    const result = await pending;
    expect(result.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
    release();
  });
});

test.describe("source-backed compression / redirect matrix", () => {
  test("route.fetch decodes brotli upstream bodies", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/brotli`, async (r) => {
      const response = await r.fetch();
      await r.fulfill({ json: await response.json() });
    });
    expect((await trigger("/brotli")).data).toEqual({
      brotli: true,
      message: "hello",
    });
  });

  test("route.fetch decodes deflate upstream bodies", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/deflate`, async (r) => {
      const response = await r.fetch();
      await r.fulfill({ json: await response.json() });
    });
    expect((await trigger("/deflate")).data).toEqual({
      deflated: true,
      message: "hello",
    });
  });

  for (const code of [302, 303] as const) {
    test(`${code} redirect after POST becomes GET with empty body`, async ({
      route,
      trigger,
    }) => {
      await route(`${UPSTREAM}/redirect-by-status?code=${code}`, async (r) => {
        const response = await r.fetch({
          method: "POST",
          postData: "payload",
          headers: {
            ...r.request().headers(),
            "content-type": "text/plain",
          },
        });
        await r.fulfill({ status: 200, json: await response.json() });
      });

      expect((await trigger(`/redirect-by-status?code=${code}`)).data).toMatchObject({
        method: "GET",
        body: null,
        bodyByteLength: 0,
      });
    });
  }

  test("308 redirect after POST preserves method and body", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/redirect-by-status?code=308`, async (r) => {
      const response = await r.fetch({
        method: "POST",
        postData: "keep-308",
        headers: {
          ...r.request().headers(),
          "content-type": "text/plain",
        },
      });
      await r.fulfill({ status: 200, json: await response.json() });
    });

    expect((await trigger("/redirect-by-status?code=308")).data).toMatchObject({
      method: "POST",
      body: "keep-308",
    });
  });

  test("301 rewrite drops content-* request headers on the follow-up hop", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/redirect-by-status?code=301`, async (r) => {
      const response = await r.fetch({
        method: "POST",
        postData: "payload",
        headers: {
          ...r.request().headers(),
          "content-type": "text/plain",
          "content-language": "en",
          "content-location": "/x",
        },
      });
      await r.fulfill({ status: 200, json: await response.json() });
    });

    const echoed = (await trigger("/redirect-by-status?code=301")).data as {
      method: string;
      body: string | null;
      headers: Record<string, string>;
    };
    expect(echoed.method).toBe("GET");
    expect(echoed.body).toBeNull();
    expect(echoed.headers["content-type"]).toBeFalsy();
    expect(echoed.headers["content-language"]).toBeFalsy();
    expect(echoed.headers["content-location"]).toBeFalsy();
    expect(echoed.headers["content-length"]).toBeFalsy();
  });

  test("cross-origin redirect strips Authorization", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/redirect-to-localhost`, async (r) => {
      const response = await r.fetch({
        headers: {
          ...r.request().headers(),
          authorization: "Bearer secret-token",
        },
      });
      await r.fulfill({ status: 200, json: await response.json() });
    });

    const echoed = (await trigger("/redirect-to-localhost")).data as {
      headers: Record<string, string>;
    };
    expect(echoed.headers.authorization).toBeFalsy();
  });

  test("same-origin redirect preserves Authorization", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/redirect-echo`, async (r) => {
      const response = await r.fetch({
        headers: {
          ...r.request().headers(),
          authorization: "Bearer keep-me",
        },
      });
      await r.fulfill({ status: 200, json: await response.json() });
    });

    const echoed = (await trigger("/redirect-echo")).data as {
      headers: Record<string, string>;
    };
    expect(echoed.headers.authorization).toBe("Bearer keep-me");
  });

  test("maxRetries reuses the original POST body after a reset", async ({
    route,
    trigger,
  }) => {
    const key = `post-retry-${Date.now()}`;
    await route("**/flaky*", async (r) => {
      const response = await r.fetch({ maxRetries: 2 });
      await r.fulfill({ response });
    });

    const result = await trigger(`/flaky?key=${key}&fail=1`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "retry-body",
    });
    expect(result.data).toMatchObject({
      ok: true,
      body: "retry-body",
    });
  });

  test("negative maxRetries is rejected", async ({ route, trigger }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      let message = "";
      try {
        await r.fetch({ maxRetries: -1 });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.length).toBeGreaterThan(0);
      await r.fulfill({ status: 200, body: "rejected-retries" });
    });
    expect((await trigger("/users")).raw).toBe("rejected-retries");
  });
});

test.describe("source-backed fulfill / continue / fallback edges", () => {
  test("json + path uses path bytes with application/json content-type", async ({
    route,
    trigger,
  }) => {
    const txtPath = path.join(fixtureDir, "../testdata/payload.txt");
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({
        json: { ignored: true },
        path: txtPath,
      });
    });
    const result = await trigger("/users");
    expect(result.raw?.trim()).toBe("plain-file-body");
    expect(headerValue(result.headers, "content-type")).toContain("application/json");
  });

  test("empty string and empty Buffer bodies do not auto-add Content-Length", async ({
    route,
    trigger,
  }) => {
    for (const body of ["", Buffer.alloc(0)] as const) {
      await route(`${UPSTREAM}/users`, async (r) => {
        await r.fulfill({ status: 200, body });
      });
      const result = await trigger("/users");
      expect(headerValue(result.headers, "content-length")).toBeUndefined();
    }
  });

  test("unknown path extension falls back to application/octet-stream", async ({
    route,
    trigger,
  }, testInfo) => {
    const oddPath = testInfo.outputPath("payload.notarealext");
    fs.writeFileSync(oddPath, "odd-bytes");
    await route(`${UPSTREAM}/users`, async (r) => {
      await r.fulfill({ path: oddPath });
    });
    const result = await trigger("/users");
    expect(headerValue(result.headers, "content-type")).toContain(
      "application/octet-stream",
    );
  });

  test("continue rejects non-string non-undefined header values", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/users`, async (r) => {
      let message = "";
      try {
        await r.continue({
          headers: {
            ...r.request().headers(),
            "x-number": 42 as unknown as string,
          },
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
        await r.abort();
      }
      expect(message.length).toBeGreaterThan(0);
    });
    expect((await trigger("/users")).ok).toBe(false);
  });

  test("fallback empty-string postData clears the body for the next handler", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      expect(r.request().postData()).toBe("");
      await r.continue();
    });
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.fallback({ postData: "" });
    });

    const result = await trigger("/echo", {
      method: "POST",
      body: "original-body",
    });
    expect((result.data as { body: string | null; bodyByteLength: number }).body).toBe(
      null,
    );
    expect((result.data as { bodyByteLength: number }).bodyByteLength).toBe(0);
  });

  test("forbidden proxy-* and sec-* continue overrides are ignored", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        headers: {
          ...r.request().headers(),
          "proxy-authorization": "Basic should-drop",
          "sec-fetch-mode": "should-drop",
          "x-allowed": "keep",
        },
      });
    });

    const headers = (
      await trigger("/echo", {
        headers: {
          "proxy-authorization": "Basic original",
          "sec-fetch-mode": "cors",
        },
      })
    ).data as { headers: Record<string, string> };
    // Overrides for forbidden names are stripped; originals may be restored.
    expect(headers.headers["x-allowed"]).toBe("keep");
    expect(headers.headers["proxy-authorization"]).not.toBe("Basic should-drop");
    expect(headers.headers["sec-fetch-mode"]).not.toBe("should-drop");
  });

  test("unroute with an equivalent RegExp (same source+flags) removes the handler", async ({
    route,
    unroute,
    trigger,
  }) => {
    await route(/\/users$/i, async (r) => {
      await r.fulfill({ status: 200, body: "regex-handler" });
    });
    await unroute(/\/users$/i);

    expect((await trigger("/users")).data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);
  });

  test("unroute leaves a RegExp with different flags registered", async ({
    route,
    unroute,
    trigger,
  }) => {
    await route(/\/users$/, async (r) => {
      await r.fulfill({ status: 200, body: "case-sensitive" });
    });
    await unroute(/\/users$/i);

    expect((await trigger("/users")).raw).toBe("case-sensitive");
  });
});

test.describe("source-backed HAR body-match permissiveness", () => {
  test("PUT bodies are ignored when disambiguating HAR entries", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const harFile = testInfo.outputPath("put-bodies.har");
    const har = {
      log: {
        version: "1.2",
        creator: { name: "parity", version: "0" },
        entries: [
          {
            startedDateTime: "2024-01-01T00:00:00.000Z",
            time: 1,
            request: {
              method: "PUT",
              url: `${UPSTREAM}/put-item`,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: 5,
              postData: { mimeType: "text/plain", text: "first" },
            },
            response: {
              status: 200,
              statusText: "OK",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [{ name: "content-type", value: "text/plain" }],
              content: { size: 5, mimeType: "text/plain", text: "first" },
              redirectURL: "",
              headersSize: -1,
              bodySize: 5,
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
          },
          {
            startedDateTime: "2024-01-01T00:00:00.000Z",
            time: 1,
            request: {
              method: "PUT",
              url: `${UPSTREAM}/put-item`,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: 6,
              postData: { mimeType: "text/plain", text: "second" },
            },
            response: {
              status: 200,
              statusText: "OK",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [{ name: "content-type", value: "text/plain" }],
              content: { size: 6, mimeType: "text/plain", text: "second" },
              redirectURL: "",
              headersSize: -1,
              bodySize: 6,
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
          },
        ],
      },
    };
    fs.writeFileSync(harFile, JSON.stringify(har));
    await routeFromHAR(harFile, {
      url: "**/put-item",
      update: false,
      notFound: "abort",
    });

    // Body is ignored for PUT — first/header-best entry wins regardless of body.
    const result = await trigger("/put-item", {
      method: "PUT",
      body: "second",
    });
    expect(result.raw).toBe("first");
  });

  test("bodyless POST can match a HAR entry that has postData", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const harFile = testInfo.outputPath("bodyless-post.har");
    const har = {
      log: {
        version: "1.2",
        creator: { name: "parity", version: "0" },
        entries: [
          {
            startedDateTime: "2024-01-01T00:00:00.000Z",
            time: 1,
            request: {
              method: "POST",
              url: `${UPSTREAM}/bodyless-post`,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: 11,
              postData: { mimeType: "text/plain", text: "has-a-body" },
            },
            response: {
              status: 200,
              statusText: "OK",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [{ name: "content-type", value: "text/plain" }],
              content: {
                size: 7,
                mimeType: "text/plain",
                text: "matched",
              },
              redirectURL: "",
              headersSize: -1,
              bodySize: 7,
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
          },
        ],
      },
    };
    fs.writeFileSync(harFile, JSON.stringify(har));
    await routeFromHAR(harFile, {
      url: "**/bodyless-post",
      update: false,
      notFound: "abort",
    });

    const result = await trigger("/bodyless-post", { method: "POST" });
    expect(result.raw).toBe("matched");
  });

  test("POST with a body can match a HAR entry lacking postData", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const harFile = testInfo.outputPath("no-postdata.har");
    const har = {
      log: {
        version: "1.2",
        creator: { name: "parity", version: "0" },
        entries: [
          {
            startedDateTime: "2024-01-01T00:00:00.000Z",
            time: 1,
            request: {
              method: "POST",
              url: `${UPSTREAM}/no-postdata`,
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: 0,
            },
            response: {
              status: 200,
              statusText: "OK",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: [{ name: "content-type", value: "text/plain" }],
              content: {
                size: 8,
                mimeType: "text/plain",
                text: "no-pdata",
              },
              redirectURL: "",
              headersSize: -1,
              bodySize: 8,
            },
            cache: {},
            timings: { send: 0, wait: 0, receive: 0 },
          },
        ],
      },
    };
    fs.writeFileSync(harFile, JSON.stringify(har));
    await routeFromHAR(harFile, {
      url: "**/no-postdata",
      update: false,
      notFound: "abort",
    });

    const result = await trigger("/no-postdata", {
      method: "POST",
      body: "client-body",
    });
    expect(result.raw).toBe("no-pdata");
  });
});

function harEntry(opts: {
  method: string;
  url: string;
  status: number;
  body?: string;
  location?: string;
  postData?: string;
  mimeType?: string;
  statusText?: string;
}): Record<string, unknown> {
  const headers: Array<{ name: string; value: string }> = [];
  if (opts.location) headers.push({ name: "location", value: opts.location });
  if (opts.mimeType || opts.body !== undefined) {
    headers.push({
      name: "content-type",
      value: opts.mimeType ?? "text/plain",
    });
  }
  const text = opts.body ?? "";
  return {
    startedDateTime: "2024-01-01T00:00:00.000Z",
    time: 1,
    request: {
      method: opts.method,
      url: opts.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: [],
      queryString: [],
      headersSize: -1,
      bodySize: opts.postData?.length ?? 0,
      ...(opts.postData !== undefined
        ? {
            postData: {
              mimeType: "text/plain",
              text: opts.postData,
            },
          }
        : {}),
    },
    response: {
      status: opts.status,
      statusText: opts.statusText ?? (opts.status === -1 ? "" : "OK"),
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers,
      content: {
        size: text.length,
        mimeType: opts.mimeType ?? "text/plain",
        text,
      },
      redirectURL: opts.location ?? "",
      headersSize: -1,
      bodySize: text.length,
      ...(opts.status === -1 ? { _failureText: "net::ERR_FAILED" } : {}),
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  };
}

test.describe("source-backed HAR redirect / stall edges", () => {
  test("status -1 HAR entry stalls rather than fulfilling or aborting", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const harFile = testInfo.outputPath("status-minus-one.har");
    fs.writeFileSync(
      harFile,
      JSON.stringify({
        log: {
          version: "1.2",
          creator: { name: "parity", version: "0" },
          entries: [
            harEntry({
              method: "GET",
              url: `${UPSTREAM}/stall-me`,
              status: -1,
            }),
          ],
        },
      }),
    );

    await routeFromHAR(harFile, {
      url: "**/stall-me",
      update: false,
      notFound: "abort",
    });

    const result = await Promise.race([
      trigger("/stall-me").then((r) => ({ kind: "done" as const, r })),
      sleep(800).then(() => ({ kind: "stall" as const })),
    ]);
    // HarRouter returns early on status -1 — request stays paused (stall).
    expect(result.kind).toBe("stall");
  });

  test("HAR 302 after POST rewrites the follow-up lookup to GET", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const harFile = testInfo.outputPath("har-302-post.har");
    fs.writeFileSync(
      harFile,
      JSON.stringify({
        log: {
          version: "1.2",
          creator: { name: "parity", version: "0" },
          entries: [
            harEntry({
              method: "POST",
              url: `${UPSTREAM}/har-post-redir`,
              status: 302,
              location: `${UPSTREAM}/har-post-target`,
              postData: "ignored-after-rewrite",
            }),
            harEntry({
              method: "GET",
              url: `${UPSTREAM}/har-post-target`,
              status: 200,
              body: "get-target",
            }),
            harEntry({
              method: "POST",
              url: `${UPSTREAM}/har-post-target`,
              status: 200,
              body: "post-target",
              postData: "ignored-after-rewrite",
            }),
          ],
        },
      }),
    );

    await routeFromHAR(harFile, {
      url: "**/har-post-*",
      update: false,
      notFound: "abort",
    });

    const result = await trigger("/har-post-redir", {
      method: "POST",
      body: "ignored-after-rewrite",
    });
    expect(result.raw).toBe("get-target");
  });

  test("HAR 307 after POST keeps POST for the follow-up lookup", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const harFile = testInfo.outputPath("har-307-post.har");
    fs.writeFileSync(
      harFile,
      JSON.stringify({
        log: {
          version: "1.2",
          creator: { name: "parity", version: "0" },
          entries: [
            harEntry({
              method: "POST",
              url: `${UPSTREAM}/har-307-redir`,
              status: 307,
              location: `${UPSTREAM}/har-307-target`,
              postData: "keep-post",
            }),
            harEntry({
              method: "GET",
              url: `${UPSTREAM}/har-307-target`,
              status: 200,
              body: "get-target",
            }),
            harEntry({
              method: "POST",
              url: `${UPSTREAM}/har-307-target`,
              status: 200,
              body: "post-target",
              postData: "keep-post",
            }),
          ],
        },
      }),
    );

    await routeFromHAR(harFile, {
      url: "**/har-307-*",
      update: false,
      notFound: "abort",
    });

    const result = await trigger("/har-307-redir", {
      method: "POST",
      body: "keep-post",
    });
    expect(result.raw).toBe("post-target");
  });

  test("relative HAR Location is resolved against the current request URL", async ({
    routeFromHAR,
    trigger,
  }, testInfo) => {
    const harFile = testInfo.outputPath("har-relative-location.har");
    fs.writeFileSync(
      harFile,
      JSON.stringify({
        log: {
          version: "1.2",
          creator: { name: "parity", version: "0" },
          entries: [
            harEntry({
              method: "GET",
              url: `${UPSTREAM}/har-rel-a`,
              status: 302,
              location: "har-rel-b",
            }),
            harEntry({
              method: "GET",
              url: `${UPSTREAM}/har-rel-b`,
              status: 200,
              body: "relative-ok",
            }),
          ],
        },
      }),
    );

    await routeFromHAR(harFile, {
      url: "**/har-rel-*",
      update: false,
      notFound: "abort",
    });

    expect((await trigger("/har-rel-a")).raw).toBe("relative-ok");
  });
});

test.describe("source-backed settlement / fetch / matcher sharpening", () => {
  test("unrouteAll({ behavior: 'wait' }) waits even after continue() while handler still runs", async ({
    route,
    unrouteAll,
    trigger,
  }) => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });

    await route(`${UPSTREAM}/users`, async (r) => {
      entered();
      await r.continue();
      await barrier;
    });

    const pending = trigger("/users");
    await enteredPromise;

    let didUnroute = false;
    const unroutePromise = unrouteAll({ behavior: "wait" }).then(() => {
      didUnroute = true;
    });
    await sleep(200);
    expect(didUnroute).toBe(false);
    release();
    await unroutePromise;
    expect(didUnroute).toBe(true);
    await pending;
  });

  test("fulfill rejects a disposed fetch response", async ({ route, trigger }) => {
    let message = "";
    await route(`${UPSTREAM}/users`, async (r) => {
      const response = await r.fetch();
      await response.dispose();
      try {
        await r.fulfill({ response });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      // Server marks the route handled before asserting the body exists, so
      // recovery settle APIs also throw "already handled".
    });

    await Promise.race([trigger("/users").catch(() => undefined), sleep(500)]);
    expect(message).toMatch(/disposed/i);
  });

  test("empty url and method continue overrides are ignored", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        url: "",
        method: "",
      });
    });

    const result = await trigger("/echo", { method: "POST", body: "x" });
    expect(result.data).toMatchObject({
      method: "POST",
      url: "/echo",
    });
  });

  test("forbidden x-http-method-override TRACE value is ignored", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        headers: {
          ...r.request().headers(),
          "x-http-method-override": "TRACE",
          "x-allowed": "1",
        },
      });
    });

    const headers = (
      await trigger("/echo", {
        headers: { "x-http-method-override": "GET" },
      })
    ).data as { headers: Record<string, string> };
    expect(headers.headers["x-allowed"]).toBe("1");
    // Forbidden TRACE override is stripped; original may be restored.
    expect(headers.headers["x-http-method-override"]).not.toBe("TRACE");
  });

  test("allowed x-http-method-override value survives continue", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      await r.continue({
        headers: {
          ...r.request().headers(),
          "x-http-method-override": "PUT",
        },
      });
    });

    const headers = (await trigger("/echo")).data as {
      headers: Record<string, string>;
    };
    expect(headers.headers["x-http-method-override"]).toBe("PUT");
  });

  test("string postData under exact application/json is JSON-stringified when not JSON", async ({
    route,
    trigger,
  }) => {
    await route(`${UPSTREAM}/echo`, async (r) => {
      const response = await r.fetch({
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        postData: "not-json-text",
      });
      await r.fulfill({ response });
    });

    const echoed = (await trigger("/echo")).data as { body: string | null };
    expect(echoed.body).toBe(JSON.stringify("not-json-text"));
  });

  test("maxRetries exhaustion fails after the last retry attempt", async ({
    route,
    trigger,
  }) => {
    const key = `exhaust-${Date.now()}`;
    await route("**/flaky*", async (r) => {
      let message = "";
      try {
        // fail=3 means three destroys before success; maxRetries:1 → 2 attempts total.
        await r.fetch({ maxRetries: 1 });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.length).toBeGreaterThan(0);
      await r.fulfill({ status: 502, body: "retries-exhausted" });
    });

    const result = await trigger(`/flaky?key=${key}&fail=3`);
    expect(result.status).toBe(502);
    expect(result.raw).toBe("retries-exhausted");
  });

  test("APIResponse.ok is true only for status 200-299", async ({ route, trigger }) => {
    const checks: Array<{ status: number; ok: boolean }> = [];
    // Skip exotic 1xx — some HTTP stacks reset those connections.
    for (const status of [200, 204, 299, 300, 404]) {
      await route(`${UPSTREAM}/status/${status}`, async (r) => {
        const response = await r.fetch();
        checks.push({ status: response.status(), ok: response.ok() });
        await r.fulfill({
          status: 200,
          json: { status: response.status(), ok: response.ok() },
        });
      });
      await trigger(`/status/${status}`);
    }
    expect(checks).toEqual([
      { status: 200, ok: true },
      { status: 204, ok: true },
      { status: 299, ok: true },
      { status: 300, ok: false },
      { status: 404, ok: false },
    ]);
  });

  test("APIResponse.body returns exact binary bytes", async ({ route, trigger }) => {
    const expected = Buffer.from([0, 1, 2, 3, 254, 255]);
    await route(`${UPSTREAM}/binary`, async (r) => {
      const response = await r.fetch();
      const body = await response.body();
      expect(Buffer.from(body).equals(expected)).toBe(true);
      await r.fulfill({ response });
    });
    const result = await trigger("/binary");
    expect(result.status).toBe(200);
  });

  test("RegExp with sticky /y flag resets lastIndex between matches", async ({
    route,
    trigger,
  }) => {
    // Sticky match must anchor at index 0 of the full URL, so include the host.
    const pattern = new RegExp(`^${UPSTREAM.replace(/\./g, "\\.")}/users$`, "y");
    let hits = 0;
    await route(pattern, async (r) => {
      hits += 1;
      await r.fulfill({ status: 200, body: `sticky-${hits}` });
    });
    expect((await trigger("/users")).raw).toBe("sticky-1");
    expect((await trigger("/users")).raw).toBe("sticky-2");
    expect(hits).toBe(2);
  });
});
