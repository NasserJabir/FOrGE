/**
 * ULID generation for FOrGE event and artifact identifiers.
 *
 * C-01 closed dependency list includes ULID. We implement a dependency-free
 * Crockford-base32 ULID (128-bit, lexicographically sortable, monotonic within
 * a millisecond) so the kernel never depends on an external ULID package at
 * runtime — keeping the dependency surface minimal and auditable.
 *
 * @forge-trace {"component_id":"lib-ulid","problems":["P08"],"heritage":["K01"],"decisions":["DEC-01","DEC-41"],"bp_ids":[],"ac_ids":[]}
 */
import { randomFillSync } from 'node:crypto';

// Crockford base32 alphabet (excludes I, L, O, U to avoid confusion)
const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32n;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTimeMs = 0;
let lastRandomPart: number[] = Array.from({ length: RANDOM_LEN }, () => 0);

/**
 * Generate a monotonic, lexicographically-sortable ULID string (26 chars).
 * Monotonicity: within the same millisecond, the random portion is incremented
 * rather than regenerated, preserving sort order for simultaneous events.
 */
export function ulid(): string {
  const now = Date.now();
  return encodeUlid(now);
}

function encodeUlid(timeMs: number): string {
  // Monotonic guard: if same ms as last call, increment the random part.
  let random: number[];
  if (timeMs === lastTimeMs) {
    random = incrementBytes(lastRandomPart);
  } else {
    random = randomBytes(RANDOM_LEN);
  }
  lastTimeMs = timeMs;
  lastRandomPart = random;

  return encodeTime(timeMs) + encodeRandom(random);
}

function encodeTime(timeMs: number): string {
  let ts = BigInt(timeMs);
  let out = '';
  for (let i = TIME_LEN; i > 0; i--) {
    const mod = ts % ENCODING_LEN;
    out = ENCODING[Number(mod)] + out;
    ts = ts / ENCODING_LEN;
  }
  return out;
}

function encodeRandom(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    out += (ENCODING[(byte & 0xf0) >> 4] ?? '') + (ENCODING[byte & 0x0f] ?? '');
  }
  return out;
}

function randomBytes(len: number): number[] {
  // node:crypto randomFillSync is part of node:crypto, NOT a network facility
  // (net/http/https/fetch are the forbidden ones per C-02). Safe in lib.
  const buf = new Uint8Array(len);
  randomFillSync(buf);
  return Array.from(buf);
}

function incrementBytes(bytes: number[]): number[] {
  const out = bytes.slice();
  let carry = 1;
  for (let i = out.length - 1; i >= 0; i--) {
    let v = (out[i] ?? 0) + carry;
    if (v > 0xff) {
      v = 0;
      carry = 1;
    } else {
      carry = 0;
    }
    out[i] = v;
  }
  return out;
}
