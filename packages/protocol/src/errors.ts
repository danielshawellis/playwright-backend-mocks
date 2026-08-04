import type { BackendErrorCode, SerializedError } from "./schemas.js";

export class BackendMocksNetworkError extends Error {
  readonly code: BackendErrorCode;

  constructor(code: BackendErrorCode, message?: string) {
    super(message ?? defaultMessage(code));
    this.name = "BackendMocksNetworkError";
    this.code = code;
  }
}

function defaultMessage(code: BackendErrorCode): string {
  switch (code) {
    case "failed":
      return "net::ERR_FAILED";
    case "aborted":
      return "net::ERR_ABORTED";
    case "timedout":
      return "net::ERR_TIMED_OUT";
    case "connectionrefused":
      return "net::ERR_CONNECTION_REFUSED";
    case "connectionreset":
      return "net::ERR_CONNECTION_RESET";
    case "namenotresolved":
      return "net::ERR_NAME_NOT_RESOLVED";
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const result: SerializedError = {
      name: error.name,
      message: error.message,
    };
    if (error.stack !== undefined) {
      result.stack = error.stack;
    }
    if (
      "code" in error &&
      (typeof error.code === "string" || typeof error.code === "number")
    ) {
      result.code = String(error.code);
    }
    return result;
  }

  return {
    name: "Error",
    message: String(error),
  };
}

export function errorFromCode(
  code: BackendErrorCode,
  message?: string,
): BackendMocksNetworkError {
  return new BackendMocksNetworkError(code, message);
}
