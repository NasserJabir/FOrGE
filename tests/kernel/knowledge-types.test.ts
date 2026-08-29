/**
 * K-S4 Knowledge types + authority order tests — FR-S4-10, with provocation
 * tests (C-07).
 *
 * T-KTYPE-1 (eight types + authority order): a claim typed outside the eight
 *   knowledge types is rejected; two conflicting claims resolve by authority
 *   order `Constraint > Decision > Fact > Environmental > Heuristic >
 *   Preference` (FR-S4-10, P63).
 * T-KTYPE-2 (Assumptions at zero confidence): an Assumption claim created
 *   with `confidence > 0` is downgraded to 0 (FR-S4-10).
 *
 * @forge-trace {"component_id":"test-kernel-knowledge-types","problems":["P63","P65"],"heritage":["E01","K05"],"decisions":["DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import {
  AUTHORITY_ORDER,
  AUTHORITY_ORDERED_TYPES,
  ASSUMPTION_CONFIDENCE,
  KNOWLEDGE_TYPES,
  authorityRank,
  compareAuthority,
  enforceAssumptionConfidence,
  isAuthorityOrdered,
  isLegalKnowledgeType,
  isSkillLifecycle,
} from '../../src/kernel/knowledge-types.js';

// ---------------------------------------------------------------------------
// T-KTYPE-1: eight types + authority order (FR-S4-10, P63)
// ---------------------------------------------------------------------------

describe('T-KTYPE-1: eight knowledge types + authority order (FR-S4-10)', () => {
  it('exposes exactly the eight knowledge types', () => {
    expect(KNOWLEDGE_TYPES).toHaveLength(8);
    expect(KNOWLEDGE_TYPES).toContain('Constraint');
    expect(KNOWLEDGE_TYPES).toContain('Decision');
    expect(KNOWLEDGE_TYPES).toContain('Fact');
    expect(KNOWLEDGE_TYPES).toContain('Environmental');
    expect(KNOWLEDGE_TYPES).toContain('Heuristic');
    expect(KNOWLEDGE_TYPES).toContain('Preference');
    expect(KNOWLEDGE_TYPES).toContain('Assumption');
    expect(KNOWLEDGE_TYPES).toContain('Skill');
  });

  it('rejects a claim typed outside the eight knowledge types', () => {
    // A type that is not in the eight — provocation: an attacker tries to
    // inject "Rule" or "Belief" as a knowledge type.
    expect(isLegalKnowledgeType('Rule')).toBe(false);
    expect(isLegalKnowledgeType('Belief')).toBe(false);
    expect(isLegalKnowledgeType('')).toBe(false);
    expect(isLegalKnowledgeType('constraint')).toBe(false); // case-sensitive
    expect(isLegalKnowledgeType('fact')).toBe(false);
  });

  it('accepts each of the eight knowledge types', () => {
    for (const t of KNOWLEDGE_TYPES) {
      expect(isLegalKnowledgeType(t)).toBe(true);
    }
  });

  it('exposes exactly the six authority-ordered types', () => {
    expect(AUTHORITY_ORDERED_TYPES).toHaveLength(6);
    expect(AUTHORITY_ORDERED_TYPES).not.toContain('Assumption');
    expect(AUTHORITY_ORDERED_TYPES).not.toContain('Skill');
  });

  it('authority order is Constraint > Decision > Fact > Environmental > Heuristic > Preference', () => {
    expect(AUTHORITY_ORDER.Constraint).toBe(0);
    expect(AUTHORITY_ORDER.Decision).toBe(1);
    expect(AUTHORITY_ORDER.Fact).toBe(2);
    expect(AUTHORITY_ORDER.Environmental).toBe(3);
    expect(AUTHORITY_ORDER.Heuristic).toBe(4);
    expect(AUTHORITY_ORDER.Preference).toBe(5);
  });

  it('compareAuthority: Constraint has higher authority than Decision (negative)', () => {
    expect(compareAuthority('Constraint', 'Decision')).toBeLessThan(0);
    expect(compareAuthority('Decision', 'Constraint')).toBeGreaterThan(0);
  });

  it('compareAuthority: Fact > Environmental > Heuristic > Preference', () => {
    expect(compareAuthority('Fact', 'Environmental')).toBeLessThan(0);
    expect(compareAuthority('Environmental', 'Heuristic')).toBeLessThan(0);
    expect(compareAuthority('Heuristic', 'Preference')).toBeLessThan(0);
  });

  it('compareAuthority: equal types return 0', () => {
    expect(compareAuthority('Fact', 'Fact')).toBe(0);
    expect(compareAuthority('Constraint', 'Constraint')).toBe(0);
  });

  it('authorityRank: Constraint=0 (highest), Preference=5 (lowest)', () => {
    expect(authorityRank('Constraint')).toBe(0);
    expect(authorityRank('Preference')).toBe(5);
  });

  it('authorityRank: Assumption and Skill are NOT in the authority order (null)', () => {
    expect(authorityRank('Assumption')).toBeNull();
    expect(authorityRank('Skill')).toBeNull();
  });

  it('isAuthorityOrdered: true for the six, false for Assumption/Skill/invalid', () => {
    expect(isAuthorityOrdered('Constraint')).toBe(true);
    expect(isAuthorityOrdered('Preference')).toBe(true);
    expect(isAuthorityOrdered('Assumption')).toBe(false);
    expect(isAuthorityOrdered('Skill')).toBe(false);
    expect(isAuthorityOrdered('Rule')).toBe(false);
  });

  it('compareAuthority throws for non-authority types (cannot compare by authority)', () => {
    expect(() => compareAuthority('Assumption', 'Fact')).toThrow();
    expect(() => compareAuthority('Fact', 'Skill')).toThrow();
    expect(() => compareAuthority('Assumption', 'Skill')).toThrow();
  });

  it('isSkillLifecycle: true only for Skill (own lifecycle, FR-S4-10)', () => {
    expect(isSkillLifecycle('Skill')).toBe(true);
    expect(isSkillLifecycle('Fact')).toBe(false);
    expect(isSkillLifecycle('Assumption')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-KTYPE-2: Assumptions at zero confidence (FR-S4-10)
// ---------------------------------------------------------------------------

describe('T-KTYPE-2: Assumptions enter at zero confidence (FR-S4-10)', () => {
  it('an Assumption with confidence > 0 is downgraded to 0 (adjusted=true)', () => {
    const res = enforceAssumptionConfidence('Assumption', 0.9);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.confidence).toBe(0);
      expect(res.adjusted).toBe(true);
    }
  });

  it('an Assumption with confidence = 0 passes as-is (adjusted=false)', () => {
    const res = enforceAssumptionConfidence('Assumption', 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.confidence).toBe(0);
      expect(res.adjusted).toBe(false);
    }
  });

  it('a non-Assumption type with confidence > 0 passes through unchanged', () => {
    const res = enforceAssumptionConfidence('Fact', 0.8);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.confidence).toBe(0.8);
      expect(res.adjusted).toBe(false);
    }
  });

  it('ASSUMPTION_CONFIDENCE constant is 0', () => {
    expect(ASSUMPTION_CONFIDENCE).toBe(0);
  });

  it('enforceAssumptionConfidence rejects an unknown knowledge type', () => {
    const res = enforceAssumptionConfidence('Rule', 0.5);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('FR-S4-10');
    }
  });

  it('enforceAssumptionConfidence downgrades even confidence=1.0 for Assumptions', () => {
    // Provocation: an attacker tries to bootstrap a high-confidence Assumption.
    const res = enforceAssumptionConfidence('Assumption', 1.0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.confidence).toBe(0);
      expect(res.adjusted).toBe(true);
    }
  });
});
