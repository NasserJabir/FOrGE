/**
 * K-S4 Staleness + zero-model-call derivation — FR-S4-5/9.
 *
 * FR-S4-5: Deterministic staleness SHALL be derived at read time with zero
 *   model calls (hash comparison); stale claims SHALL surface lazily in
 *   ongoing work and never disappear silently.
 * FR-S4-9: Staleness for non-artifact-grounded knowledge SHALL be `heuristic`
 *   (scheduled recheck) or `manual_only`; the system SHALL NOT claim
 *   deterministic staleness for it.
 *
 * The `checkStaleness` function is a **pure function** — it accepts a hash
 * lookup callback and performs a single hash comparison. There is no model
 * parameter in the API; this is structural enforcement of zero-model-call
 * (FR-S4-5). A model-call counter instrumented by the caller must remain 0.
 *
 * `deriveStalenessMode` enforces FR-S4-9: only artifact-grounded evidence
 * (kind='artifact' WITH a version_hash) may use 'deterministic_hash'; all
 * other evidence kinds must use 'heuristic' or 'manual_only'.
 *
 * @forge-trace {"component_id":"kernel-staleness","problems":["P18","P19","OR-3"],"heritage":["E01"],"decisions":["DEC-42.1"],"bp_ids":[],"ac_ids":["AC-BP3"]}
 */
import type { Claim, StalenessMode } from './claim.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A pure hash lookup: given an artifact id (the evidenceRef.locator), return
 * the artifact's current contentHash, or null if not found.
 *
 * This is deliberately NOT a model call — it is a single hash read from the
 * K-2 ContractStore. The purity of this callback is what enforces
 * zero-model-call (FR-S4-5): `checkStaleness` only compares hashes, it never
 * invokes a model.
 */
export type ArtifactHashLookup = (artifactId: string) => string | null;

/** The result of a staleness check. */
export type StalenessResult =
  | { ok: true; stale: boolean; pinnedHash: string; currentHash: string; reason?: string }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// FR-S4-9: isArtifactGrounded + deriveStalenessMode
// ---------------------------------------------------------------------------

/**
 * FR-S4-9: An evidence reference is "artifact-grounded" only if its kind is
 * 'artifact' AND it carries a non-empty version_hash. This is the
 * prerequisite for deterministic staleness (hash comparison).
 *
 * run_journal and external kinds are NOT artifact-grounded (they reference
 * K-1 journal ranges or external Tier-B content, not a K-2 artifact with a
 * contentHash).
 */
export function isArtifactGrounded(evidence: { kind: string; version_hash?: string }): boolean {
  return evidence.kind === 'artifact' && (evidence.version_hash ?? '') !== '';
}

/**
 * FR-S4-9: Derive the staleness mode from the evidence reference.
 *
 * - artifact-grounded (kind='artifact' + version_hash) → 'deterministic_hash'
 * - everything else → 'heuristic' (scheduled recheck)
 *
 * The caller may downgrade to 'manual_only' if desired, but the system SHALL
 * NOT allow 'deterministic_hash' for non-artifact-grounded evidence (OR-3).
 */
export function deriveStalenessMode(evidence: {
  kind: string;
  version_hash?: string;
}): StalenessMode {
  if (isArtifactGrounded(evidence)) {
    return 'deterministic_hash';
  }
  return 'heuristic';
}

// ---------------------------------------------------------------------------
// FR-S4-5: checkStaleness — pure function, zero model calls
// ---------------------------------------------------------------------------

/**
 * FR-S4-5: Check staleness of a claim at read time with zero model calls.
 *
 * For `deterministic_hash` mode:
 *   - Looks up the artifact's current contentHash via the pure `lookup`
 *     callback (a single hash read from K-2 — NOT a model call).
 *   - Compares the pinned `evidenceRef.version_hash` to the current hash.
 *   - If they differ → stale=true (the claim surfaces with both hashes and
 *     a reason; it never disappears silently — P19).
 *   - If they match → stale=false.
 *
 * For `heuristic` and `manual_only` modes:
 *   - Returns ok=false with a 'non-deterministic' reason — staleness cannot
 *     be determined via hash comparison for these modes (FR-S4-9). They
 *     require scheduled recheck (heuristic) or human review (manual_only).
 *
 * Defense in depth: if a deterministic claim is missing its pinned
 * version_hash (should not happen if FR-S4-9 is enforced at creation), the
 * check returns ok=false with a 'version_hash' reason.
 */
export function checkStaleness(claim: Claim, lookup: ArtifactHashLookup): StalenessResult {
  // Non-deterministic modes cannot be checked via hash comparison (FR-S4-9).
  if (claim.stalenessMode !== 'deterministic_hash') {
    return {
      ok: false,
      reason: `non-deterministic staleness mode '${claim.stalenessMode}' cannot be checked via hash comparison (FR-S4-9)`,
    };
  }

  const pinnedHash = claim.evidenceRef.version_hash;
  if (pinnedHash === undefined || pinnedHash === '') {
    // Defense in depth: a deterministic claim should always have a pinned
    // version_hash (enforced at creation by FR-S4-9). If it doesn't, we
    // cannot check it.
    return {
      ok: false,
      reason:
        'deterministic_hash claim is missing evidenceRef.version_hash (FR-S4-9 defense in depth)',
    };
  }

  // The artifact id is the evidenceRef.locator — this is a single hash read,
  // NOT a model call (FR-S4-5).
  const currentHash = lookup(claim.evidenceRef.locator);
  if (currentHash === null) {
    return {
      ok: false,
      reason: `artifact '${claim.evidenceRef.locator}' not found in K-2 store`,
    };
  }

  if (currentHash !== pinnedHash) {
    // FR-S4-5 / P19: stale claims surface lazily and never disappear silently.
    return {
      ok: true,
      stale: true,
      pinnedHash,
      currentHash,
      reason: `hash mismatch: pinned '${pinnedHash}' ≠ current '${currentHash}'`,
    };
  }

  return {
    ok: true,
    stale: false,
    pinnedHash,
    currentHash,
  };
}
