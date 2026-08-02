import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { encodeBody } from "@playwright-backend-mocks/protocol";
import { test, expect } from "@playwright-backend-mocks/playwright";
import { UPSTREAM, callVia, headerValue, readProxyJson } from "../helpers.js";

const cassetteDir = mkdtempSync(path.join(tmpdir(), "pbm-route-from-json-"));
const cassettePath = path.join(cassetteDir, "users.json");

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  rmSync(cassetteDir, { recursive: true, force: true });
});

test.describe("routeFromJSON", () => {
  test("records matching traffic with update: true", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.routeFromJSON(cassettePath, {
      url: `${UPSTREAM}/**`,
      update: true,
    });

    const users = await readProxyJson(await callVia(request, "fetch", "/users"));
    expect(users.status).toBe(200);
    expect(users.data).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);

    const charge = await readProxyJson(
      await callVia(request, "fetch", "/charges", {
        method: "POST",
        data: { amount: 42 },
      }),
    );
    expect(charge.status).toBe(201);
    expect(charge.data).toMatchObject({ id: "ch_real", amount: 42 });
  });

  test("writes a multi-entry JSON cassette on fixture dispose", async () => {
    const file = JSON.parse(readFileSync(cassettePath, "utf8")) as {
      version: number;
      entries: Array<{
        request: { url: string; method: string; bodyBase64: string | null };
        response: { status: number; bodyBase64: string | null };
      }>;
    };

    expect(file.version).toBe(1);
    expect(file.entries.length).toBeGreaterThanOrEqual(2);

    const usersEntry = file.entries.find(
      (entry) => entry.request.method === "GET" && entry.request.url.endsWith("/users"),
    );
    expect(usersEntry).toBeTruthy();
    expect(usersEntry?.response.status).toBe(200);

    const chargeEntry = file.entries.find(
      (entry) =>
        entry.request.method === "POST" && entry.request.url.endsWith("/charges"),
    );
    expect(chargeEntry).toBeTruthy();
    expect(chargeEntry?.request.bodyBase64).toBe(
      encodeBody(JSON.stringify({ amount: 42 })),
    );
  });

  test("replays fulfilled responses from the JSON cassette", async ({
    request,
    backendMocks,
  }) => {
    const file = JSON.parse(readFileSync(cassettePath, "utf8")) as {
      version: number;
      entries: Array<{
        request: { url: string; method: string };
        response: {
          status: number;
          statusText: string;
          headers: Record<string, string>;
          bodyBase64: string | null;
        };
      }>;
    };

    const usersEntry = file.entries.find(
      (entry) => entry.request.method === "GET" && entry.request.url.endsWith("/users"),
    );
    expect(usersEntry).toBeTruthy();
    usersEntry!.response.bodyBase64 = encodeBody(
      JSON.stringify([{ id: 9, name: "FromJSON" }]),
    );
    usersEntry!.response.headers = {
      ...usersEntry!.response.headers,
      "x-from-json": "yes",
    };
    writeFileSync(cassettePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");

    await backendMocks.routeFromJSON(cassettePath, {
      url: `${UPSTREAM}/**`,
      update: false,
    });

    const body = await readProxyJson(await callVia(request, "fetch", "/users"));
    expect(body.status).toBe(200);
    expect(body.data).toEqual([{ id: 9, name: "FromJSON" }]);
    expect(headerValue(body.headers, "x-from-json")).toBe("yes");
  });

  test("replays the same entry for repeated identical requests", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.routeFromJSON(cassettePath, {
      url: `${UPSTREAM}/users`,
    });

    const first = await readProxyJson(await callVia(request, "fetch", "/users"));
    const second = await readProxyJson(await callVia(request, "fetch", "/users"));
    expect(first.data).toEqual([{ id: 9, name: "FromJSON" }]);
    expect(second.data).toEqual([{ id: 9, name: "FromJSON" }]);
  });

  test("matches POST payloads strictly when replaying", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.routeFromJSON(cassettePath, {
      url: `${UPSTREAM}/**`,
    });

    const matched = await readProxyJson(
      await callVia(request, "fetch", "/charges", {
        method: "POST",
        data: { amount: 42 },
      }),
    );
    expect(matched.status).toBe(201);
    expect(matched.data).toMatchObject({ id: "ch_real", amount: 42 });

    const missing = await callVia(request, "fetch", "/charges", {
      method: "POST",
      data: { amount: 99 },
    });
    expect(missing.status()).toBe(500);
    const missingBody = await readProxyJson(missing);
    expect(missingBody.error).toBe("request_failed");
  });

  test("aborts by default when no cassette entry matches", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.routeFromJSON(cassettePath, {
      url: `${UPSTREAM}/echo`,
    });

    const response = await callVia(request, "fetch", "/echo");
    expect(response.status()).toBe(500);
    const body = await readProxyJson(response);
    expect(body.error).toBe("request_failed");
  });

  test("falls back to the network when notFound is fallback", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.routeFromJSON(cassettePath, {
      url: `${UPSTREAM}/echo`,
      notFound: "fallback",
    });

    const body = await readProxyJson(await callVia(request, "fetch", "/echo"));
    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({ method: "GET", url: "/echo" });
    expect(headerValue(body.headers, "x-upstream")).toBe("real");
  });

  test("update: true replaces the cassette with a new session snapshot", async ({
    request,
    backendMocks,
  }) => {
    await backendMocks.routeFromJSON(cassettePath, {
      url: `${UPSTREAM}/echo`,
      update: true,
    });

    const body = await readProxyJson(await callVia(request, "http", "/echo"));
    expect(body.status).toBe(200);
    expect(body.data).toMatchObject({ method: "GET" });
  });

  test("replaced cassette only contains the new session entries", async () => {
    const file = JSON.parse(readFileSync(cassettePath, "utf8")) as {
      entries: Array<{ request: { url: string } }>;
    };
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]?.request.url).toBe(`${UPSTREAM}/echo`);
  });
});
