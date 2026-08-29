/**
 * K-S4 Forgetting service — FR-S4-13.
 *
 * FR-S4-13: Forgetting SHALL be policy-driven:
 *   - use/last-access tracking,
 *   - reversible auto-archive,
 *   - visible tombstones for human erasure,
 *   - per-type decay;
 *   silent deletion prohibited.
 *
 * The ForgettingService enforces the core anti-silent-deletion invariant:
 * a claim SHALL NOT be deleted without a visible tombstone. `archive()` is
 * reversible (auto-archive with a restore path); `tombstone()` is the visible
 * marker for human-initiated erasure. A `deleteClaim()` that attempts silent
 * deletion (no tombstone, no archive) is explicitly rejected (FR-S4-13).
 *
 * Per-type decay: each knowledge type has a decay policy that determines when
 * a claim becomes eligible for auto-archive based on last-access time. The
 * caller supplies the current time; the service is deterministic and pure.
 *
 * @forge-trace {"component_id":"kernel-forgetting","problems":["P66","P65","P19"],"heritage":["E01","K08"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { isLegalKnowledgeType } from './knowledge-types.js';

import type { Claim } from './claim.js';
import type { EventJournal } from './event-journal.js';

// ---------------------------------------------------------------------------
// FR-S4-13: Decay policy (per-type)
// ---------------------------------------------------------------------------

/**
 * A decay policy for a knowledge type: the number of days of inactivity after
 * which a claim of that type becomes eligible for auto-archive (FR-S4-13).
 * `null` = never auto-archive (e.g., Constraint never decays).
 */
export type DecayDays = number | null;

/**
 * Per-type decay policy (FR-S4-13).
 *
 * Constraint: never decays (structural invariant).
 * Decision: long decay (decisions are sticky).
 * Fact: medium decay.
 * Environmental: short decay (environmental facts change often).
 * Heuristic: medium-short decay.
 * Preference: short decay (preferences shift).
 * Assumption: short decay (assumptions should be verified or forgotten).
 * Skill: never auto-archived (skills have their own lifecycle — FR-S4-10).
 */
export const DECAY_POLICY: Readonly<Record<string, DecayDays>> = {
  Constraint: null,
  Decision: 365,
  Fact: 180,
  Environmental: 90,
  Heuristic: 120,
  Preference: 60,
  Assumption: 30,
  Skill: null,
};

/**
 * FR-S4-13: Get the decay policy for a knowledge type.
 * Returns null (never decay) for unknown types.
 */
export function decayFor(type: string): DecayDays {
  return DECAY_POLICY[type] ?? null;
}

// ---------------------------------------------------------------------------
// FR-S4-13: Use/last-access tracking
// ---------------------------------------------------------------------------

/**
 * A use-tracking record: the last-access timestamp for a claim.
 * The caller maintains this (e.g., via Context Composer read events).
 */
export interface UseRecord {
  claimId: string;
  lastAccessedAt: string; // ISO 8601
  accessCount: number;
}

/**
 * FR-S4-13: Is a claim eligible for auto-archive given its use record and
 * the current time?
 *
 * Eligibility = the knowledge type has a decay policy (not null) AND the
 * days since last access exceed the decay threshold.
 */
export function isEligibleForArchive(knowledgeType: string, use: UseRecord, now: string): boolean {
  const decay = decayFor(knowledgeType);
  if (decay === null) return false;
  const lastMs = Date.parse(use.lastAccessedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) return false;
  const daysSince = (nowMs - lastMs) / (1000 * 60 * 60 * 24);
  return daysSince > decay;
}

// ---------------------------------------------------------------------------
// FR-S4-13: Archive + tombstone result types
// ---------------------------------------------------------------------------

/** A tombstone record — the visible marker for human erasure (FR-S4-13). */
export interface Tombstone {
  claimId: string;
  reason: string;
  erasedAt: string;
  erasedBy: string;
}

/** An archive record — reversible auto-archive (FR-S4-13). */
export interface ArchiveRecord {
  claimId: string;
  archivedAt: string;
  reason: string;
  reversible: true;
}

export type ArchiveResult =
  { ok: true; record: ArchiveRecord; eventId?: string } | { ok: false; reason: string };

export type TombstoneResult =
  { ok: true; tombstone: Tombstone; eventId?: string } | { ok: false; reason: string };

export type DeleteResult = { ok: true; eventId?: string } | { ok: false; reason: string };

/** Options for constructing a ForgettingService. */
export interface ForgettingServiceOptions {
  journal?: EventJournal;
}

// ---------------------------------------------------------------------------
// FR-S4-13: ForgettingService
// ---------------------------------------------------------------------------

