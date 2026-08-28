/**
 * Golden fixture tests (§4: committed journals including a deliberately
 * corrupted chain with expected exact firstBroken).
 *
 * @forge-trace {"component_id":"test-golden-fixtures","problems":["P74","P08"],"heritage":["K05"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';

import {
  buildGoldenCleanJournal,
  buildGoldenCorruptedJournal,
  verifyGoldenFixtures,
} from '../fixtures/golden-journal.js';

describe('Golden fixtures (§4)', () => {
  it('clean golden journal verifies with ok=true and checked=3', () => {
    const { journal } = buildGoldenCleanJournal();
    const v = journal.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(3);
    expect(v.firstBroken).toBeNull();
  });

  it('corrupted golden journal fails with exact firstBroken (NFR-1)', () => {
    const { journal, corruptedEventId, expectedReason } = buildGoldenCorruptedJournal();
    const v = journal.verify();
    expect(v.ok).toBe(false);
    expect(v.firstBroken).not.toBeNull();
    expect(v.firstBroken!.eventId).toBe(corruptedEventId);
    expect(v.firstBroken!.reason).toBe(expectedReason);
  });

  it('verifyGoldenFixtures helper returns both results consistently', () => {
    const { clean, corrupted } = verifyGoldenFixtures();
    expect(clean.ok).toBe(true);
    expect(corrupted.ok).toBe(false);
    expect(corrupted.firstBroken!.reason).toContain('hash mismatch');
  });
});
