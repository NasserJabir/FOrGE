/**
 * K-S4 Scope-bleed guard — FR-S4-12.
 *
 * FR-S4-12: Scope promotion private→shared SHALL pass a lifecycle gate;
 *   cross-scope privacy bleed SHALL be blocked (anti-bleed), tested.
 *
 * The ScopeBleedGuard enforces two related rules:
 *
 * 1. **Scope promotion gate**: a private→shared scope promotion SHALL pass a
 *    lifecycle gate. The caller must supply a gate-passed flag (set by the
 *    lifecycle review step). Without the gate pass, the promotion is blocked
 *    and recorded (`scope.promotion` with `passed=false`).
 *
 * 2. **Cross-scope privacy bleed**: a consumer at a broader scope SHALL NOT
 *    see claims from a narrower private scope unless the claim has been
 *    explicitly promoted to shared. `canRead()` blocks the bleed.
 *
 * `promoteScope()` and `canRead()` are pure functions over their inputs —
 * they do not mutate claims. The caller journals `scope.promotion` and
 * applies the scope change via ClaimStore/ContractStore.
 *
 * @forge-trace {"component_id":"kernel-scope-bleed","problems":["P67","P65"],"heritage":["E01","K08"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { scopeRank } from './conflict-resolver.js';

import type { Claim } from './claim.js';
import type { EventJournal } from './event-journal.js';

// ---------------------------------------------------------------------------
// Scope visibility model (FR-S4-12)
// ---------------------------------------------------------------------------

/**
 * A claim's visibility — `private` (only its own scope) or `shared`
 * (promoted, visible to broader scopes after passing the lifecycle gate).
 */
export type Visibility = 'private' | 'shared';

/**
 * The visibility of a claim, carried alongside the scope. The Claim schema
 * itself uses a free-form `scope` string; the bleed guard consults this
 * helper field if present (added by P3-4 alongside the Claim).
 */
export interface ScopedClaim extends Claim {
  visibility?: Visibility;
}

// ---------------------------------------------------------------------------
// Promotion result types
// ---------------------------------------------------------------------------

/** The result of a scope-promotion attempt. */
export type PromotionResult =
  | { ok: true; fromScope: string; toScope: string; visibility: Visibility; eventId?: string }
  | { ok: false; reason: string };

/** Options for constructing a ScopeBleedGuard. */
export interface ScopeBleedGuardOptions {
  journal?: EventJournal;
}

// ---------------------------------------------------------------------------
// FR-S4-12: ScopeBleedGuard
// ---------------------------------------------------------------------------

/**
 * K-S4 ScopeBleedGuard — enforces the private→shared lifecycle gate and
 * cross-scope anti-bleed (FR-S4-12).
 */
export class ScopeBleedGuard {
  private readonly journal: EventJournal | undefined;

  constructor(opts: ScopeBleedGuardOptions = {}) {
    this.journal = opts.journal;
  }

  /**
   * FR-S4-12: Promote a claim's scope from private to shared.
   *
   * The promotion SHALL pass a lifecycle gate — the caller sets
   * `gatePassed=true` only after the lifecycle review step has approved the
   * promotion. Without the gate pass, the promotion is blocked and recorded
   * (`scope.promotion` with `passed=false`).
   *
   * The claim MUST currently be `private`; promoting an already-`shared`
   * claim is a no-op success (idempotent) but still journaled.
   *
   * @returns a PromotionResult. On success, the caller applies the visibility
   *          change and journals `scope.promotion` with `passed=true` (this
   *          method journals the blocked case itself when a journal is
   *          configured).
   */
  promoteScope(claim: ScopedClaim, toScope: string, gatePassed: boolean): PromotionResult {
    const fromVisibility = claim.visibility ?? 'private';

    // Idempotent: already shared.
    if (fromVisibility === 'shared') {
      this.journalScopePromotion(claim.claimId, claim.scope, toScope, true, 'already shared');
      return {
        ok: true,
        fromScope: claim.scope,
        toScope,
        visibility: 'shared',
      };
    }

    // FR-S4-12: private→shared SHALL pass the lifecycle gate.
    if (!gatePassed) {
      this.journalScopePromotion(
        claim.claimId,
        claim.scope,
        toScope,
        false,
        'lifecycle gate not passed (FR-S4-12)',
      );
      return {
        ok: false,
        reason:
          'private→shared scope promotion requires a passed lifecycle gate (FR-S4-12); the promotion is blocked and recorded',
      };
    }

    // Gate passed → promotion allowed.
    this.journalScopePromotion(claim.claimId, claim.scope, toScope, true, 'lifecycle gate passed');
    return {
      ok: true,
      fromScope: claim.scope,
      toScope,
      visibility: 'shared',
    };
  }

  /**
   * FR-S4-12: Can a consumer at `consumerScope` read a claim at `claimScope`
   * with the given visibility?
   *
   * Anti-bleed rule: a `private` claim is visible ONLY to consumers at the
   * same scope. A broader-scope consumer SHALL NOT see a narrower private
   * claim (cross-scope privacy bleed is blocked). A `shared` claim is visible
   * to broader scopes after promotion.
   *
   * Same-scope is always allowed (private or shared). Narrower consumer than
   * the claim is always allowed (the consumer is inside the claim's scope).
   */
  canRead(claimScope: string, claimVisibility: Visibility, consumerScope: string): boolean {
    // Same scope → always readable.
    if (scopeEqual(claimScope, consumerScope)) {
      return true;
    }
    // Shared → readable by any scope (promoted).
    if (claimVisibility === 'shared') {
      return true;
    }
    // Private → anti-bleed (FR-S4-12). A broader-scope consumer SHALL NOT see
    // a narrower private claim. A narrower consumer (inside the claim's scope)
    // MAY read a broader private claim — it is contained within that scope.
    const claimRank = scopeRank(claimScope);
    const consumerRank = scopeRank(consumerScope);
    if (claimRank !== null && consumerRank !== null) {
      // Lower rank = narrower. Consumer narrower than claim → allowed (inside).
      return consumerRank < claimRank;
    }
    // Unknown/custom scopes (not in the 4-tier hierarchy) → strictly same-scope
    // only for private (anti-bleed conservative default).
    return false;
  }

  // --- internal ---

  private journalScopePromotion(
    claimId: string,
    fromScope: string,
    toScope: string,
    passed: boolean,
    reason: string,
  ): void {
    if (!this.journal) return;
    this.journal.append({
      actor: 'forge:kernel',
      kind: 'scope.promotion',
      payload: {
        claimId,
        fromScope,
        toScope,
        passed,
        reason,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Case-insensitive scope equality. */
export function scopeEqual(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
