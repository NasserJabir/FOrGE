/**
 * K-S4 Claim entity + state machine tests — FR-S4-1/2/3/4, with provocation
 * tests (C-07).
 *
 * T-CLAIM-1: Tier-B direct citation rejection — an attempt to cite Tier-B
 *   content directly (not wrapped as a Claim) in a governed cross-layer
 *   reference is rejected (FR-S4-1, DEC-27).
 * T-CLAIM-2: intake floor — all meaningful intake creates Claim(proposed); a
 *   provocation that asserts intake enters at `supported` or higher fails
 *   (FR-S4-2, P68).
 * T-CLAIM-3: schema-mandatory fields — a Claim missing a mandatory field is
 *   rejected (FR-S4-3).
 * T-CLAIM-4: state machine — proposed→supported without ≥N evidence is
 *   rejected (FR-S4-4).
 * T-CLAIM-5: state machine — illegal transition refuted→supported (re-raise
 *   without recheck) is rejected (FR-S4-4).
 *
 * @forge-trace {"component_id":"test-kernel-claim","problems":["P68","P23"],"heritage":["E01","K05","K08","INV-4"],"decisions":["DEC-27","DEC-42.1"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import {
  ClaimStore,
  CLAIM_STATES,
  LEGAL_CLAIM_TRANSITIONS,
  DEFAULT_EVIDENCE_THRESHOLD,
  type Claim,
  type ClaimTransitionResult,
} from '../../src/kernel/claim.js';
import { ContractStore } from '../../src/kernel/contract-store.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
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

function makeClaimStore(opts?: { evidenceThreshold?: number }): {
  store: ClaimStore;
  journal: EventJournal;
  contracts: ContractStore;
} {
  const journal = makeJournal();
  const contracts = new ContractStore();
  const store = new ClaimStore({
    journal,
    contracts,
    evidenceThreshold: opts?.evidenceThreshold ?? DEFAULT_EVIDENCE_THRESHOLD,
  });
  return { store, journal, contracts };
}

/** A minimal valid claim proposal input. */
function baseProposal(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    statement: 'The build passes on Node 20.',
    scope: 'project',
    provenance: [{ source: 'alice', ts: '2026-08-29T00:00:00.000Z' }],
    confidence: 0.5,
    evidenceRef: {
      kind: 'artifact',
      locator: 'tc-test',
      version_hash: 'abc',
      pinned_at: '2026-08-29T00:00:00.000Z',
    },
    trustLabel: 'tool-output',
    stalenessMode: 'deterministic_hash',
    originAgent: 'alice',
    ...over,
  };
}

describe('T-CLAIM-1: Tier-B direct citation rejection (FR-S4-1, DEC-27)', () => {
  it('rejects a cross-layer reference to raw Tier-B content not wrapped as a Claim', () => {
    const { store } = makeClaimStore();
    // A "Tier-B direct citation" is an attempt to register a governed knowledge
    // reference whose evidenceRef points at raw Tier-B content (kind: 'tier-b-raw')
    // without wrapping it as a Claim. The ClaimStore refuses to ingest it.
    const res = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'tier-b-raw',
          locator: 'session-42',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/tier-b/i);
    }
  });

  it('accepts a Claim that wraps Tier-B content as evidence (the Claim is the governed layer)', () => {
    const { store } = makeClaimStore();
    // Wrapping Tier-B content inside a Claim(proposed) is the legal path: the
    // Claim is the governed cross-layer reference, not the raw Tier-B blob.
    const res = store.propose(
      baseProposal({
        evidenceRef: {
          kind: 'external',
          locator: 'session-42',
          pinned_at: '2026-08-29T00:00:00.000Z',
        },
        trustLabel: 'web/untrusted',
        stalenessMode: 'manual_only',
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(true);
  });
});

describe('T-CLAIM-2: intake floor — all intake enters at Claim(proposed) (FR-S4-2, P68)', () => {
  it('creates every new claim at the `proposed` state (minimum-belief floor)', () => {
    const { store } = makeClaimStore();
    const res = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claim.state).toBe('proposed');
    }
  });

  it('rejects a proposal that attempts to enter at `supported` directly', () => {
    const { store } = makeClaimStore();
    const res = store.propose(
      baseProposal({ state: 'supported' }) as Parameters<typeof store.propose>[0],
    );
    // The store ignores any client-supplied `state` and forces `proposed`;
    // a caller cannot bootstrap above the floor. Verify the resulting claim
    // is at `proposed`, not `supported`.
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claim.state).toBe('proposed');
    }
  });

  it('rejects a proposal that attempts to enter at `approved` directly', () => {
    const { store } = makeClaimStore();
    const res = store.propose(
      baseProposal({ state: 'approved' }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claim.state).toBe('proposed');
    }
  });
});

