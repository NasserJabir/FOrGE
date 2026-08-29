/**
 * K-S4 EvidenceRef resolution + trust label enforcement — FR-S4-6/7.
 *
 * FR-S4-6: trust_label SHALL be schema-mandatory on every Claim and Tier-A
 *   governed artifact, computed at creation as the weakest of contributing
 *   sources; `derived` SHALL inherit the weakest of its sources; labels SHALL
 *   persist across summarization, re-encoding, agent-mediated transfer, and
 *   composition.
 *
 * FR-S4-7: Any EvidenceRef(kind: run_journal, locator: k1:[…]) SHALL inherit
 *   the weakest trust label of the underlying material; a journal range is
 *   never a trust source by itself.
 *
 * This module provides the EvidenceRef schema (re-exported for consumers) and
 * the `resolveEvidenceRefTrustLabel()` resolver, plus `deriveTrustLabel()` for
 * derivations (summarize/re-encode/transfer/compose). The enforcement at Claim
 * ingestion (propose) lives in kernel-claim and delegates here.
 *
 * @forge-trace {"component_id":"kernel-evidence-ref","problems":["P23","P68"],"heritage":["E01","INV-4"],"decisions":["DEC-42.1","DEC-42.2"],"bp_ids":[],"ac_ids":[]}
 */
import { z } from 'zod';

import { type TrustLabel, weakestOf, journalRangeTrustLabel } from './trust-label.js';

// ---------------------------------------------------------------------------
// FR-S4-3: EvidenceRef schema
// ---------------------------------------------------------------------------

/**
 * The governed evidence-reference kinds. `tier-b-raw` is NOT legal (FR-S4-1):
 * raw Tier-B content must be wrapped in a Claim with evidenceRef.kind
 * 'external'.
 */
export const EVIDENCE_REF_KINDS = ['run_journal', 'artifact', 'external'] as const;
export type EvidenceRefKind = (typeof EVIDENCE_REF_KINDS)[number];

/**
 * EvidenceRef schema. An EvidenceRef is a governed cross-layer pointer to the
 * material that grounds a Claim.
 *
 * - `kind`: the governed kind of reference.
 * - `locator`: a string locator into the material (e.g. an artifact id, a
 *   journal range `k1:[start,end]`, or an external URI).
 * - `version_hash`: optional pinned content hash (required for
 *   deterministic_hash staleness — FR-S4-9).
 * - `pinned_at`: optional ISO timestamp pinning the reference in time.
 */
export const EvidenceRefSchema = z
  .object({
    kind: z.enum(EVIDENCE_REF_KINDS),
    locator: z.string().min(1),
    version_hash: z.string().min(1).optional(),
    pinned_at: z.string().min(1).optional(),
  })
  .strict();

export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/** Returns true if `kind` is a legal (governed) evidence-reference kind. */
export function isLegalEvidenceKind(kind: string): boolean {
  return (EVIDENCE_REF_KINDS as readonly string[]).includes(kind);
}

// ---------------------------------------------------------------------------
// FR-S4-7: EvidenceRef run_journal trust resolution
// ---------------------------------------------------------------------------

/**
 * FR-S4-7 / DEC-42.2: Resolve the trust label conferred by an EvidenceRef.
 *
 * - For `run_journal`: the journal range confers NO trust by itself. The
 *   result is the weakest of the underlying material labels (delegated to
 *   `journalRangeTrustLabel`). If no material labels are known, the result is
 *   `derived` (weakest non-committal). It is NEVER a bare `trusted/user` just
 *   because it came through the journal.
 * - For `artifact` and `external`: the EvidenceRef itself does not compute a
 *   label — the caller supplies the material/source labels and the result is
 *   the weakest of those (consistent with FR-S4-6). An `external` reference
 *   with no known material labels resolves to `derived`.
 *
 * @param ref        The EvidenceRef to resolve.
 * @param materialLabels  The trust labels of the underlying material referenced
 *                        by `ref.locator`. May be empty (unknown).
 * @returns The resolved trust label, never stronger than the weakest material.
 */
export function resolveEvidenceRefTrustLabel(
  ref: EvidenceRef,
  materialLabels: TrustLabel[],
): TrustLabel {
  // FR-S4-7: a journal range is never a trust source by itself. Whether the
  // kind is run_journal, artifact, or external, the conferred label is the
  // weakest of the underlying material — never a bare trust upgrade. The
  // journalRangeTrustLabel helper encodes the same rule for run_journal
  // specifically; for artifact/external we apply the identical weakest-of
  // rule so that no EvidenceRef kind can launder trust.
  if (ref.kind === 'run_journal') {
    return journalRangeTrustLabel(materialLabels);
  }
  // artifact | external: weakest of material, or 'derived' if unknown.
  return weakestOf(materialLabels);
}

// ---------------------------------------------------------------------------
// FR-S4-6: Derivation trust label (summarize / re-encode / transfer / compose)
// ---------------------------------------------------------------------------

/**
 * FR-S4-6 / DEC-42.1: Compute the trust label of a derived artifact.
 *
 * A derivation (summarize, re-encode, agent-mediated transfer, composition)
 * over a set of source labels yields the weakest of those sources. This makes
 * trust-laundering through derivation ineffective: feeding `tool-output` and
 * `web/untrusted` into a summarizer produces `web/untrusted`, NOT `trusted`.
 *
 * - Empty input => `derived` (a derived thing with no known sources is the
 *   weakest non-committal label).
 * - The result is always labeled `derived` when no sources are known, and
 *   otherwise the weakest of the sources. Callers that want to mark the
 *   output explicitly as a derivation may downgrade to `derived`, but the
 *   weakest-of rule already prevents laundering.
 *
 * @param sourceLabels  The trust labels of the contributing source artifacts.
 * @returns The weakest of the sources, or `derived` if none.
 */
export function deriveTrustLabel(sourceLabels: TrustLabel[]): TrustLabel {
  // FR-S4-6: `derived` SHALL inherit the weakest of its sources. The output
  // is the weakest-of the inputs — laundering is ineffective.
  return weakestOf(sourceLabels);
}
