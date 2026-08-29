/**
 * K-S4 Conflict resolution — FR-S4-11.
 *
 * FR-S4-11: Conflict resolution SHALL apply:
 *   1. higher authority →
 *   2. explicit supersession (naming what is voided and why, evidence-linked) →
 *   3. else `conflict_pending` →
 *   4. narrowest scope wins (`Global ⊂ Org ⊂ Project ⊂ Task`);
 *   newer-wins without supersession SHALL be rejected.
 *
 * The ConflictResolver resolves two conflicting claims by walking the
 * precedence ladder in order. Each step is a strict short-circuit: if step 1
 * decides, steps 2–4 are not consulted, and so on.
 *
 * `resolve()` is a **pure function** over its inputs — it does not mutate the
 * claims and does not journal. The caller is responsible for journaling the
 * outcome (`conflict.resolved` or `conflict.pending`) and applying any state
 * transitions via ClaimStore. This separation keeps the resolver testable and
 * deterministic (no hidden side effects).
 *
 * @forge-trace {"component_id":"kernel-conflict-resolver","problems":["P65","P67"],"heritage":["E01","K08"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { authorityRank, isLegalKnowledgeType } from './knowledge-types.js';

import type { Claim } from './claim.js';

// ---------------------------------------------------------------------------
// Scope hierarchy (FR-S4-11)
// ---------------------------------------------------------------------------

/**
 * The four scope tiers from broadest to narrowest (FR-S4-11):
 *   `Global ⊂ Org ⊂ Project ⊂ Task`
 *
 * A narrower scope wins when authorities are equal and there is no explicit
 * supersession. Lower number = narrower scope = wins.
 */
export const SCOPE_ORDER: Readonly<Record<string, number>> = {
  task: 0,
  project: 1,
  org: 2,
  global: 3,
};

/** Canonical scope key (case-insensitive). Returns null for unknown scopes. */
export function scopeRank(scope: string): number | null {
  const key = scope.toLowerCase();
  return SCOPE_ORDER[key] ?? null;
}

// ---------------------------------------------------------------------------
// Resolution result types
// ---------------------------------------------------------------------------

/** The outcome of a conflict resolution. */
export type ConflictOutcome =
  | { kind: 'resolved'; winner: 'A' | 'B'; reason: string; loser: 'A' | 'B' }
  | { kind: 'pending'; reason: string };

/** The input pair for conflict resolution. */
export interface ConflictPair {
  /** The older claim (A). */
  claimA: Claim & { knowledgeType?: string };
  /** The newer claim (B). */
  claimB: Claim & { knowledgeType?: string };
}

// ---------------------------------------------------------------------------
// FR-S4-11: ConflictResolver.resolve
// ---------------------------------------------------------------------------

/**
 * FR-S4-11: Resolve a conflict between two claims.
 *
 * The claims must both carry a `knowledgeType` (added by P3-4 alongside the
 * Claim schema). Claim A is the older, Claim B is the newer.
 *
 * Precedence ladder (short-circuit at each step):
 *   1. Higher authority — the claim whose knowledge type has a lower
 *      authority rank wins. If either type is not authority-ordered (e.g.
 *      Assumption or Skill), this step is skipped (cannot decide by
 *      authority).
 *   2. Explicit supersession — if the newer claim (B) carries a `supersedes`
 *      that names the older claim (A) with a reason, B wins by explicit
 *      supersession (naming what is voided and why). If A supersedes B
 *      (unusual but legal), A wins.
 *   3. Narrowest scope wins — when authorities are equal and no supersession,
 *      the narrower scope wins (`Global ⊂ Org ⊂ Project ⊂ Task`).
 *   4. conflict_pending — if none of the above can decide, the conflict is
 *      pending. **Newer-wins without supersession is explicitly rejected**
 *      (FR-S4-11) — the resolver SHALL NOT silently pick the newer claim.
 *
 * @returns a ConflictOutcome. The caller journals `conflict.resolved` or
 *          `conflict.pending` and applies state transitions.
 */
