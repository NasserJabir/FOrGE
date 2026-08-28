/**
 * K-5 lifecycle tests — FR-K5-2/3/4/5/7, NFR-8, with provocation tests (C-07).
 *
 * T-AUTH-1: authority-escalation via derivation — an identity with
 *   authorityClass = OBSERVER and a SpawnContract granting COMMITTER results in
 *   effective authority OBSERVER (intersection), NOT COMMITTER (INV-2, NFR-8).
 * T-AUTH-2: can_commit defaults false — a SpawnContract without explicit
 *   can_commit: true does not authorize commits.
 * T-GRANT-1: a ContextGrant with scope: 'write' is rejected (FR-K5-5:
 *   read-only/read-comment, never write).
 * T-GRANT-2: a ContextGrant without a reason is rejected.
 * T-ADOPT-1: an instance entering the Adoption Queue is NOT auto-adopted, NOT
 *   auto-trusted, and NOT silently destroyed.
 * T-ROUTE-1: routing surfaces known_limitations BEFORE capability claims (INV-6).
 *
 * @forge-trace {"component_id":"test-lifecycle","problems":["P09","P90"],"heritage":["K05","INV-2","INV-6","INV-7"],"decisions":["DEC-02","DEC-03","DEC-32","DEC-33"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { AdoptionQueue } from '../../src/kernel/adoption-queue.js';
import { AUTHORITY_CLASSES } from '../../src/kernel/agent-registry.js';
import {
  ContextGrantStore,
  CONTEXT_GRANT_KIND,
  CONTEXT_REVOKE_KIND,
  type ContextGrantInput,
} from '../../src/kernel/context-grant.js';
import { ContractStore } from '../../src/kernel/contract-store.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import { route, type RoutingCandidate } from '../../src/kernel/routing.js';
import {
  SpawnContractEnforcer,
  SPAWN_CONTRACT_KIND,
  type SpawnContractInput,
  effectiveAuthority,
} from '../../src/kernel/spawn-contract.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';

import type { AgentIdentity } from '../../src/kernel/agent-registry.js';

// --- helpers ---------------------------------------------------------------

/** Build a journal with all P2 lifecycle event kinds registered. */
function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: [
      SPAWN_CONTRACT_KIND,
      CONTEXT_GRANT_KIND,
      CONTEXT_REVOKE_KIND,
      'adoption.queued',
      'adoption.adopted',
      'journal.append_rejected',
    ],
  });
}

/** Build a valid AgentIdentity with sensible defaults. */
function makeIdentity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    identityId: 'agent-1',
    privateMemoryNs: 'agent-1/private',
    privateSkills: [],
    experienceLedger: [],
    capabilityMatrix: [{ domain: 'typescript', level: 'L3', certifiedBy: ['owner'] }],
    knownLimitations: ['cannot access network'],
    authorityClass: 'EXECUTOR',
    evolutionBoundary: { mayLearnIn: ['project'], mayTouchShared: false, maySpawnAgents: false },
    confidenceModel: { default: 0.5 },
    ...over,
  };
}

/** Build a minimal valid SpawnContractInput. */
function makeSpawnInput(over: Partial<SpawnContractInput> = {}): SpawnContractInput {
  return {
    identityId: 'agent-1',
    taskId: 'task-001',
    grantedAuthority: 'EXECUTOR',
    canCommit: false,
    contextGrants: [],
    createdBy: 'owner@forge',
    ...over,
  };
}

/** Build a minimal valid ContextGrantInput. */
function makeGrantInput(over: Partial<ContextGrantInput> = {}): ContextGrantInput {
  return {
    granter: 'owner@forge',
    grantee: 'agent-1',
    items: ['src/kernel/canonical-json.ts'],
    scope: 'read-only',
    reason: 'Code review for task-001.',
    ...over,
  };
}

// --- T-AUTH-1: authority escalation via derivation -------------------------

