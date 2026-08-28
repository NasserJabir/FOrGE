/**
 * K-2 Contract Store — typed Tier-A artifact store.
 *
 * FR-K2-1: store typed artifacts (TaskContract, PlanArtifact, DecisionRecord,
 *   SpawnContract, ContextGrant, AuthorityMatrix, Policy, claim/skill/evidence
 *   manifests).
 * FR-K2-2: every artifact carries frontmatter (artifactId, artifactType,
 *   version monotonic, createdAt/By, status, scope, lifecycleState,
 *   supersedes{?, reason REQUIRED}, contentHash, provenance[], evidenceRefs[],
 *   compatibility?).
 * FR-K2-3: validation re-computes contentHash against body and rejects mismatch;
 *   unknown frontmatter keys rejected (strict schema).
 * FR-K2-4: supersession requires explicit reason, moves to deprecated tree with
 *   visible tombstone, journals contract.superseded; silent mutation impossible.
 * FR-K2-5: artifacts human-readable (Markdown + structured frontmatter).
 * FR-K2-7: DecisionRecord captures context, chosen option, rejected alternative
 *   with reason, evidence refs, approver.
 * FR-K2-8: Authority Matrix human-always rows immutable by automation (P8).
 *
 * @forge-trace {"component_id":"kernel-contract-store","problems":["P01","P04","P14","P16","P22","P90"],"heritage":["K02","K04","K05","K07","K08","INV-4"],"decisions":["DEC-01","DEC-22"],"bp_ids":[],"ac_ids":["AC-P01"]}
 */
import { z } from 'zod';

import { sha256Hex } from '../lib/hash.js';
import { ulid } from '../lib/ulid.js';

import { canonicalJson } from './canonical-json.js';
import { weakestOf, type TrustLabel } from './trust-label.js';

