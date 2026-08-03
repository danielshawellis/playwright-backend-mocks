import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright-backend-mocks/playwright";
import {
  ABORT_CODES,
  TRANSPORTS,
  UPSTREAM,
  callVia,
  headerValue,
  readProxyJson,
} from "../helpers.js";

const fulfillBodyPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../testdata/fulfill-body.txt",
);

for (const transport of TRANSPORTS) {
  test.describe(`transport: ${transport}`, () => {
    test(`fulfill mocks a GET JSON response (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
        await route.fulfill({
          status: 200,
          json: [{ id: 9, name: "Mocked" }],
        });
      });

      const response = await callVia(request, transport, "/users");
      const body = await readProxyJson(response);
      expect(response.status()).toBe(200);
      expect(body.transport).toBe(transport);
      expect(body.status).toBe(200);
      expect(body.data).toEqual([{ id: 9, name: "Mocked" }]);
    });

    test(`fulfill supports status, headers, and raw body (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
        await route.fulfill({
          status: 418,
          headers: { "x-mock": "yes" },
          contentType: "text/plain",
          body: "teapot",
        });
      });

      const response = await callVia(request, transport, "/users");
      const body = await readProxyJson(response);
      expect(body.status).toBe(418);
      expect(body.raw).toBe("teapot");
      expect(headerValue(body.headers, "x-mock")).toBe("yes");
    });

    test(`fulfill mocks a POST request body (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/charges`, async (route, req) => {
        expect(req.method).toBe("POST");
        expect(req.json()).toEqual({ amount: 42 });
        await route.fulfill({
          status: 201,
          json: { id: "ch_mock", amount: 42, status: "mocked" },
        });
      });

      const response = await callVia(request, transport, "/charges", {
        method: "POST",
        data: { amount: 42 },
      });
      const body = await readProxyJson(response);
      expect(body.status).toBe(201);
      expect(body.data).toEqual({ id: "ch_mock", amount: 42, status: "mocked" });
    });

    test(`passthrough when no route matches (${transport})`, async ({ request }) => {
      const response = await callVia(request, transport, "/users");
      const body = await readProxyJson(response);
      expect(body.status).toBe(200);
      expect(body.data).toEqual([
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
      ]);
      expect(headerValue(body.headers, "x-upstream")).toBe("real");
    });

    test(`continue() sends the request upstream (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
        await route.continue();
      });

      const response = await callVia(request, transport, "/users");
      const body = await readProxyJson(response);
      expect(body.status).toBe(200);
      expect(body.data).toEqual([
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
      ]);
    });

    test(`continue() with url override (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/echo`, async (route) => {
        await route.continue({ url: `${UPSTREAM}/echo-alt` });
      });

      const response = await callVia(request, transport, "/echo");
      const body = await readProxyJson(response);
      expect(body.status).toBe(200);
      expect(body.data).toMatchObject({ variant: "alt" });
    });

    test(`continue() with method/headers/postData overrides (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/echo`, async (route) => {
        await route.continue({
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-continue": "yes",
          },
          postData: JSON.stringify({ overridden: true }),
        });
      });

      const response = await callVia(request, transport, "/echo");
      const body = await readProxyJson(response);
      expect(body.status).toBe(200);
      expect(body.data).toMatchObject({
        method: "POST",
        body: JSON.stringify({ overridden: true }),
      });
      const echoHeaders = (body.data as { headers: Record<string, string> }).headers;
      expect(echoHeaders["x-continue"]).toBe("yes");
    });

    test(`fulfill({ path }) serves a local file body (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/plain",
          path: fulfillBodyPath,
        });
      });

      const response = await callVia(request, transport, "/users");
      const body = await readProxyJson(response);
      expect(body.status).toBe(200);
      expect(body.raw?.trim()).toBe("hello-from-file");
    });

    test(`fetch() + modify + fulfill (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
        const upstream = await route.fetch();
        const users = upstream.json() as Array<{ id: number; name: string }>;
        users.push({ id: 100, name: "Loquat" });
        await route.fulfill({ response: upstream, json: users });
      });

      const response = await callVia(request, transport, "/users");
      const body = await readProxyJson(response);
      expect(body.data).toEqual([
        { id: 1, name: "Ada" },
        { id: 2, name: "Grace" },
        { id: 100, name: "Loquat" },
      ]);
    });

    test(`fetch() with url/method/headers/postData overrides (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
        const upstream = await route.fetch({
          url: `${UPSTREAM}/echo`,
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-fetch": "yes",
          },
          postData: JSON.stringify({ from: "fetch-override" }),
        });
        await route.fulfill({
          status: 200,
          json: {
            fetched: upstream.json(),
          },
        });
      });

      const response = await callVia(request, transport, "/users");
      const body = await readProxyJson(response);
      expect(body.data).toMatchObject({
        fetched: {
          method: "POST",
          body: JSON.stringify({ from: "fetch-override" }),
        },
      });
      const fetched = body.data as {
        fetched: { headers: Record<string, string> };
      };
      expect(fetched.fetched.headers["x-fetch"]).toBe("yes");
    });

    test(`waitForRequest and requests() inspect traffic (${transport})`, async ({
      request,
      backendMocks,
    }) => {
      await backendMocks.route(`${UPSTREAM}/charges`, async (route) => {
        await route.fulfill({
          status: 201,
          json: { id: "ch_spy", status: "ok" },
        });
      });

      const pending = backendMocks.waitForRequest(`${UPSTREAM}/charges`, {
        method: "POST",
      });
      const response = await callVia(request, transport, "/charges", {
        method: "POST",
        data: { amount: 99 },
      });
      const seen = await pending;
      const body = await readProxyJson(response);

      expect(body.status).toBe(201);
      expect(seen.method).toBe("POST");
      expect(seen.clientId).toBe("api-server");
      expect(seen.json()).toEqual({ amount: 99 });

      const all = await backendMocks.requests(`${UPSTREAM}/charges`);
      expect(all.length).toBeGreaterThanOrEqual(1);
    });

    for (const errorCode of ABORT_CODES) {
      test(`abort(${errorCode}) fails the outbound request (${transport})`, async ({
        request,
        backendMocks,
      }) => {
        await backendMocks.route(`${UPSTREAM}/users`, async (route) => {
          await route.abort(errorCode);
        });

        const response = await callVia(request, transport, "/users");
        expect(response.status()).toBe(500);
        const body = await readProxyJson(response);
        expect(body.error).toBe("request_failed");
        expect(body.message?.length).toBeGreaterThan(0);
      });
    }
  });
}
