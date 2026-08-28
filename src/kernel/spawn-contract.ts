/**
 * K-5 SpawnContract — effective authority = Identity ∩ contract (FR-K5-3/4, INV-2).
 *
 * FR-K5-3: effective authority = Identity authority ∩ contract grant.
 *   can_commit defaults false. Empty context grants = full privacy.
 * FR-K5-4: SpawnContract delivered to adapter as operational constraints AND
 *   monitored by pre-tool hooks. The contract is NOT a trust document.
 * INV-2: authority = identity ∩ contract — escalation via contract is impossible.
 * NFR-8: scoped grants, no ambient permissions.
 *
 * The SpawnContract is the operational constraint document for a managed spawn.
 * It is NOT a trust document: it can only REDUCE the identity's authority (via
 * intersection), never increase it. The effective authority is the intersection
 * of the identity's authorityClass and the contract's grantedAuthority.
 *
 * @forge-trace {"component_id":"kernel-spawn-contract","problems":["P09"],"heritage":["K05","INV-2","INV-7"],"decisions":["DEC-02","DEC-32"],"bp_ids":[],"ac_ids":[]}
 */
import { AUTHORITY_CLASSES } from './agent-registry.js';

import type { AgentIdentity, AuthorityClass } from './agent-registry.js';
import type { EventJournal } from './event-journal.js';

/** The event kind journaled when a SpawnContract is enforced. */
export const SPAWN_CONTRACT_KIND = 'spawn.contract';

/** The allowed scopes for a context grant within a SpawnContract (FR-K5-5). */
export const GRANT_SCOPES = ['read-only', 'read-comment'] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

/** A context grant entry embedded in a SpawnContract. */
export interface ContextGrantEntry {
  items: string[];
  scope: GrantScope;
  ttl?: number;
}

/** Input for creating a SpawnContract. */
export interface SpawnContractInput {
  identityId: string;
  taskId: string;
  grantedAuthority: AuthorityClass;
  /** Defaults false (FR-K5-3). */
  canCommit?: boolean;
  contextGrants: ContextGrantEntry[];
  createdBy: string;
}

/** The result of enforcing a SpawnContract. */
export interface EnforcementResult {
  identityId: string;
  taskId: string;
  effectiveAuthority: AuthorityClass;
  canCommit: boolean;
  contextGrants: ContextGrantEntry[];
  /** True when contextGrants is empty (FR-K5-3: empty = full privacy). */
  fullPrivacy: boolean;
}

/** Options for constructing a SpawnContractEnforcer. */
export interface SpawnContractEnforcerOptions {
  journal: EventJournal;
}

/**
 * The authority ranking (OBSERVER < EXECUTOR < COMMITTER < APPROVER).
 * The intersection of two authority classes is the LOWER of the two (INV-2).
 * This means a contract can never grant more authority than the identity has.
 */
const AUTHORITY_RANK: Readonly<Record<AuthorityClass, number>> = {
  OBSERVER: 0,
  EXECUTOR: 1,
  COMMITTER: 2,
  APPROVER: 3,
};

/**
 * Compute the effective authority = Identity ∩ contract (INV-2, FR-K5-3).
 *
 * The intersection is the LOWER of the two authority classes. This means:
 *   - An OBSERVER identity with a COMMITTER contract → OBSERVER (no escalation).
 *   - A COMMITTER identity with an OBSERVER contract → OBSERVER (scoped down).
 *   - An EXECUTOR identity with an EXECUTOR contract → EXECUTOR (unchanged).
 *
 * Escalation via contract is structurally impossible: the contract can only
 * reduce authority, never increase it.
 */
export function effectiveAuthority(
  identity: AgentIdentity,
  contract: SpawnContractInput,
): AuthorityClass {
  const idRank = AUTHORITY_RANK[identity.authorityClass];
  const cRank = AUTHORITY_RANK[contract.grantedAuthority];
  // The intersection is the lower of the two — the contract can only reduce.
  const lowerRank = Math.min(idRank, cRank);
  // Map the rank back to the authority class.
  for (const cls of AUTHORITY_CLASSES) {
    if (AUTHORITY_RANK[cls] === lowerRank) {
      return cls;
    }
  }
  // Unreachable: AUTHORITY_CLASSES covers all ranks 0..3.
  return 'OBSERVER';
}

/**
 * The K-5 SpawnContract enforcer (FR-K5-3/4).
 *
 * Enforces the SpawnContract as operational constraints on a managed spawn.
 * The contract is NOT a trust document — it can only reduce authority (via
 * intersection), never increase it. The enforcer journals a `spawn.contract`
 * event recording the effective authority.
 */
export class SpawnContractEnforcer {
  private readonly journal: EventJournal;

  constructor(opts: SpawnContractEnforcerOptions) {
    this.journal = opts.journal;
  }

  /**
   * Enforce a SpawnContract (FR-K5-3/4).
   *
   * Computes the effective authority (Identity ∩ contract), determines
   * can_commit (defaults false), and evaluates privacy (empty context grants
   * = full privacy). Journals a `spawn.contract` event with the result.
   *
   * The contract is delivered to the adapter as operational constraints AND
   * monitored by pre-tool hooks (FR-K5-4). It is NOT a trust document.
   */
  enforce(contract: SpawnContractInput, identity?: AgentIdentity): EnforcementResult {
    // FR-K5-3: effective authority = Identity ∩ contract.
    // If no identity is provided, the contract's grantedAuthority is the upper
    // bound (the identity will be resolved at composition time).
    const effective =
      identity !== undefined ? effectiveAuthority(identity, contract) : contract.grantedAuthority;

    // FR-K5-3: can_commit defaults false.
    const canCommit = contract.canCommit ?? false;

    // FR-K5-3: empty context grants = full privacy.
    const fullPrivacy = contract.contextGrants.length === 0;

    // Journal the spawn.contract event (FR-K5-4: auditable).
    this.journal.append({
      actor: 'forge:spawn-contract',
      kind: SPAWN_CONTRACT_KIND,
      payload: {
        spawnContractId: contract.identityId,
        identityId: contract.identityId,
        taskId: contract.taskId,
        grantedAuthority: contract.grantedAuthority,
        effectiveAuthority: effective,
        canCommit,
        fullPrivacy,
        contextGrants: contract.contextGrants,
      },
      task_ref: contract.taskId,
    });

    return {
      identityId: contract.identityId,
      taskId: contract.taskId,
      effectiveAuthority: effective,
      canCommit,
      contextGrants: contract.contextGrants,
      fullPrivacy,
    };
  }
}
