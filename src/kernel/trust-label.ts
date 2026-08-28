/**
 * Trust Label computation — DEC-42.1 (trust-laundering defense).
 *
 * FR-S4-6: trust_label SHALL be schema-mandatory on every Claim and Tier-A
 * governed artifact, computed at creation as the weakest of contributing
 * sources; `derived` SHALL inherit the weakest of its sources; labels SHALL
 * persist across summarization, re-encoding, agent-mediated transfer, and
 * composition.
 *
 * FR-SEC-1: Four trust labels: trusted/user, tool-output, web/untrusted, derived.
 * Critical actions require trusted sources only.
 *
 * FR-S4-7: Any EvidenceRef(kind: run_journal) SHALL inherit the weakest trust
 * label of the underlying material; a journal range is never a trust source by
 * itself.
 *
 * @forge-trace {"component_id":"kernel-trust-label","problems":["P10","P68"],"heritage":["K06","INV-4"],"decisions":["DEC-42","DEC-27"],"bp_ids":[],"ac_ids":[]}
 */

/** The four trust labels (FR-SEC-1), ordered from strongest to weakest. */
export type TrustLabel = 'trusted/user' | 'tool-output' | 'web/untrusted' | 'derived';

/**
 * Authority ranking of trust labels (lower index = stronger/more trusted).
 * `derived` is the weakest — it MUST inherit the weakest of its sources.
 */
const TRUST_ORDER: TrustLabel[] = ['trusted/user', 'tool-output', 'web/untrusted', 'derived'];

/**
 * Return the weaker of two trust labels (the one with the higher index).
 * This is the core of DEC-42.1: derivation produces the weakest of inputs.
 */
export function weakerOf(a: TrustLabel, b: TrustLabel): TrustLabel {
  return TRUST_ORDER.indexOf(a) >= TRUST_ORDER.indexOf(b) ? a : b;
}

/**
 * Compute the trust label of a derived artifact as the weakest of its
 * contributing source labels (DEC-42.1 / FR-S4-6).
 *
 * - Empty input => 'derived' (safest non-committal label for a derived thing).
 * - A single source => that source's label (but if used as a derivation,
 *   callers may downgrade to 'derived' explicitly).
 */
export function weakestOf(labels: TrustLabel[]): TrustLabel {
  if (labels.length === 0) return 'derived';
  return labels.reduce((acc, l) => weakerOf(acc, l));
}

/**
 * FR-S4-7: An EvidenceRef to a journal range inherits the weakest trust label
 * of the underlying material — the journal range itself is never a trust
 * source. This function encodes that rule: pass the labels of the material
 * referenced by the journal range; the result is the weakest of those, never
 * a bare 'trusted' just because it came through the journal.
 */
export function journalRangeTrustLabel(materialLabels: TrustLabel[]): TrustLabel {
  // A journal range confers NO trust by itself; the result is the weakest of
  // the underlying material, and is always at most as strong as the weakest.
  // If no material labels are known, it is 'derived' (weakest non-committal).
  if (materialLabels.length === 0) return 'derived';
  return weakestOf(materialLabels);
}

/**
 * FR-SEC-1: critical actions require trusted sources only.
 * Returns true if the label is strong enough for a critical action.
 */
export function isTrustedForCritical(label: TrustLabel): boolean {
  return label === 'trusted/user';
}