describe('T-AUTH-1 PROVOCATION: authority escalation via SpawnContract is impossible (INV-2, NFR-8)', () => {
  it('an OBSERVER identity with a COMMITTER-granting contract gets effective authority OBSERVER, NOT COMMITTER', () => {
    const identity = makeIdentity({ identityId: 'obs-1', authorityClass: 'OBSERVER' });
    const contract = makeSpawnInput({
      identityId: 'obs-1',
      grantedAuthority: 'COMMITTER',
    });
    // effectiveAuthority = Identity ∩ Contract = OBSERVER ∩ COMMITTER = OBSERVER.
    const effective = effectiveAuthority(identity, contract);
    expect(effective).toBe('OBSERVER');
    expect(effective).not.toBe('COMMITTER');
  });

  it('an EXECUTOR identity with an APPROVER-granting contract gets EXECUTOR, NOT APPROVER', () => {
    const identity = makeIdentity({ identityId: 'exec-1', authorityClass: 'EXECUTOR' });
    const contract = makeSpawnInput({
      identityId: 'exec-1',
      grantedAuthority: 'APPROVER',
    });
    const effective = effectiveAuthority(identity, contract);
    expect(effective).toBe('EXECUTOR');
    expect(effective).not.toBe('APPROVER');
  });

  it('a COMMITTER identity with a COMMITTER-granting contract gets COMMITTER (intersection = same)', () => {
    const identity = makeIdentity({ identityId: 'com-1', authorityClass: 'COMMITTER' });
    const contract = makeSpawnInput({
      identityId: 'com-1',
      grantedAuthority: 'COMMITTER',
    });
    const effective = effectiveAuthority(identity, contract);
    expect(effective).toBe('COMMITTER');
  });

  it('the effective authority is always one of the four declared classes', () => {
    for (const idAuth of [...AUTHORITY_CLASSES]) {
      for (const cAuth of [...AUTHORITY_CLASSES]) {
        const identity = makeIdentity({ identityId: `id-${idAuth}`, authorityClass: idAuth });
        const contract = makeSpawnInput({
          identityId: `id-${idAuth}`,
          grantedAuthority: cAuth,
        });
        const effective = effectiveAuthority(identity, contract);
        expect((AUTHORITY_CLASSES as readonly string[]).includes(effective)).toBe(true);
      }
    }
  });
});

// --- T-AUTH-2: can_commit defaults false -----------------------------------

describe('T-AUTH-2 PROVOCATION: can_commit defaults false (FR-K5-3)', () => {
  it('a SpawnContract without explicit can_commit: true does not authorize commits', () => {
    const contract = makeSpawnInput({ canCommit: false });
    expect(contract.canCommit).toBe(false);
    // The enforcer must not authorize commits when canCommit is false.
    const enforcer = new SpawnContractEnforcer({ journal: makeJournal() });
    const res = enforcer.enforce(contract);
    expect(res.canCommit).toBe(false);
  });

  it('a SpawnContract with can_commit: true DOES authorize commits', () => {
    const contract = makeSpawnInput({ canCommit: true });
    const enforcer = new SpawnContractEnforcer({ journal: makeJournal() });
    const res = enforcer.enforce(contract);
    expect(res.canCommit).toBe(true);
  });

  it('the factory createSpawnContract defaults canCommit to false when omitted', () => {
    const store = new ContractStore();
    const artifact = store.createSpawnContract({
      identityId: 'agent-1',
      taskId: 'task-001',
      grantedAuthority: 'EXECUTOR',
      contextGrants: [],
      createdBy: 'owner@forge',
      // canCommit intentionally omitted — must default to false.
    });
    expect(artifact.frontmatter.artifactType).toBe('SpawnContract');
    // The body must reflect can_commit: false.
    expect(artifact.body).toContain('can_commit: false');
  });
});

// --- T-GRANT-1: scope 'write' rejected ------------------------------------

describe('T-GRANT-1 PROVOCATION: ContextGrant with scope "write" is rejected (FR-K5-5)', () => {
  it('rejects a ContextGrant with scope: "write"', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const res = store.grant(makeGrantInput({ scope: 'write' as 'read-only' }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('scope');
    }
  });

  it('accepts a ContextGrant with scope: "read-only"', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const res = store.grant(makeGrantInput({ scope: 'read-only' }));
    expect(res.ok).toBe(true);
  });

  it('accepts a ContextGrant with scope: "read-comment"', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const res = store.grant(makeGrantInput({ scope: 'read-comment' }));
    expect(res.ok).toBe(true);
  });

  it('rejects a ContextGrant with an arbitrary scope string', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const res = store.grant(makeGrantInput({ scope: 'admin' as 'read-only' }));
    expect(res.ok).toBe(false);
  });
});

// --- T-GRANT-2: reason required -------------------------------------------

