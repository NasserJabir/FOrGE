/**
 * K-1 Event Journal — append-only, content-addressed, hash-chained event log.
 *
 * FR-K1-1: append only (no update/delete at type level); record shape.
 * FR-K1-2: payload_hash = SHA-256(canonical(payload)); hash = SHA-256(canonical(event minus hash)); prev_hash chains.
 * FR-K1-3: canonical JSON fixed algorithm (golden test in canonical-json.test.ts).
 * FR-K1-4: duplicate event_id is a no-op returning the existing sealed event; NOT journaled.
 * FR-K1-5: verify(from?) checks hash, prev_hash, payload_hash; reports firstBroken.
 * FR-K1-6: replay via fold over any range; chronological reconstruction; actor/task correlation.
 * FR-K1-7: reject payloads matching secret-pattern set; journal `journal.append_rejected`.
 * FR-K1-8: event kinds namespaced (domain.action) and schema-registered; free-form rejected.
 * FR-K1-9: state transitions journaled before effect (write-ahead) — P2+ (hook present in P1).
 * NFR-1: detect any single-byte mutation via chain verification with exact firstBroken.
 *
 * @forge-trace {"component_id":"kernel-event-journal","problems":["P74","P08","P93","P78","P83","P98"],"heritage":["K01","K05","R4"],"decisions":["DEC-01","DEC-22","DEC-25","DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { canonicalJson } from './canonical-json.js';
import { sha256Hex } from '../lib/hash.js';
import { ulid } from '../lib/ulid.js';
import { scanForSecrets } from '../lib/secret-patterns.js';
import type { InsertResult, JournalStorage, StoredEventRow } from './storage-port.js';

/** Genesis prev_hash marker (FR-K1-2). */
export const GENESIS_PREV_HASH = 'GENESIS';

/** A payload is an arbitrary JSON-serializable object. */
export type EventPayload = Record<string, unknown>;

/** The full event record as defined by FR-K1-1. */
export interface JournalEvent {
  event_id: string;
  ts: string;
  actor: string;
  task_ref: string | null;
  kind: string;
  payload_hash: string;
  prev_hash: string;
  hash: string;
  payload: EventPayload;
}

/** Result of an append attempt. */
export type AppendResult =
  | { kind: 'appended'; event: JournalEvent }
  | { kind: 'duplicate'; event: JournalEvent }
  | { kind: 'rejected'; reason: string; patternId?: string };

/** Result of verify (FR-K1-5). */
export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBroken: { eventId: string; reason: string } | null;
}

/** A rejection event journaled per FR-K1-7. */
export interface AppendRejectionEvent {
  event_id: string;
  ts: string;
  actor: string;
  kind: 'journal.append_rejected';
  reason: string;
  patternId?: string;
  attempted_kind: string;
  attempted_actor: string;
}

/** Options for creating a journal. */
export interface JournalOptions {
  storage: JournalStorage;
  /** Registered event-kind namespaces (FR-K1-8). Each is a `domain.action` string. */
  allowedKinds?: string[];
  /** Whether to allow unknown kinds (default false — FR-K1-8 rejects free-form). */
  allowUnknownKinds?: boolean;
}

/**
 * The K-1 Event Journal. Construct one per logical journal (per workspace).
 */
export class EventJournal {
  private readonly storage: JournalStorage;
  private readonly allowedKinds: Set<string>;
  private readonly allowUnknownKinds: boolean;

  constructor(opts: JournalOptions) {
    this.storage = opts.storage;
    this.allowedKinds = new Set(opts.allowedKinds ?? []);
    this.allowUnknownKinds = opts.allowUnknownKinds ?? false;
  }

  /**
   * Append an event. FR-K1-1/2/4/7/8.
   * Returns the sealed event, or a duplicate/rejected result.
   */
  append(input: {
    actor: string;
    kind: string;
    payload: EventPayload;
    task_ref?: string;
    ts?: string;
  }): AppendResult {
    const ts = input.ts ?? new Date().toISOString();

    // FR-K1-8: event kinds namespaced and schema-registered; free-form rejected.
    if (!this.isKindAllowed(input.kind)) {
      return {
        kind: 'rejected',
        reason: `unknown event kind '${input.kind}' (not registered)`,
      };
    }

    // FR-K1-7: reject payloads matching the secret-pattern set BEFORE persistence.
    const payloadCanonical = canonicalJson(input.payload);
    const secretHit = scanForSecrets(payloadCanonical);
    if (secretHit) {
      // Journal the rejection itself (FR-K1-7) — this rejection event is NOT
      // subject to secret scanning (it contains only a truncated snippet).
      this.journalRejection({
        ts,
        actor: input.actor,
        kind: 'journal.append_rejected',
        attempted_actor: input.actor,
        attempted_kind: input.kind,
        reason: 'secret-pattern match in payload',
        patternId: secretHit.patternId,
      });
      return {
        kind: 'rejected',
        reason: 'secret-pattern match in payload',
        patternId: secretHit.patternId,
      };
    }

    const event_id = ulid();
    const payload_hash = sha256Hex(payloadCanonical);
    const prev = this.storage.getLast();
    const prev_hash = prev ? prev.hash : GENESIS_PREV_HASH;

    // Build the event minus hash, compute hash over canonical(event minus hash).
    const eventMinusHash: Omit<JournalEvent, 'hash'> = {
      event_id,
      ts,
      actor: input.actor,
      task_ref: input.task_ref ?? null,
      kind: input.kind,
      payload_hash,
      prev_hash,
      payload: input.payload,
    };
    const hash = sha256Hex(canonicalJson(eventMinusHash));

    const event: JournalEvent = { ...eventMinusHash, hash };
    const row: StoredEventRow = {
      event_id: event.event_id,
      ts: event.ts,
      actor: event.actor,
      task_ref: event.task_ref,
      kind: event.kind,
      payload_hash: event.payload_hash,
      prev_hash: event.prev_hash,
      hash: event.hash,
      body: canonicalJson(eventMinusHash),
    };

    const res: InsertResult = this.storage.insert(row);
    if (res.kind === 'duplicate') {
      // FR-K1-4: no-op returning the existing sealed event; NOT journaled.
      const existing = this.rowToEvent(res.existing);
      return { kind: 'duplicate', event: existing };
    }
    return { kind: 'appended', event };
  }

