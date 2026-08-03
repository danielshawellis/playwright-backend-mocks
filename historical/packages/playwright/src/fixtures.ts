import { randomUUID } from "node:crypto";
import { test as base } from "@playwright/test";
import { createBackendMocks } from "./backend-mocks.js";
import { connectPlaywrightProxy, type PlaywrightProxyConnection } from "./connection.js";
import type { BackendMocksWorkerOptions } from "./options.js";
import type { BackendMocks } from "./types.js";

export type BackendMocksFixtures = {
  backendMocks: BackendMocks;
};

export type { BackendMocksWorkerOptions };

type WorkerFixtures = BackendMocksWorkerOptions & {
  backendMocksConnection: PlaywrightProxyConnection;
};

const PROXY_URL_ENV = "PLAYWRIGHT_BACKEND_MOCKS_PROXY_URL";
const TOKEN_ENV = "PLAYWRIGHT_BACKEND_MOCKS_TOKEN";

export const test = base.extend<BackendMocksFixtures, WorkerFixtures>({
  backendMocksProxyUrl: [
    process.env[PROXY_URL_ENV] ?? "http://127.0.0.1:4310",
    { option: true, scope: "worker" },
  ],
  backendMocksToken: [process.env[TOKEN_ENV], { option: true, scope: "worker" }],

  backendMocksConnection: [
    async ({ backendMocksProxyUrl, backendMocksToken }, use, workerInfo) => {
      const connection = await connectPlaywrightProxy({
        proxyUrl: backendMocksProxyUrl,
        workerId: String(workerInfo.workerIndex),
        ...(backendMocksToken !== undefined ? { token: backendMocksToken } : {}),
      });
      await use(connection);
      await connection.close();
    },
    { scope: "worker" },
  ],

  backendMocks: async ({ backendMocksConnection }, use, testInfo) => {
    const testId = randomUUID();

    backendMocksConnection.send({
      type: "test:register",
      testId,
      title: testInfo.title,
      file: testInfo.file,
      workerId: String(testInfo.workerIndex),
    });

    const mocks = createBackendMocks({
      connection: backendMocksConnection,
      testId,
    });

    await use(mocks);
    mocks.dispose();

    const remainingErrors = mocks.takeErrors();
    if (remainingErrors.length > 0) {
      throw new AggregateError(
        remainingErrors,
        remainingErrors.map((error) => error.message).join("\n"),
      );
    }
  },
});

export { expect } from "@playwright/test";