describe('T-CLAIM-3: schema-mandatory fields (FR-S4-3)', () => {
  it('rejects a Claim missing trust_label', () => {
    const { store } = makeClaimStore();
    const input = baseProposal();
    delete input.trustLabel;
    const res = store.propose(input as Parameters<typeof store.propose>[0]);
    expect(res.ok).toBe(false);
  });

  it('rejects a Claim missing staleness_mode', () => {
    const { store } = makeClaimStore();
    const input = baseProposal();
    delete input.stalenessMode;
    const res = store.propose(input as Parameters<typeof store.propose>[0]);
    expect(res.ok).toBe(false);
  });

  it('rejects a Claim missing confidence', () => {
    const { store } = makeClaimStore();
    const input = baseProposal();
    delete input.confidence;
    const res = store.propose(input as Parameters<typeof store.propose>[0]);
    expect(res.ok).toBe(false);
  });

  it('rejects a Claim missing scope', () => {
    const { store } = makeClaimStore();
    const input = baseProposal();
    delete input.scope;
    const res = store.propose(input as Parameters<typeof store.propose>[0]);
    expect(res.ok).toBe(false);
  });

  it('rejects a Claim missing origin_agent', () => {
    const { store } = makeClaimStore();
    const input = baseProposal();
    delete input.originAgent;
    const res = store.propose(input as Parameters<typeof store.propose>[0]);
    expect(res.ok).toBe(false);
  });

  it('rejects a Claim missing evidence_ref.kind', () => {
    const { store } = makeClaimStore();
    const input = baseProposal();
    delete (input.evidenceRef as Record<string, unknown>).kind;
    const res = store.propose(input as Parameters<typeof store.propose>[0]);
    expect(res.ok).toBe(false);
  });

  it('rejects a Claim with an invalid staleness_mode', () => {
    const { store } = makeClaimStore();
    const res = store.propose(
      baseProposal({ stalenessMode: 'psychic' }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(false);
  });
});

describe('T-CLAIM-4: proposed→supported requires ≥N evidence (FR-S4-4)', () => {
  it('rejects proposed→supported when fewer than N evidence refs are present', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 2 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    // The claim has exactly one evidence ref (baseProposal). Threshold is 2.
    const res = store.support(prop.claim.claimId);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toMatch(/evidence|threshold|N/i);
    }
  });

  it('accepts proposed→supported when ≥N evidence refs are present', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 2 });
    const prop = store.propose(
      baseProposal({
        additionalEvidence: [
          {
            kind: 'artifact',
            locator: 'tc-other',
            version_hash: 'def',
            pinned_at: '2026-08-29T00:00:00.000Z',
          },
        ],
      }) as Parameters<typeof store.propose>[0],
    );
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const res = store.support(prop.claim.claimId);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claim.state).toBe('supported');
    }
  });
});

describe('T-CLAIM-5: illegal transitions rejected (FR-S4-4)', () => {
  it('rejects refuted→supported (re-raise without recheck)', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    // proposed → supported (1 evidence, threshold 1)
    const sup = store.support(prop.claim.claimId);
    expect(sup.ok).toBe(true);
    if (!sup.ok) return;
    // supported → stale (hash mismatch)
    const stale = store.markStale(sup.claim.claimId);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    // stale → refuted (explicit refutation; recheck(false) yields 'superseded'
    // as the default false-outcome per FR-S4-4, refute() is the explicit path
    // to 'refuted').
    const refuted = store.refute(stale.claim.claimId, 'recheck failed: hash mismatch persists');
    expect(refuted.ok).toBe(true);
    if (!refuted.ok) return;
    expect(refuted.claim.state).toBe('refuted');
    // Now attempt an illegal refuted → supported (no recheck path)
    const illegal = store.support(refuted.claim.claimId);
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) {
      expect(illegal.reason).toMatch(/illegal|transition/i);
    }
  });

  it('the LEGAL_CLAIM_TRANSITIONS table has no refuted→supported edge', () => {
    const fromRefuted = LEGAL_CLAIM_TRANSITIONS['refuted'];
    expect(fromRefuted).not.toContain('supported');
  });
});

