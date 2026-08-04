import type { HistoryEntry } from "@playwright-backend-mocks/protocol";

export class HistoryStore {
  private readonly entries: HistoryEntry[] = [];

  constructor(private readonly limit: number) {}

  add(entry: HistoryEntry): void {
    this.entries.unshift(entry);
    if (this.entries.length > this.limit) {
      this.entries.length = this.limit;
    }
  }

  update(
    id: string,
    updater: (entry: HistoryEntry) => HistoryEntry,
  ): HistoryEntry | undefined {
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

  list(): readonly HistoryEntry[] {
    return this.entries;
  }
}
