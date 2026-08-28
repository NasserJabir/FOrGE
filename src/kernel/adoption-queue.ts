/**
 * K-5 Adoption Queue — unmanaged spawns enter a queue, never auto-adopted (FR-K5-7).
 *
 * FR-K5-7: unmanaged spawns enter the Adoption Queue, NOT auto-adopted, NOT
 *   auto-trusted, and NOT silently destroyed. Adoption is a manual, auditable
 *   decision with an explicit adopter and reason.
 * DEC-32: adoption is a governance decision, not an automatic process.
 * DEC-33: the queue is visible and auditable.
 * INV-7: no side channels — the queue is journaled.
 *
 * An unmanaged spawn is an agent instance that appeared without a SpawnContract
 * (e.g., an external process that started an agent outside FOrGE's governance).
 * Such instances enter the Adoption Queue and wait for a human to manually adopt
 * them (with an explicit adopter and reason) or reject them. They are NEVER
 * auto-adopted, auto-trusted, or silently destroyed.
 *
 * @forge-trace {"component_id":"kernel-adoption-queue","problems":["P09"],"heritage":["K05","INV-7"],"decisions":["DEC-32","DEC-33"],"bp_ids":[],"ac_ids":[]}
 */
import { ulid } from '../lib/ulid.js';

import type { EventJournal } from './event-journal.js';

/** The event kind journaled when an instance enters the queue. */
export const ADOPTION_QUEUED_KIND = 'adoption.queued';

/** The event kind journaled when an instance is adopted. */
export const ADOPTION_ADOPTED_KIND = 'adoption.adopted';

/** Input for enqueueing an instance. */
export interface EnqueueInput {
  instanceId: string;
  source: string;
  observedAt: string;
}

/** A candidate in the Adoption Queue. */
export interface Candidate {
  candidateId: string;
  instanceId: string;
  source: string;
  observedAt: string;
  /** An unmanaged spawn is NEVER auto-trusted (FR-K5-7). */
  trusted: boolean;
  adopted: boolean;
  adoptedBy?: string;
  adoptedReason?: string;
  adoptedAt?: string;
}

/** Input for adopting a candidate. */
export interface AdoptInput {
  instanceId: string;
  adoptedBy: string;
  reason: string;
}

/** The result of an enqueue. */
export type EnqueueResult = { ok: true; candidateId: string } | { ok: false; reason: string };

/** The result of an adopt. */
export type AdoptResult = { ok: true; candidateId: string } | { ok: false; reason: string };

/** Options for constructing an AdoptionQueue. */
export interface AdoptionQueueOptions {
  journal: EventJournal;
}

/**
 * The K-5 Adoption Queue (FR-K5-7).
 *
 * Unmanaged spawns enter the queue and wait for manual adoption. They are
 * NEVER auto-adopted, auto-trusted, or silently destroyed. Every enqueue and
 * adoption is journaled as a K-1 event (auditable).
 */
export class AdoptionQueue {
  private readonly journal: EventJournal;
  private readonly candidates: Map<string, Candidate> = new Map();
  private readonly byInstance: Map<string, string> = new Map();

  constructor(opts: AdoptionQueueOptions) {
    this.journal = opts.journal;
  }

  /**
   * Enqueue an unmanaged spawn (FR-K5-7).
   *
   * The instance enters the queue as a candidate. It is NOT auto-adopted, NOT
   * auto-trusted, and NOT silently destroyed. The enqueue is journaled as an
   * `adoption.queued` event.
   */
  enqueue(input: EnqueueInput): EnqueueResult {
    if (this.byInstance.has(input.instanceId)) {
      return { ok: false, reason: `instance '${input.instanceId}' already queued` };
    }
    const candidateId = `aq-${ulid()}`;
    const candidate: Candidate = {
      candidateId,
      instanceId: input.instanceId,
      source: input.source,
      observedAt: input.observedAt,
      trusted: false, // FR-K5-7: NOT auto-trusted.
      adopted: false, // FR-K5-7: NOT auto-adopted.
    };

    // Journal the enqueue (FR-K5-7: auditable).
    this.journal.append({
      actor: 'forge:adoption-queue',
      kind: ADOPTION_QUEUED_KIND,
      payload: {
        candidateId,
        instanceId: input.instanceId,
        source: input.source,
        observedAt: input.observedAt,
      },
    });

    this.candidates.set(candidateId, candidate);
    this.byInstance.set(input.instanceId, candidateId);
    return { ok: true, candidateId };
  }

  /**
   * Adopt a candidate (FR-K5-7: manual only).
   *
   * Adoption is a manual, auditable decision with an explicit adopter and
   * reason. The adoption is journaled as an `adoption.adopted` event.
   */
  adopt(input: AdoptInput): AdoptResult {
    const candidateId = this.byInstance.get(input.instanceId);
    if (!candidateId) {
      return { ok: false, reason: `instance '${input.instanceId}' not in the queue` };
    }
    const candidate = this.candidates.get(candidateId);
    if (!candidate) {
      return { ok: false, reason: `candidate '${candidateId}' not found` };
    }
    if (candidate.adopted) {
      return { ok: false, reason: `instance '${input.instanceId}' already adopted` };
    }
    const adoptedAt = new Date().toISOString();
    candidate.adopted = true;
    candidate.adoptedBy = input.adoptedBy;
    candidate.adoptedReason = input.reason;
    candidate.adoptedAt = adoptedAt;

    // Journal the adoption (FR-K5-7: auditable).
    this.journal.append({
      actor: input.adoptedBy,
      kind: ADOPTION_ADOPTED_KIND,
      payload: {
        candidateId,
        instanceId: input.instanceId,
        adoptedBy: input.adoptedBy,
        reason: input.reason,
        adoptedAt,
      },
    });

    return { ok: true, candidateId };
  }

  /** List all candidates (pending and adopted). */
  listCandidates(): Candidate[] {
    return Array.from(this.candidates.values());
  }

  /** Read a candidate by instanceId. */
  getCandidate(instanceId: string): Candidate | null {
    const candidateId = this.byInstance.get(instanceId);
    if (!candidateId) return null;
    return this.candidates.get(candidateId) ?? null;
  }
}