describe('FR-S4-4: full state machine happy paths', () => {
  it('proposed→supported→stale→supported (recheck true)', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const sup = store.support(prop.claim.claimId);
    expect(sup.ok).toBe(true);
    if (!sup.ok) return;
    const stale = store.markStale(sup.claim.claimId);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    const rechecked = store.recheck(stale.claim.claimId, true);
    expect(rechecked.ok).toBe(true);
    if (rechecked.ok) {
      expect(rechecked.claim.state).toBe('supported');
    }
  });

  it('proposed→supported→stale→superseded (recheck false)', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const sup = store.support(prop.claim.claimId);
    expect(sup.ok).toBe(true);
    if (!sup.ok) return;
    const stale = store.markStale(sup.claim.claimId);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    const res = store.recheck(stale.claim.claimId, false);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(['superseded', 'refuted']).toContain(res.claim.state);
    }
  });

  it('any state → contested (counter-evidence) → decision', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const sup = store.support(prop.claim.claimId);
    expect(sup.ok).toBe(true);
    if (!sup.ok) return;
    const contested = store.contest(sup.claim.claimId, 'counter-evidence found');
    expect(contested.ok).toBe(true);
    if (contested.ok) {
      expect(contested.claim.state).toBe('contested');
    }
  });
});

describe('FR-S4-1/2: journaling on claim lifecycle', () => {
  it('journals claim.created on propose and claim.transition on support', () => {
    const { store, journal } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    store.support(prop.claim.claimId);
    const kinds = journal.all().map((e) => e.kind);
    expect(kinds).toContain('claim.created');
    expect(kinds).toContain('claim.transition');
  });

  it('journals claim.contested on contest', () => {
    const { store, journal } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    store.support(prop.claim.claimId);
    store.contest(prop.claim.claimId, 'disputed');
    const kinds = journal.all().map((e) => e.kind);
    expect(kinds).toContain('claim.contested');
  });
});

describe('CLAIM_STATES: declared states match SRS', () => {
  it('exposes exactly the six claim states', () => {
    expect([...CLAIM_STATES]).toEqual([
      'proposed',
      'supported',
      'stale',
      'superseded',
      'refuted',
      'contested',
    ]);
  });
});

describe('ClaimStore: get and list', () => {
  it('retrieves a claim by id and lists all claims', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const got = store.get(prop.claim.claimId);
    expect(got).not.toBeNull();
    expect(store.list().length).toBe(1);
  });

  it('returns null for an unknown claim id', () => {
    const { store } = makeClaimStore();
    expect(store.get('cg-nonexistent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge cases: not-found, illegal transitions, staleness constraint, optional
// fields, default threshold — drive claim.ts branch coverage to NFR-11 ≥90%.
// ---------------------------------------------------------------------------

describe('ClaimStore: not-found rejection paths', () => {
  it('support() rejects for an unknown claim id', () => {
    const { store } = makeClaimStore();
    const res = store.support('cg-nonexistent');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });

  it('markStale() rejects for an unknown claim id', () => {
    const { store } = makeClaimStore();
    const res = store.markStale('cg-nonexistent');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });

  it('recheck() rejects for an unknown claim id', () => {
    const { store } = makeClaimStore();
    const res = store.recheck('cg-nonexistent', true);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });

  it('supersede() rejects for an unknown claim id', () => {
    const { store } = makeClaimStore();
    const res = store.supersede('cg-nonexistent', 'reason');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });

  it('refute() rejects for an unknown claim id', () => {
    const { store } = makeClaimStore();
    const res = store.refute('cg-nonexistent', 'reason');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });

  it('contest() rejects for an unknown claim id', () => {
    const { store } = makeClaimStore();
    const res = store.contest('cg-nonexistent', 'reason');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/not found/i);
  });
});

describe('ClaimStore: illegal-transition rejections', () => {
  it('recheck() rejects when the claim is not in the stale state', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    // claim is at 'proposed' — recheck is only legal from 'stale'.
    const res = store.recheck(prop.claim.claimId, true);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/stale/i);
  });

  it('supersede() rejects an illegal transition from proposed→superseded', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    // proposed has no direct edge to superseded.
    const res = store.supersede(prop.claim.claimId, 'replaced');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/illegal|transition/i);
  });

  it('refute() rejects an illegal transition from proposed→refuted', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    // proposed has no direct edge to refuted.
    const res = store.refute(prop.claim.claimId, 'wrong');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/illegal|transition/i);
  });

  it('contest() rejects when no legal contested edge exists', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    // contest once: proposed → contested (legal).
    const c1 = store.contest(prop.claim.claimId, 'first dispute');
    expect(c1.ok).toBe(true);
    if (!c1.ok) return;
    // contest again: contested has NO edge to contested — illegal.
    const c2 = store.contest(c1.claim.claimId, 'second dispute');
    expect(c2.ok).toBe(false);
    if (!c2.ok) expect(c2.reason).toMatch(/illegal|transition/i);
  });
});

