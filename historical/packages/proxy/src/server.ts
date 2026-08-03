import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import {
  PACKAGE_VERSION,
  PROTOCOL_VERSION,
  matchSerializedMatcher,
  parseJsonClientMessage,
  stringifyMessage,
  type ClientToProxyMessage,
  type HistoryEntry,
  type ProxyToClientMessage,
  type RouteMatchDiagnostic,
  type SerializedMatcher,
} from "@playwright-backend-mocks/protocol";
import { createProxyConfig, type ProxyConfig } from "./config.js";
import { HistoryStore } from "./history.js";
import { Logger } from "./logger.js";

interface BoundSocket {
  readonly socket: WebSocket;
  readonly connectionId: string;
  role: "node" | "playwright" | "pending";
  clientId: string;
  workerId?: string;
  lastSeen: number;
}

interface RouteRegistration {
  readonly routeId: string;
  readonly testId: string;
  readonly matcher: SerializedMatcher;
  readonly connectionId: string;
}

interface TestRegistration {
  readonly testId: string;
  readonly title: string;
  readonly file: string;
  readonly workerId: string;
  readonly connectionId: string;
}

interface PendingRequest {
  readonly requestId: string;
  readonly connectionId: string;
  readonly clientId: string;
  readonly historyId: string;
  readonly startedAt: number;
  routeId?: string;
  testId?: string;
  fetchWaiters: Map<
    string,
    {
      resolve: (message: Extract<ClientToProxyMessage, { type: "fetch:result" }>) => void;
    }
  >;
}

interface PendingClaim {
  readonly expectedTestIds: Set<string>;
  readonly respondedTestIds: Set<string>;
  readonly matches: Array<{ routeId: string; testId: string }>;
  readonly timer: NodeJS.Timeout;
  resolve(matches: Array<{ routeId: string; testId: string }>): void;
  reject(error: Error): void;
}

