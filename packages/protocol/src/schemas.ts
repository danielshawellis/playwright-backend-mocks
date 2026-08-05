import { z } from "zod";

export const backendErrorCodeSchema = z.enum([
  "failed",
  "aborted",
  "timedout",
  "connectionrefused",
  "connectionreset",
  "namenotresolved",
]);

export type BackendErrorCode = z.infer<typeof backendErrorCodeSchema>;

export const serializedRequestSchema = z.object({
  url: z.string().min(1),
  method: z.string().min(1),
  headers: z.record(z.string(), z.string()),
  bodyBase64: z.string().nullable(),
});

export type SerializedRequest = z.infer<typeof serializedRequestSchema>;

export const serializedResponseSchema = z.object({
  status: z.number().int().min(0).max(599),
  statusText: z.string(),
  headers: z.record(z.string(), z.string()),
  bodyBase64: z.string().nullable(),
  /** Final response URL after redirects (Playwright APIResponse.url). Additive. */
  url: z.string().optional(),
});

export type SerializedResponse = z.infer<typeof serializedResponseSchema>;

export const serializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  code: z.string().optional(),
});

export type SerializedError = z.infer<typeof serializedErrorSchema>;

export const urlRegexSchema = z.object({
  source: z.string(),
  flags: z.string(),
});

export const serializedMatcherSchema = z.object({
  urlGlob: z.string().optional(),
  urlRegex: urlRegexSchema.optional(),
  methods: z.array(z.string()).optional(),
  clientIds: z.array(z.string()).optional(),
  /** Present when the live matcher is a predicate evaluated in Playwright. */
  predicate: z.boolean().optional(),
});

export type SerializedMatcher = z.infer<typeof serializedMatcherSchema>;

export const requestOverridesSchema = z.object({
  url: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  bodyBase64: z.string().nullable().optional(),
});

export type RequestOverrides = z.infer<typeof requestOverridesSchema>;

export const routeMatchDiagnosticSchema = z.object({
  routeId: z.string(),
  testId: z.string(),
  title: z.string(),
  file: z.string(),
  workerId: z.string(),
  matcher: serializedMatcherSchema,
});

export type RouteMatchDiagnostic = z.infer<typeof routeMatchDiagnosticSchema>;

/** Route registration kind — WebSocket routes must survive HTTP `unrouteAll`. */
export const routeKindSchema = z.enum(["http", "websocket"]);

export type RouteKind = z.infer<typeof routeKindSchema>;

export const wsDataSchema = z.object({
  data: z.string(),
  isBase64: z.boolean(),
});

export type WsData = z.infer<typeof wsDataSchema>;

export const wsCloseFieldsSchema = z.object({
  socketId: z.string().min(1),
  code: z.number().int().optional(),
  reason: z.string().optional(),
  wasClean: z.boolean(),
});

export const historyOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mocked"),
    response: serializedResponseSchema,
    routeId: z.string(),
    testId: z.string(),
  }),
  z.object({
    kind: z.literal("passthrough"),
  }),
  z.object({
    kind: z.literal("continued"),
    response: serializedResponseSchema.optional(),
  }),
  z.object({
    kind: z.literal("aborted"),
    errorCode: z.string(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    /** Proxy decision code when known, e.g. `ambiguous_route`. */
    code: z.string().optional(),
    /** Competing route claims for `ambiguous_route`. */
    matches: z.array(routeMatchDiagnosticSchema).optional(),
  }),
  z.object({
    kind: z.literal("pending"),
  }),
]);

/** Normalized handler/coordinator action for observability UIs. */
export const historyActionSchema = z.enum([
  "fulfill",
  "continue",
  "abort",
  "passthrough",
  "fetch",
  "error",
  "pending",
]);

export type HistoryAction = z.infer<typeof historyActionSchema>;

export const historyEventSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  kind: z.string(),
  detail: z.string().optional(),
});

export type HistoryEvent = z.infer<typeof historyEventSchema>;

