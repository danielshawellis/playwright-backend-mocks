import type { HistoryEntry, SerializedResponse } from "./schemas.js";

/**
 * Response body recorded on an HTTP history entry, when one exists.
 *
 * - `fulfill` / mocked — always present
 * - `continue` / `passthrough` — present after Node reports `request:response`
 * - `abort` / `error` / `pending` — never (no HTTP response to the app)
 */
export function historyResponse(
  entry: HistoryEntry,
): SerializedResponse | undefined {
  switch (entry.outcome.kind) {
    case "mocked":
      return entry.outcome.response;
    case "continued":
    case "passthrough":
      return entry.outcome.response;
    default:
      return undefined;
  }
}

/** True when the outcome kind never carries an HTTP response. */
export function historyOutcomeHasNoResponse(entry: HistoryEntry): boolean {
  return (
    entry.outcome.kind === "aborted" ||
    entry.outcome.kind === "error" ||
    entry.outcome.kind === "pending"
  );
}
