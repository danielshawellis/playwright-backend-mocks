import { randomUUID } from "node:crypto";
import type {
  HistoryAction,
  HistoryEntry,
  HistoryEvent,
  RequestOverrides,
  SerializedError,
  SerializedRequest,
  SerializedResponse,
} from "@playwright-backend-mocks/protocol";
import type { HistoryCaptureMode } from "./config.js";
import type { HistoryStore } from "./history.js";

export function actionFromOutcome(outcome: HistoryEntry["outcome"]): HistoryAction {
  switch (outcome.kind) {
    case "mocked":
      return "fulfill";
    case "continued":
      return "continue";
    case "aborted":
      return "abort";
    case "passthrough":
      return "passthrough";
    case "error":
      return "error";
    case "pending":
      return "pending";
  }
}

export function isHandledAction(action: HistoryAction): boolean {
  return (
    action === "fulfill" ||
    action === "continue" ||
    action === "abort" ||
    action === "error"
  );
}

export function shouldRetainHttp(
  capture: HistoryCaptureMode,
  action: HistoryAction,
): boolean {
  if (capture === "none") {
    return false;
  }
  if (capture === "handled") {
    return isHandledAction(action);
  }
  return true;
}

export function shouldRetainWs(
  capture: HistoryCaptureMode,
  outcome: "pending" | "matched" | "passthrough" | "error",
): boolean {
  if (capture === "none") {
    return false;
  }
  if (capture === "handled") {
    return outcome === "matched" || outcome === "error";
  }
  return true;
}

export function makeHistoryEvent(
  kind: string,
  detail?: string,
  timestamp: number = Date.now(),
): HistoryEvent {
  return {
    id: randomUUID(),
    timestamp,
    kind,
    ...(detail !== undefined ? { detail } : {}),
  };
}

export interface FinishHistoryOptions {
  readonly history: HistoryStore;
  readonly capture: HistoryCaptureMode;
  readonly historyId: string;
  readonly startedAt: number;
  readonly outcome: HistoryEntry["outcome"];
  readonly testId?: string;
  readonly routeId?: string;
  readonly title?: string;
  readonly path?: string;
  readonly overrides?: RequestOverrides;
  readonly event?: HistoryEvent;
}

export function finishHistoryEntry(options: FinishHistoryOptions): void {
  const action = actionFromOutcome(options.outcome);
  if (!shouldRetainHttp(options.capture, action)) {
    options.history.remove(options.historyId);
    return;
  }

  options.history.update(options.historyId, (entry) => {
    const events = [...(entry.events ?? [])];
    if (options.event) {
      events.push(options.event);
    } else {
      events.push(makeHistoryEvent(action));
    }
    return {
      ...entry,
      outcome: options.outcome,
      action,
      durationMs: Date.now() - options.startedAt,
      ...(options.testId !== undefined ? { testId: options.testId } : {}),
      ...(options.routeId !== undefined ? { routeId: options.routeId } : {}),
      ...(options.title !== undefined ? { title: options.title } : {}),
      ...(options.path !== undefined ? { path: options.path } : {}),
      ...(options.overrides !== undefined ? { overrides: options.overrides } : {}),
      events,
    };
  });
}

/**
 * Attach an upstream settle response (continue / passthrough / redirect hop).
 * Preserves the decision `action`; only patches `outcome.response` and timeline.
 */
export function attachHistoryResponse(options: {
  readonly history: HistoryStore;
  readonly requestId: string;
  readonly ok: boolean;
  readonly response?: SerializedResponse;
  readonly error?: SerializedError;
}): void {
  const entry = options.history.get(options.requestId);
  if (entry === undefined) {
    return;
  }

  options.history.update(options.requestId, (current) => {
    const durationMs = Date.now() - current.timestamp;

    if (!options.ok || options.response === undefined) {
      if (
        current.outcome.kind !== "continued" &&
        current.outcome.kind !== "passthrough"
      ) {
        return current;
      }
      const detail = options.error?.message ?? "Upstream request failed";
      return {
        ...current,
        durationMs,
        events: [
          ...(current.events ?? []),
          makeHistoryEvent("upstream_error", detail),
        ],
      };
    }

    if (current.outcome.kind === "continued") {
      return {
        ...current,
        durationMs,
        events: [
          ...(current.events ?? []),
          makeHistoryEvent(
            "response",
            `${options.response.status} ${options.response.statusText}`,
          ),
        ],
        outcome: { kind: "continued", response: options.response },
      };
    }
    if (current.outcome.kind === "passthrough") {
      return {
        ...current,
        durationMs,
        events: [
          ...(current.events ?? []),
          makeHistoryEvent(
            "response",
            `${options.response.status} ${options.response.statusText}`,
          ),
        ],
        outcome: { kind: "passthrough", response: options.response },
      };
    }
    // fulfill / abort / error already terminal — ignore late upstream reports.
    return current;
  });
}

/**
 * Record a synthetic redirect hop from Node `request:observe`.
 * Inherits action / ownership metadata from the prior hop when retained.
 */
export function recordRedirectHop(options: {
  readonly history: HistoryStore;
  readonly capture: HistoryCaptureMode;
  readonly requestId: string;
  readonly clientId: string;
  readonly request: SerializedRequest;
  readonly redirectedFromRequestId: string;
}): void {
  if (options.capture === "none") {
    return;
  }

  const prior = options.history.get(options.redirectedFromRequestId);
  if (prior === undefined) {
    return;
  }

  const action = prior.action ?? actionFromOutcome(prior.outcome);
  if (!shouldRetainHttp(options.capture, action)) {
    return;
  }

  // Only continue / passthrough settlements follow redirects inside the agent.
  if (action !== "continue" && action !== "passthrough") {
    return;
  }

  if (options.history.get(options.requestId) !== undefined) {
    return;
  }

  const timestamp = Date.now();
  const outcome: HistoryEntry["outcome"] =
    action === "continue" ? { kind: "continued" } : { kind: "passthrough" };

  options.history.add({
    id: options.requestId,
    timestamp,
    clientId: options.clientId,
    request: options.request,
    outcome,
    action,
    ...(prior.testId !== undefined ? { testId: prior.testId } : {}),
    ...(prior.routeId !== undefined ? { routeId: prior.routeId } : {}),
    ...(prior.title !== undefined ? { title: prior.title } : {}),
    ...(prior.path !== undefined ? { path: prior.path } : {}),
    redirectedFromId: prior.id,
    events: [makeHistoryEvent("observed", "redirect hop", timestamp)],
  });

  options.history.update(prior.id, (entry) => ({
    ...entry,
    redirectedToId: options.requestId,
  }));
}

export function formatStartupBanner(options: {
  readonly httpUrl: string;
  readonly historyCapture: HistoryCaptureMode;
}): string {
  const wsUrl = options.httpUrl.replace(/^http/, "ws") + "/ws";
  return [
    "playwright-backend-mocks proxy",
    "",
    `  Connect Node / Playwright:  ${wsUrl}`,
    `  REST API:                   ${options.httpUrl}`,
    "  Dashboard:                  install @playwright-backend-mocks/dashboard",
    `                              and point --proxy-url at ${options.httpUrl}`,
    `  History capture:            ${options.historyCapture}`,
  ].join("\n");
}
