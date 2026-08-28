/**
 * K-5 ContextGrant — explicit, scoped, revocable context grants (FR-K5-5).
 *
 * FR-K5-5: ContextGrant SHALL be explicit — granter, grantee, items, scope
 *   ∈ {read-only, read-comment} (never write), TTL, revocable, logged, reason
 *   required. Grants and revocations are journaled as K-1 events.
 * DEC-03: context grants explicit (no ambient permissions).
 * INV-7: no side channels — grants are visible and auditable.
 *
 * A ContextGrant is the explicit mechanism for sharing context with an agent.
 * It is NEVER a trust document: it can only grant read access (read-only or
 * read-comment), NEVER write access. Every grant and revocation is journaled
 * as a K-1 event so the full history is auditable.
 *
 * @forge-trace {"component_id":"kernel-context-grant","problems":["P09"],"heritage":["K05","INV-7"],"decisions":["DEC-03"],"bp_ids":[],"ac_ids":[]}
 */
import { z } from 'zod';

import { ulid } from '../lib/ulid.js';

import type { EventJournal } from './event-journal.js';

/** The event kind journaled when a context grant is issued. */
export const CONTEXT_GRANT_KIND = 'context.grant';

/** The event kind journaled when a context grant is revoked. */
export const CONTEXT_REVOKE_KIND = 'context.revoke';

/** The allowed scopes (FR-K5-5: read-only/read-comment, never write). */
export const GRANT_SCOPES = ['read-only', 'read-comment'] as const;
export type GrantScope = (typeof GRANT_SCOPES)[number];

/** The strict ContextGrant input schema (FR-K5-5). */
export const ContextGrantInputSchema = z
  .object({
    granter: z.string().min(1),
    grantee: z.string().min(1),
    items: z.array(z.string().min(1)).min(1),
    scope: z.enum(GRANT_SCOPES),
    ttl: z.number().int().positive().optional(),
    reason: z.string().min(1),
  })
  .strict();

/** Input for creating a ContextGrant. */
export interface ContextGrantInput {
  granter: string;
  grantee: string;
  items: string[];
  scope: GrantScope;
  ttl?: number;
  reason: string;
}

/** A stored, active context grant. */
export interface ContextGrant {
  grantId: string;
  granter: string;
  grantee: string;
  items: string[];
  scope: GrantScope;
  ttl?: number;
  reason: string;
  grantedAt: string;
  revoked: boolean;
  revokedBy?: string;
  revokedReason?: string;
  revokedAt?: string;
}

/** The result of a grant attempt. */
export type GrantResult =
  { ok: true; grantId: string; grant: ContextGrant } | { ok: false; reason: string };

/** The result of a revoke attempt. */
export type RevokeResult = { ok: true; grantId: string } | { ok: false; reason: string };

/** Options for constructing a ContextGrantStore. */
export interface ContextGrantStoreOptions {
  journal: EventJournal;
}

/**
 * The K-5 ContextGrant store (FR-K5-5).
 *
 * Grants and revokes context access. Every grant is journaled as a
 * `context.grant` event; every revocation as a `context.revoke` event. The
 * scope is always read-only or read-comment — write is NEVER allowed. A
 * reason is required for every grant (FR-K5-5).
 */
export class ContextGrantStore {
  private readonly journal: EventJournal;
  private readonly grants: Map<string, ContextGrant> = new Map();

  constructor(opts: ContextGrantStoreOptions) {
    this.journal = opts.journal;
  }

  /**
   * Grant context access (FR-K5-5).
   *
   * Validates the input (strict schema: scope ∈ {read-only, read-comment},
   * reason required). Journals a `context.grant` event. Returns the grant.
   */
  grant(raw: unknown): GrantResult {
    const parsed = ContextGrantInputSchema.safeParse(raw);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue ? firstIssue.path.join('.') : 'input';
      return {
        ok: false,
        reason: `${field}: ${firstIssue?.message ?? 'invalid context grant'}`,
      };
    }
    const input = parsed.data;
    const grantId = `cg-${ulid()}`;
    const grantedAt = new Date().toISOString();
    const grant: ContextGrant = {
      grantId,
      granter: input.granter,
      grantee: input.grantee,
      items: input.items,
      scope: input.scope,
      reason: input.reason,
      grantedAt,
      revoked: false,
    };
    if (input.ttl !== undefined) {
      grant.ttl = input.ttl;
    }

    // Journal the grant as a K-1 event (FR-K5-5: logged).
    this.journal.append({
      actor: input.granter,
      kind: CONTEXT_GRANT_KIND,
      payload: {
        grantId,
        granter: input.granter,
        grantee: input.grantee,
        items: input.items,
        scope: input.scope,
        ttl: input.ttl ?? null,
        reason: input.reason,
        grantedAt,
      },
    });

    this.grants.set(grantId, grant);
    return { ok: true, grantId, grant };
  }

  /**
   * Revoke a context grant (FR-K5-5: revocable).
   *
   * Journals a `context.revoke` event. The grant is marked revoked.
   */
  revoke(input: { grantId: string; revokedBy: string; reason: string }): RevokeResult {
    const grant = this.grants.get(input.grantId);
    if (!grant) {
      return { ok: false, reason: `grant '${input.grantId}' not found` };
    }
    if (grant.revoked) {
      return { ok: false, reason: `grant '${input.grantId}' already revoked` };
    }
    const revokedAt = new Date().toISOString();
    grant.revoked = true;
    grant.revokedBy = input.revokedBy;
    grant.revokedReason = input.reason;
    grant.revokedAt = revokedAt;

    // Journal the revocation as a K-1 event (FR-K5-5: logged).
    this.journal.append({
      actor: input.revokedBy,
      kind: CONTEXT_REVOKE_KIND,
      payload: {
        grantId: input.grantId,
        revokedBy: input.revokedBy,
        reason: input.reason,
        revokedAt,
      },
    });

    return { ok: true, grantId: input.grantId };
  }

  /** Read a grant by id. */
  get(grantId: string): ContextGrant | null {
    return this.grants.get(grantId) ?? null;
  }

  /** List all grants (active and revoked). */
  list(): ContextGrant[] {
    return Array.from(this.grants.values());
  }

  /** List active (non-revoked) grants for a grantee. */
  activeFor(grantee: string): ContextGrant[] {
    return Array.from(this.grants.values()).filter((g) => g.grantee === grantee && !g.revoked);
  }
}
