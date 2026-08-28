/**
 * Canonical JSON tests — FR-K1-3 (fixed algorithm + golden test), NFR-2 (determinism).
 *
 * @forge-trace {"component_id":"test-canonical-json","problems":["P74","P08"],"heritage":["K05"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../../src/kernel/canonical-json.js';

describe('canonicalJson — golden fixture (FR-K1-3)', () => {
  // GOLDEN: the exact byte output for a known input. Any change to the
  // canonicalization algorithm changes this output and MUST require AU-08.
  it('produces the golden byte sequence for the reference object', () => {
    const input = {
      z: 1,
      a: 'hello',
      m: { d: [3, 1, 2], c: true, b: null },
      n: -0.5,
      empty: '',
      flag: false,
    };
    const expected =
      '{"a":"hello","empty":"","flag":false,"m":{"b":null,"c":true,"d":[3,1,2]},"n":-0.5,"z":1}';
    expect(canonicalJson(input)).toBe(expected);
  });

  it('golden: arrays preserve order (NOT sorted)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson(['c', 'a', 'b'])).toBe('["c","a","b"]');
  });

  it('golden: nested keys sorted recursively', () => {
    expect(canonicalJson({ b: { y: 1, x: 2 }, a: 0 })).toBe('{"a":0,"b":{"x":2,"y":1}}');
  });
});

describe('canonicalJson — determinism (NFR-2)', () => {
  it('same input always yields same output', () => {
    const input = { b: 2, a: 1, c: [1, 2, 3] };
    const out1 = canonicalJson(input);
    const out2 = canonicalJson(input);
    expect(out1).toBe(out2);
  });

  it('key insertion order does not affect output', () => {
    const o1 = { a: 1, b: 2, c: 3 };
    const o2 = { c: 3, a: 1, b: 2 };
    expect(canonicalJson(o1)).toBe(canonicalJson(o2));
  });

  it('permuted deeply-nested objects are equal', () => {
    // Both produce {"a":0,"z":{"y":{"w":2,"x":1}}} — keys sorted recursively.
    const a = { z: { y: { x: 1, w: 2 } }, a: 0 };
    const b = { a: 0, z: { y: { w: 2, x: 1 } } };
    expect(canonicalJson(a)).toBe('{"a":0,"z":{"y":{"w":2,"x":1}}}');
    expect(canonicalJson(b)).toBe('{"a":0,"z":{"y":{"w":2,"x":1}}}');
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe('canonicalJson — no insignificant whitespace', () => {
  it('contains no spaces', () => {
    expect(canonicalJson({ a: 1, b: 2 })).not.toContain(' ');
  });
  it('contains no newlines', () => {
    expect(canonicalJson({ a: 1, b: 2 })).not.toContain('\n');
  });
});

describe('canonicalJson — scalars', () => {
  it('null', () => {
    expect(canonicalJson(null)).toBe('null');
  });
  it('true', () => {
    expect(canonicalJson(true)).toBe('true');
  });
  it('false', () => {
    expect(canonicalJson(false)).toBe('false');
  });
  it('integer', () => {
    expect(canonicalJson(42)).toBe('42');
  });
  it('negative', () => {
    expect(canonicalJson(-7)).toBe('-7');
  });
  it('float', () => {
    expect(canonicalJson(3.14)).toBe('3.14');
  });
  it('string', () => {
    expect(canonicalJson('hi')).toBe('"hi"');
  });
  it('string with unicode', () => {
    expect(canonicalJson('Ω')).toBe('"Ω"');
  });
  it('string with escape', () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
  });
});

describe('canonicalJson — edge cases', () => {
  it('empty object', () => {
    expect(canonicalJson({})).toBe('{}');
  });
  it('empty array', () => {
    expect(canonicalJson([])).toBe('[]');
  });
  it('undefined values omitted', () => {
    expect(canonicalJson({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });
  it('NaN and Infinity encoded as null (JSON conformance)', () => {
    expect(canonicalJson(NaN)).toBe('null');
    expect(canonicalJson(Infinity)).toBe('null');
    expect(canonicalJson(-Infinity)).toBe('null');
  });
});
