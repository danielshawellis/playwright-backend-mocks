/**
 * Library E2E: ClientRequest (`node:http`) + the docs modify-upstream recipe.
 *
 * Issue #34 reported that `route.fetch()` then `fulfill({ response, json })`
 * yields `HPE_INVALID_CONSTANT` / `HPE_CLOSED_CONNECTION` for axios / `http.get`,
 * while WHATWG `fetch` survives. Empirically those parser errors are how a
 * *stale Content-Length* (#33) manifests on ClientRequest — with #33's
 * recompute in place, this matrix is green; without it, the same cases fail
 * with the exact HPE messages from the issue.
 *
 * Lives here (not in the dual-mode oracle) because the shared parity
 * downstream is WHATWG fetch only and cannot host ClientRequest.
 *
 * @see https://github.com/danielshawellis/playwright-backend-mocks/issues/34
 * @see https://github.com/danielshawellis/playwright-backend-mocks/issues/33
 */
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { startBackendMocks } from "@playwright-backend-mocks/node";
import {
  connectPlaywrightProxy,
  createBackendMocks,
  sendAndWaitForAck,
} from "@playwright-backend-mocks/playwright";
import { getFreePort, withProxy } from "../helpers.js";
import { httpGet } from "../http-get.js";

type UsersUpstream = {
  url: string;
  close: () => Promise<void>;
};

const SHORT_USERS = [{ id: 1, name: "Ada" }] as const;
const LONGER_USERS = [
  { id: 1, name: "Ada" },
  { id: 100, name: "Injected" },
] as const;

async function startUsersUpstream(): Promise<UsersUpstream> {
  const port = await getFreePort();
  const payload = JSON.stringify(SHORT_USERS);
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (req.method === "GET" && url.pathname === "/users") {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function withMocksAndUpstream(
  run: (ctx: {
    upstream: UsersUpstream;
    mocks: ReturnType<typeof createBackendMocks>;
  }) => Promise<void>,
): Promise<void> {
  await withProxy({}, async (proxy) => {
    const upstream = await startUsersUpstream();
    const agent = await startBackendMocks({
      proxyUrl: proxy.url,
      clientId: `cr-${randomUUID().slice(0, 8)}`,
    });
    const connection = await connectPlaywrightProxy({
      proxyUrl: proxy.url,
      workerId: `cr-worker-${randomUUID().slice(0, 8)}`,
    });
    const testId = randomUUID();
    await sendAndWaitForAck(
      connection,
      {
        type: "test:register",
        testId,
        title: "client-request-modify-upstream",
        file: "client-request-modify-upstream.spec.ts",
        workerId: "cr-worker",
      },
      (message) => message.type === "test:registered" && message.testId === testId,
    );
    const mocks = createBackendMocks({ connection, testId });
    try {
      await run({ upstream, mocks });
    } finally {
      await mocks.dispose();
      await connection.close();
      await agent.stop();
      await upstream.close();
    }
  });
}

test.describe("ClientRequest modify-upstream (#34)", () => {
  /**
   * Issue case 1 / 3 — same loopback URL, docs recipe with `response` copied.
   * Without #33: HPE_INVALID_CONSTANT / Expected HTTP/. With #33: full longer JSON.
   */
  test("http.get: fetch + fulfill({ response, json: longer }) returns full JSON", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await mocks.route(`${upstream.url}/users`, async (route) => {
        const response = await route.fetch();
        const users = (await response.json()) as Array<{ id: number; name: string }>;
        await route.fulfill({
          response,
          json: [...users, { id: 100, name: "Injected" }],
        });
      });

      const result = await httpGet(`${upstream.url}/users`);
      expect(result.ok, `ClientRequest failed: ${result.ok ? "" : result.error}`).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.status).toBe(200);
      expect(result.data).toEqual([...LONGER_USERS]);
    });
  });

  /**
   * Issue case 2 — same recipe with keepAlive: false.
   * Without #33: Data after Connection: close. With #33: full longer JSON.
   */
  test("http.get keepAlive:false: fetch + fulfill({ response, json }) returns full JSON", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await mocks.route(`${upstream.url}/users`, async (route) => {
        const response = await route.fetch();
        const users = (await response.json()) as Array<{ id: number; name: string }>;
        await route.fulfill({
          response,
          json: [...users, { id: 100, name: "Injected" }],
        });
      });

      const result = await httpGet(`${upstream.url}/users`, { keepAlive: false });
      expect(result.ok, `ClientRequest failed: ${result.ok ? "" : result.error}`).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.status).toBe(200);
      expect(result.data).toEqual([...LONGER_USERS]);
    });
  });

  /**
   * Issue case 6 — fetch a different URL, but still copy `response` into fulfill.
   * Same ClientRequest failure mode without #33; not specific to same-host loopback.
   */
  test("http.get: fetch({ url }) + fulfill({ response, json }) returns full JSON", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await mocks.route("https://api.example.test/users", async (route) => {
        const response = await route.fetch({ url: `${upstream.url}/users` });
        const users = (await response.json()) as Array<{ id: number; name: string }>;
        await route.fulfill({
          response,
          json: [...users, { id: 100, name: "Injected" }],
        });
      });

      const result = await httpGet("https://api.example.test/users");
      expect(result.ok, `ClientRequest failed: ${result.ok ? "" : result.error}`).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.status).toBe(200);
      expect(result.data).toEqual([...LONGER_USERS]);
    });
  });

  /**
   * Control (issue case 4) — ClientRequest + fulfill-only must already work.
   * Keeps the red bar honest: mocking http.get is fine; copying `response` is not.
   */
  test("http.get: fulfill-only (no fetch) returns mocked JSON", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await mocks.route(`${upstream.url}/users`, async (route) => {
        await route.fulfill({ json: [...LONGER_USERS] });
      });

      const result = await httpGet(`${upstream.url}/users`);
      expect(result.ok, `ClientRequest failed: ${result.ok ? "" : result.error}`).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.status).toBe(200);
      expect(result.data).toEqual([...LONGER_USERS]);
    });
  });

  /**
   * Control (issue case 5) — fetch other URL + fulfill({ json }) without `response`.
   * Documents the current workaround; should stay green after the fix too.
   */
  test("http.get: fetch({ url }) + fulfill({ json }) without response works", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await mocks.route("https://api.example.test/users", async (route) => {
        const response = await route.fetch({ url: `${upstream.url}/users` });
        const users = (await response.json()) as Array<{ id: number; name: string }>;
        await route.fulfill({
          json: [...users, { id: 100, name: "Injected" }],
        });
      });

      const result = await httpGet("https://api.example.test/users");
      expect(result.ok, `ClientRequest failed: ${result.ok ? "" : result.error}`).toBe(
        true,
      );
      if (!result.ok) return;
      expect(result.status).toBe(200);
      expect(result.data).toEqual([...LONGER_USERS]);
    });
  });

  /**
   * Contrast — same docs recipe via WHATWG fetch.
   * Without #33: truncated JSON. With #33: full body (parity fetch.spec.ts case).
   */
  test("fetch: fetch + fulfill({ response, json: longer }) returns full JSON", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await mocks.route(`${upstream.url}/users`, async (route) => {
        const response = await route.fetch();
        const users = (await response.json()) as Array<{ id: number; name: string }>;
        await route.fulfill({
          response,
          json: [...users, { id: 100, name: "Injected" }],
        });
      });

      const response = await fetch(`${upstream.url}/users`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([...LONGER_USERS]);
    });
  });
});
