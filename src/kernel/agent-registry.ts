/**
 * K-5 Agent Registry — durable AgentIdentity records (P1: structure).
 *
 * FR-K5-1: manage durable AgentIdentity records as Tier-A Markdown artifacts:
 *   identity_id, lineage?, persona_profile_ref?, private_memory_ns,
 *   private_skills[], experience_ledger, capability_matrix[{domain, level
 *   L0–L4, certified_by[], expires?}], known_limitations[], authority_class
 *   ∈ {OBSERVER, EXECUTOR, COMMITTER, APPROVER}, evolution_boundary,
 *   confidence_model.
 * FR-K5-2: routing evaluates domain × level × authority; surfaces
 *   known_limitations before capability claims (INV-6) — P2.
 * FR-K5-3: effective authority = Identity authority ∩ contract grant — P2.
 * FR-K5-6: experience ledger writes go to identity, post-gate — P5/P7.
 * FR-K5-7: unmanaged spawns enter Adoption Queue, never auto-adopted — P2.
 * FR-K5-8: agent-to-agent exchange via Offer→Evaluate→Adopt-as-Candidate — P5.
 *
 * P1 scope: the AgentIdentity record structure and the registry CRUD.
 * Lifecycle (spawn, grants, exchange) is P2+.
 *
 * @forge-trace {"component_id":"kernel-agent-registry","problems":["P09","P90"],"heritage":["K05","INV-2","INV-6"],"decisions":["DEC-02","DEC-03"],"bp_ids":[],"ac_ids":[]}
 */
import { z } from 'zod';

/** Capability levels L0–L4. */
export const CAPABILITY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type CapabilityLevel = (typeof CAPABILITY_LEVELS)[number];

/** Authority classes (FR-K5-1). */
export const AUTHORITY_CLASSES = ['OBSERVER', 'EXECUTOR', 'COMMITTER', 'APPROVER'] as const;
export type AuthorityClass = (typeof AUTHORITY_CLASSES)[number];

/** A capability matrix entry. */
export const CapabilityEntrySchema = z.object({
  domain: z.string().min(1),
  level: z.enum(CAPABILITY_LEVELS),
  certifiedBy: z.array(z.string()),
  expires: z.string().optional(),
});
export type CapabilityEntry = z.infer<typeof CapabilityEntrySchema>;

/** Evolution boundary — what the identity may learn/touch. */
export const EvolutionBoundarySchema = z.object({
  mayLearnIn: z.array(z.string()),
  mayTouchShared: z.boolean(),
  maySpawnAgents: z.boolean(),
});
export type EvolutionBoundary = z.infer<typeof EvolutionBoundarySchema>;

/** The AgentIdentity record (FR-K5-1). */
export const AgentIdentitySchema = z
  .object({
    identityId: z.string().min(1),
    lineage: z.string().optional(),
    personaProfileRef: z.string().optional(),
    privateMemoryNs: z.string().min(1),
    privateSkills: z.array(z.string()),
    experienceLedger: z.array(z.object({ ref: z.string(), ts: z.string() })),
    capabilityMatrix: z.array(CapabilityEntrySchema),
    knownLimitations: z.array(z.string()),
    authorityClass: z.enum(AUTHORITY_CLASSES),
    evolutionBoundary: EvolutionBoundarySchema,
    confidenceModel: z.record(z.string(), z.number()),
  })
  .strict();
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

/**
 * The K-5 Agent Registry. Stores durable AgentIdentity records.
 * P1: structure + CRUD. Lifecycle operations are P2+.
 */
export class AgentRegistry {
  private readonly byId: Map<string, AgentIdentity> = new Map();

  /**
   * Register a new AgentIdentity (FR-K5-1). Validates strict schema.
   */
  register(raw: unknown): { ok: true; identity: AgentIdentity } | { ok: false; errors: string[] } {
    const parsed = AgentIdentitySchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    }
    const id = parsed.data.identityId;
    if (this.byId.has(id)) {
      return { ok: false, errors: [`identity '${id}' already registered`] };
    }
    this.byId.set(id, parsed.data);
    return { ok: true, identity: parsed.data };
  }

  /** Read an identity by id. */
  get(identityId: string): AgentIdentity | null {
    return this.byId.get(identityId) ?? null;
  }

  /** List all identities. */
  list(): AgentIdentity[] {
    return Array.from(this.byId.values());
  }

  /**
   * Validate an identity record without storing (FR-K5-1 strict schema).
   */
  validate(raw: unknown): { ok: true } | { ok: false; errors: string[] } {
    const parsed = AgentIdentitySchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
    }
    return { ok: true };
  }
}
