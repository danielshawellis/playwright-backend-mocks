import type { HistoryEntry } from "@playwright-backend-mocks/protocol";

export class HistoryStore {
  private readonly entries: HistoryEntry[] = [];

  constructor(private readonly limit: number) {}

  add(entry: HistoryEntry): void {
    this.entries.unshift(entry);
    this.trim();
  }

  /** Prefer dropping settled rows so in-flight requests can still finish. */
  private trim(): void {
    while (this.entries.length > this.limit) {
      let dropIndex = -1;
      for (let i = this.entries.length - 1; i >= 0; i--) {
        if (this.entries[i]?.outcome.kind !== "pending") {
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

  get(id: string): HistoryEntry | undefined {
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
