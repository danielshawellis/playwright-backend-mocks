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
  }),
  z.object({
    kind: z.literal("pending"),
  }),
]);

export const historyEntrySchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  clientId: z.string(),
  request: serializedRequestSchema,
  outcome: historyOutcomeSchema,
  durationMs: z.number().optional(),
  testId: z.string().optional(),
  routeId: z.string().optional(),
});

export type HistoryEntry = z.infer<typeof historyEntrySchema>;

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
  }),
  z.object({
    type: z.literal("route:unregister"),
    routeId: z.string().optional(),
    testId: z.string().optional(),
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
]);

export type ProxyToClientMessage = z.infer<typeof proxyToClientMessageSchema>;

export function parseClientToProxyMessage(data: unknown): ClientToProxyMessage {
  return clientToProxyMessageSchema.parse(data);
}

export function parseProxyToClientMessage(data: unknown): ProxyToClientMessage {
  return proxyToClientMessageSchema.parse(data);
}

export function safeParseClientToProxyMessage(data: unknown) {
  return clientToProxyMessageSchema.safeParse(data);
}

export function safeParseProxyToClientMessage(data: unknown) {
  return proxyToClientMessageSchema.safeParse(data);
}
