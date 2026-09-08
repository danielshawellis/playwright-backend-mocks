/**
 * ClientRequest regression for the docs modify-upstream recipe.
 *
 * Parity covers WHATWG fetch only. Without a ClientRequest lock, a stale
 * Content-Length on `fulfill({ response, json })` (#33) can ship green in the
 * oracle while `http.get` / axios fail with HPE_* parser errors (#34).
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
  type BackendMocksController,
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
const LONGER_BODY = JSON.stringify(LONGER_USERS);

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
  run: (ctx: { upstream: UsersUpstream; mocks: BackendMocksController }) => Promise<void>,
): Promise<void> {
  await withProxy({}, async (proxy) => {
    const upstream = await startUsersUpstream();
    const agent = await startBackendMocks({
      proxyUrl: proxy.url,
      clientId: `cr-${randomUUID().slice(0, 8)}`,
    });
    const workerId = `cr-worker-${randomUUID().slice(0, 8)}`;
    const connection = await connectPlaywrightProxy({
      proxyUrl: proxy.url,
      workerId,
    });
    const testId = randomUUID();
    await sendAndWaitForAck(
      connection,
      {
        type: "test:register",
        testId,
        title: "client-request-modify-upstream",
        file: "client-request-modify-upstream.spec.ts",
        workerId,
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

async function registerDocsModifyRecipe(
  mocks: BackendMocksController,
  url: string,
): Promise<void> {
  await mocks.route(url, async (route) => {
    const response = await route.fetch();
    const users = (await response.json()) as Array<{ id: number; name: string }>;
    await route.fulfill({
      response,
      json: [...users, { id: 100, name: "Injected" }],
    });
  });
}

function expectLongerUsers(result: Awaited<ReturnType<typeof httpGet>>): void {
  expect(result.ok, `ClientRequest failed: ${result.ok ? "" : result.error}`).toBe(true);
  if (!result.ok) return;
  expect(result.status).toBe(200);
  // Assert length before body so a stale Content-Length fails on the root cause
  // (HPE_* / truncate) rather than only via truncated JSON.
  expect(result.headers["content-length"]).toBe(String(Buffer.byteLength(LONGER_BODY)));
  expect(result.data).toEqual([...LONGER_USERS]);
}

test.describe("ClientRequest modify-upstream", () => {
  test("http.get: fetch + fulfill({ response, json: longer }) returns full JSON", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await registerDocsModifyRecipe(mocks, `${upstream.url}/users`);
      expectLongerUsers(await httpGet(`${upstream.url}/users`));
    });
  });

  test("http.get keepAlive:false: fetch + fulfill({ response, json }) returns full JSON", async () => {
    await withMocksAndUpstream(async ({ upstream, mocks }) => {
      await registerDocsModifyRecipe(mocks, `${upstream.url}/users`);
      expectLongerUsers(await httpGet(`${upstream.url}/users`, { keepAlive: false }));
    });
  });
});