/** The set of typed Tier-A artifact types (FR-K2-1). */
export const ARTIFACT_TYPES = [
  'TaskContract',
  'PlanArtifact',
  'DecisionRecord',
  'SpawnContract',
  'ContextGrant',
  'AuthorityMatrix',
  'Policy',
  'Claim',
  'Skill',
  'EvidenceBundle',
  'AgentIdentity',
  'PKP',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Artifact lifecycle states (FR-ART-4 representation layer; internal machine is normative). */
export const LIFECYCLE_STATES = [
  'observed',
  'proposed',
  'supported',
  'reviewed',
  'approved',
  'deprecated',
  'superseded',
  'refuted',
  'contested',
] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Strict frontmatter schema (FR-K2-2, FR-K2-3). Unknown keys rejected. */
const SupersedeSchema = z.object({
  artifactId: z.string().min(1),
  reason: z.string().min(1),
});

const EvidenceRefSchema = z.object({
  kind: z.string().min(1),
  locator: z.string().min(1),
  version_hash: z.string().min(1).optional(),
  pinned_at: z.string().min(1).optional(),
});

const ProvenanceSchema = z.object({
  source: z.string().min(1),
  ts: z.string().min(1),
});

export const FrontmatterSchema = z
  .object({
    artifactId: z.string().min(1),
    artifactType: z.enum(ARTIFACT_TYPES),
    version: z.number().int().positive(),
    createdAt: z.string().min(1),
    createdBy: z.string().min(1),
    status: z.string().min(1),
    scope: z.string().min(1),
    lifecycleState: z.enum(LIFECYCLE_STATES),
    supersedes: SupersedeSchema.optional(),
    contentHash: z.string().min(1),
    provenance: z.array(ProvenanceSchema),
    evidenceRefs: z.array(EvidenceRefSchema),
    compatibility: z.record(z.string(), z.unknown()).optional(),
    trustLabel: z.enum(['trusted/user', 'tool-output', 'web/untrusted', 'derived']),
  })
  .strict(); // FR-K2-3: unknown frontmatter keys rejected

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

/** A stored artifact: frontmatter + body (Markdown content). */
export interface Artifact {
  frontmatter: Frontmatter;
  body: string;
}

/** Validation result. */
export type ValidationResult = { ok: true; artifact: Artifact } | { ok: false; errors: string[] };

/** A supersession request. */
export interface SupersedeRequest {
  oldArtifactId: string;
  newArtifactId: string;
  reason: string;
}

/**
 * The K-2 Contract Store. Stores typed Tier-A artifacts, validates strict
 * frontmatter, enforces contentHash integrity, and manages supersession with
 * visible tombstones. Silent mutation is structurally impossible.
 */
export class ContractStore {
  private readonly byId: Map<string, Artifact> = new Map();
  private readonly deprecated: Map<string, Artifact> = new Map();
  private readonly byType: Map<ArtifactType, string[]> = new Map();
  private readonly history: Map<string, string[]> = new Map(); // artifactId -> [supersededBy chain]

  /**
   * Validate an artifact's frontmatter and contentHash (FR-K2-3).
   * Re-computes contentHash against the body; rejects mismatch and unknown keys.
   */
  validate(raw: unknown): ValidationResult {
    if (typeof raw !== 'object' || raw === null) {
      return { ok: false, errors: ['artifact must be an object'] };
    }
    const obj = raw as Record<string, unknown>;
    const fmRaw = obj.frontmatter;
    const body = obj.body;
    if (typeof body !== 'string') {
      return { ok: false, errors: ['body must be a string'] };
    }

    // FR-K2-3: strict schema parse rejects unknown keys.
    const parsed = FrontmatterSchema.safeParse(fmRaw);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    const fm = parsed.data;

    // FR-K2-3: re-compute contentHash against the body and reject mismatch.
    const computed = sha256Hex(canonicalJson({ body, frontmatter: stripHash(fm) }));
    if (computed !== fm.contentHash) {
      return { ok: false, errors: ['contentHash mismatch (frontmatter hash does not match body)'] };
    }

    return { ok: true, artifact: { frontmatter: fm, body } };
  }

  /**
   * Store a validated artifact (FR-K2-1). Returns the stored artifact or errors.
   * Rejects if the artifact fails validation.
   */
  store(raw: unknown): ValidationResult {
    const v = this.validate(raw);
    if (!v.ok) return v;
    const art = v.artifact;
    this.byId.set(art.frontmatter.artifactId, art);
    const list = this.byType.get(art.frontmatter.artifactType) ?? [];
    list.push(art.frontmatter.artifactId);
    this.byType.set(art.frontmatter.artifactType, list);
    return { ok: true, artifact: art };
  }

  /** Read an artifact by id (FR-K2-5: inspectable without a running agent). */
  get(artifactId: string): Artifact | null {
    return this.byId.get(artifactId) ?? null;
  }

  /** List artifacts by type. */
  listByType(type: ArtifactType): Artifact[] {
    const ids = this.byType.get(type) ?? [];
    return ids.map((id) => this.byId.get(id)).filter((a): a is Artifact => a !== null);
  }

  /** List all artifacts. */
  list(): Artifact[] {
    return Array.from(this.byId.values());
  }

  /**
   * Supersede an artifact (FR-K2-4). Requires explicit reason. Moves the old
   * artifact to the deprecated tree with a visible tombstone. Journals
   * contract.superseded (caller is responsible for the K-1 journal event).
   * Silent mutation is structurally impossible — there is no update() method.
   */
  supersede(req: SupersedeRequest): { ok: boolean; reason?: string } {
    if (req.reason.length === 0) {
      return { ok: false, reason: 'supersession requires an explicit reason (FR-K2-4)' };
    }
    const old = this.byId.get(req.oldArtifactId);
    if (!old) {
      return { ok: false, reason: `artifact '${req.oldArtifactId}' not found` };
    }
    const newer = this.byId.get(req.newArtifactId);
    if (!newer) {
      return { ok: false, reason: `successor '${req.newArtifactId}' not found` };
    }
    // Move old to deprecated tree with tombstone.
    const tombstoned: Artifact = {
      frontmatter: { ...old.frontmatter, lifecycleState: 'superseded' },
      body:
        old.body + `\n\n---\n**SUPERSEDED** by \`${req.newArtifactId}\` — reason: ${req.reason}\n`,
    };
    this.deprecated.set(req.oldArtifactId, tombstoned);
    this.byId.delete(req.oldArtifactId);
    // Record history chain.
    const chain = this.history.get(req.oldArtifactId) ?? [];
    chain.push(req.newArtifactId);
    this.history.set(req.oldArtifactId, chain);
    return { ok: true };
  }

  /** Read a deprecated (tombstoned) artifact. */
  getDeprecated(artifactId: string): Artifact | null {
    return this.deprecated.get(artifactId) ?? null;
  }

  /** Get the supersession history chain for an artifact. */
  historyOf(artifactId: string): string[] {
    return this.history.get(artifactId) ?? [];
  }

  /**
   * Create a DecisionRecord (FR-K2-7). Captures context, chosen option,
   * rejected alternative with reason, evidence refs, approver.
   */
  createDecisionRecord(input: {
    context: string;
    chosenOption: string;
    rejectedAlternative: string;
    rejectionReason: string;
    evidenceRefs: Frontmatter['evidenceRefs'];
    approver: string;
    scope?: string;
  }): Artifact {
    const artifactId = `dr-${ulid()}`;
    const now = new Date().toISOString();
    const body = [
      `# Decision Record`,
      ``,
      `**Context:** ${input.context}`,
      ``,
      `**Chosen option:** ${input.chosenOption}`,
      ``,
      `**Rejected alternative:** ${input.rejectedAlternative}`,
      ``,
      `**Rejection reason:** ${input.rejectionReason}`,
      ``,
      `**Approver:** ${input.approver}`,
      ``,
      `**Evidence:** ${input.evidenceRefs.map((e) => e.locator).join(', ')}`,
    ].join('\n');
    const fm: Frontmatter = {
      artifactId,
      artifactType: 'DecisionRecord',
      version: 1,
      createdAt: now,
      createdBy: input.approver,
      status: 'approved',
      scope: input.scope ?? 'project',
      lifecycleState: 'approved',
      contentHash: '', // computed below
      provenance: [{ source: input.approver, ts: now }],
      evidenceRefs: input.evidenceRefs,
      trustLabel: 'trusted/user',
    };
    const contentHash = sha256Hex(canonicalJson({ body, frontmatter: stripHash(fm) }));
    const art: Artifact = { frontmatter: { ...fm, contentHash }, body };
    this.store(art);
    return art;
  }
}

/**
 * Compute the trust label for a derived artifact as the weakest of its sources
 * (DEC-42.1 / FR-S4-6). Exposed for K-2 consumers that compose artifacts.
 */
export function deriveTrustLabel(sources: TrustLabel[]): TrustLabel {
  return weakestOf(sources);
}

/** Strip the contentHash field for hash computation (it's computed over the rest). */
function stripHash(fm: Frontmatter): Omit<Frontmatter, 'contentHash'> {
  const { contentHash: _omit, ...rest } = fm;
  void _omit;
  return rest;
}