export function resolve(pair: ConflictPair): ConflictOutcome {
  const { claimA, claimB } = pair;
  const typeA = claimA.knowledgeType;
  const typeB = claimB.knowledgeType;

  // Validate knowledge types if present.
  if (typeA !== undefined && !isLegalKnowledgeType(typeA)) {
    return {
      kind: 'pending',
      reason: `claim A has unknown knowledge type '${typeA}' (FR-S4-10)`,
    };
  }
  if (typeB !== undefined && !isLegalKnowledgeType(typeB)) {
    return {
      kind: 'pending',
      reason: `claim B has unknown knowledge type '${typeB}' (FR-S4-10)`,
    };
  }

  // --- Step 1: higher authority wins ---
  const rankA = typeA !== undefined ? authorityRank(typeA) : null;
  const rankB = typeB !== undefined ? authorityRank(typeB) : null;
  if (rankA !== null && rankB !== null) {
    if (rankA < rankB) {
      return {
        kind: 'resolved',
        winner: 'A',
        loser: 'B',
        reason: `higher authority: ${typeA} (rank ${rankA}) > ${typeB} (rank ${rankB}) (FR-S4-11)`,
      };
    }
    if (rankB < rankA) {
      return {
        kind: 'resolved',
        winner: 'B',
        loser: 'A',
        reason: `higher authority: ${typeB} (rank ${rankB}) > ${typeA} (rank ${rankA}) (FR-S4-11)`,
      };
    }
    // ranks equal → fall through to step 2
  }

  // --- Step 2: explicit supersession wins ---
  // The newer claim (B) supersedes the older (A)?
  if (claimB.supersedes && claimB.supersedes.claimId === claimA.claimId) {
    return {
      kind: 'resolved',
      winner: 'B',
      loser: 'A',
      reason: `explicit supersession: claim B supersedes A — "${claimB.supersedes.reason}" (FR-S4-11)`,
    };
  }
  // The older claim (A) supersedes the newer (B)? (unusual but legal)
  if (claimA.supersedes && claimA.supersedes.claimId === claimB.claimId) {
    return {
      kind: 'resolved',
      winner: 'A',
      loser: 'B',
      reason: `explicit supersession: claim A supersedes B — "${claimA.supersedes.reason}" (FR-S4-11)`,
    };
  }

  // --- Step 3: narrowest scope wins (when authorities equal, no supersession) ---
  // Only applies if both types are authority-ordered and equal, OR if
  // authority couldn't decide (one or both types not in authority order).
  const scopeA = scopeRank(claimA.scope);
  const scopeB = scopeRank(claimB.scope);
  if (scopeA !== null && scopeB !== null) {
    if (scopeA < scopeB) {
      return {
        kind: 'resolved',
        winner: 'A',
        loser: 'B',
        reason: `narrowest scope wins: ${claimA.scope} ⊂ ${claimB.scope} (FR-S4-11)`,
      };
    }
    if (scopeB < scopeA) {
      return {
        kind: 'resolved',
        winner: 'B',
        loser: 'A',
        reason: `narrowest scope wins: ${claimB.scope} ⊂ ${claimA.scope} (FR-S4-11)`,
      };
    }
    // scopes equal → fall through to pending
  }

  // --- Step 4: conflict_pending ---
  // FR-S4-11: newer-wins without supersession SHALL be rejected.
  // We do NOT silently pick the newer claim (B). The conflict is pending
  // and requires a decision (human or downstream authority).
  let reason =
    'conflict_pending: no authority, supersession, or scope difference could decide (FR-S4-11)';
  if (scopeA === null || scopeB === null) {
    reason += ` — unknown scope ('${claimA.scope}' / '${claimB.scope}')`;
  } else if (scopeA === scopeB) {
    reason += ` — equal scope ('${claimA.scope}')`;
  }
  if (rankA !== null && rankB !== null && rankA === rankB) {
    reason += ` — equal authority (${typeA} = ${typeB})`;
  }
  return { kind: 'pending', reason };
}
