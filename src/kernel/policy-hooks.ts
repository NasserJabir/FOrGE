/**
 * K-4 Policy Hook Points — five hook points, shadow-locked in P1.
 *
 * FR-K4-1: exactly five hook points: pre-send, pre-tool, post-result,
 *   pre-commit, periodic-tick; each evaluation outcome journaled as
 *   `hook.evaluated`.
 * FR-K4-2: K-4 contains no rule logic; rules load from Tier-A policy data
 *   (strictly typed PolicyRule).
 * FR-K4-3: P1 hook runner hard-locked to shadow mode: externally always
 *   allow; the would-be outcome, matched rules, and labels recorded as events.
 *   A provocation test SHALL prove shadow cannot block (T-SHADOW-1).
 * FR-K4-4: enforcement flips (shadow→enforce) per action class, gated (P8).
 * FR-K4-5: on layer failure: critical/destructive fail-closed; advisory
 *   fail-open with explicit `unverified` tag (R5) — P8.
 *
 * @forge-trace {"component_id":"kernel-policy-hooks","problems":["P10","P09","P83","P92","P13","P30"],"heritage":["E02"],"decisions":["DEC-01","DEC-30","DEC-35"],"bp_ids":[],"ac_ids":[]}
 */
import { z } from 'zod';
import type { EventJournal } from './event-journal.js';

/** The exactly five hook points (FR-K4-1). */
export const HOOK_POINTS = [
  'pre-send',
  'pre-tool',
  'post-result',
  'pre-commit',
  'periodic-tick',
] as const;
export type HookPoint = (typeof HOOK_POINTS)[number];

/** The effect a policy rule produces. */
export type PolicyEffect = 'allow' | 'deny' | 'advise';

/** Fail posture on layer failure (R5 / FR-K4-5). */
export type FailPosture = 'fail-closed' | 'fail-open';

/** Strictly typed PolicyRule (FR-K4-2 / C-11: policy is data, not code). */
export const PolicyRuleSchema = z.object({
  ruleId: z.string().min(1),
  hookPoint: z.enum(HOOK_POINTS),
  actionClass: z.string().min(1),
  effect: z.enum(['allow', 'deny', 'advise']),
  failPosture: z.enum(['fail-closed', 'fail-open']),
  conditions: z.array(z.record(z.string(), z.unknown())),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

/** The evaluation outcome of a hook run. */
export interface HookOutcome {
  hookPoint: HookPoint;
  actionClass: string;
  /** What the rules WOULD produce (shadow) or DO produce (enforce). */
  wouldBeEffect: PolicyEffect;
  /** Whether enforcement is active for this action class. */
  enforced: boolean;
  /** The final decision delivered to the caller. */
  decision: 'allow' | 'deny' | 'advise';
  /** Matched rule ids. */
  matchedRules: string[];
  /** Labels applied (for audit). */
  labels: string[];
}

/** Context passed to a hook evaluation. */
export interface HookContext {
  hookPoint: HookPoint;
  actionClass: string;
  /** The action payload (e.g., command, tool call, commit). */
  payload: Record<string, unknown>;
  /** Arbitrary labels already attached to the action. */
  labels: string[];
}

/**
 * The K-4 Policy Hook runner. In P1 it is hard-locked to shadow mode
 * (FR-K4-3): externally always allow; would-be outcomes journaled.
 */
export class PolicyHookRunner {
  private readonly journal: EventJournal;
  private readonly rules: PolicyRule[] = [];
  /** P1: hard-locked to shadow. Enforce mode is P8 (FR-K4-4). */
  private readonly mode: 'shadow' = 'shadow';
  /** Action classes flipped to enforce (P8 only; empty in P1). */
  private readonly enforcedClasses: Set<string> = new Set();

  constructor(journal: EventJournal) {
    this.journal = journal;
  }

  /**
   * Load policy rules from Tier-A policy data (FR-K4-2 / C-11).
   * K-4 contains no rule logic; it only interprets loaded data.
   */
  loadRules(rawRules: unknown[]): { ok: boolean; errors?: string[] } {
    const parsed: PolicyRule[] = [];
    const errors: string[] = [];
    for (let i = 0; i < rawRules.length; i++) {
      const r = PolicyRuleSchema.safeParse(rawRules[i]);
      if (!r.success) {
        errors.push(`rule[${i}]: ${r.error.issues.map((x) => x.message).join(', ')}`);
      } else {
        parsed.push(r.data);
      }
    }
    if (errors.length > 0) return { ok: false, errors };
    this.rules.push(...parsed);
    return { ok: true };
  }

  /**
   * Evaluate a hook (FR-K4-1). Returns the outcome and journals `hook.evaluated`.
   *
   * In P1 shadow mode (FR-K4-3): the decision delivered to the caller is
   * ALWAYS 'allow' regardless of what rules would produce. The would-be
   * effect, matched rules, and labels are recorded as a `hook.evaluated` event.
   */
  evaluate(ctx: HookContext): HookOutcome {
    // Find matching rules (FR-K4-2: interpret data, no logic).
    const matched = this.rules.filter(
      (r) => r.hookPoint === ctx.hookPoint && r.actionClass === ctx.actionClass,
    );

    // Compute the would-be effect: deny wins over advise, advise over allow.
    let wouldBeEffect: PolicyEffect = 'allow';
    for (const r of matched) {
      if (r.effect === 'deny') {
        wouldBeEffect = 'deny';
        break;
      }
      if (r.effect === 'advise' && wouldBeEffect === 'allow') {
        wouldBeEffect = 'advise';
      }
    }

    // P1: hard-locked to shadow. Enforced only if the action class was flipped
    // (P8). In P1, enforcedClasses is always empty, so enforced=false always.
    const enforced = this.enforcedClasses.has(ctx.actionClass);

    // FR-K4-3: shadow mode => externally always allow.
    // The decision delivered to the caller is 'allow' unless enforced.
    let decision: HookOutcome['decision'] = 'allow';
    if (enforced) {
      decision = wouldBeEffect === 'deny' ? 'deny' : wouldBeEffect === 'advise' ? 'advise' : 'allow';
    }
    // In shadow, decision is always 'allow' (T-SHADOW-1 invariant).

    const outcome: HookOutcome = {
      hookPoint: ctx.hookPoint,
      actionClass: ctx.actionClass,
      wouldBeEffect,
      enforced,
      decision,
      matchedRules: matched.map((r) => r.ruleId),
      labels: ctx.labels,
    };

    // FR-K4-1: journal each evaluation outcome as `hook.evaluated`.
    this.journal.append({
      actor: 'forge:kernel',
      kind: 'hook.evaluated',
      payload: {
        hookPoint: outcome.hookPoint,
        actionClass: outcome.actionClass,
        wouldBeEffect: outcome.wouldBeEffect,
        enforced: outcome.enforced,
        decision: outcome.decision,
        matchedRules: outcome.matchedRules,
        labels: outcome.labels,
        mode: this.mode,
      },
    });

    return outcome;
  }

  /** The current mode (always 'shadow' in P1). */
  getMode(): 'shadow' | 'enforce' {
    return this.mode;
  }

  /** Whether an action class is enforced (always false in P1). */
  isEnforced(actionClass: string): boolean {
    return this.enforcedClasses.has(actionClass);
  }
}
