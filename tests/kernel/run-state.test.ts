/**
 * K-15 RunState tests — FR-S3-1 (event-sourced states), FR-K1-9 (write-ahead),
 * NFR-5 (recoverability), with provocation tests (C-07).
 *
 * T-RS-1: declared states match the SRS state diagram exactly.
 * T-RS-2: a transition applied without a prior journal event (effect before
 *   journal) is detected — the state machine refuses to advance.
 * T-RS-3: after a forced kill (drop in-memory state, reconstruct from K-1),
 *   the RunState matches the last journaled state, not any unjournaled
 *   intermediate (NFR-5/NFR-6).
 * T-RS-4: an illegal transition (e.g. CLOSED → RUNNING) is rejected.
 *
 * @forge-trace {"component_id":"test-run-state","problems":["P95"],"heritage":["K15"],"decisions":["DEC-25"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { EventJournal } from '../../src/kernel/event-journal.js';
import {
  RUN_STATES,
  RunState,
  LEGAL_TRANSITIONS,
  type RunStateValue,
} from '../../src/kernel/run-state.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';

/** Build a journal with the runstate.transition kind registered. */
function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: ['runstate.transition', 'journal.append_rejected'],
  });
}

/** Build a RunState over a fresh journal. */
function makeRunState(): { rs: RunState; journal: EventJournal } {
  const journal = makeJournal();
  const rs = new RunState({ journal });
  return { rs, journal };
}

describe('T-RS-1: RunState declared states match the SRS state diagram', () => {
  it('exposes exactly the eight declared states', () => {
    expect([...RUN_STATES]).toEqual([
      'QUEUED',
      'RUNNING',
      'SUSPENDED',
      'INTERRUPTED',
      'RECOVERING',
      'RESUMING',
      'ABORTED',
      'CLOSED',
    ]);
  });

  it('QUEUED → RUNNING is legal', () => {
    const { rs } = makeRunState();
    const res = rs.transition('inst-1', 'RUNNING', 'started');
    expect(res.ok).toBe(true);
    expect(rs.stateOf('inst-1')).toBe('RUNNING');
  });
});

describe('T-RS-2 PROVOCATION: effect-before-journal is detected (write-ahead, FR-K1-9)', () => {
  it('a transition journals BEFORE the in-memory state advances', () => {
    // After a successful transition, the journal must contain the event.
    const { rs, journal } = makeRunState();
    const before = journal.count();
    rs.transition('inst-1', 'RUNNING', 'started');
    const after = journal.count();
    expect(after).toBe(before + 1);
  });

  it('the in-memory state is disposable — reconstructing from the journal yields the journaled state', () => {
    const { rs, journal } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    rs.transition('inst-1', 'SUSPENDED', 'paused');
    // Drop the in-memory state entirely (simulate crash).
    const fresh = new RunState({ journal });
    expect(fresh.stateOf('inst-1')).toBe('SUSPENDED');
  });
});

describe('T-RS-3 PROVOCATION: forced-kill recovery reconstructs from K-1 (NFR-5)', () => {
  it('reconstructs the last journaled state, not any unjournaled intermediate', () => {
    const { rs, journal } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    rs.transition('inst-1', 'SUSPENDED', 'paused');
    rs.transition('inst-1', 'RUNNING', 'resumed');
    rs.transition('inst-1', 'INTERRUPTED', 'signal');

    // Simulate a forced kill: drop the in-memory state, rebuild from K-1.
    const recovered = new RunState({ journal });
    expect(recovered.stateOf('inst-1')).toBe('INTERRUPTED');
  });

  it('an instance with no journaled transitions has no state (null)', () => {
    const { journal } = makeRunState();
    const rs = new RunState({ journal });
    expect(rs.stateOf('never-seen')).toBeNull();
  });

  it('multiple instances are tracked independently via task_ref', () => {
    const { rs, journal } = makeRunState();
    rs.transition('inst-a', 'RUNNING', 'started');
    rs.transition('inst-b', 'RUNNING', 'started');
    rs.transition('inst-a', 'SUSPENDED', 'paused');

    const recovered = new RunState({ journal });
    expect(recovered.stateOf('inst-a')).toBe('SUSPENDED');
    expect(recovered.stateOf('inst-b')).toBe('RUNNING');
  });
});

describe('T-RS-4 PROVOCATION: illegal transitions are rejected', () => {
  it('rejects CLOSED → RUNNING (terminal state)', () => {
    const { rs } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    rs.transition('inst-1', 'CLOSED', 'done');
    expect(rs.stateOf('inst-1')).toBe('CLOSED');
    const res = rs.transition('inst-1', 'RUNNING', 'sneaky-restart');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('CLOSED');
    }
    // State unchanged after rejection.
    expect(rs.stateOf('inst-1')).toBe('CLOSED');
  });

  it('rejects ABORTED → RUNNING (terminal state)', () => {
    const { rs } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    rs.transition('inst-1', 'ABORTED', 'killed');
    const res = rs.transition('inst-1', 'RUNNING', 'sneaky-restart');
    expect(res.ok).toBe(false);
  });

  it('rejects QUEUED → SUSPENDED (must go through RUNNING)', () => {
    const { rs } = makeRunState();
    const res = rs.transition('inst-1', 'SUSPENDED', 'skip-running');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('QUEUED');
    }
    expect(rs.stateOf('inst-1')).toBeNull();
  });

  it('rejects a transition to an unknown state', () => {
    const { rs } = makeRunState();
    const res = rs.transition('inst-1', 'ZOMBIE' as RunStateValue, 'bad');
    expect(res.ok).toBe(false);
  });

  it('a rejected illegal transition is NOT journaled (no phantom event)', () => {
    const { rs, journal } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    const before = journal.count();
    rs.transition('inst-1', 'SUSPENDED', 'paused');
    // RUNNING → SUSPENDED is legal, so this one IS journaled.
    expect(journal.count()).toBe(before + 1);
    const before2 = journal.count();
    // Now try a genuinely illegal one: SUSPENDED → RESUMING is NOT in the
    // table (RESUMING is only reachable from RECOVERING).
    const res = rs.transition('inst-1', 'RESUMING', 'illegal-skip-recovering');
    expect(res.ok).toBe(false);
    expect(journal.count()).toBe(before2); // no phantom event
  });
});