  /**
   * Verify the integrity of the chain (FR-K1-5, NFR-1).
   * Checks hash, prev_hash, and payload_hash for each event.
   * Reports {ok, checked, firstBroken{eventId, reason}}.
   */
  verify(fromId?: string): VerifyResult {
    const rows = this.storage.range(fromId ?? null, null);
    let checked = 0;
    let expectedPrev = fromId ? this.storage.getById(fromId)?.hash ?? null : null;

    for (const row of rows) {
      // Reconstruct event minus hash from body.
      let parsed: Omit<JournalEvent, 'hash'>;
      try {
        parsed = JSON.parse(row.body) as Omit<JournalEvent, 'hash'>;
      } catch {
        return {
          ok: false,
          checked,
          firstBroken: { eventId: row.event_id, reason: 'body is not valid JSON' },
        };
      }

      // Check 1: hash matches SHA-256(canonical(event minus hash)).
      const recomputedHash = sha256Hex(canonicalJson(parsed));
      if (recomputedHash !== row.hash) {
        return {
          ok: false,
          checked,
          firstBroken: { eventId: row.event_id, reason: 'hash mismatch (event tampered)' },
        };
      }

      // Check 2: prev_hash chains correctly.
      const expected = expectedPrev ?? GENESIS_PREV_HASH;
      if (row.prev_hash !== expected) {
        return {
          ok: false,
          checked,
          firstBroken: {
            eventId: row.event_id,
            reason: `prev_hash mismatch (expected '${expected}', got '${row.prev_hash}')`,
          },
        };
      }

      // Check 3: payload_hash matches SHA-256(canonical(payload)).
      const recomputedPayloadHash = sha256Hex(canonicalJson(parsed.payload));
      if (recomputedPayloadHash !== row.payload_hash) {
        return {
          ok: false,
          checked,
          firstBroken: { eventId: row.event_id, reason: 'payload_hash mismatch' },
        };
      }

      expectedPrev = row.hash;
      checked++;
    }

    return { ok: true, checked, firstBroken: null };
  }

  /**
   * Replay via fold over any event range (FR-K1-6).
   * Chronological reconstruction; actor attribution; task correlation.
   */
  replay<T>(
    fromId: string | null,
    toId: string | null,
    seed: T,
    fold: (acc: T, event: JournalEvent) => T,
  ): T {
    const rows = this.storage.range(fromId, toId);
    let acc = seed;
    for (const row of rows) {
      acc = fold(acc, this.rowToEvent(row));
    }
    return acc;
  }

  /** Read a single event by id. */
  get(eventId: string): JournalEvent | null {
    const row = this.storage.getById(eventId);
    return row ? this.rowToEvent(row) : null;
  }

  /** Read all events chronologically. */
  all(): JournalEvent[] {
    return this.storage.all().map((r) => this.rowToEvent(r));
  }

  /** Count of events. */
  count(): number {
    return this.storage.count();
  }

  /** Close the underlying storage. */
  close(): void {
    this.storage.close();
  }

  // --- internals ---

  private isKindAllowed(kind: string): boolean {
    if (this.allowUnknownKinds) return true;
    if (this.allowedKinds.size === 0) {
      // Default registry: require namespaced kind (domain.action) form.
      return /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(kind);
    }
    return this.allowedKinds.has(kind);
  }

  private journalRejection(rej: Omit<AppendRejectionEvent, 'event_id'>): void {
    // The rejection event bypasses secret scanning (it has no payload).
    const event_id = ulid();
    const body = {
      event_id,
      ts: rej.ts,
      actor: 'forge:kernel',
      task_ref: null,
      kind: 'journal.append_rejected',
      payload_hash: sha256Hex(canonicalJson(rej)),
      prev_hash: this.storage.getLast()?.hash ?? GENESIS_PREV_HASH,
      payload: rej,
    };
    const hash = sha256Hex(canonicalJson(body));
    this.storage.insert({
      event_id,
      ts: rej.ts,
      actor: 'forge:kernel',
      task_ref: null,
      kind: 'journal.append_rejected',
      payload_hash: body.payload_hash,
      prev_hash: body.prev_hash,
      hash,
      body: canonicalJson(body),
    });
  }

  private rowToEvent(row: StoredEventRow): JournalEvent {
    const parsed = JSON.parse(row.body) as Omit<JournalEvent, 'hash'>;
    return { ...parsed, hash: row.hash };
  }
}