export const historyEntrySchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  clientId: z.string(),
  request: serializedRequestSchema,
  outcome: historyOutcomeSchema,
  durationMs: z.number().optional(),
  testId: z.string().optional(),
  routeId: z.string().optional(),
  action: historyActionSchema.optional(),
  /** Playwright test title when a test owned the request. */
  title: z.string().optional(),
  /** Playwright test file path when a test owned the request. */
  path: z.string().optional(),
  overrides: requestOverridesSchema.optional(),
  events: z.array(historyEventSchema).optional(),
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const wsConnectionOutcomeSchema = z.enum([
  "pending",
  "matched",
  "passthrough",
  "error",
]);

export type WsConnectionOutcome = z.infer<typeof wsConnectionOutcomeSchema>;

export const wsTimelineEventSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  direction: z.enum(["client", "server", "system"]),
  kind: z.enum(["open", "frame", "close", "error", "handler"]),
  detail: z.string().optional(),
  data: z.string().optional(),
  isBase64: z.boolean().optional(),
});

export type WsTimelineEvent = z.infer<typeof wsTimelineEventSchema>;

export const wsConnectionEntrySchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  clientId: z.string(),
  url: z.string(),
  protocols: z.array(z.string()).optional(),
  title: z.string().optional(),
  path: z.string().optional(),
  testId: z.string().optional(),
  routeId: z.string().optional(),
  outcome: wsConnectionOutcomeSchema,
  /** Proxy decision code when outcome is `error`, e.g. `ambiguous_route`. */
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  /** Competing route claims for `ambiguous_route`. */
  matches: z.array(routeMatchDiagnosticSchema).optional(),
  closedAt: z.number().optional(),
  close: z
    .object({
      code: z.number().optional(),
      reason: z.string().optional(),
      wasClean: z.boolean(),
    })
    .optional(),
  events: z.array(wsTimelineEventSchema),
});

export type WsConnectionEntry = z.infer<typeof wsConnectionEntrySchema>;

export const connectionRoleSchema = z.enum(["node", "playwright"]);

export type ConnectionRole = z.infer<typeof connectionRoleSchema>;

