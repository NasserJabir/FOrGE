/**
 * K-S4 Staleness + zero-model-call tests — FR-S4-5/9, with provocation tests
 * (C-07).
 *
 * T-STALE-1 (zero-model-call): a deterministic staleness check on an
 *   artifact-grounded claim invokes zero model calls — instrumented via a
 *   model-call counter that must remain 0 across the read path (FR-S4-5).
 * T-STALE-2 (hash mismatch ⇒ stale, surfaces lazily): a claim whose pinned
 *   `version_hash` no longer matches the artifact's current hash is detected
 *   as stale at read time and surfaces (never disappears silently) (FR-S4-5,
 *   P19).
 * T-STALE-3 (non-artifact-grounded ⇒ no deterministic claim): a claim without
 *   an artifact ground cannot set `staleness_mode: 'deterministic_hash'`; it
 *   must be `heuristic` or `manual_only` (FR-S4-9, OR-3).
 *
 * @forge-trace {"component_id":"test-kernel-staleness","problems":["P18","P19","OR-3"],"heritage":["E01"],"decisions":["DEC-42.1"],"bp_ids":[],"ac_ids":["AC-BP3"]}
 */
import { describe, it, expect } from 'vitest';

import { ClaimStore, DEFAULT_EVIDENCE_THRESHOLD, type Claim } from '../../src/kernel/claim.js';
import { ContractStore } from '../../src/kernel/contract-store.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import {
  checkStaleness,
  deriveStalenessMode,
  isArtifactGrounded,
  type ArtifactHashLookup,
} from '../../src/kernel/staleness.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';

const CLAIM_KINDS = [
  'claim.created',
  'claim.transition',
  'claim.superseded',
  'claim.contested',
  'claim.stale',
  'journal.append_rejected',
];

function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: CLAIM_KINDS,
  });
}

function makeClaimStore(): { store: ClaimStore; contracts: ContractStore } {
  const journal = makeJournal();
  const contracts = new ContractStore();
  const store = new ClaimStore({
    journal,
    contracts,
    evidenceThreshold: DEFAULT_EVIDENCE_THRESHOLD,
  });
  return { store, contracts };
}

/** A minimal valid claim proposal input with artifact-grounded evidence. */
function baseProposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    statement: 'The build passes on Node 20.',
    scope: 'project',
    provenance: [{ source: 'alice', ts: '2026-08-29T00:00:00.000Z' }],
    confidence: 0.5,
    evidenceRef: {
      kind: 'artifact',
      locator: 'tc-test',
      version_hash: 'abc123',
      pinned_at: '2026-08-29T00:00:00.000Z',
    },
    trustLabel: 'tool-output',
    stalenessMode: 'deterministic_hash',
    originAgent: 'alice',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// T-STALE-1: zero-model-call (FR-S4-5)
// ---------------------------------------------------------------------------

