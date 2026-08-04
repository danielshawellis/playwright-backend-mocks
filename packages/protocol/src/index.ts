export { PROTOCOL_VERSION, PACKAGE_VERSION } from "./version.js";
export { encodeBody, decodeBody, decodeBodyText } from "./body.js";
export { normalizeHeaders } from "./headers.js";
export {
  globToRegexPattern,
  resolveGlobToRegexPattern,
  urlMatches,
  matchUrlGlob,
  matchSerializedMatcher,
  serializeRegExp,
  isURLPatternLike,
  type MatchInput,
  type URLMatch,
  type URLPatternLike,
} from "./match.js";
export { BackendMocksNetworkError, serializeError, errorFromCode } from "./errors.js";
export {
  parseJsonClientMessage,
  parseJsonProxyMessage,
  stringifyMessage,
} from "./parse-json.js";
export {
  backendErrorCodeSchema,
  serializedRequestSchema,
  serializedResponseSchema,
  serializedErrorSchema,
  serializedMatcherSchema,
  requestOverridesSchema,
  routeMatchDiagnosticSchema,
  historyEntrySchema,
  historyOutcomeSchema,
  connectionRoleSchema,
  clientToProxyMessageSchema,
  proxyToClientMessageSchema,
  parseClientToProxyMessage,
  parseProxyToClientMessage,
  safeParseClientToProxyMessage,
  safeParseProxyToClientMessage,
  type BackendErrorCode,
  type SerializedRequest,
  type SerializedResponse,
  type SerializedError,
  type SerializedMatcher,
  type RequestOverrides,
  type RouteMatchDiagnostic,
  type HistoryEntry,
  type ConnectionRole,
  type ClientToProxyMessage,
  type ProxyToClientMessage,
} from "./schemas.js";
