/**
 * K-S4 Scope-bleed guard tests — FR-S4-12, with provocation tests (C-07).
 *
 * T-BLEED-1 (scope-bleed blocked): a private→shared scope promotion without
 *   passing the lifecycle gate is blocked and recorded (FR-S4-12, P67).
 *
 * Also covers the cross-scope anti-bleed rule: a broader-scope consumer SHALL
 * NOT see a narrower private claim (FR-S4-12).
 *
 * @forge-trace {"component_id":"test-kernel-scope-bleed","problems":["P67","P65"],"heritage":["E01","K08"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { EventJournal } from '../../src/kernel/event-journal.js';
import { ScopeBleedGuard, scopeEqual, type ScopedClaim } from '../../src/kernel/scope-bleed.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';

const BLEED_KINDS = ['scope.promotion', 'journal.append_rejected'];

function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: BLEED_KINDS,
  });
}

type TestClaim = ScopedClaim;

function makeClaim(over: Partial<TestClaim> & { claimId: string }): TestClaim {
  return {
    claimId: over.claimId,
    statement: over.statement ?? 'test',
    scope: over.scope ?? 'task',
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
    visibility: over.visibility,
  };
}

// ---------------------------------------------------------------------------
// T-BLEED-1: private→shared scope promotion blocked without lifecycle gate
// ---------------------------------------------------------------------------

describe('T-BLEED-1: private→shared promotion blocked without lifecycle gate (FR-S4-12)', () => {
  it('a private→shared promotion WITHOUT a passed gate is blocked', () => {
    const guard = new ScopeBleedGuard();
    const claim = makeClaim({ claimId: 'cg-priv', scope: 'task', visibility: 'private' });

    const result = guard.promoteScope(claim, 'project', false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('lifecycle gate');
      expect(result.reason).toContain('FR-S4-12');
    }
  });

  it('a private→shared promotion WITH a passed gate succeeds', () => {
    const guard = new ScopeBleedGuard();
    const claim = makeClaim({ claimId: 'cg-priv', scope: 'task', visibility: 'private' });

    const result = guard.promoteScope(claim, 'project', true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.visibility).toBe('shared');
      expect(result.fromScope).toBe('task');
      expect(result.toScope).toBe('project');
    }
  });

  it('a blocked promotion is recorded (journal scope.promotion with passed=false)', () => {
    const journal = makeJournal();
    const guard = new ScopeBleedGuard({ journal });
    const claim = makeClaim({ claimId: 'cg-rec', scope: 'task', visibility: 'private' });

    guard.promoteScope(claim, 'project', false);

    const events = journal.all();
    const promotionEvents = events.filter((e) => e.kind === 'scope.promotion');
    expect(promotionEvents).toHaveLength(1);
    const payload = promotionEvents[0].payload as { passed: boolean; reason: string };
    expect(payload.passed).toBe(false);
    expect(payload.reason).toContain('gate not passed');
  });

  it('a successful promotion is recorded (journal scope.promotion with passed=true)', () => {
    const journal = makeJournal();
    const guard = new ScopeBleedGuard({ journal });
    const claim = makeClaim({ claimId: 'cg-rec-ok', scope: 'task', visibility: 'private' });

    guard.promoteScope(claim, 'project', true);

    const events = journal.all();
    const promotionEvents = events.filter((e) => e.kind === 'scope.promotion');
    expect(promotionEvents).toHaveLength(1);
    const payload = promotionEvents[0].payload as { passed: boolean };
    expect(payload.passed).toBe(true);
  });

  it('promoting an already-shared claim is idempotent (success, no gate required)', () => {
    const guard = new ScopeBleedGuard();
    const claim = makeClaim({ claimId: 'cg-shared', scope: 'task', visibility: 'shared' });

    // Already shared — gate not required (idempotent).
    const result = guard.promoteScope(claim, 'project', false);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.visibility).toBe('shared');
    }
  });

  it('a claim with no visibility field defaults to private and requires the gate', () => {
    const guard = new ScopeBleedGuard();
    const claim = makeClaim({ claimId: 'cg-novis' });
    // visibility undefined → defaults to private

    const result = guard.promoteScope(claim, 'project', false);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-scope anti-bleed (FR-S4-12)
// ---------------------------------------------------------------------------

describe('Cross-scope anti-bleed: broader consumer cannot read narrower private claim (FR-S4-12)', () => {
  it('a global-scope consumer CANNOT read a task-scope private claim', () => {
    const guard = new ScopeBleedGuard();
    expect(guard.canRead('task', 'private', 'global')).toBe(false);
  });

  it('an org-scope consumer CANNOT read a project-scope private claim', () => {
    const guard = new ScopeBleedGuard();
    expect(guard.canRead('project', 'private', 'org')).toBe(false);
  });

  it('a same-scope consumer CAN read a private claim', () => {
    const guard = new ScopeBleedGuard();
    expect(guard.canRead('task', 'private', 'task')).toBe(true);
    expect(guard.canRead('project', 'private', 'project')).toBe(true);
  });

  it('a broader-scope consumer CAN read a shared (promoted) claim', () => {
    const guard = new ScopeBleedGuard();
    expect(guard.canRead('task', 'shared', 'global')).toBe(true);
    expect(guard.canRead('project', 'shared', 'org')).toBe(true);
  });

  it('a narrower-scope consumer CAN read a broader claim (consumer is inside)', () => {
    const guard = new ScopeBleedGuard();
    // A task-scope consumer reading a global-scope claim — allowed regardless.
    expect(guard.canRead('global', 'private', 'task')).toBe(true);
  });

  it('anti-bleed is case-insensitive on scope', () => {
    const guard = new ScopeBleedGuard();
    // 'Task' vs 'Global' (case-insensitive) — still blocked for private.
    expect(guard.canRead('Task', 'private', 'Global')).toBe(false);
    expect(guard.canRead('TASK', 'private', 'TASK')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scopeEqual helper
// ---------------------------------------------------------------------------

describe('scopeEqual helper', () => {
  it('compares scopes case-insensitively', () => {
    expect(scopeEqual('task', 'task')).toBe(true);
    expect(scopeEqual('Task', 'task')).toBe(true);
    expect(scopeEqual('TASK', 'task')).toBe(true);
    expect(scopeEqual('task', 'project')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('ScopeBleedGuard edge cases', () => {
  it('canRead with custom/unknown scopes: different scopes block private reads', () => {
    const guard = new ScopeBleedGuard();
    // Unknown scopes that are not equal → private is blocked.
    expect(guard.canRead('team-alpha', 'private', 'team-beta')).toBe(false);
    expect(guard.canRead('team-alpha', 'shared', 'team-beta')).toBe(true);
    expect(guard.canRead('team-alpha', 'private', 'team-alpha')).toBe(true);
  });

  it('a second private→shared promotion after the first still records an event', () => {
    const journal = makeJournal();
    const guard = new ScopeBleedGuard({ journal });
    const claim = makeClaim({ claimId: 'cg-double', scope: 'task', visibility: 'private' });

    guard.promoteScope(claim, 'project', true);
    // promote again (now shared) — idempotent, but still journals.
    const shared = makeClaim({ claimId: 'cg-double', scope: 'task', visibility: 'shared' });
    guard.promoteScope(shared, 'project', false);

    const events = journal.all().filter((e) => e.kind === 'scope.promotion');
    expect(events).toHaveLength(2);
  });
});
