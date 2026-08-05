import { randomUUID } from "node:crypto";
import type {
  WsConnectionEntry,
  WsConnectionOutcome,
  WsTimelineEvent,
} from "@playwright-backend-mocks/protocol";

const DEFAULT_EVENT_LIMIT = 500;

export class WsHistoryStore {
  private readonly entries: WsConnectionEntry[] = [];

  constructor(
    private readonly limit: number,
    private readonly eventLimit: number = DEFAULT_EVENT_LIMIT,
  ) {}

  add(entry: WsConnectionEntry): void {
    this.entries.unshift(entry);
    this.trim();
  }

  /** Prefer dropping settled rows so in-flight sockets can still finish. */
  private trim(): void {
    while (this.entries.length > this.limit) {
      let dropIndex = -1;
      for (let i = this.entries.length - 1; i >= 0; i--) {
        if (this.entries[i]?.outcome !== "pending") {
          dropIndex = i;
          break;
        }
      }
      if (dropIndex === -1) {
        this.entries.pop();
      } else {
        this.entries.splice(dropIndex, 1);
      }
    }
  }

  get(id: string): WsConnectionEntry | undefined {
    return this.entries.find((entry) => entry.id === id);
  }

  remove(id: string): void {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index !== -1) {
      this.entries.splice(index, 1);
    }
  }

  update(
    id: string,
    updater: (entry: WsConnectionEntry) => WsConnectionEntry,
  ): WsConnectionEntry | undefined {
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return undefined;
    }
    const current = this.entries[index];
    if (current === undefined) {
      return undefined;
    }
    const next = updater(current);
    this.entries[index] = next;
    return next;
  }

  appendEvent(id: string, event: Omit<WsTimelineEvent, "id"> & { id?: string }): void {
    this.update(id, (entry) => {
      const nextEvent: WsTimelineEvent = {
        id: event.id ?? randomUUID(),
        timestamp: event.timestamp,
        direction: event.direction,
        kind: event.kind,
        ...(event.detail !== undefined ? { detail: event.detail } : {}),
        ...(event.data !== undefined ? { data: event.data } : {}),
        ...(event.isBase64 !== undefined ? { isBase64: event.isBase64 } : {}),
      };
      const events = [nextEvent, ...entry.events];
      if (events.length > this.eventLimit) {
        events.length = this.eventLimit;
      }
      return { ...entry, events };
    });
  }

  setOutcome(
    id: string,
    outcome: WsConnectionOutcome,
    extras: Partial<
      Pick<
        WsConnectionEntry,
        | "title"
        | "path"
        | "testId"
        | "routeId"
        | "errorCode"
        | "errorMessage"
        | "matches"
        | "closedAt"
        | "close"
      >
    > = {},
  ): void {
    this.update(id, (entry) => ({
      ...entry,
      outcome,
      ...extras,
    }));
  }

  list(): readonly WsConnectionEntry[] {
    return this.entries;
  }
}
