# Errors

## Abort codes

Used by `route.abort(errorCode?)` and carried on the wire as `BackendErrorCode`:

```ts
type BackendErrorCode =
  | "failed"
  | "aborted"
  | "timedout"
  | "connectionrefused"
  | "connectionreset"
  | "namenotresolved";
```

| Code                | Default message               |
| ------------------- | ----------------------------- |
| `failed`            | `net::ERR_FAILED`             |
| `aborted`           | `net::ERR_ABORTED`            |
| `timedout`          | `net::ERR_TIMED_OUT`          |
| `connectionrefused` | `net::ERR_CONNECTION_REFUSED` |
| `connectionreset`   | `net::ERR_CONNECTION_RESET`   |
| `namenotresolved`   | `net::ERR_NAME_NOT_RESOLVED`  |

Default when omitted: `"failed"`.

## `BackendMocksNetworkError`

Package: `@playwright-backend-mocks/protocol`

```ts
class BackendMocksNetworkError extends Error {
  readonly code: BackendErrorCode;
  // name === "BackendMocksNetworkError"
}
```

Helpers:

```ts
function errorFromCode(
  code: BackendErrorCode,
  message?: string,
): BackendMocksNetworkError;
function serializeError(error: unknown): SerializedError;
```

Application tests usually don't import these — you call `route.abort("timedout")` and assert on your app's failure UI/API. Import them when writing custom agents or protocol tooling.

## Errors surfaced to Playwright

| Situation                 | How you see it                                                                  |
| ------------------------- | ------------------------------------------------------------------------------- |
| Handler didn't settle     | Node request aborted; error recorded → teardown `AggregateError` unless drained |
| Double settle             | Throw in handler: `"Backend route already settled"`                             |
| Ambiguous routes          | Node fails; `proxy:error` on tests → `takeErrors()` / teardown                  |
| `route.fetch` timeout     | Promise rejects: `` `route.fetch timed out after ${ms}ms` ``                    |
| Proxy disconnect mid-test | Pending Node requests fail; Playwright may receive proxy errors                 |
| Undrained `takeErrors()`  | `AggregateError` on fixture teardown                                            |

## Handshake failures

| Cause                 | Result                                        |
| --------------------- | --------------------------------------------- |
| Wrong / missing token | `unauthorized`, socket closed                 |
| Protocol version skew | `hello:error`, socket closed                  |
| Package version skew  | Warning in logs; connection may still proceed |

Keep `@playwright-backend-mocks/playwright`, `node`, `proxy`, and `protocol` on the same release.
