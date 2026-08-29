/**
 * K-S4 Trust label enforcement + EvidenceRef tests — FR-S4-6/7, with
 * provocation tests (C-07).
 *
 * T-TLABEL-1 (schema-mandatory, weakest-of): a Claim created without a
 *   `trust_label` is rejected; a Claim derived from `web/untrusted` +
 *   `tool-output` sources gets `web/untrusted` (weakest), NOT `trusted/user`
 *   (FR-S4-6, DEC-42.1).
 * T-TLABEL-2 (derived inherits weakest): a derivation (summarize/re-encode)
 *   over inputs with labels `tool-output` and `web/untrusted` yields an output
 *   labeled `web/untrusted` — laundering through the derivation is ineffective
 *   (FR-S4-6, DEC-42.1, FR-LAUND-4).
 * T-TLABEL-3 (run_journal range never a trust source): an
 *   EvidenceRef(kind: run_journal, locator: k1:[…]) whose underlying material
 *   is `web/untrusted` inherits `web/untrusted`, NOT a bare `trusted` just
 *   because it came through the journal (FR-S4-7, DEC-42.2).
 *
 * @forge-trace {"component_id":"test-kernel-evidence-ref","problems":["P23","P68"],"heritage":["E01","INV-4"],"decisions":["DEC-42.1","DEC-42.2"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import { ClaimStore, DEFAULT_EVIDENCE_THRESHOLD } from '../../src/kernel/claim.js';
import { ContractStore } from '../../src/kernel/contract-store.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import {
  EvidenceRefSchema,
  EVIDENCE_REF_KINDS,
  isLegalEvidenceKind,
  resolveEvidenceRefTrustLabel,
  deriveTrustLabel,
  type EvidenceRef,
} from '../../src/kernel/evidence-ref.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';
import { weakestOf, journalRangeTrustLabel } from '../../src/kernel/trust-label.js';

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

function makeClaimStore(): {
  store: ClaimStore;
  journal: EventJournal;
  contracts: ContractStore;
} {
  const journal = makeJournal();
  const contracts = new ContractStore();
  const store = new ClaimStore({
    journal,
    contracts,
    evidenceThreshold: DEFAULT_EVIDENCE_THRESHOLD,
  });
  return { store, journal, contracts };
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
// T-TLABEL-1: schema-mandatory, weakest-of (FR-S4-6, DEC-42.1)
// ---------------------------------------------------------------------------

describe('T-TLABEL-1: trust_label is schema-mandatory and computed as weakest-of (FR-S4-6, DEC-42.1)', () => {
  it('rejects a Claim created without a trust_label (schema-mandatory)', () => {
    const { store } = makeClaimStore();
    // Provocation: omit trust_label entirely. The schema MUST reject it.
    const prop = store.propose(
      baseProposal({ trustLabel: undefined }) as Parameters<typeof store.propose>[0],
    );
    expect(prop.ok).toBe(false);
    if (!prop.ok) {
      expect(prop.reason).toMatch(/trustLabel|trust_label/i);
    }
  });

  it('rejects a Claim with an invalid trust_label value', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({ trustLabel: 'trusted' }) as Parameters<typeof store.propose>[0],
    );
    expect(prop.ok).toBe(false);
  });

  it('derives web/untrusted from web/untrusted + tool-output sources (weakest, NOT trusted/user)', () => {
    const { store } = makeClaimStore();
    // Provocation: a claim built from web/untrusted + tool-output sources.
    // The enforced trust_label MUST be web/untrusted (the weakest), NOT
    // trusted/user — laundering via mixing is ineffective.
    const prop = store.propose(
      baseProposal({
        trustLabel: 'trusted/user', // attacker tries to assert a strong label
        sourceLabels: ['web/untrusted', 'tool-output'],
      }) as Parameters<typeof store.propose>[0],
    );
    expect(prop.ok).toBe(true);
    if (prop.ok) {
      // The enforced label is the weakest of the sources, regardless of what
      // the caller asserted.
      expect(prop.claim.trustLabel).toBe('web/untrusted');
    }
  });

  it('derives tool-output when all sources are tool-output (no downgrade beyond sources)', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        trustLabel: 'trusted/user',
        sourceLabels: ['tool-output', 'tool-output'],
      }) as Parameters<typeof store.propose>[0],
    );
    expect(prop.ok).toBe(true);
    if (prop.ok) {
      expect(prop.claim.trustLabel).toBe('tool-output');
    }
  });

  it('derives trusted/user only when all sources are trusted/user', () => {
    const { store } = makeClaimStore();
    const prop = store.propose(
      baseProposal({
        trustLabel: 'web/untrusted', // caller tries a weak assertion
        sourceLabels: ['trusted/user', 'trusted/user'],
      }) as Parameters<typeof store.propose>[0],
    );
    expect(prop.ok).toBe(true);
    if (prop.ok) {
      // The enforced label is the weakest of the sources = trusted/user.
      expect(prop.claim.trustLabel).toBe('trusted/user');
    }
  });

  it('uses the caller-provided label when no sourceLabels are given (single-source intake)', () => {
    const { store } = makeClaimStore();
    // No sourceLabels: the caller's label is trusted as the single source
    // (this is the direct-intake path, not a derivation).
    const prop = store.propose(
      baseProposal({ trustLabel: 'tool-output' }) as Parameters<typeof store.propose>[0],
    );
    expect(prop.ok).toBe(true);
    if (prop.ok) {
      expect(prop.claim.trustLabel).toBe('tool-output');
    }
  });
});

// ---------------------------------------------------------------------------
// T-TLABEL-2: derived inherits weakest (FR-S4-6, DEC-42.1, FR-LAUND-4)
// ---------------------------------------------------------------------------

describe('T-TLABEL-2: derivation inherits the weakest of its sources (FR-S4-6, DEC-42.1, FR-LAUND-4)', () => {
  it('summarize over tool-output + web/untrusted yields web/untrusted (laundering ineffective)', () => {
    // Provocation: an attacker feeds a mix of labels through a summarizer
    // hoping the output is promoted. The derivation MUST yield the weakest.
    const out = deriveTrustLabel(['tool-output', 'web/untrusted']);
    expect(out).toBe('web/untrusted');
  });

  it('re-encode over trusted/user + web/untrusted yields web/untrusted', () => {
    const out = deriveTrustLabel(['trusted/user', 'web/untrusted']);
    expect(out).toBe('web/untrusted');
  });

  it('compose over three sources yields the weakest of all three', () => {
    const out = deriveTrustLabel(['trusted/user', 'tool-output', 'web/untrusted']);
    expect(out).toBe('web/untrusted');
  });

  it('derive over a single trusted/user source yields trusted/user (no spurious downgrade)', () => {
    const out = deriveTrustLabel(['trusted/user']);
    expect(out).toBe('trusted/user');
  });

  it('derive over no known sources yields derived (weakest non-committal)', () => {
    const out = deriveTrustLabel([]);
    expect(out).toBe('derived');
  });

  it('weakestOf agrees with deriveTrustLabel (same core invariant)', () => {
    const labels = ['tool-output', 'web/untrusted', 'trusted/user'];
    expect(deriveTrustLabel(labels)).toBe(weakestOf(labels as never));
  });
});

// ---------------------------------------------------------------------------
// T-TLABEL-3: run_journal range never a trust source (FR-S4-7, DEC-42.2)
// ---------------------------------------------------------------------------

describe('T-TLABEL-3: run_journal range is never a trust source (FR-S4-7, DEC-42.2)', () => {
  it('a run_journal ref over web/untrusted material inherits web/untrusted, NOT trusted/user', () => {
    // Provocation: an attacker routes web/untrusted material through the
    // journal and claims the journal range confers trust. It MUST NOT.
    const ref: EvidenceRef = {
      kind: 'run_journal',
      locator: 'k1:[0,10]',
    };
    const label = resolveEvidenceRefTrustLabel(ref, ['web/untrusted']);
    expect(label).toBe('web/untrusted');
    expect(label).not.toBe('trusted/user');
  });

  it('a run_journal ref over mixed material yields the weakest material label', () => {
    const ref: EvidenceRef = {
      kind: 'run_journal',
      locator: 'k1:[0,10]',
    };
    const label = resolveEvidenceRefTrustLabel(ref, [
      'trusted/user',
      'tool-output',
      'web/untrusted',
    ]);
    expect(label).toBe('web/untrusted');
  });

  it('a run_journal ref with no known material labels yields derived (never trusted)', () => {
    const ref: EvidenceRef = {
      kind: 'run_journal',
      locator: 'k1:[0,10]',
    };
    const label = resolveEvidenceRefTrustLabel(ref, []);
    expect(label).toBe('derived');
    expect(label).not.toBe('trusted/user');
  });

  it('an artifact ref over web/untrusted material yields web/untrusted (no kind-based upgrade)', () => {
    const ref: EvidenceRef = {
      kind: 'artifact',
      locator: 'tc-test',
      version_hash: 'abc123',
    };
    const label = resolveEvidenceRefTrustLabel(ref, ['web/untrusted']);
    expect(label).toBe('web/untrusted');
  });

  it('an external ref over tool-output material yields tool-output', () => {
    const ref: EvidenceRef = {
      kind: 'external',
      locator: 'https://example.com/doc',
    };
    const label = resolveEvidenceRefTrustLabel(ref, ['tool-output']);
    expect(label).toBe('tool-output');
  });

  it('journalRangeTrustLabel agrees with resolveEvidenceRefTrustLabel for run_journal', () => {
    const ref: EvidenceRef = { kind: 'run_journal', locator: 'k1:[0,10]' };
    const material = ['tool-output', 'web/untrusted'];
    expect(resolveEvidenceRefTrustLabel(ref, material as never)).toBe(
      journalRangeTrustLabel(material as never),
    );
  });
});

// ---------------------------------------------------------------------------
// EvidenceRef schema + helpers
// ---------------------------------------------------------------------------

describe('EvidenceRef schema + helpers (FR-S4-3, FR-S4-1)', () => {
  it('accepts a valid run_journal EvidenceRef', () => {
    const parsed = EvidenceRefSchema.safeParse({
      kind: 'run_journal',
      locator: 'k1:[0,10]',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a valid artifact EvidenceRef with version_hash + pinned_at', () => {
    const parsed = EvidenceRefSchema.safeParse({
      kind: 'artifact',
      locator: 'tc-test',
      version_hash: 'abc123',
      pinned_at: '2026-08-29T00:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an EvidenceRef with kind tier-b-raw (FR-S4-1)', () => {
    const parsed = EvidenceRefSchema.safeParse({
      kind: 'tier-b-raw',
      locator: 'tc-test',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an EvidenceRef missing locator', () => {
    const parsed = EvidenceRefSchema.safeParse({
      kind: 'artifact',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects an EvidenceRef with unknown keys (strict)', () => {
    const parsed = EvidenceRefSchema.safeParse({
      kind: 'artifact',
      locator: 'tc-test',
      extra: 'no',
    });
    expect(parsed.success).toBe(false);
  });

  it('isLegalEvidenceKind accepts governed kinds and rejects tier-b-raw', () => {
    for (const k of EVIDENCE_REF_KINDS) {
      expect(isLegalEvidenceKind(k)).toBe(true);
    }
    expect(isLegalEvidenceKind('tier-b-raw')).toBe(false);
    expect(isLegalEvidenceKind('')).toBe(false);
  });
});