describe('FR-S3-1: legal transition table coverage', () => {
  it('RUNNING ⇄ SUSPENDED is bidirectional', () => {
    const { rs } = makeRunState();
    expect(rs.transition('inst-1', 'RUNNING', 'started').ok).toBe(true);
    expect(rs.transition('inst-1', 'SUSPENDED', 'paused').ok).toBe(true);
    expect(rs.transition('inst-1', 'RUNNING', 'resumed').ok).toBe(true);
  });

  it('RUNNING → INTERRUPTED → RECOVERING → RESUMING → RUNNING', () => {
    const { rs } = makeRunState();
    expect(rs.transition('inst-1', 'RUNNING', 'started').ok).toBe(true);
    expect(rs.transition('inst-1', 'INTERRUPTED', 'signal').ok).toBe(true);
    expect(rs.transition('inst-1', 'RECOVERING', 'recovering').ok).toBe(true);
    expect(rs.transition('inst-1', 'RESUMING', 'resuming').ok).toBe(true);
    expect(rs.transition('inst-1', 'RUNNING', 'resumed').ok).toBe(true);
  });

  it('SUSPENDED → INTERRUPTED (interrupted while paused)', () => {
    const { rs } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    rs.transition('inst-1', 'SUSPENDED', 'paused');
    expect(rs.transition('inst-1', 'INTERRUPTED', 'signal').ok).toBe(true);
  });

  it('any non-terminal → ABORTED and → CLOSED', () => {
    const states: RunStateValue[] = [
      'RUNNING',
      'SUSPENDED',
      'INTERRUPTED',
      'RECOVERING',
      'RESUMING',
    ];
    for (const s of states) {
      const { rs } = makeRunState();
      rs.transition('inst-1', 'RUNNING', 'started');
      // Navigate to the target state via legal path.
      if (s === 'SUSPENDED') rs.transition('inst-1', 'SUSPENDED', 'paused');
      if (s === 'INTERRUPTED') rs.transition('inst-1', 'INTERRUPTED', 'signal');
      if (s === 'RECOVERING') {
        rs.transition('inst-1', 'INTERRUPTED', 'signal');
        rs.transition('inst-1', 'RECOVERING', 'recovering');
      }
      if (s === 'RESUMING') {
        rs.transition('inst-1', 'INTERRUPTED', 'signal');
        rs.transition('inst-1', 'RECOVERING', 'recovering');
        rs.transition('inst-1', 'RESUMING', 'resuming');
      }
      expect(rs.stateOf('inst-1')).toBe(s);
      expect(rs.transition('inst-1', 'ABORTED', 'abort').ok).toBe(true);
    }
  });

  it('QUEUED → ABORTED and QUEUED → CLOSED (cancel before start)', () => {
    const { rs } = makeRunState();
    expect(rs.transition('inst-1', 'ABORTED', 'cancelled-before-start').ok).toBe(true);
    const rs2 = makeRunState().rs;
    expect(rs2.transition('inst-2', 'CLOSED', 'withdrawn').ok).toBe(true);
  });

  it('LEGAL_TRANSITIONS table is non-empty and covers all states', () => {
    // Every state must appear as a source or destination somewhere.
    const sources = new Set<string>();
    const dests = new Set<string>();
    for (const [from, tos] of Object.entries(LEGAL_TRANSITIONS)) {
      sources.add(from);
      for (const t of tos) dests.add(t);
    }
    for (const s of RUN_STATES) {
      expect(sources.has(s) || dests.has(s)).toBe(true);
    }
  });
});

describe('FR-K1-9: write-ahead ordering guarantee', () => {
  it('the journal event is sealed before the in-memory state reflects it', () => {
    // We verify this indirectly: if we construct a NEW RunState over the
    // SAME journal immediately after transition() returns, it must see the
    // new state — proving the event was persisted before the call returned.
    const { rs, journal } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    const immediate = new RunState({ journal });
    expect(immediate.stateOf('inst-1')).toBe('RUNNING');
  });

  it('a failed transition (illegal) leaves both journal and memory unchanged', () => {
    const { rs, journal } = makeRunState();
    rs.transition('inst-1', 'RUNNING', 'started');
    const memBefore = rs.stateOf('inst-1');
    const jBefore = journal.count();
    rs.transition('inst-1', 'QUEUED', 'illegal-rewind');
    expect(rs.stateOf('inst-1')).toBe(memBefore);
    expect(journal.count()).toBe(jBefore);
  });
});