/** Messages from any client to the proxy. */
export const clientToProxyMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    protocolVersion: z.number().int(),
    packageVersion: z.string(),
    role: connectionRoleSchema,
    clientId: z.string().optional(),
    workerId: z.string().optional(),
    token: z.string().optional(),
  }),
  z.object({
    type: z.literal("ping"),
    at: z.number(),
  }),
  z.object({
    type: z.literal("pong"),
    at: z.number(),
  }),
  z.object({
    type: z.literal("request:start"),
    requestId: z.string(),
    clientId: z.string(),
    request: serializedRequestSchema,
  }),
  z.object({
    type: z.literal("request:cancel"),
    requestId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("fetch:result"),
    requestId: z.string(),
    fetchId: z.string(),
    ok: z.boolean(),
    response: serializedResponseSchema.optional(),
    error: serializedErrorSchema.optional(),
  }),
  /**
   * Node → proxy: upstream/settle response for waitForResponse correlation.
   * Used after continue / passthrough (fulfill is mirrored by the proxy from handler:result).
   */
  z.object({
    type: z.literal("request:response"),
    requestId: z.string(),
    ok: z.boolean(),
    response: serializedResponseSchema.optional(),
    error: serializedErrorSchema.optional(),
  }),
  /**
   * Node → proxy: synthetic request observation for redirect hops followed
   * inside continue/fetch (so Playwright can link redirectedFrom/To without
   * the app issuing a second intercepted fetch).
   */
  z.object({
    type: z.literal("request:observe"),
    requestId: z.string(),
    clientId: z.string(),
    request: serializedRequestSchema,
  }),
  z.object({
    type: z.literal("agent:error"),
    message: z.string(),
    detail: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("test:register"),
    testId: z.string(),
    title: z.string(),
    file: z.string(),
    workerId: z.string(),
  }),
  z.object({
    type: z.literal("test:unregister"),
    testId: z.string(),
  }),
  z.object({
    type: z.literal("route:register"),
    routeId: z.string(),
    testId: z.string(),
    matcher: serializedMatcherSchema,
    /** Omit / `http` = HTTP route; `websocket` survives HTTP `unrouteAll`. */
    kind: routeKindSchema.optional(),
  }),
  z.object({
    type: z.literal("route:unregister"),
    routeId: z.string().optional(),
    testId: z.string().optional(),
  }),
  // --- Application WebSocket lifecycle (Node / Playwright → proxy) ---
  // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/injected/src/webSocketMock.ts
  // Playwright: https://github.com/microsoft/playwright/blob/26a9e47/packages/playwright-core/src/server/dispatchers/webSocketRouteDispatcher.ts
  z.object({
    type: z.literal("ws:connection"),
    socketId: z.string().min(1),
    url: z.string().min(1),
    protocols: z.array(z.string()),
    clientId: z.string().min(1),
  }),
  z.object({
    type: z.literal("ws:messageFromPage"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:messageFromServer"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:closePage"),
    socketId: z.string().min(1),
    code: z.number().int().optional(),
    reason: z.string().optional(),
    wasClean: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:closeServer"),
    socketId: z.string().min(1),
    code: z.number().int().optional(),
    reason: z.string().optional(),
    wasClean: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:claim-result"),
    socketId: z.string().min(1),
    testId: z.string(),
    matches: z.array(z.object({ routeId: z.string() })),
  }),
  /** Playwright → proxy → Node: open real upstream (`connectToServer`). */
  z.object({
    type: z.literal("ws:connect"),
    socketId: z.string().min(1),
  }),
  /** Playwright → proxy → Node: mock-open after handler (`ensureOpened`). */
  z.object({
    type: z.literal("ws:ensureOpened"),
    socketId: z.string().min(1),
  }),
  z.object({
    type: z.literal("ws:sendToPage"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:sendToServer"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("handler:result"),
    requestId: z.string(),
    result: z.discriminatedUnion("action", [
      z.object({
        action: z.literal("fulfill"),
        response: serializedResponseSchema,
      }),
      z.object({
        action: z.literal("continue"),
        overrides: requestOverridesSchema.optional(),
      }),
      z.object({
        action: z.literal("abort"),
        errorCode: backendErrorCodeSchema,
        message: z.string().optional(),
      }),
      z.object({
        action: z.literal("fetch"),
        fetchId: z.string(),
        overrides: requestOverridesSchema.optional(),
        /** Playwright route.fetch maxRedirects; omit → default 20; 0 → do not follow. */
        maxRedirects: z.number().int().optional(),
        /** Playwright route.fetch maxRetries; omit → 0 (no retries). Retries ECONNRESET. */
        maxRetries: z.number().int().optional(),
      }),
    ]),
  }),
  z.object({
    type: z.literal("request:claim-result"),
    requestId: z.string(),
    testId: z.string(),
    matches: z.array(
      z.object({
        routeId: z.string(),
      }),
    ),
  }),
  z.object({
    type: z.literal("history:query"),
    queryId: z.string(),
    testId: z.string().optional(),
    matcher: serializedMatcherSchema.optional(),
  }),
]);

export type ClientToProxyMessage = z.infer<typeof clientToProxyMessageSchema>;

