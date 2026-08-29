/**
 * K-S4 Conflict resolver tests — FR-S4-11, with provocation tests (C-07).
 *
 * T-CONFLICT-1 (newer-wins-without-supersession rejected): two conflicting
 *   claims where the newer one lacks explicit supersession of the older ⇒
 *   `conflict_pending`, NOT silent newer-wins (FR-S4-11, P65).
 * T-CONFLICT-2 (narrowest scope wins): a Task-scope claim overrides a
 *   Global-scope claim at conflict when authorities are equal and no
 *   supersession — narrowest scope wins (`Global ⊂ Org ⊂ Project ⊂ Task`)
 *   (FR-S4-11).
 *
 * @forge-trace {"component_id":"test-kernel-conflict-resolver","problems":["P65","P67"],"heritage":["E01","K08"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { resolve, scopeRank, SCOPE_ORDER } from '../../src/kernel/conflict-resolver.js';

import type { Claim } from '../../src/kernel/claim.js';

// ---------------------------------------------------------------------------
// Helpers: build minimal claims for conflict resolution
// ---------------------------------------------------------------------------

type ConflictClaim = Claim & { knowledgeType?: string };

function makeClaim(over: Partial<ConflictClaim> & { claimId: string }): ConflictClaim {
  return {
    claimId: over.claimId,
    statement: over.statement ?? 'test statement',
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
    contentHash: over.contentHash ?? 'dummy-hash',
    knowledgeType: over.knowledgeType,
    supersedes: over.supersedes,
  };
}

// ---------------------------------------------------------------------------
// Scope hierarchy
// ---------------------------------------------------------------------------

describe('Scope hierarchy (FR-S4-11: Global ⊂ Org ⊂ Project ⊂ Task)', () => {
  it('ranks the four scopes from broadest (Global=3) to narrowest (Task=0)', () => {
    expect(SCOPE_ORDER.task).toBe(0);
    expect(SCOPE_ORDER.project).toBe(1);
    expect(SCOPE_ORDER.org).toBe(2);
    expect(SCOPE_ORDER.global).toBe(3);
  });

  it('scopeRank is case-insensitive', () => {
    expect(scopeRank('Task')).toBe(0);
    expect(scopeRank('TASK')).toBe(0);
    expect(scopeRank('Global')).toBe(3);
    expect(scopeRank('GLOBAL')).toBe(3);
  });

  it('scopeRank returns null for unknown scopes', () => {
    expect(scopeRank('team')).toBeNull();
    expect(scopeRank('')).toBeNull();
    expect(scopeRank('sprint')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-CONFLICT-1: newer-wins-without-supersession rejected (FR-S4-11, P65)
// ---------------------------------------------------------------------------

describe('T-CONFLICT-1: newer-wins-without-supersession ⇒ conflict_pending (FR-S4-11)', () => {
  it('two equal-authority, equal-scope claims with no supersession ⇒ conflict_pending', () => {
    const claimA = makeClaim({
      claimId: 'cg-a',
      scope: 'project',
      knowledgeType: 'Fact',
    });
    const claimB = makeClaim({
      claimId: 'cg-b',
      scope: 'project',
      knowledgeType: 'Fact',
    });

    const result = resolve({ claimA, claimB });
    // FR-S4-11: newer-wins without supersession SHALL be rejected.
    expect(result.kind).toBe('pending');
    if (result.kind === 'pending') {
      expect(result.reason).toContain('conflict_pending');
    }
  });

  it('does NOT silently pick the newer claim (B) when there is no supersession', () => {
    const claimA = makeClaim({
      claimId: 'cg-old',
      scope: 'task',
      knowledgeType: 'Decision',
    });
    const claimB = makeClaim({
      claimId: 'cg-new',
      scope: 'task',
      knowledgeType: 'Decision',
      // newer but NO supersedes field pointing at claimA
    });

    const result = resolve({ claimA, claimB });
    // The resolver must NOT return winner='B' just because B is newer.
    expect(result.kind).toBe('pending');
  });

  it('a newer claim (B) WITH explicit supersession of A ⇒ B wins', () => {
    const claimA = makeClaim({
      claimId: 'cg-old',
      scope: 'project',
      knowledgeType: 'Fact',
    });
    const claimB = makeClaim({
      claimId: 'cg-new',
      scope: 'project',
      knowledgeType: 'Fact',
      supersedes: { claimId: 'cg-old', reason: 'newer evidence supersedes older fact' },
    });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.winner).toBe('B');
      expect(result.reason).toContain('supersession');
    }
  });

  it('conflict_pending when authority is equal, scope is equal, no supersession', () => {
    const claimA = makeClaim({
      claimId: 'cg-a',
      scope: 'org',
      knowledgeType: 'Heuristic',
    });
    const claimB = makeClaim({
      claimId: 'cg-b',
      scope: 'org',
      knowledgeType: 'Heuristic',
    });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('pending');
    if (result.kind === 'pending') {
      expect(result.reason).toContain('equal authority');
      expect(result.reason).toContain('equal scope');
    }
  });
});

// ---------------------------------------------------------------------------
// T-CONFLICT-2: narrowest scope wins (FR-S4-11)
// ---------------------------------------------------------------------------

describe('T-CONFLICT-2: narrowest scope wins (FR-S4-11)', () => {
  it('a Task-scope claim overrides a Global-scope claim at equal authority', () => {
    const claimA = makeClaim({
      claimId: 'cg-global',
      scope: 'global',
      knowledgeType: 'Fact',
    });
    const claimB = makeClaim({
      claimId: 'cg-task',
      scope: 'task',
      knowledgeType: 'Fact',
    });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      // Task (narrower) wins over Global (broader).
      expect(result.winner).toBe('B');
      expect(result.reason).toContain('narrowest scope');
    }
  });

  it('a Project-scope claim overrides an Org-scope claim at equal authority', () => {
    const claimA = makeClaim({
      claimId: 'cg-org',
      scope: 'org',
      knowledgeType: 'Decision',
    });
    const claimB = makeClaim({
      claimId: 'cg-proj',
      scope: 'project',
      knowledgeType: 'Decision',
    });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.winner).toBe('B');
      expect(result.reason).toContain('narrowest scope');
    }
  });

  it('the four scopes form a strict nesting: Global ⊂ Org ⊂ Project ⊂ Task', () => {
    // Task beats Project, Project beats Org, Org beats Global — all at equal authority.
    const pairs: Array<{ aScope: string; bScope: string }> = [
      { aScope: 'global', bScope: 'org' },
      { aScope: 'global', bScope: 'project' },
      { aScope: 'global', bScope: 'task' },
      { aScope: 'org', bScope: 'project' },
      { aScope: 'org', bScope: 'task' },
      { aScope: 'project', bScope: 'task' },
    ];
    for (const { aScope, bScope } of pairs) {
      const claimA = makeClaim({ claimId: `cg-${aScope}`, scope: aScope, knowledgeType: 'Fact' });
      const claimB = makeClaim({ claimId: `cg-${bScope}`, scope: bScope, knowledgeType: 'Fact' });
      const result = resolve({ claimA, claimB });
      expect(result.kind).toBe('resolved');
      if (result.kind === 'resolved') {
        expect(result.winner).toBe('B');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Authority order integration
// ---------------------------------------------------------------------------

describe('Authority order decides before scope (FR-S4-11 step 1)', () => {
  it('higher authority wins even if the other claim has a narrower scope', () => {
    // Constraint (rank 0) at Global scope vs Fact (rank 2) at Task scope.
    // Authority is step 1 (short-circuit) — Constraint wins despite broader scope.
    const claimA = makeClaim({
      claimId: 'cg-constraint-global',
      scope: 'global',
      knowledgeType: 'Constraint',
    });
    const claimB = makeClaim({
      claimId: 'cg-fact-task',
      scope: 'task',
      knowledgeType: 'Fact',
    });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.winner).toBe('A');
      expect(result.reason).toContain('higher authority');
    }
  });

  it('Decision beats Fact at any scope combination', () => {
    const claimA = makeClaim({
      claimId: 'cg-decision',
      scope: 'global',
      knowledgeType: 'Decision',
    });
    const claimB = makeClaim({
      claimId: 'cg-fact',
      scope: 'task',
      knowledgeType: 'Fact',
    });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.winner).toBe('A');
    }
  });
});

// ---------------------------------------------------------------------------
// Supersession integration (step 2)
// ---------------------------------------------------------------------------

describe('Explicit supersession decides after authority (FR-S4-11 step 2)', () => {
  it('explicit supersession wins when authorities are equal', () => {
    const claimA = makeClaim({
      claimId: 'cg-a',
      scope: 'project',
      knowledgeType: 'Fact',
    });
    const claimB = makeClaim({
      claimId: 'cg-b',
      scope: 'project',
      knowledgeType: 'Fact',
      supersedes: { claimId: 'cg-a', reason: 'corrected with new evidence' },
    });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.winner).toBe('B');
      expect(result.reason).toContain('supersession');
    }
  });

  it('supersession must name the voided claim — a supersedes pointing elsewhere does not decide', () => {
    const claimA = makeClaim({
      claimId: 'cg-a',
      scope: 'project',
      knowledgeType: 'Fact',
    });
    const claimB = makeClaim({
      claimId: 'cg-b',
      scope: 'project',
      knowledgeType: 'Fact',
      // supersedes points at a DIFFERENT claim, not claimA
      supersedes: { claimId: 'cg-unrelated', reason: 'voids something else' },
    });

    const result = resolve({ claimA, claimB });
    // Equal authority, equal scope, supersession doesn't name A → pending.
    expect(result.kind).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Conflict resolver edge cases', () => {
  it('returns pending when a knowledge type is unknown', () => {
    const claimA = makeClaim({ claimId: 'cg-a', knowledgeType: 'Rule' });
    const claimB = makeClaim({ claimId: 'cg-b', knowledgeType: 'Fact' });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('pending');
    if (result.kind === 'pending') {
      expect(result.reason).toContain('unknown knowledge type');
    }
  });

  it('returns pending when scopes are unknown', () => {
    const claimA = makeClaim({ claimId: 'cg-a', scope: 'team', knowledgeType: 'Fact' });
    const claimB = makeClaim({ claimId: 'cg-b', scope: 'sprint', knowledgeType: 'Fact' });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('pending');
    if (result.kind === 'pending') {
      expect(result.reason).toContain('unknown scope');
    }
  });

  it('Assumption types (not authority-ordered) fall through to scope', () => {
    const claimA = makeClaim({ claimId: 'cg-a', scope: 'global', knowledgeType: 'Assumption' });
    const claimB = makeClaim({ claimId: 'cg-b', scope: 'task', knowledgeType: 'Assumption' });

    const result = resolve({ claimA, claimB });
    // Assumptions are not authority-ordered → scope decides → Task wins.
    expect(result.kind).toBe('resolved');
    if (result.kind === 'resolved') {
      expect(result.winner).toBe('B');
      expect(result.reason).toContain('narrowest scope');
    }
  });

  it('returns pending when both types are missing', () => {
    const claimA = makeClaim({ claimId: 'cg-a', scope: 'project' });
    const claimB = makeClaim({ claimId: 'cg-b', scope: 'project' });

    const result = resolve({ claimA, claimB });
    expect(result.kind).toBe('pending');
  });
});
