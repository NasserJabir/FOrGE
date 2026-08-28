/**
 * SHA-256 hashing helpers for FOrGE content-addressed integrity.
 *
 * @forge-trace {"component_id":"lib-hash","problems":["P74","P08"],"heritage":["K05"],"decisions":["DEC-01","DEC-22"],"bp_ids":[],"ac_ids":[]}
 */
import { createHash } from 'node:crypto';

/**
 * Compute the SHA-256 hex digest of a UTF-8 string.
 * Used by K-1 (event hashes) and K-2 (content hashes).
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