/** Messages from the proxy to clients. */
export const proxyToClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello:ok"),
    connectionId: z.string(),
    protocolVersion: z.number().int(),
    packageVersion: z.string(),
    clientId: z.string(),
  }),
  z.object({
    type: z.literal("hello:error"),
    code: z.enum(["protocol_mismatch", "unauthorized", "invalid_hello"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("ping"),
    at: z.number(),
  }),
  z.object({
    type: z.literal("pong"),
    at: z.number(),
  }),
  z.object({
    type: z.literal("decision:fulfill"),
    requestId: z.string(),
    response: serializedResponseSchema,
  }),
  z.object({
    type: z.literal("decision:continue"),
    requestId: z.string(),
    overrides: requestOverridesSchema.optional(),
  }),
  z.object({
    type: z.literal("decision:abort"),
    requestId: z.string(),
    errorCode: backendErrorCodeSchema,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("decision:fetch"),
    requestId: z.string(),
    fetchId: z.string(),
    overrides: requestOverridesSchema.optional(),
    /** Playwright route.fetch maxRedirects; omit → default 20; 0 → do not follow. */
    maxRedirects: z.number().int().optional(),
    /** Playwright route.fetch maxRetries; omit → 0 (no retries). Retries ECONNRESET. */
    maxRetries: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("decision:passthrough"),
    requestId: z.string(),
  }),
  z.object({
    type: z.literal("decision:error"),
    requestId: z.string(),
    code: z.enum([
      "ambiguous_route",
      "handler_failed",
      "disconnected",
      "internal",
      "claim_timeout",
    ]),
    message: z.string(),
    matches: z.array(routeMatchDiagnosticSchema).optional(),
  }),
  z.object({
    type: z.literal("request:claim"),
    requestId: z.string(),
    request: serializedRequestSchema,
    clientId: z.string(),
  }),
  z.object({
    type: z.literal("request:matched"),
    requestId: z.string(),
    routeId: z.string(),
    testId: z.string(),
    request: serializedRequestSchema,
    clientId: z.string(),
  }),
  /**
   * Proxy → Playwright: every Node request start (routed or passthrough), for
   * future-only waitForRequest observation. Independent of route ownership.
   */
  z.object({
    type: z.literal("request:observed"),
    requestId: z.string(),
    request: serializedRequestSchema,
    clientId: z.string(),
  }),
  /**
   * Proxy → Playwright: settled HTTP response for waitForResponse.
   * Fulfill: mirrored from handler:result. Continue/passthrough: from Node request:response.
   */
  z.object({
    type: z.literal("request:response"),
    requestId: z.string(),
    ok: z.boolean(),
    response: serializedResponseSchema.optional(),
    error: serializedErrorSchema.optional(),
  }),
  z.object({
    type: z.literal("fetch:done"),
    requestId: z.string(),
    fetchId: z.string(),
    ok: z.boolean(),
    response: serializedResponseSchema.optional(),
    error: serializedErrorSchema.optional(),
  }),
  z.object({
    type: z.literal("history:result"),
    queryId: z.string(),
    entries: z.array(historyEntrySchema),
  }),
  z.object({
    type: z.literal("proxy:error"),
    testId: z.string().optional(),
    code: z.string(),
    message: z.string(),
    detail: z.unknown().optional(),
  }),
  // --- Application WebSocket (proxy → Node / Playwright) ---
  z.object({
    type: z.literal("ws:claim"),
    socketId: z.string().min(1),
    url: z.string().min(1),
    protocols: z.array(z.string()),
    clientId: z.string().min(1),
  }),
  z.object({
    type: z.literal("ws:matched"),
    socketId: z.string().min(1),
    routeId: z.string(),
    testId: z.string(),
    url: z.string().min(1),
    protocols: z.array(z.string()),
    clientId: z.string().min(1),
  }),
  z.object({
    type: z.literal("ws:passthrough"),
    socketId: z.string().min(1),
  }),
  z.object({
    type: z.literal("ws:connect"),
    socketId: z.string().min(1),
  }),
  z.object({
    type: z.literal("ws:ensureOpened"),
    socketId: z.string().min(1),
  }),
  z.object({
    type: z.literal("ws:sendToPage"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:sendToServer"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:closePage"),
    socketId: z.string().min(1),
    code: z.number().int().optional(),
    reason: z.string().optional(),
    wasClean: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:closeServer"),
    socketId: z.string().min(1),
    code: z.number().int().optional(),
    reason: z.string().optional(),
    wasClean: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:messageFromPage"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:messageFromServer"),
    socketId: z.string().min(1),
    data: z.string(),
    isBase64: z.boolean(),
  }),
  z.object({
    type: z.literal("ws:error"),
    socketId: z.string().min(1),
    code: z.enum([
      "ambiguous_route",
      "handler_failed",
      "disconnected",
      "internal",
      "claim_timeout",
    ]),
    message: z.string(),
    matches: z.array(routeMatchDiagnosticSchema).optional(),
  }),
]);

export type ProxyToClientMessage = z.infer<typeof proxyToClientMessageSchema>;

export function parseClientToProxyMessage(data: unknown): ClientToProxyMessage {
  return clientToProxyMessageSchema.parse(data);
}

export function parseProxyToClientMessage(data: unknown): ProxyToClientMessage {
  return proxyToClientMessageSchema.parse(data);
}
