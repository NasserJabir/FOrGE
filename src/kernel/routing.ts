/**
 * K-5 Routing — domain × level × authority, limitations before capability claims (FR-K5-2, INV-6).
 *
 * FR-K5-2: routing evaluates domain × level × authority; surfaces
 *   known_limitations BEFORE capability claims (INV-6).
 * INV-6: limitations before capability claims — a candidate with known
 *   limitations is NOT presented as unlimited.
 * DEC-02: agent identity (durable, scoped).
 *
 * The routing function evaluates candidates against a task's requirements
 * (domain, minimum capability level, minimum authority class) and returns the
 * matched candidates. Crucially, the routing output surfaces known_limitations
 * BEFORE capability claims (INV-6) — a candidate with limitations is never
 * presented as unlimited.
 *
 * @forge-trace {"component_id":"kernel-routing","problems":["P09"],"heritage":["K05","INV-2","INV-6"],"decisions":["DEC-02"],"bp_ids":[],"ac_ids":[]}
 */
import { AUTHORITY_CLASSES, CAPABILITY_LEVELS } from './agent-registry.js';

import type { AuthorityClass, CapabilityLevel } from './agent-registry.js';

/** A routing candidate — derived from an AgentIdentity. */
export interface RoutingCandidate {
  identityId: string;
  capabilityMatrix: Array<{ domain: string; level: CapabilityLevel; certifiedBy: string[] }>;
  knownLimitations: string[];
  authorityClass: AuthorityClass;
}

/** The task requirements for routing. */
export interface RoutingRequest {
  domain: string;
  /** Minimum capability level required. */
  level: CapabilityLevel;
  /** Minimum authority class required. */
  requiredAuthority: AuthorityClass;
}

/** A matched candidate with its limitations surfaced (INV-6). */
export interface RoutingMatch {
  identityId: string;
  authorityClass: AuthorityClass;
  matchedDomain: string;
  matchedLevel: CapabilityLevel;
  /** Known limitations surfaced BEFORE capability claims (INV-6). */
  knownLimitations: string[];
  capabilityClaims: Array<{ domain: string; level: CapabilityLevel; certifiedBy: string[] }>;
}

/** The result of routing. */
export type RoutingResult =
  { ok: true; matched: RoutingMatch[]; summary: string } | { ok: false; reason: string };

/** Options for constructing a RoutingEngine. */
export interface RoutingOptions {
  candidates: RoutingCandidate[];
}

/**
 * The authority ranking (OBSERVER < EXECUTOR < COMMITTER < APPROVER).
 * Used to compare whether a candidate's authority meets the required minimum.
 */
const AUTHORITY_RANK: Readonly<Record<AuthorityClass, number>> = {
  OBSERVER: 0,
  EXECUTOR: 1,
  COMMITTER: 2,
  APPROVER: 3,
};

/**
 * Route candidates against a task's requirements (FR-K5-2, INV-6).
 *
 * Evaluates domain × level × authority. A candidate matches when:
 *   1. It has a capability entry for the requested domain.
 *   2. The capability level is >= the required level.
 *   3. The authority class is >= the required authority class.
 *
 * The routing output surfaces known_limitations BEFORE capability claims
 * (INV-6) — a candidate with limitations is never presented as unlimited.
 */
export function route(candidates: RoutingCandidate[], req: RoutingRequest): RoutingResult {
  // Validate the request.
  if (!CAPABILITY_LEVELS.includes(req.level)) {
    return { ok: false, reason: `unknown capability level '${String(req.level)}'` };
  }
  if (!AUTHORITY_CLASSES.includes(req.requiredAuthority)) {
    return { ok: false, reason: `unknown authority class '${String(req.requiredAuthority)}'` };
  }

  const reqLevelIdx = CAPABILITY_LEVELS.indexOf(req.level);
  const reqAuthRank = AUTHORITY_RANK[req.requiredAuthority];

  const matched: RoutingMatch[] = [];

  for (const candidate of candidates) {
    // Check authority class: candidate must have >= required authority.
    if (AUTHORITY_RANK[candidate.authorityClass] < reqAuthRank) {
      continue;
    }

    // Check domain × level: candidate must have a capability for the domain
    // at or above the required level.
    const capEntry = candidate.capabilityMatrix.find((c) => c.domain === req.domain);
    if (!capEntry) {
      continue;
    }
    const capLevelIdx = CAPABILITY_LEVELS.indexOf(capEntry.level);
    if (capLevelIdx < reqLevelIdx) {
      continue;
    }

    // The candidate matches. Surface known_limitations BEFORE capability
    // claims (INV-6) — the limitations are listed first in the match.
    matched.push({
      identityId: candidate.identityId,
      authorityClass: candidate.authorityClass,
      matchedDomain: capEntry.domain,
      matchedLevel: capEntry.level,
      knownLimitations: candidate.knownLimitations,
      capabilityClaims: candidate.capabilityMatrix,
    });
  }

  // Build the summary with limitations BEFORE capabilities (INV-6).
  const summary = buildSummary(matched);

  return { ok: true, matched, summary };
}

/**
 * Build a human-readable summary that surfaces limitations BEFORE capability
 * claims (INV-6). This is the key invariant: a candidate with limitations is
 * never presented as unlimited.
 */
function buildSummary(matched: RoutingMatch[]): string {
  const lines: string[] = [];
  for (const m of matched) {
    lines.push(`Candidate: ${m.identityId} (authority: ${m.authorityClass})`);
    // INV-6: limitations BEFORE capabilities.
    const limStr = m.knownLimitations.length > 0 ? m.knownLimitations.join(', ') : '(none)';
    lines.push(`Limitations: ${limStr}`);
    const capStr = m.capabilityClaims.map((c) => `${c.domain}@${c.level}`).join(', ');
    lines.push(`Capabilities: ${capStr}`);
  }
  return lines.join('\n');
}

/**
 * The K-5 Routing engine (FR-K5-2). Wraps the routing function with a stored
 * candidate set for convenience.
 */
export class RoutingEngine {
  private readonly candidates: RoutingCandidate[];

  constructor(opts: RoutingOptions) {
    this.candidates = opts.candidates;
  }

  /** Route against the stored candidate set. */
  route(req: RoutingRequest): RoutingResult {
    return route(this.candidates, req);
  }

  /** Add a candidate to the set. */
  addCandidate(candidate: RoutingCandidate): void {
    this.candidates.push(candidate);
  }
}