describe('T-GRANT-2 PROVOCATION: ContextGrant without a reason is rejected (FR-K5-5)', () => {
  it('rejects a ContextGrant with an empty reason', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const res = store.grant(makeGrantInput({ reason: '' }));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('reason');
    }
  });

  it('accepts a ContextGrant with a non-empty reason', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const res = store.grant(makeGrantInput({ reason: 'Audit review for task-002.' }));
    expect(res.ok).toBe(true);
  });

  it('a granted ContextGrant journals a context.grant event', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const before = journal.count();
    store.grant(makeGrantInput());
    const after = journal.count();
    expect(after).toBe(before + 1);
    const events = journal.all().filter((e) => e.kind === CONTEXT_GRANT_KIND);
    expect(events).toHaveLength(1);
  });

  it('revoking a grant journals a context.revoke event', () => {
    const journal = makeJournal();
    const store = new ContextGrantStore({ journal });
    const grantRes = store.grant(makeGrantInput());
    if (!grantRes.ok) throw new Error('grant should have succeeded');
    const before = journal.count();
    store.revoke({
      grantId: grantRes.grantId,
      revokedBy: 'owner@forge',
      reason: 'review complete',
    });
    const events = journal.all().filter((e) => e.kind === CONTEXT_REVOKE_KIND);
    expect(events).toHaveLength(1);
    expect(journal.count()).toBe(before + 1);
  });
});

// --- T-ADOPT-1: no auto-adopt ----------------------------------------------

describe('T-ADOPT-1 PROVOCATION: unmanaged spawns are NOT auto-adopted/trusted/destroyed (FR-K5-7)', () => {
  it('an instance entering the Adoption Queue is NOT auto-adopted', () => {
    const journal = makeJournal();
    const queue = new AdoptionQueue({ journal });
    const res = queue.enqueue({
      instanceId: 'inst-1',
      source: 'unmanaged-spawn',
      observedAt: new Date().toISOString(),
    });
    expect(res.ok).toBe(true);
    // The queue must have the candidate pending — NOT adopted.
    const candidates = queue.listCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.adopted).toBe(false);
  });

  it('an instance entering the Adoption Queue is NOT auto-trusted', () => {
    const journal = makeJournal();
    const queue = new AdoptionQueue({ journal });
    queue.enqueue({
      instanceId: 'inst-2',
      source: 'unmanaged-spawn',
      observedAt: new Date().toISOString(),
    });
    const candidates = queue.listCandidates();
    // A pending candidate must not carry a trust label.
    expect(candidates[0]!.trusted).toBe(false);
  });

  it('an instance entering the Adoption Queue is NOT silently destroyed', () => {
    const journal = makeJournal();
    const queue = new AdoptionQueue({ journal });
    queue.enqueue({
      instanceId: 'inst-3',
      source: 'unmanaged-spawn',
      observedAt: new Date().toISOString(),
    });
    // The candidate must still be present after enqueue — not destroyed.
    const candidates = queue.listCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.instanceId).toBe('inst-3');
  });

  it('adoption requires an explicit manual call with adopter and reason', () => {
    const journal = makeJournal();
    const queue = new AdoptionQueue({ journal });
    queue.enqueue({
      instanceId: 'inst-4',
      source: 'unmanaged-spawn',
      observedAt: new Date().toISOString(),
    });
    // No auto-adopt: the candidate is still pending.
    expect(queue.listCandidates().filter((c) => c.adopted)).toHaveLength(0);
    // Manual adopt with explicit adopter and reason.
    const res = queue.adopt({
      instanceId: 'inst-4',
      adoptedBy: 'owner@forge',
      reason: 'Manual adoption after review.',
    });
    expect(res.ok).toBe(true);
    // After adoption, the candidate is marked adopted.
    const candidates = queue.listCandidates();
    const adopted = candidates.find((c) => c.instanceId === 'inst-4');
    expect(adopted?.adopted).toBe(true);
  });

  it('enqueue journals an adoption.queued event', () => {
    const journal = makeJournal();
    const queue = new AdoptionQueue({ journal });
    queue.enqueue({
      instanceId: 'inst-5',
      source: 'unmanaged-spawn',
      observedAt: new Date().toISOString(),
    });
    const events = journal.all().filter((e) => e.kind === 'adoption.queued');
    expect(events).toHaveLength(1);
  });

  it('adopt journals an adoption.adopted event', () => {
    const journal = makeJournal();
    const queue = new AdoptionQueue({ journal });
    queue.enqueue({
      instanceId: 'inst-6',
      source: 'unmanaged-spawn',
      observedAt: new Date().toISOString(),
    });
    queue.adopt({
      instanceId: 'inst-6',
      adoptedBy: 'owner@forge',
      reason: 'Reviewed and approved.',
    });
    const events = journal.all().filter((e) => e.kind === 'adoption.adopted');
    expect(events).toHaveLength(1);
  });
});