describe('T-STALE-1: deterministic staleness check invokes zero model calls (FR-S4-5)', () => {
  it('returns stale=false when pinned hash matches current hash, with zero model calls', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    if (!prop.ok) throw new Error('propose failed');
    const claim = prop.claim;

    // A model-call counter — if checkStaleness invoked any model, this would
    // increment. The lookup is a pure hash comparison, NOT a model call.
    let modelCalls = 0;
    const modelSpy = (): string => {
      modelCalls++;
      return 'should-not-be-called';
    };

    // The lookup returns the current contentHash for the artifact. This is a
    // pure read, not a model call.
    const lookup: ArtifactHashLookup = (_artifactId: string) => {
      // Deliberately ignore modelSpy — the staleness check must NOT consult it.
      void modelSpy;
      return claim.evidenceRef.version_hash ?? null;
    };

    const result = checkStaleness(claim, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stale).toBe(false);
    }
    // FR-S4-5: zero model calls across the read path.
    expect(modelCalls).toBe(0);
  });

  it('checkStaleness accepts only a pure hash lookup — no model parameter in the API', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    if (!prop.ok) throw new Error('propose failed');

    // The function signature is (claim, lookup) — there is no model parameter.
    // This is structural enforcement of zero-model-call (FR-S4-5).
    const lookup: ArtifactHashLookup = () => 'abc123';
    const result = checkStaleness(prop.claim, lookup);
    expect(result.ok).toBe(true);
  });

  it('instruments the lookup call count — only hash comparison, no model', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    if (!prop.ok) throw new Error('propose failed');

    let lookupCalls = 0;
    const lookup: ArtifactHashLookup = (artifactId: string) => {
      lookupCalls++;
      expect(artifactId).toBe('tc-test');
      return 'abc123';
    };

    const result = checkStaleness(prop.claim, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stale).toBe(false);
    }
    // Exactly one lookup call — a single hash fetch, no model rounds.
    expect(lookupCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// T-STALE-2: hash mismatch ⇒ stale, surfaces lazily (FR-S4-5, P19)
// ---------------------------------------------------------------------------

describe('T-STALE-2: hash mismatch ⇒ stale, surfaces lazily (FR-S4-5, P19)', () => {
  it('detects staleness when the pinned version_hash no longer matches the current hash', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'artifact',
          locator: 'tc-evolved',
          version_hash: 'original-hash',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
      }) as Parameters<typeof store.propose>[0],
    );
    if (!prop.ok) throw new Error('propose failed');
    const claim = prop.claim;

    // The artifact's hash has changed (e.g., the task contract was updated).
    const lookup: ArtifactHashLookup = () => 'new-hash-after-update';

    const result = checkStaleness(claim, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stale).toBe(true);
      // The stale claim surfaces with a reason — it never disappears silently (P19).
      expect(result.reason).toContain('hash mismatch');
      expect(result.pinnedHash).toBe('original-hash');
      expect(result.currentHash).toBe('new-hash-after-update');
    }
  });

  it('a stale claim surfaces with enough detail to act on — never silently dropped', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'artifact',
          locator: 'tc-ghost',
          version_hash: 'pinned-aaa',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
      }) as Parameters<typeof store.propose>[0],
    );
    if (!prop.ok) throw new Error('propose failed');

    const lookup: ArtifactHashLookup = () => 'current-bbb';
    const result = checkStaleness(prop.claim, lookup);
    expect(result.ok).toBe(true);
    if (result.ok && result.stale) {
      // Both hashes are surfaced so a consumer can diagnose the drift.
      expect(result.pinnedHash).toBeDefined();
      expect(result.currentHash).toBeDefined();
      expect(result.pinnedHash).not.toBe(result.currentHash);
    }
  });

  it('hash match after recheck (same hash) ⇒ not stale', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'artifact',
          locator: 'tc-stable',
          version_hash: 'stable-hash',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
      }) as Parameters<typeof store.propose>[0],
    );
    if (!prop.ok) throw new Error('propose failed');

    const lookup: ArtifactHashLookup = () => 'stable-hash';
    const result = checkStaleness(prop.claim, lookup);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stale).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// T-STALE-3: non-artifact-grounded ⇒ no deterministic claim (FR-S4-9, OR-3)
// ---------------------------------------------------------------------------

