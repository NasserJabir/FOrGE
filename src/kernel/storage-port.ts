/**
 * Storage Port — abstraction over the persistence backend (C-01: better-sqlite3
 * behind a storage port). The kernel never imports better-sqlite3 directly;
 * it programs against this interface, enabling substitution (NFR-6) and
 * keeping the dependency surface auditable.
 *
 * P1 ships an in-memory implementation for tests and a SQLite implementation
 * for production. Both satisfy the same contract.
 *
 * @forge-trace {"component_id":"kernel-storage-port","problems":["P08","P89"],"heritage":["K01"],"decisions":["DEC-01","DEC-41","DEC-32"],"bp_ids":[],"ac_ids":[]}
 */

/**
 * A stored journal row (the persisted form of an event).
 * The journal stores the canonical-JSON event body and its computed hash.
 */
export interface StoredEventRow {
  event_id: string;
  ts: string;
  actor: string;
  task_ref: string | null;
  kind: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
  body: string; // canonical JSON of the full event (minus hash)
}

/**
 * Storage port for the K-1 journal. Implementations MUST be append-only at
 * the type level (no update/delete exposed) per FR-K1-1.
 */
export interface JournalStorage {
  /** Append a sealed event row. Idempotent by event_id (FR-K1-4). */
  insert(row: StoredEventRow): InsertResult;
  /** Read a single event by id, or null. */
  getById(eventId: string): StoredEventRow | null;
  /** Read the last appended event (for chaining), or null if empty. */
  getLast(): StoredEventRow | null;
  /** Read all events in chronological order. */
  all(): StoredEventRow[];
  /** Read events in a range [fromId, toId] inclusive (for replay FR-K1-6). */
  range(fromId: string | null, toId: string | null): StoredEventRow[];
  /** Count of stored events. */
  count(): number;
  /** Close the storage (release resources). */
  close(): void;
}

export type InsertResult = { kind: 'inserted' } | { kind: 'duplicate'; existing: StoredEventRow };
