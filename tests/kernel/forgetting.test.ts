/**
 * K-S4 Forgetting service tests — FR-S4-13, with provocation tests (C-07).
 *
 * T-FORGET-1 (silent deletion prohibited): an attempt to silently delete a
 *   claim (no tombstone, no archive) is rejected; forgetting must be
 *   policy-driven with a visible tombstone (FR-S4-13, P66).
 *
 * Also covers: reversible auto-archive, per-type decay, use/last-access
 * tracking, visible tombstones for human erasure.
 *
 * @forge-trace {"component_id":"test-kernel-forgetting","problems":["P66","P65","P19"],"heritage":["E01","K08"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { EventJournal } from '../../src/kernel/event-journal.js';
import {
  ForgettingService,
  DECAY_POLICY,
  decayFor,
  hasDecayPolicy,
  isEligibleForArchive,
  type UseRecord,
} from '../../src/kernel/forgetting.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';

import type { Claim } from '../../src/kernel/claim.js';

const FORGET_KINDS = [
  'forget.archived',
  'forget.restored',
  'forget.tombstone',
  'forget.deleted',
  'journal.append_rejected',
];

function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: FORGET_KINDS,
  });
}

function makeClaim(over: Partial<Claim> & { claimId: string }): Claim {
  return {
    claimId: over.claimId,
    statement: over.statement ?? 'test',
    scope: over.scope ?? 'project',
    provenance: over.provenance ?? [{ source: 'alice', ts: '2026-08-29T00:00:00.000Z' }],
    confidence: over.confidence ?? 0.5,
    state: over.state ?? 'supported',
    evidenceRef: over.evidenceRef ?? {
      kind: 'artifact',
      locator: 'tc-1',
      version_hash: 'abc',
      pinned_at: '2026-08-29T00:00:00.000Z',
    },
    trustLabel: over.trustLabel ?? 'tool-output',
    stalenessMode: over.stalenessMode ?? 'deterministic_hash',
    originAgent: over.originAgent ?? 'alice',
    version: over.version ?? 1,
    contentHash: over.contentHash ?? 'dummy',
  };
}

const NOW = '2026-08-29T00:00:00.000Z';
const DAYS_AGO = (days: number): string => {
  const ms = Date.parse(NOW) - days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString();
};

// ---------------------------------------------------------------------------
// T-FORGET-1: silent deletion prohibited (FR-S4-13, P66)
// ---------------------------------------------------------------------------

describe('T-FORGET-1: silent deletion prohibited (FR-S4-13)', () => {
  it('deleteClaim WITHOUT a tombstone is rejected', () => {
    const svc = new ForgettingService();
    const result = svc.deleteClaim('cg-1', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('silent deletion prohibited');
      expect(result.reason).toContain('FR-S4-13');
      expect(result.reason).toContain('tombstone');
    }
  });

  it('deleteClaim WITH a tombstone proceeds', () => {
    const svc = new ForgettingService();
    const result = svc.deleteClaim('cg-1', true);
    expect(result.ok).toBe(true);
  });

  it('a tombstone must be placed before deletion — the tombstone is visible', () => {
    const journal = makeJournal();
    const svc = new ForgettingService({ journal });
    const claim = makeClaim({ claimId: 'cg-erase' });

    // Step 1: place a visible tombstone.
    const tomb = svc.tombstone(claim, 'user requested erasure', 'alice', NOW);
    expect(tomb.ok).toBe(true);
    if (tomb.ok) {
      expect(tomb.tombstone.claimId).toBe('cg-erase');
      expect(tomb.tombstone.erasedBy).toBe('alice');
      expect(tomb.tombstone.reason).toContain('erasure');
    }

    // Step 2: now deletion is allowed (tombstone exists).
    const del = svc.deleteClaim('cg-erase', true);
    expect(del.ok).toBe(true);

    // The tombstone event is journaled and visible.
    const events = journal.all();
    const tombEvents = events.filter((e) => e.kind === 'forget.tombstone');
    expect(tombEvents).toHaveLength(1);
    const delEvents = events.filter((e) => e.kind === 'forget.deleted');
    expect(delEvents).toHaveLength(1);
  });

  it('a tombstone requires a non-empty reason (no silent erasure)', () => {
    const svc = new ForgettingService();
    const claim = makeClaim({ claimId: 'cg-x' });
    const result = svc.tombstone(claim, '', 'alice', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('reason');
    }
  });

  it('a tombstone requires an erasedBy actor (attribution)', () => {
    const svc = new ForgettingService();
    const claim = makeClaim({ claimId: 'cg-y' });
    const result = svc.tombstone(claim, 'erasure', '', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('erasedBy');
    }
  });

  it('the tombstone event is journaled (visible, auditable)', () => {
    const journal = makeJournal();
    const svc = new ForgettingService({ journal });
    const claim = makeClaim({ claimId: 'cg-auditable' });

    svc.tombstone(claim, 'gdpr erasure', 'alice', NOW);

    const events = journal.all().filter((e) => e.kind === 'forget.tombstone');
    expect(events).toHaveLength(1);
    const payload = events[0].payload as { claimId: string; reason: string; erasedBy: string };
    expect(payload.claimId).toBe('cg-auditable');
    expect(payload.erasedBy).toBe('alice');
  });
});

// ---------------------------------------------------------------------------
// Reversible auto-archive (FR-S4-13)
// ---------------------------------------------------------------------------

describe('Reversible auto-archive (FR-S4-13)', () => {
  it('archive() records a reversible archive with a reason', () => {
    const journal = makeJournal();
    const svc = new ForgettingService({ journal });
    const claim = makeClaim({ claimId: 'cg-arch' });

    const result = svc.archive(claim, 'stale, no access for 200 days', NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.reversible).toBe(true);
      expect(result.record.claimId).toBe('cg-arch');
      expect(result.record.reason).toContain('stale');
    }
  });

  it('archive() journals forget.archived', () => {
    const journal = makeJournal();
    const svc = new ForgettingService({ journal });
    const claim = makeClaim({ claimId: 'cg-arch2' });

    svc.archive(claim, 'decay', NOW);

    const events = journal.all().filter((e) => e.kind === 'forget.archived');
    expect(events).toHaveLength(1);
  });

  it('archive() requires a non-empty reason', () => {
    const svc = new ForgettingService();
    const claim = makeClaim({ claimId: 'cg-arch3' });

    const result = svc.archive(claim, '', NOW);
    expect(result.ok).toBe(false);
  });

  it('restore() reverses an archive and journals forget.restored', () => {
    const journal = makeJournal();
    const svc = new ForgettingService({ journal });

    const result = svc.restore('cg-arch', 're-validated');
    expect(result.ok).toBe(true);

    const events = journal.all().filter((e) => e.kind === 'forget.restored');
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Per-type decay policy (FR-S4-13)
// ---------------------------------------------------------------------------

describe('Per-type decay policy (FR-S4-13)', () => {
  it('Constraint never decays (null) — structural invariant', () => {
    expect(DECAY_POLICY.Constraint).toBeNull();
    expect(decayFor('Constraint')).toBeNull();
  });

  it('Skill never auto-archived (own lifecycle, FR-S4-10)', () => {
    expect(DECAY_POLICY.Skill).toBeNull();
    expect(decayFor('Skill')).toBeNull();
  });

  it('Decision has the longest decay (365 days)', () => {
    expect(DECAY_POLICY.Decision).toBe(365);
  });

  it('Preference has short decay (60 days)', () => {
    expect(DECAY_POLICY.Preference).toBe(60);
  });

  it('Environmental has shorter decay than Fact', () => {
    expect(DECAY_POLICY.Environmental!).toBeLessThan(DECAY_POLICY.Fact!);
  });

  it('decayFor returns null for unknown types', () => {
    expect(decayFor('Rule')).toBeNull();
    expect(decayFor('')).toBeNull();
  });

  it('hasDecayPolicy: true for the eight types, false for invalid', () => {
    expect(hasDecayPolicy('Constraint')).toBe(true);
    expect(hasDecayPolicy('Assumption')).toBe(true);
    expect(hasDecayPolicy('Skill')).toBe(true);
    expect(hasDecayPolicy('Rule')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Use/last-access tracking + archive eligibility (FR-S4-13)
// ---------------------------------------------------------------------------

describe('Use/last-access tracking + archive eligibility (FR-S4-13)', () => {
  it('a Fact last accessed 200 days ago is eligible (decay=180)', () => {
    const use: UseRecord = {
      claimId: 'cg-fact',
      lastAccessedAt: DAYS_AGO(200),
      accessCount: 3,
    };
    expect(isEligibleForArchive('Fact', use, NOW)).toBe(true);
  });

  it('a Fact last accessed 100 days ago is NOT eligible (decay=180)', () => {
    const use: UseRecord = {
      claimId: 'cg-fact',
      lastAccessedAt: DAYS_AGO(100),
      accessCount: 3,
    };
    expect(isEligibleForArchive('Fact', use, NOW)).toBe(false);
  });

  it('a Constraint is never eligible regardless of last access', () => {
    const use: UseRecord = {
      claimId: 'cg-constraint',
      lastAccessedAt: DAYS_AGO(10000),
      accessCount: 0,
    };
    expect(isEligibleForArchive('Constraint', use, NOW)).toBe(false);
  });

  it('a Skill is never eligible (own lifecycle)', () => {
    const use: UseRecord = {
      claimId: 'cg-skill',
      lastAccessedAt: DAYS_AGO(10000),
      accessCount: 0,
    };
    expect(isEligibleForArchive('Skill', use, NOW)).toBe(false);
  });

  it('an Assumption last accessed 40 days ago is eligible (decay=30)', () => {
    const use: UseRecord = {
      claimId: 'cg-assump',
      lastAccessedAt: DAYS_AGO(40),
      accessCount: 1,
    };
    expect(isEligibleForArchive('Assumption', use, NOW)).toBe(true);
  });

  it('returns false for invalid timestamps', () => {
    const use: UseRecord = {
      claimId: 'cg-bad',
      lastAccessedAt: 'not-a-date',
      accessCount: 0,
    };
    expect(isEligibleForArchive('Fact', use, NOW)).toBe(false);
  });

  it('returns false for an unknown knowledge type', () => {
    const use: UseRecord = {
      claimId: 'cg-unknown',
      lastAccessedAt: DAYS_AGO(10000),
      accessCount: 0,
    };
    expect(isEligibleForArchive('Rule', use, NOW)).toBe(false);
  });
});