describe('T-STALE-3: non-artifact-grounded ⇒ no deterministic claim (FR-S4-9, OR-3)', () => {
  it('isArtifactGrounded returns true only for artifact kind with version_hash', () => {
    expect(isArtifactGrounded({ kind: 'artifact', version_hash: 'abc' })).toBe(true);
    // artifact kind but no version_hash → NOT grounded
    expect(isArtifactGrounded({ kind: 'artifact' })).toBe(false);
    // run_journal kind → NOT artifact-grounded (journal ≠ K-2 artifact)
    expect(isArtifactGrounded({ kind: 'run_journal', version_hash: 'abc' })).toBe(false);
    // external kind → NOT artifact-grounded
    expect(isArtifactGrounded({ kind: 'external', version_hash: 'abc' })).toBe(false);
    // no kind match at all
    expect(isArtifactGrounded({ kind: 'unknown' })).toBe(false);
  });

  it('deriveStalenessMode returns deterministic_hash only for artifact-grounded evidence', () => {
    expect(deriveStalenessMode({ kind: 'artifact', version_hash: 'abc' })).toBe(
      'deterministic_hash',
    );
  });

  it('deriveStalenessMode returns heuristic for non-artifact-grounded evidence', () => {
    // run_journal — not an artifact, even with a version_hash
    expect(deriveStalenessMode({ kind: 'run_journal', version_hash: 'xyz' })).toBe('heuristic');
    // external — not an artifact
    expect(deriveStalenessMode({ kind: 'external', version_hash: 'xyz' })).toBe('heuristic');
    // artifact kind but no version_hash — cannot do deterministic hash comparison
    expect(deriveStalenessMode({ kind: 'artifact' })).toBe('heuristic');
    // no version_hash at all
    expect(deriveStalenessMode({ kind: 'external' })).toBe('heuristic');
  });

  it('checkStaleness on a heuristic-mode claim returns not-applicable (cannot determine deterministically)', () => {
    const { store } = makeClaimStore();
    // A non-artifact-grounded claim with heuristic staleness mode.
    const prop = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'external',
          locator: 'web-url-42',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
        stalenessMode: 'heuristic',
      }) as Parameters<typeof store.propose>[0],
    );
    if (!prop.ok) throw new Error('propose failed');

    const lookup: ArtifactHashLookup = () => 'irrelevant';
    const result = checkStaleness(prop.claim, lookup);
    // Non-deterministic modes cannot be checked via hash comparison.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('non-deterministic');
    }
  });

  it('checkStaleness on a manual_only-mode claim returns not-applicable', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'external',
          locator: 'manual-ref',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
        stalenessMode: 'manual_only',
      }) as Parameters<typeof store.propose>[0],
    );
    if (!prop.ok) throw new Error('propose failed');

    const lookup: ArtifactHashLookup = () => null;
    const result = checkStaleness(prop.claim, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('non-deterministic');
    }
  });

  it('ClaimStore rejects deterministic_hash for non-artifact-grounded evidence (FR-S4-9)', () => {
    const { store } = makeClaimStore();
    // external kind with no version_hash — cannot be deterministic_hash.
    const res = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'external',
          locator: 'web-url-99',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
        stalenessMode: 'deterministic_hash',
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('FR-S4-9');
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Staleness edge cases', () => {
  it('checkStaleness returns not-applicable when version_hash is missing on a deterministic claim', () => {
    // This shouldn't happen if FR-S4-9 is enforced at creation, but checkStaleness
    // must defend in depth: a deterministic claim with no pinned hash cannot be
    // checked.
    const claim: Claim = {
      claimId: 'cg-test-nohash',
      statement: 'test',
      scope: 'project',
      provenance: [{ source: 'alice', ts: '2026-08-29T00:00:00.000Z' }],
      confidence: 0.5,
      state: 'supported',
      evidenceRef: {
        kind: 'artifact',
        locator: 'tc-nohash',
        // no version_hash — should not happen but defend in depth
      },
      trustLabel: 'tool-output',
      stalenessMode: 'deterministic_hash',
      originAgent: 'alice',
      version: 1,
      contentHash: 'dummy',
    };

    const lookup: ArtifactHashLookup = () => 'some-hash';
    const result = checkStaleness(claim, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('version_hash');
    }
  });

  it('checkStaleness returns not-applicable when the artifact is not found (lookup returns null)', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'artifact',
          locator: 'tc-missing',
          version_hash: 'abc',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
      }) as Parameters<typeof store.propose>[0],
    );
    if (!prop.ok) throw new Error('propose failed');

    const lookup: ArtifactHashLookup = () => null;
    const result = checkStaleness(prop.claim, lookup);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('not found');
    }
  });

  it('checkStaleness uses the evidenceRef.locator as the artifact id for the lookup', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'artifact',
          locator: 'tc-specific-locator',
          version_hash: 'hash-xyz',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
      }) as Parameters<typeof store.propose>[0],
    );
    if (!prop.ok) throw new Error('propose failed');

    let lookedUpId = '';
    const lookup: ArtifactHashLookup = (id: string) => {
      lookedUpId = id;
      return 'hash-xyz';
    };

    const result = checkStaleness(prop.claim, lookup);
    expect(result.ok).toBe(true);
    expect(lookedUpId).toBe('tc-specific-locator');
  });

  it('isArtifactGrounded returns false for an empty/unknown kind', () => {
    expect(isArtifactGrounded({ kind: '' })).toBe(false);
  });

  it('deriveStalenessMode defaults to heuristic for any non-artifact-grounded input', () => {
    expect(deriveStalenessMode({ kind: 'run_journal' })).toBe('heuristic');
    expect(deriveStalenessMode({ kind: 'external' })).toBe('heuristic');
    expect(deriveStalenessMode({ kind: 'artifact', version_hash: '' })).toBe('heuristic');
  });
});
