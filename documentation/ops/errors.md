# Errors

This page summarizes errors surfaced by routes, the Node agent, and the proxy.

## Abort codes

`route.abort(errorCode?)` uses backend network error codes on the wire.

| Code | Default message |
| --- | --- |
| `failed` | `net::ERR_FAILED` |
| `aborted` | `net::ERR_ABORTED` |
| `timedout` | `net::ERR_TIMED_OUT` |
| `connectionrefused` | `net::ERR_CONNECTION_REFUSED` |
| `connectionreset` | `net::ERR_CONNECTION_RESET` |
| `namenotresolved` | `net::ERR_NAME_NOT_RESOLVED` |

Default when omitted: `failed`.

The public route type accepts Playwright abort strings, but unsupported strings collapse to `failed` before reaching the Node agent.

## `BackendMocksNetworkError`

Package: `@playwright-backend-mocks/protocol`

```ts
class BackendMocksNetworkError extends Error {
  readonly code: BackendErrorCode;
}
```

Helpers exported by the protocol package:

```ts
function errorFromCode(
  code: BackendErrorCode,
  message?: string,
): BackendMocksNetworkError;

function serializeError(error: unknown): SerializedError;
```

Application tests usually do not import these helpers. They call `route.abort()` and assert on app behavior.

## Proxy decision errors

| Code | Meaning |
| --- | --- |
| `ambiguous_route` | More than one test claimed the same HTTP request or WebSocket connection. |
| `claim_timeout` | At least one expected Playwright test did not answer the claim in time. |
| `disconnected` | The matched Playwright worker or Node agent disconnected. |
| `handler_failed` | Reserved for handler failure messages. |
| `internal` | Coordination failed for an unexpected reason. |

Proxy errors are stored in the current test's `backendMocks` error buffer. Remaining errors fail fixture teardown.

```ts
const errors = backendMocks.takeErrors();
expect(errors[0]?.message).toMatch(/Ambiguous backend mock routing/);
```

Only drain errors that the test intentionally triggers.

## Handler errors

If an HTTP route handler throws:

1. The error is recorded on the test's error buffer.
2. The paused Node request is aborted with `failed`.
3. Fixture teardown throws if the error is not drained.

## Fetch and waiter errors

| API | Error |
| --- | --- |
| `route.fetch({ timeout })` | Rejects with `Timeout ${timeout}ms exceeded.` |
| `route.fetch({ signal })` | Rejects with the abort reason or `route.fetch aborted`. |
| `waitForRequest({ timeout })` | Rejects after timeout waiting for event `"request"`. |
| `waitForResponse({ timeout })` | Rejects after timeout waiting for event `"response"`. |
| Waiter with `AbortSignal` | Rejects with the abort reason or `The operation was aborted`. |

Pass `timeout: 0` to disable route fetch and waiter timeouts.

## Handshake errors

| Cause | Result |
| --- | --- |
| Protocol version mismatch | `hello:error` with `protocol_mismatch`; socket closes. |
| Wrong or missing token | `hello:error` with `unauthorized`; socket closes. |
| Package version mismatch | Proxy logs a warning and keeps the connection. |

Keep all four packages on the same version.

See [Troubleshooting](/guide/troubleshooting).
