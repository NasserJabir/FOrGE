/**
 * Canonical JSON — fixed serialization algorithm for content-addressed integrity.
 *
 * FR-K1-3: Canonical JSON SHALL be a fixed algorithm (sorted keys, no
 * whitespace, UTF-8) with a golden test; algorithm change SHALL require AU-08
 * as it invalidates history.
 *
 * Algorithm (normative, never change without AU-08 → DEC-12):
 *   1. Object keys sorted lexicographically by UTF-16 code unit (Array.prototype.sort
 *      default on strings — stable, deterministic across engines).
 *   2. No insignificant whitespace (no spaces, no newlines).
 *   3. Strings: JSON.stringify escaping (UTF-8), no lone surrogates normalized.
 *   4. Numbers: JSON.stringify canonical form (no leading zeros, minimal).
 *   5. Booleans/null: lowercase literals.
 *   6. Arrays: order preserved (NOT sorted — arrays are ordered sequences).
 *   7. Nested objects: recursively canonicalized.
 *   8. Undefined, functions, symbols: omitted (as in JSON.stringify).
 *   9. Output is UTF-8.
 *
 * @forge-trace {"component_id":"kernel-canonical-json","problems":["P74","P08"],"heritage":["K05"],"decisions":["DEC-01","DEC-22"],"bp_ids":[],"ac_ids":[]}
 */

/**
 * Produce the canonical JSON byte-string of a value.
 * Deterministic: same input always yields same output (NFR-2).
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      // JSON does not encode NaN/Infinity; represent as null per JSON.stringify.
      return 'null';
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
    keys.sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k]));
    return '{' + parts.join(',') + '}';
  }
  // functions, symbols, bigint-as-fallback: omit -> null
  return 'null';
}
