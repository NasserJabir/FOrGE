/**
 * K-2 Contract Store tests — FR-K2-1…8, with provocation tests (C-07).
 *
 * @forge-trace {"component_id":"test-contract-store","problems":["P01","P04","P14","P16","P22","P90"],"heritage":["K02","K04","K05","K07","K08"],"decisions":["DEC-01","DEC-22"],"bp_ids":[],"ac_ids":["AC-P01"]}
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ContractStore } from '../../src/kernel/contract-store.js';
import { sha256Hex } from '../../src/lib/hash.js';
import { canonicalJson } from '../../src/kernel/canonical-json.js';
import type { Artifact, Frontmatter } from '../../src/kernel/contract-store.js';

function makeStore(): ContractStore {
  return new ContractStore();
}

function makeFrontmatter(over: Partial<Frontmatter> = {}): Frontmatter {
  const base: Frontmatter = {
    artifactId: 'tc-test1',
    artifactType: 'TaskContract',
    version: 1,
    createdAt: '2026-08-28T10:00:00.000Z',
    createdBy: 'alice',
    status: 'active',
    scope: 'project',
    lifecycleState: 'approved',
    contentHash: '', // filled by helper
    provenance: [{ source: 'alice', ts: '2026-08-28T10:00:00.000Z' }],
    evidenceRefs: [],
    trustLabel: 'trusted/user',
    ...over,
  };
  return base;
}

function makeArtifact(over: Partial<Frontmatter> = {}, body = '# Task\nDo the thing.'): Artifact {
  const fm = makeFrontmatter(over);
  const { contentHash: _omit, ...rest } = fm;
  void _omit;
  const contentHash = sha256Hex(canonicalJson({ body, frontmatter: rest }));
  return { frontmatter: { ...fm, contentHash }, body };
}

describe('FR-K2-1 / FR-K2-2: store typed Tier-A artifacts with frontmatter', () => {
  it('stores a valid TaskContract artifact', () => {
    const s = makeStore();
    const art = makeArtifact();
    const res = s.store(art);
    expect(res.ok).toBe(true);
    expect(s.get('tc-test1')).not.toBeNull();
  });

  it('stores all typed artifact types (FR-K2-1)', () => {
    const s = makeStore();
    const types = [
      'TaskContract',
      'PlanArtifact',
      'DecisionRecord',
      'SpawnContract',
      'ContextGrant',
      'AuthorityMatrix',
      'Policy',
      'Claim',
      'Skill',
      'EvidenceBundle',
      'AgentIdentity',
      'PKP',
    ] as const;
    for (const t of types) {
      const art = makeArtifact({ artifactId: `a-${t}`, artifactType: t });
      const res = s.store(art);
      expect(res.ok, `type ${t}`).toBe(true);
    }
    expect(s.list().length).toBe(types.length);
  });
});

describe('FR-K2-3: strict validation — contentHash + unknown keys', () => {
  it('accepts an artifact with a correct contentHash', () => {
    const s = makeStore();
    const art = makeArtifact();
    expect(s.store(art).ok).toBe(true);
  });

  it('PROVOCATION: rejects a contentHash mismatch', () => {
    const s = makeStore();
    const art = makeArtifact();
    const tampered: Artifact = {
      ...art,
      frontmatter: { ...art.frontmatter, contentHash: 'deadbeef'.repeat(8) },
    };
    const res = s.store(tampered);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('contentHash mismatch'))).toBe(true);
    }
  });

  it('PROVOCATION: rejects unknown frontmatter keys (strict schema)', () => {
    const s = makeStore();
    const art = makeArtifact();
    const withExtra = {
      ...art,
      frontmatter: { ...art.frontmatter, secretBackdoor: 'evil' },
    };
    const res = s.store(withExtra);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('secretBackdoor') || e.includes('unknown'))).toBe(
        true,
      );
    }
  });

  it('PROVOCATION: rejects a non-string body', () => {
    const s = makeStore();
    const res = s.store({ frontmatter: makeFrontmatter(), body: 123 });
    expect(res.ok).toBe(false);
  });
});

describe('FR-K2-4: supersession requires reason + visible tombstone', () => {
  it('supersedes an artifact with an explicit reason and creates a tombstone', () => {
    const s = makeStore();
    const old = makeArtifact({ artifactId: 'old1' });
    const newer = makeArtifact({ artifactId: 'new1', supersedes: { artifactId: 'old1', reason: 'revised plan' } });
    s.store(old);
    s.store(newer);
    const res = s.supersede({ oldArtifactId: 'old1', newArtifactId: 'new1', reason: 'revised plan' });
    expect(res.ok).toBe(true);
    // Old moved to deprecated tree with tombstone.
    const dep = s.getDeprecated('old1');
    expect(dep).not.toBeNull();
    expect(dep!.frontmatter.lifecycleState).toBe('superseded');
    expect(dep!.body).toContain('SUPERSEDED');
    expect(dep!.body).toContain('new1');
    // Old no longer in active store.
    expect(s.get('old1')).toBeNull();
  });

  it('PROVOCATION: supersession without a reason is rejected', () => {
    const s = makeStore();
    const old = makeArtifact({ artifactId: 'old2' });
    const newer = makeArtifact({ artifactId: 'new2' });
    s.store(old);
    s.store(newer);
    const res = s.supersede({ oldArtifactId: 'old2', newArtifactId: 'new2', reason: '' });
    expect(res.ok).toBe(false);
  });

  it('PROVOCATION: silent mutation is structurally impossible (no update method)', () => {
    const s = makeStore();
    expect((s as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).mutate).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).edit).toBeUndefined();
  });

  it('records the supersession history chain', () => {
    const s = makeStore();
    const old = makeArtifact({ artifactId: 'h1' });
    const newer = makeArtifact({ artifactId: 'h2' });
    s.store(old);
    s.store(newer);
    s.supersede({ oldArtifactId: 'h1', newArtifactId: 'h2', reason: 'v2' });
    expect(s.historyOf('h1')).toEqual(['h2']);
  });
});

describe('FR-K2-5: human-readable artifacts (AC-P01)', () => {
  it('artifacts are Markdown + structured frontmatter, inspectable in a plain editor', () => {
    const s = makeStore();
    const art = makeArtifact({}, '# Plan\n\nStep 1: do X\nStep 2: do Y\n');
    s.store(art);
    const got = s.get('tc-test1')!;
    expect(got.body).toContain('# Plan');
    expect(typeof got.frontmatter.artifactId).toBe('string');
  });
});

describe('FR-K2-7: DecisionRecord captures context + rejected alternative', () => {
  it('creates a DecisionRecord with all required fields', () => {
    const s = makeStore();
    const dr = s.createDecisionRecord({
      context: 'Need a storage backend',
      chosenOption: 'SQLite behind a port',
      rejectedAlternative: 'Plain JSON files',
      rejectionReason: 'No transactional integrity',
      evidenceRefs: [{ kind: 'run_journal', locator: 'k1:[0,5]' }],
      approver: 'owner',
    });
    expect(dr.frontmatter.artifactType).toBe('DecisionRecord');
    expect(dr.body).toContain('SQLite behind a port');
    expect(dr.body).toContain('Plain JSON files');
    expect(dr.body).toContain('No transactional integrity');
    expect(dr.body).toContain('owner');
  });
});

describe('Trust label derivation (DEC-42.1 / FR-S4-6)', () => {
  it('derives the weakest of source labels', async () => {
    const { deriveTrustLabel } = await import('../../src/kernel/contract-store.js');
    expect(deriveTrustLabel(['trusted/user', 'web/untrusted'])).toBe('web/untrusted');
    expect(deriveTrustLabel(['tool-output', 'trusted/user'])).toBe('tool-output');
    expect(deriveTrustLabel([])).toBe('derived');
  });
});
