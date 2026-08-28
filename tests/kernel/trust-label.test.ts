/**
 * Trust Label computation tests — DEC-42.1 / FR-SEC-1 / FR-S4-6 / FR-S4-7.
 *
 * Covers weakerOf, weakestOf, journalRangeTrustLabel, isTrustedForCritical.
 * Includes provocation tests (C-07): trust-laundering attacks that MUST fail.
 *
 * @forge-trace {"component_id":"test-trust-label","problems":["P10","P68"],"heritage":["K06","INV-4"],"decisions":["DEC-42","DEC-27"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import {
  weakerOf,
  weakestOf,
  journalRangeTrustLabel,
  isTrustedForCritical,
  type TrustLabel,
} from '../../src/kernel/trust-label.js';

describe('FR-SEC-1: four trust labels ordered strongest to weakest', () => {
  it('TRUST_ORDER: trusted/user > tool-output > web/untrusted > derived', () => {
    // weakerOf encodes the order: the higher-index label is weaker.
    expect(weakerOf('trusted/user', 'tool-output')).toBe('tool-output');
    expect(weakerOf('tool-output', 'web/untrusted')).toBe('web/untrusted');
    expect(weakerOf('web/untrusted', 'derived')).toBe('derived');
    // Strongest vs weakest.
    expect(weakerOf('trusted/user', 'derived')).toBe('derived');
  });

  it('weakerOf is symmetric in the sense that the weaker label always wins', () => {
    expect(weakerOf('derived', 'trusted/user')).toBe('derived');
    expect(weakerOf('trusted/user', 'trusted/user')).toBe('trusted/user');
    expect(weakerOf('tool-output', 'tool-output')).toBe('tool-output');
  });
});

describe('FR-S4-6: weakestOf computes the weakest of contributing sources', () => {
  it('returns "derived" for an empty array (safest non-committal label)', () => {
    expect(weakestOf([])).toBe('derived');
  });

  it('returns the single label for a one-element array', () => {
    expect(weakestOf(['trusted/user'])).toBe('trusted/user');
    expect(weakestOf(['web/untrusted'])).toBe('web/untrusted');
  });

  it('returns the weakest among multiple labels', () => {
    expect(weakestOf(['trusted/user', 'tool-output', 'web/untrusted'])).toBe('web/untrusted');
    expect(weakestOf(['tool-output', 'trusted/user'])).toBe('tool-output');
    expect(weakestOf(['trusted/user', 'derived'])).toBe('derived');
  });

  it('PROVOCATION: a single web/untrusted source poisons the whole derivation', () => {
    // Attack: an adversary injects one web/untrusted source among many trusted
    // sources, hoping the derivation stays trusted. DEC-42.1 MUST prevent this.
    const labels: TrustLabel[] = [
      'trusted/user',
      'trusted/user',
      'trusted/user',
      'web/untrusted', // one poisoned source
    ];
    expect(weakestOf(labels)).toBe('web/untrusted');
  });

  it('PROVOCATION: a derived source makes the whole derivation derived', () => {
    expect(weakestOf(['trusted/user', 'tool-output', 'derived'])).toBe('derived');
  });
});

describe('FR-S4-7: journalRangeTrustLabel — a journal range is never a trust source', () => {
  it('returns "derived" when no material labels are known', () => {
    expect(journalRangeTrustLabel([])).toBe('derived');
  });

  it('returns the weakest of the underlying material labels', () => {
    expect(journalRangeTrustLabel(['trusted/user', 'tool-output'])).toBe('tool-output');
    expect(journalRangeTrustLabel(['trusted/user', 'web/untrusted'])).toBe('web/untrusted');
    expect(journalRangeTrustLabel(['trusted/user'])).toBe('trusted/user');
  });

  it('PROVOCATION: a journal range over trusted material plus one web source is web/untrusted', () => {
    // Attack: an adversary claims that because the material went through the
    // journal, it inherits journal "trust". FR-S4-7: the journal confers NO
    // trust; the result is the weakest of the underlying material.
    const materialLabels: TrustLabel[] = ['trusted/user', 'trusted/user', 'web/untrusted'];
    expect(journalRangeTrustLabel(materialLabels)).toBe('web/untrusted');
  });

  it('PROVOCATION: a journal range over only derived material is derived', () => {
    expect(journalRangeTrustLabel(['derived', 'derived'])).toBe('derived');
  });
});

describe('FR-SEC-1: isTrustedForCritical — critical actions require trusted sources', () => {
  it('returns true only for trusted/user', () => {
    expect(isTrustedForCritical('trusted/user')).toBe(true);
  });

  it('returns false for tool-output', () => {
    expect(isTrustedForCritical('tool-output')).toBe(false);
  });

  it('returns false for web/untrusted', () => {
    expect(isTrustedForCritical('web/untrusted')).toBe(false);
  });

  it('returns false for derived', () => {
    expect(isTrustedForCritical('derived')).toBe(false);
  });

  it('PROVOCATION: a tool-output label cannot perform critical actions', () => {
    // Attack: an agent with tool-output authority attempts a critical action
    // (e.g., commit to main). FR-SEC-1 MUST block this.
    expect(isTrustedForCritical('tool-output')).toBe(false);
  });

  it('PROVOCATION: a derived label cannot perform critical actions', () => {
    expect(isTrustedForCritical('derived')).toBe(false);
  });
});
