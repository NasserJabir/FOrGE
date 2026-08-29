/**
 * K-S4 Claim entity + state machine — FR-S4-1/2/3/4.
 *
 * FR-S4-1: Every cross-layer knowledge reference SHALL be a Claim; Tier-B
 *   content SHALL never be cited directly (DEC-27). The Claim is the governed
 *   layer; raw Tier-B content is not a citable reference.
 * FR-S4-2: All meaningful intake SHALL create Claim(proposed) — minimum-belief
 *   state; poisoning containment is structural (intake can only enter at the
 *   floor). No client-supplied `state` can bootstrap above `proposed`.
 * FR-S4-3: Claim fields: statement, scope, provenance[], confidence, state,
 *   evidence_ref{kind, locator, version_hash, pinned_at}, trust_label,
 *   staleness_mode ∈ {deterministic_hash, heuristic, manual_only}, supersedes?,
 *   challenged_by?, evidence_bundle_id, origin_agent, version.
 * FR-S4-4: Claim state machine:
 *   proposed →(≥N evidence)→ supported →(hash mismatch)→ stale
 *     →(recheck true)→ supported | (recheck false)→ superseded|refuted;
 *   any state →(counter-evidence)→ contested →(decision)→…
 *
 * The ClaimStore is event-sourced over K-1 (transitions journaled write-ahead)
 * and persists Claims as Tier-A artifacts in K-2 (ContractStore).
 *
 * @forge-trace {"component_id":"kernel-claim","problems":["P68","P23","P65","P19"],"heritage":["E01","K05","K08","INV-4"],"decisions":["DEC-27","DEC-42.1"],"bp_ids":[],"ac_ids":[]}
 */
import { z } from 'zod';

import { sha256Hex } from '../lib/hash.js';
import { ulid } from '../lib/ulid.js';

import { canonicalJson } from './canonical-json.js';
import { type TrustLabel, weakestOf } from './trust-label.js';

import type { ContractStore, Artifact, Frontmatter, LifecycleState } from './contract-store.js';
import type { EventJournal } from './event-journal.js';

// ---------------------------------------------------------------------------
// FR-S4-3: Claim schema
// ---------------------------------------------------------------------------