// --- T-ROUTE-1: known_limitations before capability claims -----------------

describe('T-ROUTE-1 PROVOCATION: routing surfaces known_limitations BEFORE capability claims (INV-6)', () => {
  it('a candidate with known_limitations is NOT presented as unlimited', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-lim',
        capabilityMatrix: [{ domain: 'typescript', level: 'L4', certifiedBy: ['owner'] }],
        knownLimitations: ['cannot access network', 'cannot write to shared'],
        authorityClass: 'EXECUTOR',
      },
    ];
    const res = route(candidates, {
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'EXECUTOR',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      // The routing result must surface the limitations — not hide them.
      expect(res.matched.length).toBeGreaterThan(0);
      const match = res.matched[0]!;
      expect(match.knownLimitations).toContain('cannot access network');
      expect(match.knownLimitations).toContain('cannot write to shared');
    }
  });

  it('routing output lists limitations BEFORE capability claims in the summary', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-1',
        capabilityMatrix: [{ domain: 'typescript', level: 'L4', certifiedBy: ['owner'] }],
        knownLimitations: ['no network access'],
        authorityClass: 'EXECUTOR',
      },
    ];
    const res = route(candidates, {
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'EXECUTOR',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const summary = res.summary;
      // The limitations section must appear BEFORE the capabilities section.
      const limIdx = summary.indexOf('Limitations:');
      const capIdx = summary.indexOf('Capabilities:');
      expect(limIdx).toBeGreaterThan(-1);
      expect(capIdx).toBeGreaterThan(-1);
      expect(limIdx).toBeLessThan(capIdx);
    }
  });

  it('a candidate whose capability level is below the required level is not matched', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-low',
        capabilityMatrix: [{ domain: 'typescript', level: 'L1', certifiedBy: ['owner'] }],
        knownLimitations: [],
        authorityClass: 'EXECUTOR',
      },
    ];
    const res = route(candidates, {
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'EXECUTOR',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matched).toHaveLength(0);
    }
  });

  it('a candidate whose authority class is below the required class is not matched', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-obs',
        capabilityMatrix: [{ domain: 'typescript', level: 'L4', certifiedBy: ['owner'] }],
        knownLimitations: [],
        authorityClass: 'OBSERVER',
      },
    ];
    const res = route(candidates, {
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'COMMITTER',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matched).toHaveLength(0);
    }
  });

  it('a candidate matching domain, level, and authority is matched', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-ok',
        capabilityMatrix: [{ domain: 'typescript', level: 'L4', certifiedBy: ['owner'] }],
        knownLimitations: ['no network'],
        authorityClass: 'COMMITTER',
      },
    ];
    const res = route(candidates, {
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'EXECUTOR',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matched).toHaveLength(1);
    }
  });
});

// --- SpawnContract enforcer journals spawn.contract event -----------------

describe('SpawnContractEnforcer: journaling and enforcement (FR-K5-4)', () => {
  it('enforce journals a spawn.contract event with effective authority', () => {
    const journal = makeJournal();
    const enforcer = new SpawnContractEnforcer({ journal });
    const identity = makeIdentity({ identityId: 'agent-enf', authorityClass: 'EXECUTOR' });
    const contract = makeSpawnInput({ identityId: 'agent-enf', grantedAuthority: 'COMMITTER' });
    enforcer.enforce(contract, identity);
    const events = journal.all().filter((e) => e.kind === SPAWN_CONTRACT_KIND);
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload['effectiveAuthority']).toBe('EXECUTOR');
  });

  it('empty context grants mean full privacy (FR-K5-3 last clause)', () => {
    const journal = makeJournal();
    const enforcer = new SpawnContractEnforcer({ journal });
    const contract = makeSpawnInput({ contextGrants: [] });
    const res = enforcer.enforce(contract);
    // No context grants => no shared context exposed => full privacy.
    expect(res.contextGrants).toHaveLength(0);
    expect(res.fullPrivacy).toBe(true);
  });

  it('non-empty context grants mean privacy is reduced', () => {
    const journal = makeJournal();
    const enforcer = new SpawnContractEnforcer({ journal });
    const contract = makeSpawnInput({
      contextGrants: [{ items: ['src/kernel/'], scope: 'read-only' }],
    });
    const res = enforcer.enforce(contract);
    expect(res.contextGrants.length).toBeGreaterThan(0);
    expect(res.fullPrivacy).toBe(false);
  });
});