/**
 * K-S4 ForgettingService — policy-driven forgetting with anti-silent-deletion
 * (FR-S4-13).
 */
export class ForgettingService {
  private readonly journal: EventJournal | undefined;

  constructor(opts: ForgettingServiceOptions = {}) {
    this.journal = opts.journal;
  }

  /**
   * FR-S4-13: Archive a claim (reversible auto-archive).
   *
   * The claim SHALL be recorded as archived with a reason. The archive is
   * reversible — `restore()` can reverse it. Journals `forget.archived`.
   */
  archive(claim: Claim & { knowledgeType?: string }, reason: string, now: string): ArchiveResult {
    if (!reason || reason.trim() === '') {
      return { ok: false, reason: 'archive requires a non-empty reason (FR-S4-13)' };
    }
    const record: ArchiveRecord = {
      claimId: claim.claimId,
      archivedAt: now,
      reason,
      reversible: true,
    };
    const eventId = this.journalForgetArchived(record);
    return { ok: true, record, ...(eventId !== undefined ? { eventId } : {}) };
  }

  /**
   * FR-S4-13: Restore an archived claim (reversibility).
   *
   * The archive is reversible — this removes the archive marker. Journals
   * `forget.restored`.
   */
  restore(claimId: string, reason: string): { ok: true; eventId?: string } {
    const eventId = this.journalAppend('forget.restored', { claimId, reason });
    return { ok: true, ...(eventId !== undefined ? { eventId } : {}) };
  }

  /**
   * FR-S4-13: Place a visible tombstone for human-initiated erasure.
   *
   * The tombstone is a VISIBLE marker — it records that the claim was erased,
   * by whom, when, and why. The claim data is removed but the tombstone
   * remains so the erasure is auditable (never silent). Journals
   * `forget.tombstone`.
   */
  tombstone(claim: Claim, reason: string, erasedBy: string, now: string): TombstoneResult {
    if (!reason || reason.trim() === '') {
      return { ok: false, reason: 'tombstone requires a non-empty reason (FR-S4-13)' };
    }
    if (!erasedBy || erasedBy.trim() === '') {
      return { ok: false, reason: 'tombstone requires an erasedBy actor (FR-S4-13)' };
    }
    const tombstone: Tombstone = {
      claimId: claim.claimId,
      reason,
      erasedAt: now,
      erasedBy,
    };
    const eventId = this.journalTombstone(tombstone);
    return { ok: true, tombstone, ...(eventId !== undefined ? { eventId } : {}) };
  }

  /**
   * FR-S4-13: Delete a claim — REQUIRES a tombstone.
   *
   * Silent deletion (no tombstone, no archive) is PROHIBITED (FR-S4-13).
   * This method enforces the invariant: `deleteClaim()` SHALL NOT proceed
   * unless a tombstone has been placed first. The caller MUST call
   * `tombstone()` before `deleteClaim()`.
   *
   * This is the explicit anti-silent-deletion guard (FR-S4-13).
   */
  deleteClaim(claimId: string, hasTombstone: boolean): DeleteResult {
    if (!hasTombstone) {
      return {
        ok: false,
        reason:
          'silent deletion prohibited (FR-S4-13): a visible tombstone MUST be placed before deletion; call tombstone() first',
      };
    }
    const eventId = this.journalAppend('forget.deleted', { claimId, tombstone: true });
    return { ok: true, ...(eventId !== undefined ? { eventId } : {}) };
  }

  // --- internal ---

  private journalForgetArchived(record: ArchiveRecord): string | undefined {
    if (!this.journal) return undefined;
    return this.journalAppend('forget.archived', record as unknown as Record<string, unknown>);
  }

  private journalTombstone(t: Tombstone): string | undefined {
    if (!this.journal) return undefined;
    return this.journalAppend('forget.tombstone', t as unknown as Record<string, unknown>);
  }

  private journalAppend(kind: string, payload: Record<string, unknown>): string | undefined {
    if (!this.journal) return undefined;
    const res = this.journal.append({
      actor: 'forge:kernel',
      kind,
      payload,
    });
    return res.kind === 'appended' ? res.event.event_id : undefined;
  }
}

// ---------------------------------------------------------------------------
// FR-S4-13: Per-type decay validation helper
// ---------------------------------------------------------------------------

/**
 * FR-S4-13: Validate that a knowledge type has a decay policy entry.
 * Used at claim-intake to ensure the type is governable by the forgetting
 * policy.
 */
export function hasDecayPolicy(type: string): boolean {
  if (!isLegalKnowledgeType(type)) return false;
  return type in DECAY_POLICY;
}
