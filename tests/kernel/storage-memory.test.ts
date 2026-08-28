/**
 * MemoryJournalStorage tests — the in-memory JournalStorage reference impl.
 *
 * Covers insert (inserted + duplicate), getById, getLast, all, range (all
 * fromId/toId/null combinations), count, close. Also exercises the
 * JournalStorage interface (storage-port.ts) by importing it.
 *
 * @forge-trace {"component_id":"test-storage-memory","problems":["P08"],"heritage":["K01"],"decisions":["DEC-01","DEC-41"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';

import type {
  StoredEventRow,
  JournalStorage,
  InsertResult,
} from '../../src/kernel/storage-port.js';

function makeRow(id: string, hash = `hash-${id}`, prevHash = 'GENESIS'): StoredEventRow {
  return {
    event_id: id,
    ts: `2026-08-28T10:00:0${id.length}.000Z`,
    actor: 'alice',
    task_ref: null,
    kind: 'task.note',
    payload_hash: `ph-${id}`,
    prev_hash: prevHash,
    hash,
    body: `{"event_id":"${id}","hash":"${hash}"}`,
  };
}

describe('MemoryJournalStorage: insert + getById', () => {
  it('inserts a row and returns {kind:"inserted"}', () => {
    const s = new MemoryJournalStorage();
    const row = makeRow('e1');
    const res = s.insert(row);
    expect(res.kind).toBe('inserted');
  });

  it('getById returns the inserted row', () => {
    const s = new MemoryJournalStorage();
    const row = makeRow('e1');
    s.insert(row);
    const got = s.getById('e1');
    expect(got).not.toBeNull();
    expect(got!.event_id).toBe('e1');
  });

  it('getById returns null for a missing id', () => {
    const s = new MemoryJournalStorage();
    expect(s.getById('nope')).toBeNull();
  });

  it('insert of a duplicate event_id returns {kind:"duplicate", existing}', () => {
    const s = new MemoryJournalStorage();
    const row = makeRow('e1');
    s.insert(row);
    const res = s.insert(row);
    expect(res.kind).toBe('duplicate');
    if (res.kind === 'duplicate') {
      expect(res.existing.event_id).toBe('e1');
    }
  });

  it('duplicate insert does not increase count', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e1')); // duplicate
    expect(s.count()).toBe(1);
  });
});

describe('MemoryJournalStorage: getLast', () => {
  it('returns null on an empty storage', () => {
    const s = new MemoryJournalStorage();
    expect(s.getLast()).toBeNull();
  });

  it('returns the last inserted row', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1', 'h1'));
    s.insert(makeRow('e2', 'h2', 'h1'));
    const last = s.getLast();
    expect(last).not.toBeNull();
    expect(last!.event_id).toBe('e2');
  });
});

describe('MemoryJournalStorage: all + count', () => {
  it('all returns events in insertion order', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    s.insert(makeRow('e3'));
    const rows = s.all();
    expect(rows.map((r) => r.event_id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('all returns a defensive copy (mutating result does not affect storage)', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    const rows = s.all();
    rows.length = 0; // mutate the returned array
    expect(s.all().length).toBe(1);
  });

  it('count reflects the number of inserted rows', () => {
    const s = new MemoryJournalStorage();
    expect(s.count()).toBe(0);
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    expect(s.count()).toBe(2);
  });
});

describe('MemoryJournalStorage: range', () => {
  it('range(null, null) returns all rows', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    s.insert(makeRow('e3'));
    const rows = s.range(null, null);
    expect(rows.map((r) => r.event_id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('range(fromId, null) returns from fromId to the end', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    s.insert(makeRow('e3'));
    const rows = s.range('e2', null);
    expect(rows.map((r) => r.event_id)).toEqual(['e2', 'e3']);
  });

  it('range(null, toId) returns from the start through toId inclusive', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    s.insert(makeRow('e3'));
    const rows = s.range(null, 'e2');
    expect(rows.map((r) => r.event_id)).toEqual(['e1', 'e2']);
  });

  it('range(fromId, toId) returns the inclusive sub-range', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    s.insert(makeRow('e3'));
    s.insert(makeRow('e4'));
    const rows = s.range('e2', 'e3');
    expect(rows.map((r) => r.event_id)).toEqual(['e2', 'e3']);
  });

  it('range with a non-existent fromId starts at 0', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    // fromId not found => start stays 0
    const rows = s.range('missing', null);
    expect(rows.map((r) => r.event_id)).toEqual(['e1', 'e2']);
  });

  it('range with a non-existent toId ends at the full length', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    // toId not found => end stays this.rows.length
    const rows = s.range(null, 'missing');
    expect(rows.map((r) => r.event_id)).toEqual(['e1', 'e2']);
  });

  it('range on an empty storage returns []', () => {
    const s = new MemoryJournalStorage();
    expect(s.range(null, null)).toEqual([]);
  });
});

describe('MemoryJournalStorage: close', () => {
  it('close clears the storage (count drops to 0, getById returns null)', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.insert(makeRow('e2'));
    expect(s.count()).toBe(2);
    s.close();
    expect(s.count()).toBe(0);
    expect(s.getById('e1')).toBeNull();
    expect(s.getLast()).toBeNull();
    expect(s.all()).toEqual([]);
  });

  it('close is idempotent (calling twice does not throw)', () => {
    const s = new MemoryJournalStorage();
    s.insert(makeRow('e1'));
    s.close();
    expect(() => s.close()).not.toThrow();
  });
});

describe('MemoryJournalStorage: implements JournalStorage interface', () => {
  it('satisfies the JournalStorage contract (structural typing)', () => {
    const s: JournalStorage = new MemoryJournalStorage();
    // Insert one row to exercise the interface methods.
    const row = makeRow('iface1');
    const res: InsertResult = s.insert(row);
    expect(res.kind).toBe('inserted');
    expect(s.getById('iface1')).not.toBeNull();
    expect(s.getLast()).not.toBeNull();
    expect(s.all().length).toBe(1);
    expect(s.range(null, null).length).toBe(1);
    expect(s.count()).toBe(1);
    s.close();
    expect(s.count()).toBe(0);
  });
});
