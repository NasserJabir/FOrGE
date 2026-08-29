/**
 * K-S4 Knowledge types + authority order — FR-S4-10.
 *
 * FR-S4-10: Eight knowledge types with authority order
 *   `Constraint > Decision > Fact > Environmental > Heuristic > Preference`;
 *   Assumptions enter at zero confidence; Skills via their own lifecycle.
 *
 * The authority order determines which knowledge type wins when two claims
 * conflict and no explicit supersession exists (consumed by ConflictResolver,
 * FR-S4-11). A lower rank number = higher authority.
 *
 * Assumptions are special: they SHALL enter at zero confidence regardless of
 * what the caller supplies (FR-S4-10). This is a structural anti-poisoning
 * measure — an unverified assumption cannot bootstrap belief.
 *
 * Skills are NOT governed by the claim confidence/state lifecycle; they have
 * their own lifecycle (FR-S4-10) and are excluded from authority-ordered
 * conflict resolution.
 *
 * @forge-trace {"component_id":"kernel-knowledge-types","problems":["P63","P65"],"heritage":["E01","K05"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */

// ---------------------------------------------------------------------------
// FR-S4-10: The eight knowledge types
// ---------------------------------------------------------------------------

/**
 * The eight knowledge types (FR-S4-10).
 *
 * Six are authority-ordered: Constraint > Decision > Fact > Environmental >
 * Heuristic > Preference. Assumption enters at zero confidence. Skill has its
 * own lifecycle and is excluded from authority-ordered conflict.
 */
export const KNOWLEDGE_TYPES = [
  'Constraint',
  'Decision',
  'Fact',
  'Environmental',
  'Heuristic',
  'Preference',
  'Assumption',
  'Skill',
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

/**
 * The six authority-ordered types (excludes Assumption and Skill which have
 * special handling — FR-S4-10).
 */
export const AUTHORITY_ORDERED_TYPES = [
  'Constraint',
  'Decision',
  'Fact',
  'Environmental',
  'Heuristic',
  'Preference',
] as const;
export type AuthorityOrderedType = (typeof AUTHORITY_ORDERED_TYPES)[number];

/**
 * Authority rank map: lower number = higher authority (wins conflicts).
 *
 * Constraint(0) > Decision(1) > Fact(2) > Environmental(3) > Heuristic(4) >
 * Preference(5). Assumption and Skill are NOT in the authority order.
 */
export const AUTHORITY_ORDER: Readonly<Record<AuthorityOrderedType, number>> = {
  Constraint: 0,
  Decision: 1,
  Fact: 2,
  Environmental: 3,
  Heuristic: 4,
  Preference: 5,
};

/** Assumptions SHALL enter at zero confidence (FR-S4-10). */
export const ASSUMPTION_CONFIDENCE = 0;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * FR-S4-10: Is the given string one of the eight knowledge types?
 * A claim typed outside these eight is rejected.
 */
export function isLegalKnowledgeType(type: string): type is KnowledgeType {
  return (KNOWLEDGE_TYPES as readonly string[]).includes(type);
}

/**
 * FR-S4-10: Is the given type in the authority order (excludes Assumption/Skill)?
 */
export function isAuthorityOrdered(type: string): type is AuthorityOrderedType {
  return (AUTHORITY_ORDERED_TYPES as readonly string[]).includes(type);
}

/**
 * FR-S4-10: Get the authority rank of a knowledge type.
 *
 * Returns `null` for Assumption and Skill (not in the authority order).
 * A lower rank = higher authority (wins conflicts).
 */
export function authorityRank(type: string): number | null {
  if (isAuthorityOrdered(type)) {
    return AUTHORITY_ORDER[type];
  }
  return null;
}

/**
 * FR-S4-10: Compare two authority-ordered types. Returns negative if `a` has
 * higher authority than `b`, positive if `b` is higher, 0 if equal.
 *
 * Non-authority types (Assumption, Skill, or invalid) throw — they cannot be
 * compared by authority.
 */
export function compareAuthority(a: string, b: string): number {
  const ra = authorityRank(a);
  const rb = authorityRank(b);
  if (ra === null) {
    throw new Error(`type '${a}' is not in the authority order (FR-S4-10)`);
  }
  if (rb === null) {
    throw new Error(`type '${b}' is not in the authority order (FR-S4-10)`);
  }
  return ra - rb;
}

// ---------------------------------------------------------------------------
// FR-S4-10: Assumption confidence enforcement
// ---------------------------------------------------------------------------

/**
 * The result of enforcing the Assumption zero-confidence rule.
 */
export type ConfidenceResult =
  { ok: true; confidence: number; adjusted: boolean } | { ok: false; reason: string };

/**
 * FR-S4-10: Enforce that Assumptions enter at zero confidence.
 *
 * If the type is 'Assumption' and confidence > 0, the confidence is
 * downgraded to 0 (adjusted=true). The caller SHALL use the returned
 * confidence.
 *
 * If the type is 'Assumption' and confidence === 0, it passes as-is.
 * For all other types, confidence passes through unchanged.
 */
export function enforceAssumptionConfidence(type: string, confidence: number): ConfidenceResult {
  if (!isLegalKnowledgeType(type)) {
    return {
      ok: false,
      reason: `unknown knowledge type '${type}' — must be one of: ${KNOWLEDGE_TYPES.join(', ')} (FR-S4-10)`,
    };
  }
  if (type === 'Assumption') {
    if (confidence === ASSUMPTION_CONFIDENCE) {
      return { ok: true, confidence: 0, adjusted: false };
    }
    // Downgrade to zero — Assumptions cannot bootstrap belief (FR-S4-10).
    return { ok: true, confidence: 0, adjusted: true };
  }
  return { ok: true, confidence, adjusted: false };
}

// ---------------------------------------------------------------------------
// FR-S4-10: Skill lifecycle exclusion
// ---------------------------------------------------------------------------

/**
 * FR-S4-10: Skills have their own lifecycle and are excluded from the
 * authority-ordered claim conflict resolution.
 */
export function isSkillLifecycle(type: string): boolean {
  return type === 'Skill';
}
