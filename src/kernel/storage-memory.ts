/**
 * In-memory JournalStorage implementation.
 *
 * Used for tests and as a reference implementation. Append-only at the type
 * level (no update/delete) per FR-K1-1. Idempotent by event_id per FR-K1-4.
 *
 * @forge-trace {"component_id":"kernel-storage-memory","problems":["P08"],"heritage":["K01"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":[]}
 */
import type { InsertResult, JournalStorage, StoredEventRow } from './storage-port.js';

export class MemoryJournalStorage implements JournalStorage {
  private rows: StoredEventRow[] = [];
  private byId: Map<string, StoredEventRow> = new Map();

  insert(row: StoredEventRow): InsertResult {
    const existing = this.byId.get(row.event_id);
    if (existing) {
      return { kind: 'duplicate', existing };
    }
    this.rows.push(row);
    this.byId.set(row.event_id, row);
    return { kind: 'inserted' };
  }

  getById(eventId: string): StoredEventRow | null {
    return this.byId.get(eventId) ?? null;
  }

  getLast(): StoredEventRow | null {
    if (this.rows.length === 0) return null;
    return this.rows[this.rows.length - 1] ?? null;
  }

  all(): StoredEventRow[] {
    return this.rows.slice();
  }

  range(fromId: string | null, toId: string | null): StoredEventRow[] {
    let start = 0;
    let end = this.rows.length;
    if (fromId !== null) {
      const i = this.rows.findIndex((r) => r.event_id === fromId);
      if (i >= 0) start = i;
    }
    if (toId !== null) {
      const j = this.rows.findIndex((r) => r.event_id === toId);
      if (j >= 0) end = j + 1;
    }
    return this.rows.slice(start, end);
  }

  count(): number {
    return this.rows.length;
  }

  close(): void {
    this.rows = [];
    this.byId.clear();
  }
}
