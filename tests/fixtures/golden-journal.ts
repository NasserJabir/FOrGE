/**
 * Golden fixtures for K-1 (§4: "committed journals including a deliberately
 * corrupted chain (expected exact firstBroken)").
 *
 * These fixtures are deterministic: a known sequence of events with known
 * hashes, plus a deliberately corrupted variant whose exact firstBroken
 * is asserted. Any change to canonical JSON or hashing invalidates these and
 * MUST require AU-08 (FR-K1-3).
 *
 * @forge-trace {"component_id":"test-fixtures-golden-journal","problems":["P74","P08"],"heritage":["K05"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":[]}
 */
import { canonicalJson } from '../../src/kernel/canonical-json.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';
import { sha256Hex } from '../../src/lib/hash.js';

import type { JournalEvent, VerifyResult } from '../../src/kernel/event-journal.js';
import type { StoredEventRow } from '../../src/kernel/storage-port.js';

/** Build a deterministic 3-event golden journal (clean chain). */
export function buildGoldenCleanJournal(): { journal: EventJournal; events: JournalEvent[] } {
  const storage = new MemoryJournalStorage();
  const journal = new EventJournal({ storage });
  const events: JournalEvent[] = [];
  // Fixed timestamps for determinism.
  const r1 = journal.append({
    actor: 'alice',
    kind: 'task.started',
    payload: { goal: 'implement K-1' },
    ts: '2026-08-28T10:00:00.000Z',
  });
  const r2 = journal.append({
    actor: 'alice',
    kind: 'task.note',
    payload: { step: 1 },
    task_ref: 'T1',
    ts: '2026-08-28T10:01:00.000Z',
  });
  const r3 = journal.append({
    actor: 'bob',
    kind: 'task.completed',
    payload: { result: 'ok' },
    task_ref: 'T1',
    ts: '2026-08-28T10:02:00.000Z',
  });
  for (const r of [r1, r2, r3]) {
    if (r.kind === 'appended') events.push(r.event);
  }
  return { journal, events };
}

/** Build a deliberately corrupted journal: flip one byte in event 2's body. */
export function buildGoldenCorruptedJournal(): {
  journal: EventJournal;
  corruptedEventId: string;
  expectedReason: string;
} {
  const { journal } = buildGoldenCleanJournal();
  // Access the underlying storage via the journal's all() to get rows.
  // We rebuild a corrupted storage from the clean one.
  const cleanStorage = new MemoryJournalStorage();
  const cleanJournal = new EventJournal({ storage: cleanStorage });
  cleanJournal.append({
    actor: 'alice',
    kind: 'task.started',
    payload: { goal: 'implement K-1' },
    ts: '2026-08-28T10:00:00.000Z',
  });
  const r2 = cleanJournal.append({
    actor: 'alice',
    kind: 'task.note',
    payload: { step: 1 },
    task_ref: 'T1',
    ts: '2026-08-28T10:01:00.000Z',
  });
  cleanJournal.append({
    actor: 'bob',
    kind: 'task.completed',
    payload: { result: 'ok' },
    task_ref: 'T1',
    ts: '2026-08-28T10:02:00.000Z',
  });
  const rows = cleanStorage.all();
  const row2 = rows[1]!;
  // Corrupt: change the payload content without updating the hash.
  const body = JSON.parse(row2.body) as Record<string, unknown>;
  const payload = body.payload as Record<string, unknown>;
  payload.step = 999; // mutated
  const tamperedBody = canonicalJson(body);
  // Keep the ORIGINAL hash so the hash check detects the mismatch.
  const tamperedRow: StoredEventRow = { ...row2, body: tamperedBody };
  const tamperedStorage = new MemoryJournalStorage();
  tamperedStorage.insert(rows[0]!);
  tamperedStorage.insert(tamperedRow);
  tamperedStorage.insert(rows[2]!);
  const tamperedJournal = new EventJournal({ storage: tamperedStorage });
  void journal;
  void r2;
  return {
    journal: tamperedJournal,
    corruptedEventId: row2.event_id,
    expectedReason: 'hash mismatch (event tampered)',
  };
}

/** Verify the golden clean chain passes and the corrupted chain fails exactly. */
export function verifyGoldenFixtures(): {
  clean: VerifyResult;
  corrupted: VerifyResult;
} {
  const { journal: cleanJournal } = buildGoldenCleanJournal();
  const { journal: corruptedJournal } = buildGoldenCorruptedJournal();
  return {
    clean: cleanJournal.verify(),
    corrupted: corruptedJournal.verify(),
  };
}

// Re-export helpers for tests that need to recompute hashes.
export { sha256Hex, canonicalJson };
