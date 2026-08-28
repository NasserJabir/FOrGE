/**
 * K-5 lifecycle coverage tests — targeting uncovered branches in the P2-5
 * kernel modules to meet NFR-11 (≥90% branches/functions/lines/statements).
 *
 * These tests exercise the error/edge paths that the provocation tests in
 * lifecycle.test.ts intentionally do not cover (the provocation tests focus on
 * the security invariants; these cover the operational fallbacks):
 *   - adoption-queue.ts: duplicate enqueue, adopt not-found, adopt
 *     already-adopted, getCandidate for missing instance.
 *   - context-grant.ts: revoke not-found, revoke already-revoked, activeFor,
 *     get, list.
 *   - routing.ts: invalid level, invalid authority, RoutingEngine.route,
 *     RoutingEngine.addCandidate, candidate missing domain, candidate level
 *     below required.
 *   - contract-store.ts: createSpawnContract with non-empty contextGrants (TTL
 *     branch), createContextGrant with TTL.
 *   - spawn-contract.ts: enforce() without identity (line 102 fallback).
 *
 * @forge-trace {"component_id":"test-lifecycle-coverage","problems":["P09","P90"],"heritage":["K05","INV-2","INV-6","INV-7"],"decisions":["DEC-02","DEC-03","DEC-32","DEC-33"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { AdoptionQueue } from '../../src/kernel/adoption-queue.js';
import { ContextGrantStore } from '../../src/kernel/context-grant.js';
import { ContractStore } from '../../src/kernel/contract-store.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import { RoutingEngine, route, type RoutingCandidate } from '../../src/kernel/routing.js';
import { SpawnContractEnforcer } from '../../src/kernel/spawn-contract.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';

// --- helpers ---------------------------------------------------------------

function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: [
      'spawn.contract',
      'context.grant',
      'context.revoke',
      'adoption.queued',
      'adoption.adopted',
      'journal.append_rejected',
    ],
  });
}

// --- adoption-queue: error/edge paths --------------------------------------

describe('AdoptionQueue: error and edge paths', () => {
  it('rejects a duplicate enqueue of the same instanceId', () => {
    const queue = new AdoptionQueue({ journal: makeJournal() });
    const first = queue.enqueue({
      instanceId: 'dup-1',
      source: 'unmanaged',
      observedAt: new Date().toISOString(),
    });
    expect(first.ok).toBe(true);
    const second = queue.enqueue({
      instanceId: 'dup-1',
      source: 'unmanaged',
      observedAt: new Date().toISOString(),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toContain('already queued');
    }
  });

  it('rejects adoption of an instance not in the queue', () => {
    const queue = new AdoptionQueue({ journal: makeJournal() });
    const res = queue.adopt({
      instanceId: 'ghost-1',
      adoptedBy: 'owner@forge',
      reason: 'trying to adopt a non-existent instance.',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('not in the queue');
    }
  });

  it('rejects adoption of an already-adopted instance', () => {
    const queue = new AdoptionQueue({ journal: makeJournal() });
    queue.enqueue({
      instanceId: 'inst-adopted',
      source: 'unmanaged',
      observedAt: new Date().toISOString(),
    });
    const first = queue.adopt({
      instanceId: 'inst-adopted',
      adoptedBy: 'owner@forge',
      reason: 'first adoption.',
    });
    expect(first.ok).toBe(true);
    const second = queue.adopt({
      instanceId: 'inst-adopted',
      adoptedBy: 'owner@forge',
      reason: 'second adoption attempt.',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toContain('already adopted');
    }
  });

  it('getCandidate returns null for a missing instance', () => {
    const queue = new AdoptionQueue({ journal: makeJournal() });
    expect(queue.getCandidate('no-such-instance')).toBeNull();
  });

  it('getCandidate returns the candidate for an enqueued instance', () => {
    const queue = new AdoptionQueue({ journal: makeJournal() });
    queue.enqueue({
      instanceId: 'inst-found',
      source: 'unmanaged',
      observedAt: new Date().toISOString(),
    });
    const candidate = queue.getCandidate('inst-found');
    expect(candidate).not.toBeNull();
    expect(candidate?.instanceId).toBe('inst-found');
  });
});

// --- context-grant: revoke error paths + read methods ---------------------

describe('ContextGrantStore: revoke error paths and read methods', () => {
  it('rejects revocation of a non-existent grant', () => {
    const store = new ContextGrantStore({ journal: makeJournal() });
    const res = store.revoke({
      grantId: 'cg-nonexistent',
      revokedBy: 'owner@forge',
      reason: 'trying to revoke a non-existent grant.',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('not found');
    }
  });

  it('rejects revocation of an already-revoked grant', () => {
    const store = new ContextGrantStore({ journal: makeJournal() });
    const grantRes = store.grant({
      granter: 'owner@forge',
      grantee: 'agent-1',
      items: ['src/kernel/canonical-json.ts'],
      scope: 'read-only',
      reason: 'Code review.',
    });
    if (!grantRes.ok) throw new Error('grant should have succeeded');
    store.revoke({
      grantId: grantRes.grantId,
      revokedBy: 'owner@forge',
      reason: 'first revocation.',
    });
    const second = store.revoke({
      grantId: grantRes.grantId,
      revokedBy: 'owner@forge',
      reason: 'second revocation attempt.',
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toContain('already revoked');
    }
  });

  it('get returns null for a missing grantId', () => {
    const store = new ContextGrantStore({ journal: makeJournal() });
    expect(store.get('cg-missing')).toBeNull();
  });

  it('get returns the grant for an existing grantId', () => {
    const store = new ContextGrantStore({ journal: makeJournal() });
    const grantRes = store.grant({
      granter: 'owner@forge',
      grantee: 'agent-1',
      items: ['src/lib/ulid.ts'],
      scope: 'read-only',
      reason: 'Review.',
    });
    if (!grantRes.ok) throw new Error('grant should have succeeded');
    const grant = store.get(grantRes.grantId);
    expect(grant).not.toBeNull();
    expect(grant?.grantee).toBe('agent-1');
  });

  it('list returns all grants (active and revoked)', () => {
    const store = new ContextGrantStore({ journal: makeJournal() });
    store.grant({
      granter: 'owner@forge',
      grantee: 'agent-1',
      items: ['a.ts'],
      scope: 'read-only',
      reason: 'r1.',
    });
    const g2 = store.grant({
      granter: 'owner@forge',
      grantee: 'agent-2',
      items: ['b.ts'],
      scope: 'read-comment',
      reason: 'r2.',
    });
    if (!g2.ok) throw new Error('grant should have succeeded');
    store.revoke({
      grantId: g2.grantId,
      revokedBy: 'owner@forge',
      reason: 'done.',
    });
    const all = store.list();
    expect(all).toHaveLength(2);
  });

  it('activeFor returns only non-revoked grants for the grantee', () => {
    const store = new ContextGrantStore({ journal: makeJournal() });
    const g1 = store.grant({
      granter: 'owner@forge',
      grantee: 'agent-x',
      items: ['a.ts'],
      scope: 'read-only',
      reason: 'active grant.',
    });
    if (!g1.ok) throw new Error('grant should have succeeded');
    const g2 = store.grant({
      granter: 'owner@forge',
      grantee: 'agent-x',
      items: ['b.ts'],
      scope: 'read-comment',
      reason: 'will be revoked.',
    });
    if (!g2.ok) throw new Error('grant should have succeeded');
    store.revoke({
      grantId: g2.grantId,
      revokedBy: 'owner@forge',
      reason: 'revoked.',
    });
    // A grant for a different grantee should not appear.
    store.grant({
      granter: 'owner@forge',
      grantee: 'agent-y',
      items: ['c.ts'],
      scope: 'read-only',
      reason: 'other grantee.',
    });
    const active = store.activeFor('agent-x');
    expect(active).toHaveLength(1);
    expect(active[0]?.grantId).toBe(g1.grantId);
  });

  it('accepts a ContextGrant with a TTL', () => {
    const store = new ContextGrantStore({ journal: makeJournal() });
    const res = store.grant({
      granter: 'owner@forge',
      grantee: 'agent-1',
      items: ['src/kernel/'],
      scope: 'read-only',
      ttl: 3600,
      reason: 'Time-limited review.',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.grant.ttl).toBe(3600);
    }
  });
});

// --- routing: invalid requests + RoutingEngine -----------------------------

describe('routing: invalid requests and RoutingEngine', () => {
  it('rejects a request with an unknown capability level', () => {
    const res = route([], {
      domain: 'typescript',
      level: 'L9' as 'L0',
      requiredAuthority: 'EXECUTOR',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('unknown capability level');
    }
  });

  it('rejects a request with an unknown authority class', () => {
    const res = route([], {
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'SUPERUSER' as 'EXECUTOR',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('unknown authority class');
    }
  });

  it('RoutingEngine.route routes against the stored candidate set', () => {
    const engine = new RoutingEngine({
      candidates: [
        {
          identityId: 'agent-eng',
          capabilityMatrix: [{ domain: 'typescript', level: 'L4', certifiedBy: ['owner'] }],
          knownLimitations: [],
          authorityClass: 'EXECUTOR',
        },
      ],
    });
    const res = engine.route({
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'EXECUTOR',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matched).toHaveLength(1);
      expect(res.matched[0]?.identityId).toBe('agent-eng');
    }
  });

  it('RoutingEngine.addCandidate adds a candidate to the set', () => {
    const engine = new RoutingEngine({ candidates: [] });
    // Initially no matches.
    let res = engine.route({
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'EXECUTOR',
    });
    if (res.ok) {
      expect(res.matched).toHaveLength(0);
    }
    // Add a candidate.
    engine.addCandidate({
      identityId: 'agent-added',
      capabilityMatrix: [{ domain: 'typescript', level: 'L4', certifiedBy: ['owner'] }],
      knownLimitations: ['no network'],
      authorityClass: 'EXECUTOR',
    });
    res = engine.route({
      domain: 'typescript',
      level: 'L3',
      requiredAuthority: 'EXECUTOR',
    });
    if (res.ok) {
      expect(res.matched).toHaveLength(1);
      expect(res.matched[0]?.identityId).toBe('agent-added');
    }
  });

  it('a candidate without the requested domain is not matched', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-python',
        capabilityMatrix: [{ domain: 'python', level: 'L4', certifiedBy: ['owner'] }],
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

  it('a candidate with the domain but level below required is not matched', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-low2',
        capabilityMatrix: [{ domain: 'typescript', level: 'L2', certifiedBy: ['owner'] }],
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

  it('summary uses (none) when a matched candidate has no limitations', () => {
    const candidates: RoutingCandidate[] = [
      {
        identityId: 'agent-nolim',
        capabilityMatrix: [{ domain: 'typescript', level: 'L4', certifiedBy: ['owner'] }],
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
      expect(res.summary).toContain('Limitations: (none)');
    }
  });
});

// --- contract-store: factory TTL branches ----------------------------------

describe('ContractStore: createSpawnContract and createContextGrant TTL branches', () => {
  it('createSpawnContract with non-empty contextGrants renders scope and TTL', () => {
    const store = new ContractStore();
    const artifact = store.createSpawnContract({
      identityId: 'agent-1',
      taskId: 'task-001',
      grantedAuthority: 'EXECUTOR',
      canCommit: true,
      contextGrants: [
        { items: ['src/kernel/'], scope: 'read-only', ttl: 600 },
        { items: ['src/lib/'], scope: 'read-comment' },
      ],
      createdBy: 'owner@forge',
    });
    expect(artifact.frontmatter.artifactType).toBe('SpawnContract');
    // The body must render the TTL for the first grant.
    expect(artifact.body).toContain('TTL: 600s');
    // The body must render both scopes.
    expect(artifact.body).toContain('scope: read-only');
    expect(artifact.body).toContain('scope: read-comment');
    // can_commit must be true.
    expect(artifact.body).toContain('can_commit: true');
  });

  it('createContextGrant with a TTL renders the TTL line', () => {
    const store = new ContractStore();
    const artifact = store.createContextGrant({
      granter: 'owner@forge',
      grantee: 'agent-1',
      items: ['src/kernel/canonical-json.ts'],
      scope: 'read-only',
      ttl: 3600,
      reason: 'Time-limited code review.',
    });
    expect(artifact.frontmatter.artifactType).toBe('ContextGrant');
    expect(artifact.body).toContain('**TTL:** 3600s');
    expect(artifact.body).toContain('**Scope:** read-only');
    expect(artifact.body).toContain('**Reason:** Time-limited code review.');
  });

  it('createContextGrant without a TTL omits the TTL line', () => {
    const store = new ContractStore();
    const artifact = store.createContextGrant({
      granter: 'owner@forge',
      grantee: 'agent-1',
      items: ['src/kernel/'],
      scope: 'read-comment',
      reason: 'No TTL review.',
    });
    expect(artifact.body).not.toContain('TTL:');
  });
});

// --- spawn-contract: enforce without identity (line 102 fallback) ----------

describe('SpawnContractEnforcer: enforce without identity uses grantedAuthority', () => {
  it('enforce without an identity uses the contract grantedAuthority as effective', () => {
    const enforcer = new SpawnContractEnforcer({ journal: makeJournal() });
    const res = enforcer.enforce({
      identityId: 'agent-no-id',
      taskId: 'task-001',
      grantedAuthority: 'COMMITTER',
      canCommit: false,
      contextGrants: [],
      createdBy: 'owner@forge',
      // No identity argument — the contract's grantedAuthority is the upper bound.
    });
    // Without an identity, the effective authority is the contract's grant.
    expect(res.effectiveAuthority).toBe('COMMITTER');
  });
});
