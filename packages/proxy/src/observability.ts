import { randomUUID } from "node:crypto";
import type {
  HistoryAction,
  HistoryEntry,
  HistoryEvent,
  RequestOverrides,
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