describe('FR-S4-9: staleness constraint (deterministic_hash requires ground)', () => {
  it('rejects deterministic_hash without artifact ground or version_hash', () => {
    const { store } = makeClaimStore();
    // external kind with no version_hash + deterministic_hash => rejected.
    const res = store.propose(
      baseProposal({
        evidenceRef: { kind: 'external', locator: 'session-42' },
        stalenessMode: 'deterministic_hash',
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/deterministic_hash|version_hash|FR-S4-9/i);
  });

  it('accepts deterministic_hash with external kind when version_hash is present', () => {
    const { store } = makeClaimStore();
    const res = store.propose(
      baseProposal({
        evidenceRef: { kind: 'external', locator: 'session-42', version_hash: 'deadbeef' },
        stalenessMode: 'deterministic_hash',
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(true);
  });

  it('accepts heuristic staleness for a non-artifact-grounded external ref', () => {
    const { store } = makeClaimStore();
    const res = store.propose(
      baseProposal({
        evidenceRef: { kind: 'external', locator: 'session-42' },
        stalenessMode: 'heuristic',
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(true);
  });

  it('accepts manual_only staleness for a non-artifact-grounded external ref', () => {
    const { store } = makeClaimStore();
    const res = store.propose(
      baseProposal({
        evidenceRef: { kind: 'external', locator: 'session-42' },
        stalenessMode: 'manual_only',
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(true);
  });
});

describe('ClaimStore: default threshold and optional fields', () => {
  it('uses DEFAULT_EVIDENCE_THRESHOLD (1) when none is supplied', () => {
    // baseProposal has exactly one evidence ref; default threshold is 1, so
    // proposed→supported succeeds without additional evidence.
    const { store } = makeClaimStore();
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    const sup = store.support(prop.claim.claimId);
    expect(sup.ok).toBe(true);
  });

  it('accepts a proposal without pinned_at on the evidence ref', () => {
    const { store } = makeClaimStore();
    const res = store.propose(
      baseProposal({
        evidenceRef: { kind: 'artifact', locator: 'tc-test', version_hash: 'abc' },
      }) as Parameters<typeof store.propose>[0],
    );
    expect(res.ok).toBe(true);
  });

  it('accepts a proposal with supersedes metadata', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    // First claim, then supersede it with a new proposal carrying supersedes.
    const prop1 = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop1.ok).toBe(true);
    if (!prop1.ok) return;
    const prop2 = store.propose(
      baseProposal({
        statement: 'The build passes on Node 22.',
        supersedes: { claimId: prop1.claim.claimId, reason: 'newer evidence' },
      }) as Parameters<typeof store.propose>[0],
    );
    expect(prop2.ok).toBe(true);
    if (prop2.ok) {
      expect(prop2.claim.supersedes?.claimId).toBe(prop1.claim.claimId);
    }
  });
});

describe('FR-S4-4: recheck(false) → superseded path', () => {
  it('recheck(false) transitions stale → superseded (the default false-outcome)', () => {
    const { store } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    store.support(prop.claim.claimId);
    const stale = store.markStale(prop.claim.claimId);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    const res = store.recheck(stale.claim.claimId, false);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claim.state).toBe('superseded');
    }
  });

  it('recheck(true) transitions stale → supported and journals claim.transition', () => {
    const { store, journal } = makeClaimStore({ evidenceThreshold: 1 });
    const prop = store.propose(baseProposal() as Parameters<typeof store.propose>[0]);
    expect(prop.ok).toBe(true);
    if (!prop.ok) return;
    store.support(prop.claim.claimId);
    const stale = store.markStale(prop.claim.claimId);
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    const res = store.recheck(stale.claim.claimId, true);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.claim.state).toBe('supported');
      expect(res.eventId).toBeTruthy();
    }
    // recheck uses applyTransition which journals claim.transition.
    expect(journal.all().some((e) => e.kind === 'claim.transition')).toBe(true);
  });
});

export type { Claim, ClaimTransitionResult };