/** The six claim lifecycle states (FR-S4-4). */
export const CLAIM_STATES = [
  'proposed',
  'supported',
  'stale',
  'superseded',
  'refuted',
  'contested',
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

/** Staleness modes (FR-S4-5/9). */
export const STALENESS_MODES = ['deterministic_hash', 'heuristic', 'manual_only'] as const;
export type StalenessMode = (typeof STALENESS_MODES)[number];

/** Evidence reference kinds. `tier-b-raw` is NOT a legal kind (FR-S4-1). */
export const EVIDENCE_REF_KINDS = ['run_journal', 'artifact', 'external'] as const;
export type EvidenceRefKind = (typeof EVIDENCE_REF_KINDS)[number];

const EvidenceRefSchema = z.object({
  kind: z.enum(EVIDENCE_REF_KINDS),
  locator: z.string().min(1),
  version_hash: z.string().min(1).optional(),
  pinned_at: z.string().min(1).optional(),
});

const ProvenanceSchema = z.object({
  source: z.string().min(1),
  ts: z.string().min(1),
});

const SupersedeSchema = z.object({
  claimId: z.string().min(1),
  reason: z.string().min(1),
});

/** The full Claim schema (FR-S4-3). Unknown keys rejected. */
export const ClaimSchema = z
  .object({
    claimId: z.string().min(1),
    statement: z.string().min(1),
    scope: z.string().min(1),
    provenance: z.array(ProvenanceSchema),
    confidence: z.number().min(0).max(1),
    state: z.enum(CLAIM_STATES),
    evidenceRef: EvidenceRefSchema,
    additionalEvidence: z.array(EvidenceRefSchema).optional(),
    trustLabel: z.enum(['trusted/user', 'tool-output', 'web/untrusted', 'derived']),
    stalenessMode: z.enum(STALENESS_MODES),
    supersedes: SupersedeSchema.optional(),
    challengedBy: z.string().min(1).optional(),
    evidenceBundleId: z.string().min(1).optional(),
    originAgent: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict();

export type ClaimFields = z.infer<typeof ClaimSchema>;

/** A Claim is the fields plus the computed content hash (artifact integrity). */
export interface Claim extends ClaimFields {
  contentHash: string;
}

// ---------------------------------------------------------------------------
// FR-S4-4: State machine transition table
// ---------------------------------------------------------------------------

/**
 * The legal claim state transition table (FR-S4-4).
 *
 * Diagram:
 *   proposed → supported | contested
 *   supported → stale | contested
 *   stale → supported | superseded | refuted | contested
 *   superseded → contested   (a superseded claim may still be contested)
 *   refuted → contested      (but NOT → supported: re-raise without recheck)
 *   contested → supported | superseded | refuted | stale  (decision)
 *
 * Terminal-ish: superseded and refuted have no path back to supported except
 * via stale→recheck(true)→supported, which only applies from `stale`.
 */
export const LEGAL_CLAIM_TRANSITIONS: Readonly<Record<ClaimState, readonly ClaimState[]>> = {
  proposed: ['supported', 'contested'],
  supported: ['stale', 'contested'],
  stale: ['supported', 'superseded', 'refuted', 'contested'],
  superseded: ['contested'],
  refuted: ['contested'],
  contested: ['supported', 'stale', 'superseded', 'refuted'],
};

/** The default evidence threshold (≥N evidence refs for proposed→supported). */
export const DEFAULT_EVIDENCE_THRESHOLD = 1;

// ---------------------------------------------------------------------------
// Journal event payloads
// ---------------------------------------------------------------------------

interface ClaimCreatedPayload {
  claimId: string;
  statement: string;
  scope: string;
  state: ClaimState;
  trustLabel: TrustLabel;
  originAgent: string;
}

interface ClaimTransitionPayload {
  claimId: string;
  from: ClaimState;
  to: ClaimState;
  reason: string;
}

interface ClaimContestedPayload {
  claimId: string;
  from: ClaimState;
  reason: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ClaimResult = { ok: true; claim: Claim } | { ok: false; reason: string };

export type ClaimTransitionResult =
  { ok: true; claim: Claim; eventId: string } | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// ClaimStore
// ---------------------------------------------------------------------------

/** Options for constructing a ClaimStore. */
export interface ClaimStoreOptions {
  journal: EventJournal;
  contracts: ContractStore;
  /** The ≥N evidence threshold for proposed→supported (FR-S4-4). */
  evidenceThreshold?: number;
}

/**
 * K-S4 ClaimStore — the governed claims layer.
 *
 * propose() creates a Claim(proposed) artifact in K-2 and journals
 * claim.created. support()/markStale()/recheck()/supersede()/refute()/
 * contest() enforce the FR-S4-4 state machine, journal claim.transition (or
 * claim.contested), and update the stored artifact.
 *
 * The in-memory map is a cache; the K-2 artifact store and K-1 journal are the
 * durable sources of truth.
 */
export class ClaimStore {
  private readonly journal: EventJournal;
  private readonly contracts: ContractStore;
  private readonly evidenceThreshold: number;
  private readonly byId: Map<string, Claim> = new Map();

  constructor(opts: ClaimStoreOptions) {
    this.journal = opts.journal;
    this.contracts = opts.contracts;
    this.evidenceThreshold = opts.evidenceThreshold ?? DEFAULT_EVIDENCE_THRESHOLD;
  }

  /**
   * FR-S4-2: Propose a new claim. All intake enters at `proposed` (the floor).
   * FR-S4-1: Rejects evidenceRef.kind 'tier-b-raw' (Tier-B content cannot be
   * cited directly; it must be wrapped in a Claim whose evidence is `external`).
   * FR-S4-3: Validates all mandatory fields.
   * The client cannot choose the `state` — it is always `proposed`.
   */
  propose(input: {
    statement: string;
    scope: string;
    provenance: Array<{ source: string; ts: string }>;
    confidence: number;
    evidenceRef: { kind: string; locator: string; version_hash?: string; pinned_at?: string };
    additionalEvidence?: Array<{
      kind: string;
      locator: string;
      version_hash?: string;
      pinned_at?: string;
    }>;
    trustLabel: TrustLabel;
    /**
     * FR-S4-6: optional contributing source trust labels. When provided, the
     * enforced trust_label is computed as the weakest of these sources via
     * `weakestOf()` — the caller's asserted `trustLabel` is overridden. When
     * omitted (single-source direct intake), the caller's `trustLabel` is
     * used as-is. This is the enforced milestone of FR-S4-6: trust_label is
     * computed at creation as the weakest of contributing sources.
     */
    sourceLabels?: TrustLabel[];
    stalenessMode: StalenessMode;
    supersedes?: { claimId: string; reason: string };
    originAgent: string;
    // Intentionally no `state` — it is forced to `proposed` (FR-S4-2).
  }): ClaimResult {
    // FR-S4-1: Tier-B content cannot be cited directly. The evidenceRef.kind
    // must be one of the governed kinds (run_journal | artifact | external).
    // A raw Tier-B blob is referenced via `external` and wrapped in a Claim;
    // the Claim is the governed layer, not the Tier-B blob.
    if (!isLegalEvidenceKind(input.evidenceRef.kind)) {
      return {
        ok: false,
        reason: `Tier-B content cannot be cited directly (FR-S4-1): evidenceRef.kind '${input.evidenceRef.kind}' is not a governed kind; wrap the content in a Claim with evidenceRef.kind 'external' (DEC-27)`,
      };
    }

    // FR-S4-6 / DEC-42.1: enforce trust_label as the weakest of contributing
    // sources at creation. If sourceLabels are provided, the enforced label is
    // weakestOf(sourceLabels) — the caller's asserted trustLabel is ignored
    // (prevents trust-laundering by asserting a strong label over weak
    // sources). If no sourceLabels are given (direct single-source intake),
    // the caller's trustLabel is used as the single source.
    const enforcedTrustLabel =
      input.sourceLabels !== undefined && input.sourceLabels.length > 0
        ? weakestOf(input.sourceLabels)
        : input.trustLabel;

    const claimId = `cg-${ulid()}`;
    const now = new Date().toISOString();

    // FR-S4-2: force state to `proposed` (the floor). Ignore any client intent.
    const fields: ClaimFields = {
      claimId,
      statement: input.statement,
      scope: input.scope,
      provenance: input.provenance,
      confidence: input.confidence,
      state: 'proposed',
      evidenceRef: normalizeEvidenceRef(input.evidenceRef),
      additionalEvidence: input.additionalEvidence?.map(normalizeEvidenceRef),
      trustLabel: enforcedTrustLabel,
      stalenessMode: input.stalenessMode,
      supersedes: input.supersedes,
      originAgent: input.originAgent,
      version: 1,
    };

    // FR-S4-3: validate the full schema (strict — unknown keys rejected).
    const parsed = ClaimSchema.safeParse(fields);
    if (!parsed.success) {
      return {
        ok: false,
        reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    }

    // Staleness constraint (FR-S4-9): deterministic_hash requires an artifact
    // ground (version_hash). This is enforced fully in P3-3, but we apply the
    // basic guard here to prevent invalid claims from entering.
    if (
      fields.stalenessMode === 'deterministic_hash' &&
      fields.evidenceRef.kind !== 'artifact' &&
      fields.evidenceRef.version_hash === undefined
    ) {
      return {
        ok: false,
        reason:
          "deterministic_hash staleness requires an artifact ground with version_hash (FR-S4-9); use 'heuristic' or 'manual_only' for non-artifact-grounded claims",
      };
    }

    // Persist as a Tier-A artifact in K-2 (FR-K2-1, FR-ART-1).
    // The contentHash is computed by claimToArtifact using the K-2 formula
    // (sha256 over canonical { body, frontmatter: stripHash(fm) }) so that
    // ContractStore.validate() re-computes the same value (FR-K2-3).
    const { artifact, contentHash } = claimToArtifact(parsed.data, now);
    const stored = this.contracts.store(artifact);
    if (!stored.ok) {
      return { ok: false, reason: `K-2 store rejected: ${stored.errors.join('; ')}` };
    }

    const claim: Claim = { ...parsed.data, contentHash };
    this.byId.set(claimId, claim);

    // Journal claim.created (write-ahead: the event records the floor entry).
    const payload: ClaimCreatedPayload = {
      claimId,
      statement: claim.statement,
      scope: claim.scope,
      state: 'proposed',
      trustLabel: claim.trustLabel,
      originAgent: claim.originAgent,
    };
    this.journal.append({
      actor: claim.originAgent,
      kind: 'claim.created',
      payload: payload as unknown as Record<string, unknown>,
    });

    return { ok: true, claim };
  }

  /**
   * FR-S4-4: proposed → supported. Requires ≥N evidence refs (the threshold).
   */
  support(claimId: string): ClaimTransitionResult {
    return this.transition(claimId, 'supported', (claim) => {
      const count = 1 + (claim.additionalEvidence?.length ?? 0);
      if (count < this.evidenceThreshold) {
        return {
          ok: false,
          reason: `proposed→supported requires ≥${this.evidenceThreshold} evidence ref(s); got ${count} (FR-S4-4)`,
        };
      }
      return { ok: true };
    });
  }

  /** FR-S4-4: supported → stale (hash mismatch detected). No guard needed. */
  markStale(claimId: string): ClaimTransitionResult {
    return this.transition(claimId, 'stale', undefined, 'hash mismatch');
  }

  /**
   * FR-S4-4: stale → supported (recheck true) | superseded|refuted (recheck false).
   * The destination depends on the recheck outcome.
   */
  recheck(claimId: string, recheckPassed: boolean): ClaimTransitionResult {
    const current = this.byId.get(claimId);
    if (!current) return { ok: false, reason: `claim '${claimId}' not found` };
    if (current.state !== 'stale') {
      return {
        ok: false,
        reason: `recheck is only legal from 'stale' (current: '${current.state}')`,
      };
    }
    // FR-S4-4: recheck true → supported; recheck false → superseded (or refuted).
    // We choose 'superseded' as the default false outcome; refuted is available
    // via a dedicated refute() call from stale.
    const to: ClaimState = recheckPassed ? 'supported' : 'superseded';
    return this.applyTransition(claimId, to, recheckPassed ? 'recheck passed' : 'recheck failed');
  }

  /** FR-S4-4: supersede a claim (explicit supersession with reason). */
  supersede(claimId: string, reason: string): ClaimTransitionResult {
    const current = this.byId.get(claimId);
    if (!current) return { ok: false, reason: `claim '${claimId}' not found` };
    if (!isLegalTransition(current.state, 'superseded')) {
      return {
        ok: false,
        reason: `illegal transition '${current.state} → superseded' (FR-S4-4)`,
      };
    }
    return this.applyTransition(claimId, 'superseded', reason);
  }

  /** FR-S4-4: refute a claim. */
  refute(claimId: string, reason: string): ClaimTransitionResult {
    const current = this.byId.get(claimId);
    if (!current) return { ok: false, reason: `claim '${claimId}' not found` };
    if (!isLegalTransition(current.state, 'refuted')) {
      return {
        ok: false,
        reason: `illegal transition '${current.state} → refuted' (FR-S4-4)`,
      };
    }
    return this.applyTransition(claimId, 'refuted', reason);
  }

  /**
   * FR-S4-4: any state → contested (counter-evidence). Journals claim.contested.
   */
  contest(claimId: string, reason: string): ClaimTransitionResult {
    const current = this.byId.get(claimId);
    if (!current) return { ok: false, reason: `claim '${claimId}' not found` };
    if (!isLegalTransition(current.state, 'contested')) {
      return {
        ok: false,
        reason: `illegal transition '${current.state} → contested' (FR-S4-4)`,
      };
    }
    const from = current.state;
    // Update the claim state.
    const updatedFields: ClaimFields = {
      ...current,
      state: 'contested',
      challengedBy: reason,
      version: current.version + 1,
    };
    this.contracts.supersede({
      oldArtifactId: claimId,
      newArtifactId: claimId,
      reason: `contested: ${reason}`,
    });
    // Re-store the new version.
    const { artifact, contentHash } = claimToArtifact(updatedFields, new Date().toISOString());
    this.contracts.store(artifact);
    const next: Claim = { ...updatedFields, contentHash };
    this.byId.set(claimId, next);

    // Journal claim.contested.
    const payload: ClaimContestedPayload = { claimId, from, reason };
    const appendRes = this.journal.append({
      actor: next.originAgent,
      kind: 'claim.contested',
      payload: payload as unknown as Record<string, unknown>,
    });
    const eventId = appendRes.kind === 'appended' ? appendRes.event.event_id : '';
    return { ok: true, claim: next, eventId };
  }

  // --- internal ---

  /**
   * Generic transition with an optional guard. Journals claim.transition.
   */
  private transition(
    claimId: string,
    to: ClaimState,
    guard?: (claim: Claim) => { ok: true } | { ok: false; reason: string },
    reasonLabel?: string,
  ): ClaimTransitionResult {
    const current = this.byId.get(claimId);
    if (!current) return { ok: false, reason: `claim '${claimId}' not found` };

    if (!isLegalTransition(current.state, to)) {
      return {
        ok: false,
        reason: `illegal transition '${current.state} → ${to}' (FR-S4-4)`,
      };
    }

    if (guard) {
      const g = guard(current);
      if (!g.ok) return { ok: false, reason: g.reason };
    }

    return this.applyTransition(claimId, to, reasonLabel ?? `transition to ${to}`);
  }

  private applyTransition(claimId: string, to: ClaimState, reason: string): ClaimTransitionResult {
    const current = this.byId.get(claimId);
    if (!current) return { ok: false, reason: `claim '${claimId}' not found` };
    const from = current.state;

    // Write-ahead: journal claim.transition BEFORE updating the cache.
    const payload: ClaimTransitionPayload = { claimId, from, to, reason };
    const appendRes = this.journal.append({
      actor: current.originAgent,
      kind: 'claim.transition',
      payload: payload as unknown as Record<string, unknown>,
    });
    if (appendRes.kind === 'rejected') {
      return { ok: false, reason: `journal rejected: ${appendRes.reason}` };
    }

    const updatedFields: ClaimFields = {
      ...current,
      state: to,
      version: current.version + 1,
    };

    // Update the K-2 artifact (supersede old version, store new).
    this.contracts.supersede({
      oldArtifactId: claimId,
      newArtifactId: claimId,
      reason,
    });
    const { artifact, contentHash } = claimToArtifact(updatedFields, new Date().toISOString());
    this.contracts.store(artifact);
    const next: Claim = { ...updatedFields, contentHash };
    this.byId.set(claimId, next);

    const eventId = appendRes.kind === 'appended' ? appendRes.event.event_id : '';
    return { ok: true, claim: next, eventId };
  }

  /** Read a claim by id (from the in-memory cache). */
  get(claimId: string): Claim | null {
    return this.byId.get(claimId) ?? null;
  }

  /** List all claims. */
  list(): Claim[] {
    return Array.from(this.byId.values());
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLegalEvidenceKind(kind: string): boolean {
  return (EVIDENCE_REF_KINDS as readonly string[]).includes(kind);
}

function isLegalTransition(from: ClaimState, to: ClaimState): boolean {
  const allowed = LEGAL_CLAIM_TRANSITIONS[from];
  return allowed.includes(to);
}

function normalizeEvidenceRef(ref: {
  kind: string;
  locator: string;
  version_hash?: string;
  pinned_at?: string;
}): { kind: EvidenceRefKind; locator: string; version_hash?: string; pinned_at?: string } {
  return {
    kind: ref.kind as EvidenceRefKind,
    locator: ref.locator,
    ...(ref.version_hash !== undefined ? { version_hash: ref.version_hash } : {}),
    ...(ref.pinned_at !== undefined ? { pinned_at: ref.pinned_at } : {}),
  };
}

/**
 * Convert a Claim's fields to a K-2 Artifact for storage.
 *
 * The contentHash is computed using the SAME formula as ContractStore.validate()
 * (FR-K2-3): sha256(canonicalJson({ body, frontmatter: stripHash(fm) })).
 * This is the single source of truth for the artifact's integrity hash.
 *
 * Returns the artifact and the computed contentHash (so the caller can set it
 * on the Claim object, keeping claim.contentHash === artifact.frontmatter.contentHash).
 */
function claimToArtifact(
  fields: ClaimFields,
  now: string,
): { artifact: Artifact; contentHash: string } {
  const body = [
    `# Claim ${fields.claimId}`,
    ``,
    `**Statement:** ${fields.statement}`,
    ``,
    `**Scope:** ${fields.scope}`,
    ``,
    `**State:** ${fields.state}`,
    ``,
    `**Confidence:** ${fields.confidence}`,
    ``,
    `**Trust label:** ${fields.trustLabel}`,
    ``,
    `**Staleness mode:** ${fields.stalenessMode}`,
    ``,
    `**Origin agent:** ${fields.originAgent}`,
    ``,
    `**Version:** ${fields.version}`,
    ``,
    `**Evidence:** ${fields.evidenceRef.locator}`,
  ].join('\n');

  // Build frontmatter with a placeholder contentHash, then compute the real
  // hash over { body, frontmatter: stripHash(fm) } — exactly what
  // ContractStore.validate() re-computes (FR-K2-3).
  const fm: Frontmatter = {
    artifactId: fields.claimId,
    artifactType: 'Claim',
    version: fields.version,
    createdAt: now,
    createdBy: fields.originAgent,
    status: fields.state,
    scope: fields.scope,
    lifecycleState: claimStateToLifecycle(fields.state),
    contentHash: '', // computed below
    provenance: fields.provenance,
    evidenceRefs: [fields.evidenceRef, ...(fields.additionalEvidence ?? [])].map((e) => ({
      kind: e.kind,
      locator: e.locator,
      ...(e.version_hash !== undefined ? { version_hash: e.version_hash } : {}),
      ...(e.pinned_at !== undefined ? { pinned_at: e.pinned_at } : {}),
    })),
    trustLabel: fields.trustLabel,
  };

  // stripHash: remove contentHash before hashing (it's computed over the rest).
  const { contentHash: _omit, ...fmRest } = fm;
  void _omit;
  const contentHash = sha256Hex(canonicalJson({ body, frontmatter: fmRest }));

  return {
    artifact: { frontmatter: { ...fm, contentHash }, body },
    contentHash,
  };
}

function claimStateToLifecycle(state: ClaimState): LifecycleState {
  switch (state) {
    case 'proposed':
      return 'proposed';
    case 'supported':
      return 'supported';
    case 'stale':
      return 'contested';
    case 'superseded':
      return 'superseded';
    case 'refuted':
      return 'refuted';
    case 'contested':
      return 'contested';
  }
}