export interface ProxyServer {
  readonly url: string;
  readonly config: ProxyConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createProxyServer(overrides: Partial<ProxyConfig> = {}): ProxyServer {
  const config = createProxyConfig(overrides);
  const logger = new Logger(config.logLevel);
  const history = new HistoryStore(config.historyLimit);

  const connections = new Map<string, BoundSocket>();
  const routes = new Map<string, RouteRegistration>();
  const tests = new Map<string, TestRegistration>();
  const pending = new Map<string, PendingRequest>();
  const pendingClaims = new Map<string, PendingClaim>();

  const httpServer = createServer((req, res) => {
    void handleHttp(req, res);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  let heartbeatTimer: NodeJS.Timeout | undefined;

  wss.on("connection", (socket) => {
    const connectionId = randomUUID();
    const bound: BoundSocket = {
      socket,
      connectionId,
      role: "pending",
      clientId: connectionId,
      lastSeen: Date.now(),
    };
    connections.set(connectionId, bound);
    logger.debug(`connection opened ${connectionId}`);

    socket.on("message", (data) => {
      bound.lastSeen = Date.now();
      const raw = typeof data === "string" ? data : data.toString("utf8");
      try {
        const message = parseJsonClientMessage(raw);
        handleClientMessage(bound, message);
      } catch (error) {
        logger.warn(
          `invalid message from ${connectionId}:`,
          error instanceof Error ? error.message : error,
        );
        send(bound, {
          type: "proxy:error",
          code: "invalid_message",
          message: error instanceof Error ? error.message : "Invalid protocol message",
        });
      }
    });

    socket.on("close", () => {
      logger.debug(`connection closed ${connectionId}`);
      onDisconnect(bound);
    });

    socket.on("error", (error) => {
      logger.warn(`socket error ${connectionId}:`, error.message);
    });
  });

  function send(bound: BoundSocket, message: ProxyToClientMessage): void {
    if (bound.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    bound.socket.send(stringifyMessage(message));
  }

  function handleClientMessage(bound: BoundSocket, message: ClientToProxyMessage): void {
    switch (message.type) {
      case "hello":
        handleHello(bound, message);
        return;
      case "ping":
        send(bound, { type: "pong", at: message.at });
        return;
      case "pong":
        return;
      case "request:start":
        void handleRequestStart(bound, message);
        return;
      case "request:cancel":
        handleRequestCancel(message);
        return;
      case "fetch:result":
        handleFetchResult(message);
        return;
      case "agent:error":
        logger.warn(`agent error from ${bound.clientId}: ${message.message}`);
        return;
      case "test:register":
        handleTestRegister(bound, message);
        return;
      case "test:unregister":
        handleTestUnregister(message.testId);
        return;
      case "route:register":
        handleRouteRegister(bound, message);
        return;
      case "route:unregister":
        handleRouteUnregister(message);
        return;
      case "request:claim-result":
        handleClaimResult(message);
        return;
      case "handler:result":
        void handleHandlerResult(message);
        return;
      case "history:query":
        handleHistoryQuery(bound, message);
        return;
      default: {
        const _exhaustive: never = message;
        return _exhaustive;
      }
    }
  }

  function handleHello(
    bound: BoundSocket,
    message: Extract<ClientToProxyMessage, { type: "hello" }>,
  ): void {
    if (message.protocolVersion !== PROTOCOL_VERSION) {
      send(bound, {
        type: "hello:error",
        code: "protocol_mismatch",
        message: `Unsupported protocol version ${message.protocolVersion}; proxy expects ${PROTOCOL_VERSION}`,
      });
      bound.socket.close();
      return;
    }

    if (config.token !== undefined && message.token !== config.token) {
      send(bound, {
        type: "hello:error",
        code: "unauthorized",
        message: "Invalid or missing connection token",
      });
      bound.socket.close();
      return;
    }

    bound.role = message.role;
    bound.clientId =
      message.clientId ??
      (message.role === "node"
        ? `node-${bound.connectionId.slice(0, 8)}`
        : `playwright-${bound.connectionId.slice(0, 8)}`);
    if (message.workerId !== undefined) {
      bound.workerId = message.workerId;
    }

    if (message.packageVersion !== PACKAGE_VERSION) {
      logger.warn(
        `package version mismatch: client ${message.packageVersion}, proxy ${PACKAGE_VERSION}`,
      );
    }

    send(bound, {
      type: "hello:ok",
      connectionId: bound.connectionId,
      protocolVersion: PROTOCOL_VERSION,
      packageVersion: PACKAGE_VERSION,
      clientId: bound.clientId,
    });
    logger.info(`hello ok role=${bound.role} clientId=${bound.clientId}`);
  }

  async function handleRequestStart(
    bound: BoundSocket,
    message: Extract<ClientToProxyMessage, { type: "request:start" }>,
  ): Promise<void> {
    const historyId = message.requestId;
    const startedAt = Date.now();
    history.add({
      id: historyId,
      timestamp: startedAt,
      clientId: message.clientId,
      request: message.request,
      outcome: { kind: "pending" },
    });

    const pendingRequest: PendingRequest = {
      requestId: message.requestId,
      connectionId: bound.connectionId,
      clientId: message.clientId,
      historyId,
      startedAt,
      fetchWaiters: new Map(),
    };
    pending.set(message.requestId, pendingRequest);

    const activeRoutes: RouteRegistration[] = [];
    const expectedTestIds = new Set<string>();
    const claimConnections = new Set<string>();
    for (const route of routes.values()) {
      const test = tests.get(route.testId);
      if (test === undefined) {
        continue;
      }
      activeRoutes.push(route);
      expectedTestIds.add(route.testId);
      claimConnections.add(route.connectionId);
    }

    if (expectedTestIds.size === 0) {
      finishHistory(historyId, startedAt, { kind: "passthrough" });
      pending.delete(message.requestId);
      send(bound, {
        type: "decision:passthrough",
        requestId: message.requestId,
      });
      return;
    }

    let claimed: Array<{ routeId: string; testId: string }>;
    try {
      claimed = await collectClaims(message, expectedTestIds, claimConnections);
    } catch (error) {
      if (!pending.has(message.requestId)) {
        return;
      }
      const errorMessage = error instanceof Error ? error.message : "Route claim failed";
      const code =
        error instanceof Error && error.name === "ClaimTimeoutError"
          ? "claim_timeout"
          : "internal";
      finishHistory(historyId, startedAt, {
        kind: "error",
        message: errorMessage,
      });
      pending.delete(message.requestId);
      send(bound, {
        type: "decision:error",
        requestId: message.requestId,
        code,
        message: errorMessage,
      });
      return;
    }

    if (!pending.has(message.requestId)) {
      return;
    }

    const matches: Array<RouteRegistration & { test: TestRegistration }> = [];
    for (const claim of claimed) {
      const route = activeRoutes.find((item) => item.routeId === claim.routeId);
      const test = tests.get(claim.testId);
      if (route === undefined || test === undefined) {
        continue;
      }
      if (route.testId !== claim.testId) {
        continue;
      }
      matches.push({ ...route, test });
    }

    if (matches.length === 0) {
      finishHistory(historyId, startedAt, { kind: "passthrough" });
      pending.delete(message.requestId);
      send(bound, {
        type: "decision:passthrough",
        requestId: message.requestId,
      });
      return;
    }

    if (matches.length > 1) {
      const diagnostics: RouteMatchDiagnostic[] = matches.map((match) => ({
        routeId: match.routeId,
        testId: match.testId,
        title: match.test.title,
        file: match.test.file,
        workerId: match.test.workerId,
        matcher: match.matcher,
      }));
      const errorMessage = `Ambiguous backend mock routing: ${matches.length} routes matched ${message.request.method} ${message.request.url}`;

      finishHistory(historyId, startedAt, {
        kind: "error",
        message: errorMessage,
      });
      pending.delete(message.requestId);

      send(bound, {
        type: "decision:error",
        requestId: message.requestId,
        code: "ambiguous_route",
        message: errorMessage,
        matches: diagnostics,
      });

      const notifiedTests = new Set<string>();
      for (const match of matches) {
        if (notifiedTests.has(match.testId)) {
          continue;
        }
        notifiedTests.add(match.testId);
        const worker = connections.get(match.connectionId);
        if (worker) {
          send(worker, {
            type: "proxy:error",
            testId: match.testId,
            code: "ambiguous_route",
            message: errorMessage,
            detail: diagnostics,
          });
        }
      }
      return;
    }

    const match = matches[0];
    if (match === undefined) {
      return;
    }

    pendingRequest.routeId = match.routeId;
    pendingRequest.testId = match.testId;

    const worker = connections.get(match.connectionId);
    if (worker === undefined || worker.socket.readyState !== WebSocket.OPEN) {
      const errorMessage =
        "Matched Playwright worker disconnected before handling the request";
      finishHistory(historyId, startedAt, {
        kind: "error",
        message: errorMessage,
      });
      pending.delete(message.requestId);
      send(bound, {
        type: "decision:error",
        requestId: message.requestId,
        code: "disconnected",
        message: errorMessage,
      });
      return;
    }

    send(worker, {
      type: "request:matched",
      requestId: message.requestId,
      routeId: match.routeId,
      testId: match.testId,
      request: message.request,
      clientId: message.clientId,
    });
  }

  function collectClaims(
    message: Extract<ClientToProxyMessage, { type: "request:start" }>,
    expectedTestIds: Set<string>,
    claimConnections: Set<string>,
  ): Promise<Array<{ routeId: string; testId: string }>> {
    return new Promise((resolve, reject) => {
      const respondedTestIds = new Set<string>();
      const matches: Array<{ routeId: string; testId: string }> = [];

      const timer = setTimeout(() => {
        pendingClaims.delete(message.requestId);
        const missing = [...expectedTestIds].filter((id) => !respondedTestIds.has(id));
        const error = new Error(
          `Timed out waiting for route claims from Playwright tests: ${missing.join(", ")}`,
        );
        error.name = "ClaimTimeoutError";
        reject(error);
      }, config.claimTimeoutMs);

      const settle = () => {
        clearTimeout(timer);
        pendingClaims.delete(message.requestId);
        resolve([...matches]);
      };

      pendingClaims.set(message.requestId, {
        expectedTestIds,
        respondedTestIds,
        matches,
        timer,
        resolve: settle,
        reject,
      });

      for (const connectionId of claimConnections) {
        const worker = connections.get(connectionId);
        if (worker === undefined || worker.socket.readyState !== WebSocket.OPEN) {
          for (const testId of expectedTestIds) {
            const test = tests.get(testId);
            if (test?.connectionId === connectionId && !respondedTestIds.has(testId)) {
              respondedTestIds.add(testId);
            }
          }
          continue;
        }
        send(worker, {
          type: "request:claim",
          requestId: message.requestId,
          request: message.request,
          clientId: message.clientId,
        });
      }

      if ([...expectedTestIds].every((testId) => respondedTestIds.has(testId))) {
        settle();
      }
    });
  }

  function handleClaimResult(
    message: Extract<ClientToProxyMessage, { type: "request:claim-result" }>,
  ): void {
    const claim = pendingClaims.get(message.requestId);
    if (claim === undefined) {
      return;
    }
    if (!claim.expectedTestIds.has(message.testId)) {
      return;
    }
    if (claim.respondedTestIds.has(message.testId)) {
      return;
    }

    claim.respondedTestIds.add(message.testId);
    for (const match of message.matches) {
      claim.matches.push({
        routeId: match.routeId,
        testId: message.testId,
      });
    }

    if (
      [...claim.expectedTestIds].every((testId) => claim.respondedTestIds.has(testId))
    ) {
      claim.resolve([...claim.matches]);
    }
  }

  function completeClaimForTest(testId: string): void {
    for (const claim of pendingClaims.values()) {
      if (!claim.expectedTestIds.has(testId) || claim.respondedTestIds.has(testId)) {
        continue;
      }
      claim.respondedTestIds.add(testId);
      if ([...claim.expectedTestIds].every((id) => claim.respondedTestIds.has(id))) {
        claim.resolve([...claim.matches]);
      }
    }
  }

  function handleRequestCancel(
    message: Extract<ClientToProxyMessage, { type: "request:cancel" }>,
  ): void {
    const item = pending.get(message.requestId);
    if (item !== undefined) {
      finishHistory(item.historyId, item.startedAt, {
        kind: "aborted",
        errorCode: "aborted",
      });
      pending.delete(message.requestId);
    }

    const claim = pendingClaims.get(message.requestId);
    if (claim !== undefined) {
      clearTimeout(claim.timer);
      pendingClaims.delete(message.requestId);
      // Reject after clearing pending so handleRequestStart does not send a decision.
      claim.reject(new Error("Request cancelled while waiting for route claims"));
    }
  }

  function handleFetchResult(
    message: Extract<ClientToProxyMessage, { type: "fetch:result" }>,
  ): void {
    const item = pending.get(message.requestId);
    if (item === undefined) {
      return;
    }
    const waiter = item.fetchWaiters.get(message.fetchId);
    if (waiter === undefined) {
      return;
    }
    item.fetchWaiters.delete(message.fetchId);
    waiter.resolve(message);
  }

  function handleTestRegister(
    bound: BoundSocket,
    message: Extract<ClientToProxyMessage, { type: "test:register" }>,
  ): void {
    tests.set(message.testId, {
      testId: message.testId,
      title: message.title,
      file: message.file,
      workerId: message.workerId,
      connectionId: bound.connectionId,
    });
  }

  function handleTestUnregister(testId: string): void {
    tests.delete(testId);
    for (const [routeId, route] of routes) {
      if (route.testId === testId) {
        routes.delete(routeId);
      }
    }
    completeClaimForTest(testId);
    for (const [requestId, item] of pending) {
      if (item.testId === testId) {
        const node = connections.get(item.connectionId);
        if (node) {
          send(node, {
            type: "decision:error",
            requestId,
            code: "disconnected",
            message: `Test ${testId} ended while a backend mock request was pending`,
          });
        }
        finishHistory(item.historyId, item.startedAt, {
          kind: "error",
          message: "Test ended while request was pending",
        });
        pending.delete(requestId);
      }
    }
  }

  function handleRouteRegister(
    bound: BoundSocket,
    message: Extract<ClientToProxyMessage, { type: "route:register" }>,
  ): void {
    routes.set(message.routeId, {
      routeId: message.routeId,
      testId: message.testId,
      matcher: message.matcher,
      connectionId: bound.connectionId,
    });
  }

  function handleRouteUnregister(
    message: Extract<ClientToProxyMessage, { type: "route:unregister" }>,
  ): void {
    if (message.routeId !== undefined) {
      routes.delete(message.routeId);
      return;
    }
    if (message.testId !== undefined) {
      for (const [routeId, route] of routes) {
        if (route.testId === message.testId) {
          routes.delete(routeId);
        }
      }
    }
  }

  async function handleHandlerResult(
    message: Extract<ClientToProxyMessage, { type: "handler:result" }>,
  ): Promise<void> {
    const item = pending.get(message.requestId);
    if (item === undefined) {
      return;
    }
    const node = connections.get(item.connectionId);
    if (node === undefined) {
      pending.delete(message.requestId);
      return;
    }

    const { result } = message;
    switch (result.action) {
      case "fulfill": {
        send(node, {
          type: "decision:fulfill",
          requestId: message.requestId,
          response: result.response,
        });
        finishHistory(
          item.historyId,
          item.startedAt,
          {
            kind: "mocked",
            response: result.response,
            routeId: item.routeId ?? "unknown",
            testId: item.testId ?? "unknown",
          },
          item,
        );
        pending.delete(message.requestId);
        return;
      }
      case "continue": {
        send(node, {
          type: "decision:continue",
          requestId: message.requestId,
          ...(result.overrides !== undefined ? { overrides: result.overrides } : {}),
        });
        finishHistory(item.historyId, item.startedAt, { kind: "continued" }, item);
        pending.delete(message.requestId);
        return;
      }
      case "abort": {
        send(node, {
          type: "decision:abort",
          requestId: message.requestId,
          errorCode: result.errorCode,
          ...(result.message !== undefined ? { message: result.message } : {}),
        });
        finishHistory(
          item.historyId,
          item.startedAt,
          { kind: "aborted", errorCode: result.errorCode },
          item,
        );
        pending.delete(message.requestId);
        return;
      }
      case "fetch": {
        send(node, {
          type: "decision:fetch",
          requestId: message.requestId,
          fetchId: result.fetchId,
          ...(result.overrides !== undefined ? { overrides: result.overrides } : {}),
        });

        const fetchResult = await new Promise<
          Extract<ClientToProxyMessage, { type: "fetch:result" }>
        >((resolve) => {
          item.fetchWaiters.set(result.fetchId, { resolve });
        });

        const workerConn = [...connections.values()].find(
          (connection) =>
            connection.role === "playwright" &&
            item.testId !== undefined &&
            tests.get(item.testId)?.connectionId === connection.connectionId,
        );

        if (workerConn) {
          send(workerConn, {
            type: "fetch:done",
            requestId: message.requestId,
            fetchId: result.fetchId,
            ok: fetchResult.ok,
            ...(fetchResult.response !== undefined
              ? { response: fetchResult.response }
              : {}),
            ...(fetchResult.error !== undefined ? { error: fetchResult.error } : {}),
          });
        }
        return;
      }
      default: {
        const _exhaustive: never = result;
        return _exhaustive;
      }
    }
  }

  function handleHistoryQuery(
    bound: BoundSocket,
    message: Extract<ClientToProxyMessage, { type: "history:query" }>,
  ): void {
    let entries = history.list();
    if (message.testId !== undefined) {
      entries = entries.filter((entry) => entry.testId === message.testId);
    }
    if (message.matcher !== undefined) {
      const matcher = message.matcher;
      entries = entries.filter((entry) =>
        matchSerializedMatcher(matcher, {
          request: entry.request,
          clientId: entry.clientId,
        }),
      );
    }
    send(bound, {
      type: "history:result",
      queryId: message.queryId,
      entries: [...entries],
    });
  }

  function finishHistory(
    historyId: string,
    startedAt: number,
    outcome: HistoryEntry["outcome"],
    item?: PendingRequest,
  ): void {
    history.update(historyId, (entry) => ({
      ...entry,
      outcome,
      durationMs: Date.now() - startedAt,
      ...(item?.testId !== undefined ? { testId: item.testId } : {}),
      ...(item?.routeId !== undefined ? { routeId: item.routeId } : {}),
    }));
  }

  function onDisconnect(bound: BoundSocket): void {
    connections.delete(bound.connectionId);

    if (bound.role === "playwright") {
      for (const [testId, test] of tests) {
        if (test.connectionId === bound.connectionId) {
          handleTestUnregister(testId);
        }
      }
    }

    if (bound.role === "node") {
      for (const [requestId, item] of pending) {
        if (item.connectionId === bound.connectionId) {
          finishHistory(item.historyId, item.startedAt, {
            kind: "error",
            message: "Node agent disconnected",
          });
          pending.delete(requestId);
        }
      }
    }
  }

  async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);
    const isApiPath =
      url.pathname === "/health" ||
      url.pathname === "/api/history" ||
      url.pathname === "/api/connections";

    if (isApiPath) {
      setCors(res);
    }

    if (req.method === "OPTIONS" && isApiPath) {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        version: PACKAGE_VERSION,
        protocolVersion: PROTOCOL_VERSION,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/history") {
      json(res, 200, { entries: history.list() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/connections") {
      const nodeAgents = [...connections.values()]
        .filter((c) => c.role === "node")
        .map((c) => ({ clientId: c.clientId, connectionId: c.connectionId }));
      const playwrightWorkers = [...connections.values()]
        .filter((c) => c.role === "playwright")
        .map((c) => {
          const workerTests = [...tests.values()].filter(
            (t) => t.connectionId === c.connectionId,
          );
          const workerRoutes = [...routes.values()].filter(
            (r) => r.connectionId === c.connectionId,
          );
          return {
            clientId: c.clientId,
            connectionId: c.connectionId,
            workerId: c.workerId,
            testCount: workerTests.length,
            routeCount: workerRoutes.length,
          };
        });
      json(res, 200, { nodeAgents, playwrightWorkers });
      return;
    }

    if (url.pathname === "/ws") {
      // Handled by ws
      return;
    }

    json(res, 404, { error: "not_found" });
  }

  function setCors(res: ServerResponse): void {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
    });
    res.end(payload);
  }

  return {
    config,
    get url() {
      return `http://${config.host}:${config.port}`;
    },
    async start() {
      await new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(config.port, config.host, () => {
          httpServer.off("error", reject);
          resolve();
        });
      });

      heartbeatTimer = setInterval(() => {
        const now = Date.now();
        for (const bound of connections.values()) {
          if (now - bound.lastSeen > config.idleTimeoutMs) {
            logger.warn(`idle timeout ${bound.clientId}`);
            bound.socket.terminate();
            continue;
          }
          if (bound.socket.readyState === WebSocket.OPEN) {
            send(bound, { type: "ping", at: now });
          }
        }
      }, config.heartbeatMs);

      logger.info(`listening on ${this.url}`);
    },
    async stop() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      for (const bound of connections.values()) {
        bound.socket.close();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
