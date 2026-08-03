# Protocol

Package: `@playwright-backend-mocks/protocol`

Shared wire types, validators, and helpers used by the Playwright fixture, Node agent, and proxy.

**Most application tests never import this package.** Use it when building custom tooling, debugging handshake issues, or extending the system.

## Version constants

```ts
const PROTOCOL_VERSION = 2;
const PACKAGE_VERSION = "0.1.0"; // mirrors the releasing package version
```

Handshake requires equal `PROTOCOL_VERSION`. Package version skew is tolerated with a warning.

## Matching helpers

```ts
function matchUrlGlob(glob: string, url: string): boolean;
function matchSerializedMatcher(
  matcher: SerializedMatcher,
  input: { request: SerializedRequest; clientId: string },
): boolean;
function serializeRegExp(regex: RegExp): { source: string; flags: string };
```

Glob rules: `*` within a segment, `**` across segments; matched against the absolute URL. Methods compared case-insensitively. A matcher with no URL still matches when method/client filters pass.

Authoritative route ownership uses a claim broadcast: proxy → Playwright `request:claim`, Playwright → proxy `request:claim-result`. The proxy waits for every test that currently has routes before deciding 0 / 1 / >1 matches.

## Body / header helpers

```ts
function encodeBody(body: string | Buffer | Uint8Array | null | undefined): string | null;
function decodeBody(bodyBase64: string | null | undefined): Buffer | null;
function decodeBodyText(bodyBase64: string | null | undefined): string | null;
function normalizeHeaders(headers: Record<string, string>): Record<string, string>;
```

Bodies travel as base64 on the wire. Headers are lowercased; duplicate keys are comma-joined.

## Message parsing

```ts
function parseClientToProxyMessage(input: unknown): ClientToProxyMessage; // throws
function parseProxyToClientMessage(input: unknown): ProxyToClientMessage; // throws
function safeParseClientToProxyMessage(input: unknown); /* Zod safeParse */
function safeParseProxyToClientMessage(input: unknown); /* Zod safeParse */
function parseJsonClientMessage(text: string): ClientToProxyMessage;
function parseJsonProxyMessage(text: string): ProxyToClientMessage;
function stringifyMessage(message: unknown): string;
```

All message schemas are Zod-derived and re-exported (e.g. `clientToProxyMessageSchema`, `serializedRequestSchema`, …).

## Core wire types

| Type                   | Role                                                |
| ---------------------- | --------------------------------------------------- |
| `SerializedRequest`    | URL, method, headers, `bodyBase64`                  |
| `SerializedResponse`   | status, statusText, headers, `bodyBase64`           |
| `SerializedError`      | name, message, optional stack/code                  |
| `SerializedMatcher`    | `urlGlob` / `urlRegex` / `methods` / `clientIds` / optional `predicate` marker |
| `RequestOverrides`     | Optional URL/method/headers/body for continue/fetch |
| `HistoryEntry`         | Dashboard/history record + outcome                  |
| `ConnectionRole`       | `"node"` \| `"playwright"`                          |
| `ClientToProxyMessage` | Discriminated union of client messages              |
| `ProxyToClientMessage` | Discriminated union of proxy messages               |
| `RouteMatchDiagnostic` | Match debugging metadata                            |
| `BackendErrorCode`     | Abort code union                                    |

## Message families (summary)

**Client → proxy:** `hello`, `ping`/`pong`, `request:start`/`cancel`, `fetch:result`, `agent:error`, `test:register`/`unregister`, `route:register`/`unregister`, `request:claim-result`, `handler:result` (`fulfill` \| `continue` \| `abort` \| `fetch`), `history:query`

**Proxy → client:** `hello:ok` / `hello:error`, `ping`/`pong`, `decision:*` (`fulfill` \| `continue` \| `abort` \| `fetch` \| `passthrough` \| `error`), `request:claim`, `request:matched`, `fetch:done`, `history:result`, `proxy:error`

For day-to-day mocking, prefer the [Playwright](/reference/playwright), [Node](/reference/node), and [Proxy](/reference/proxy) references.
