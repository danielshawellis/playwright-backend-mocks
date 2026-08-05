import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type APIRequestContext } from "@playwright/test";
import { encodeBody, type BackendErrorCode } from "@playwright-backend-mocks/protocol";
import { getFreePort, TestSocket, withProxy } from "./helpers.js";

export { withProxy, TestSocket };

const dashboardCli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../packages/dashboard/dist/cli.cjs",
);

export type HistoryEntryJson = {
  id: string;
  action?: string;
  title?: string;
  path?: string;
  testId?: string;
  clientId?: string;
  timestamp?: number;
  overrides?: { url?: string; method?: string };
  request: { url: string; method: string };
  outcome: {
    kind: string;
    errorCode?: string;
    code?: string;
    message?: string;
    matches?: Array<{ testId: string; title: string; file: string }>;
  };
  events?: Array<{ kind: string }>;
};

export type WsEntryJson = {
  id: string;
  url: string;
  outcome: string;
  title?: string;
  path?: string;
  events: Array<{ kind: string; direction?: string }>;
};

export async function setupPair(proxyUrl: string, workerId = "obs-worker") {
  const playwright = await TestSocket.connect(proxyUrl);
  const node = await TestSocket.connect(proxyUrl);
  expect(
    (await playwright.hello({ role: "playwright", workerId, clientId: `pw-${workerId}` }))
      .type,
  ).toBe("hello:ok");
  expect((await node.hello({ role: "node", clientId: "obs-node" })).type).toBe(
    "hello:ok",
  );
  return { playwright, node };
}

export async function registerHttpRoute(
  playwright: TestSocket,
  options: {
    title: string;
    file: string;
    matcher: string;
    workerId?: string;
  },
): Promise<{ testId: string; routeId: string }> {
  const testId = randomUUID();
  const routeId = randomUUID();
  playwright.send({
    type: "test:register",
    testId,
    title: options.title,
    file: options.file,
    workerId: options.workerId ?? "obs-worker",
  });
  playwright.send({
    type: "route:register",
    routeId,
    testId,
    matcher: { urlGlob: options.matcher },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { testId, routeId };
}

export async function registerWsRoute(
  playwright: TestSocket,
  options: {
    title: string;
    file: string;
    matcher: string;
    workerId?: string;
  },
): Promise<{ testId: string; routeId: string }> {
  const testId = randomUUID();
  const routeId = randomUUID();
  playwright.send({
    type: "test:register",
    testId,
    title: options.title,
    file: options.file,
    workerId: options.workerId ?? "obs-worker",
  });
  playwright.send({
    type: "route:register",
    routeId,
    testId,
    kind: "websocket",
    matcher: { urlGlob: options.matcher },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { testId, routeId };
}

export async function startHttpAndMatch(
  node: TestSocket,
  playwright: TestSocket,
  request: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<string> {
  const requestId = randomUUID();
  node.send({
    type: "request:start",
    requestId,
    clientId: "obs-node",
    request: {
      url: request.url,
      method: request.method ?? "GET",
      headers: request.headers ?? {},
      bodyBase64:
        request.body === undefined ? null : encodeBody(JSON.stringify(request.body)),
    },
  });
  const matched = await playwright.waitForType("request:matched", 5_000);
  expect(matched.requestId).toBe(requestId);
  return requestId;
}

export async function fulfill(
  playwright: TestSocket,
  node: TestSocket,
  requestId: string,
  response: { status: number; json?: unknown },
): Promise<void> {
  playwright.send({
    type: "handler:result",
    requestId,
    result: {
      action: "fulfill",
      response: {
        status: response.status,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        bodyBase64: encodeBody(JSON.stringify(response.json ?? {})),
      },
    },
  });
  await node.waitForType("decision:fulfill", 5_000);
}

export async function continueRequest(
  playwright: TestSocket,
  node: TestSocket,
  requestId: string,
  overrides?: { url?: string; method?: string },
): Promise<void> {
  playwright.send({
    type: "handler:result",
    requestId,
    result: {
      action: "continue",
      ...(overrides !== undefined
        ? {
            overrides: {
              ...(overrides.url !== undefined ? { url: overrides.url } : {}),
              ...(overrides.method !== undefined ? { method: overrides.method } : {}),
            },
          }
        : {}),
    },
  });
  await node.waitForType("decision:continue", 5_000);
}

export async function abortRequest(
  playwright: TestSocket,
  node: TestSocket,
  requestId: string,
  errorCode: BackendErrorCode = "failed",
): Promise<void> {
  playwright.send({
    type: "handler:result",
    requestId,
    result: {
      action: "abort",
      errorCode,
    },
  });
  await node.waitForType("decision:abort", 5_000);
}

export async function passthrough(node: TestSocket, url: string): Promise<string> {
  const requestId = randomUUID();
  node.send({
    type: "request:start",
    requestId,
    clientId: "obs-node",
    request: {
      url,
      method: "GET",
      headers: {},
      bodyBase64: null,
    },
  });
  await node.waitForType("decision:passthrough", 5_000);
  return requestId;
}

export async function getHistory(
  api: APIRequestContext,
  proxyUrl: string,
  query = "",
): Promise<HistoryEntryJson[]> {
  const response = await api.get(`${proxyUrl}/api/history${query}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { entries: HistoryEntryJson[] };
  return body.entries;
}

export async function getWs(
  api: APIRequestContext,
  proxyUrl: string,
  query = "",
): Promise<WsEntryJson[]> {
  const response = await api.get(`${proxyUrl}/api/ws${query}`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { connections: WsEntryJson[] };
  return body.connections;
}

async function waitForUrl(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
}

export async function withDashboard(
  proxyUrl: string,
  run: (dashboardUrl: string) => Promise<void>,
): Promise<void> {
  const port = await getFreePort();
  const child: ChildProcess = spawn(
    process.execPath,
    [
      dashboardCli,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--proxy-url",
      proxyUrl,
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    },
  );
  const dashboardUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForUrl(`${dashboardUrl}/health`);
    await run(dashboardUrl);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000);
    });
  }
}
