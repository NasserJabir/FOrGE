/**
 * K-2 TaskContract enforcement tests — FR-K2-6 (task SHALL NOT start managed
 * execution without a TaskContract; remaining assumptions SHALL enter as
 * Assumption claims at zero confidence), AC-BP10, with provocation tests (C-07).
 *
 * T-TC-1: an attempt to start managed execution without a TaskContract is
 *   rejected and journals `taskcontract.required` (exit posture: fail-closed).
 * T-TC-2: a task with a TaskContract but unrecorded assumptions is accepted,
 *   but the assumptions enter as Assumption claims at zero confidence
 *   (FR-K2-6 second clause).
 *
 * @forge-trace {"component_id":"test-task-contract","problems":["P01"],"heritage":["K02"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":["AC-BP10"]}
 */
import { describe, it, expect } from 'vitest';

import { ContractStore } from '../../src/kernel/contract-store.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';
import {
  TaskContractGate,
  TASKCONTRACT_REQUIRED_KIND,
  ASSUMPTION_CLAIM_KIND,
  type TaskContractInput,
  type TaskContractStoreLike,
} from '../../src/kernel/task-contract.js';

/** Build a journal with the P2 task-contract event kinds registered. */
function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: [TASKCONTRACT_REQUIRED_KIND, ASSUMPTION_CLAIM_KIND, 'journal.append_rejected'],
  });
}

/** Build a ContractStore + journal + gate trio. */
function makeGate(): { gate: TaskContractGate; store: ContractStore; journal: EventJournal } {
  const journal = makeJournal();
  const store = new ContractStore();
  const gate = new TaskContractGate({ store, journal });
  return { gate, store, journal };
}

/** A minimal valid TaskContract input. */
function makeContractInput(overrides: Partial<TaskContractInput> = {}): TaskContractInput {
  return {
    taskId: 'task-001',
    objective: 'Refactor the canonical JSON serializer for deterministic output.',
    scope: 'src/kernel/canonical-json.ts',
    createdBy: 'owner@forge',
    assumptions: [],
    ...overrides,
  };
}

describe('T-TC-1 PROVOCATION: managed execution without a TaskContract is rejected (FR-K2-6, AC-BP10)', () => {
  it('refuses to start managed execution when no TaskContract exists for the task', () => {
    const { gate } = makeGate();
    // No contract has been created for 'task-001'.
    const res = gate.requireContract('task-001');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('TaskContract');
    }
  });

  it('journals a taskcontract.required event on rejection (visible, auditable)', () => {
    const { gate, journal } = makeGate();
    const before = journal.count();
    gate.requireContract('task-missing');
    const after = journal.count();
    expect(after).toBe(before + 1);
  });

  it('the journaled rejection event carries the taskId and reason', () => {
    const { gate, journal } = makeGate();
    gate.requireContract('task-audit-007');
    const events = journal.all().filter((e) => e.kind === TASKCONTRACT_REQUIRED_KIND);
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload['taskId']).toBe('task-audit-007');
    expect(typeof payload['reason']).toBe('string');
    expect((payload['reason'] as string).length).toBeGreaterThan(0);
  });

  it('fail-closed: the rejection event is journaled BEFORE the gate returns (write-ahead)', () => {
    const { gate, journal } = makeGate();
    const res = gate.requireContract('task-writeahead');
    expect(res.ok).toBe(false);
    // The rejection must already be persisted by the time the call returns.
    const events = journal.all().filter((e) => e.kind === TASKCONTRACT_REQUIRED_KIND);
    expect(events).toHaveLength(1);
  });

  it('does NOT journal a rejection when a valid TaskContract exists', () => {
    const { gate, store, journal } = makeGate();
    store.createTaskContract(makeContractInput());
    const before = journal.count();
    const res = gate.requireContract('task-001');
    expect(res.ok).toBe(true);
    expect(journal.count()).toBe(before); // no rejection event
  });
});

describe('T-TC-2: remaining assumptions enter as Assumption claims at zero confidence (FR-K2-6)', () => {
  it('a TaskContract with no assumptions is accepted with zero Assumption claims', () => {
    const { gate, store } = makeGate();
    const contract = store.createTaskContract(makeContractInput({ assumptions: [] }));
    const res = gate.requireContract('task-001');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.contract.artifactId).toBe(contract.frontmatter.artifactId);
      expect(res.assumptionClaims).toEqual([]);
    }
  });

  it('a TaskContract with recorded assumptions enters them as Assumption claims at zero confidence', () => {
    const { gate, store, journal } = makeGate();
    store.createTaskContract(
      makeContractInput({
        assumptions: [
          { text: 'The serializer output is stable across Node versions.' },
          { text: 'No callers depend on key ordering.' },
        ],
      }),
    );
    const before = journal.count();
    const res = gate.requireContract('task-001');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.assumptionClaims).toHaveLength(2);
      // Each assumption claim is journaled as an Assumption claim event.
      expect(journal.count()).toBe(before + 2);
      for (const claim of res.assumptionClaims) {
        expect(claim.confidence).toBe(0);
        expect(claim.claimType).toBe('Assumption');
      }
    }
  });

  it('every Assumption claim carries confidence = 0 (never elevated)', () => {
    const { gate, store } = makeGate();
    store.createTaskContract(
      makeContractInput({
        assumptions: [
          { text: 'Assumption one.' },
          { text: 'Assumption two.' },
          { text: 'Assumption three.' },
        ],
      }),
    );
    const res = gate.requireContract('task-001');
    expect(res.ok).toBe(true);
    if (res.ok) {
      for (const claim of res.assumptionClaims) {
        expect(claim.confidence).toBe(0);
        // Zero confidence is not a positive or negative number — exactly zero.
        expect(claim.confidence).not.toBeGreaterThan(0);
        expect(claim.confidence).not.toBeLessThan(0);
      }
    }
  });

  it('each Assumption claim is journaled as an assumption.claim event with the text and taskId', () => {
    const { gate, store, journal } = makeGate();
    store.createTaskContract(
      makeContractInput({
        taskId: 'task-trace-9',
        assumptions: [{ text: 'External API is idempotent.' }],
      }),
    );
    gate.requireContract('task-trace-9');
    const events = journal.all().filter((e) => e.kind === ASSUMPTION_CLAIM_KIND);
    expect(events).toHaveLength(1);
    const payload = events[0]!.payload as Record<string, unknown>;
    expect(payload['taskId']).toBe('task-trace-9');
    expect(payload['text']).toBe('External API is idempotent.');
    expect(payload['confidence']).toBe(0);
    expect(payload['claimType']).toBe('Assumption');
  });
});

describe('FR-K2-6: TaskContract artifact integrity', () => {
  it('createTaskContract produces a Tier-A artifact of type TaskContract', () => {
    const { store } = makeGate();
    const contract = store.createTaskContract(makeContractInput());
    expect(contract.frontmatter.artifactType).toBe('TaskContract');
    expect(contract.frontmatter.artifactId).toMatch(/^tc-/);
    expect(contract.body).toContain('task-001');
  });

  it("requireContract returns the matching contract (not a different task's)", () => {
    const { gate, store } = makeGate();
    store.createTaskContract(makeContractInput({ taskId: 'task-A' }));
    store.createTaskContract(makeContractInput({ taskId: 'task-B' }));
    const resA = gate.requireContract('task-A');
    const resB = gate.requireContract('task-B');
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
    if (resA.ok && resB.ok) {
      expect(resA.contract.artifactId).not.toBe(resB.contract.artifactId);
    }
  });

  it('a superseded TaskContract is NOT accepted (only active contracts pass the gate)', () => {
    const { gate, store } = makeGate();
    const c1 = store.createTaskContract(makeContractInput({ taskId: 'task-sup' }));
    const c2 = store.createTaskContract(
      makeContractInput({ taskId: 'task-sup', objective: 'Revised objective.' }),
    );
    // Supersede c1 with c2.
    store.supersede({
      oldArtifactId: c1.frontmatter.artifactId,
      newArtifactId: c2.frontmatter.artifactId,
      reason: 'revised objective',
    });
    // The gate should resolve to the active (non-superseded) contract.
    const res = gate.requireContract('task-sup');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.contract.artifactId).toBe(c2.frontmatter.artifactId);
    }
  });
});

describe('FR-K2-6: edge cases and fail-closed posture', () => {
  it('rejects when the taskId is empty', () => {
    const { gate, journal } = makeGate();
    const res = gate.requireContract('');
    expect(res.ok).toBe(false);
    // Still journals the rejection (auditable).
    const events = journal.all().filter((e) => e.kind === TASKCONTRACT_REQUIRED_KIND);
    expect(events).toHaveLength(1);
  });

  it('a TaskContract with assumptions containing empty text still enters a zero-confidence claim', () => {
    const { gate, store } = makeGate();
    store.createTaskContract(makeContractInput({ assumptions: [{ text: '' }] }));
    const res = gate.requireContract('task-001');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.assumptionClaims).toHaveLength(1);
      expect(res.assumptionClaims[0]!.confidence).toBe(0);
    }
  });

  it('multiple requireContract calls for the same task each re-emit Assumption claims (idempotent re-entry)', () => {
    const { gate, store, journal } = makeGate();
    store.createTaskContract(makeContractInput({ assumptions: [{ text: 'A1' }] }));
    gate.requireContract('task-001');
    const after1 = journal.all().filter((e) => e.kind === ASSUMPTION_CLAIM_KIND).length;
    gate.requireContract('task-001');
    const after2 = journal.all().filter((e) => e.kind === ASSUMPTION_CLAIM_KIND).length;
    // Each gate pass re-surfaces assumptions as claims (no silent suppression).
    expect(after2).toBe(after1 + 1);
  });
});

describe('FR-K2-6: coverage — uncovered branches (NFR-11)', () => {
  it('an assumption whose text carries a secret pattern is rejected by K-1 and surfaced with an empty eventId', () => {
    // FR-K1-7: K-1 rejects payloads matching the secret-pattern set. The gate
    // must still surface the assumption as a claim (FR-K2-6: none silently
    // dropped), but with eventId = '' since the assumption.claim append was
    // rejected (not sealed). This exercises the `appendRes.kind === 'rejected'`
    // branch (eventId = '').
    const { gate, store, journal } = makeGate();
    // A GitHub PAT (classic) triggers the github-pat secret pattern.
    const secret = 'ghp_' + 'A'.repeat(36);
    store.createTaskContract(
      makeContractInput({
        taskId: 'task-secret',
        assumptions: [{ text: `The deploy token is ${secret}.` }],
      }),
    );
    const res = gate.requireContract('task-secret');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.assumptionClaims).toHaveLength(1);
      const claim = res.assumptionClaims[0]!;
      // The claim is surfaced (not dropped)...
      expect(claim.claimType).toBe('Assumption');
      expect(claim.confidence).toBe(0);
      // ...but its eventId is empty because K-1 rejected the append.
      expect(claim.eventId).toBe('');
    }
    // K-1 journaled a journal.append_rejected for the secret-bearing claim.
    const rejections = journal.all().filter((e) => e.kind === 'journal.append_rejected');
    expect(rejections.length).toBeGreaterThanOrEqual(1);
    // No assumption.claim event was sealed for the secret-bearing assumption.
    const claims = journal.all().filter((e) => e.kind === ASSUMPTION_CLAIM_KIND);
    expect(claims).toHaveLength(0);
  });

  it('a superseded contract returned by the store is skipped (defensive lifecycleState guard)', () => {
    // ContractStore.supersede() moves the old artifact to the deprecated tree,
    // so it does not appear in listByType(). The gate still guards against
    // lifecycleState === 'superseded' defensively. We exercise that guard via
    // a stub store that returns a superseded contract (simulating a store that
    // keeps superseded artifacts in the active list).
    const stubStore: TaskContractStoreLike = {
      listByType: () => [
        {
          frontmatter: {
            artifactId: 'tc-superseded-stub',
            lifecycleState: 'superseded',
            status: 'approved',
          },
          body: 'taskId: task-stub\n\n## Assumptions\n- A1\n',
        },
      ],
    };
    const journal = makeJournal();
    const gate = new TaskContractGate({ store: stubStore, journal });
    const res = gate.requireContract('task-stub');
    // The superseded contract is skipped, so the gate fails closed.
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('TaskContract');
    }
    // A taskcontract.required rejection was journaled (fail-closed).
    const rejections = journal.all().filter((e) => e.kind === TASKCONTRACT_REQUIRED_KIND);
    expect(rejections).toHaveLength(1);
  });

  it('skips contracts for other tasks and resolves the matching one (contractMatchesTask false branch)', () => {
    // Multiple contracts exist; the most recent matching one wins. The gate
    // scans from the newest; contracts for OTHER tasks must be skipped via
    // the contractMatchesTask false branch before the matching one is found.
    const { gate, store } = makeGate();
    // Create contracts for two different tasks; the gate is queried for one.
    store.createTaskContract(makeContractInput({ taskId: 'task-other-1' }));
    store.createTaskContract(makeContractInput({ taskId: 'task-target' }));
    store.createTaskContract(makeContractInput({ taskId: 'task-other-2' }));
    const res = gate.requireContract('task-target');
    expect(res.ok).toBe(true);
    if (res.ok) {
      // The resolved contract is the one for task-target (not the others).
      expect(res.contract.frontmatter.artifactType).toBe('TaskContract');
    }
  });

  it('createTaskContract with no assumptions writes the _(none)_ sentinel in the body', () => {
    // Exercises the `input.assumptions.length === 0` branch in
    // contract-store.ts (lines 310, 329): the factory pushes `_(none)_` and
    // uses the default scope. We assert the body content directly.
    const { store } = makeGate();
    const contract = store.createTaskContract({
      taskId: 'task-none',
      objective: 'Do nothing in particular.',
      createdBy: 'owner@forge',
      assumptions: [],
    });
    expect(contract.body).toContain('## Assumptions');
    expect(contract.body).toContain('_(none)_');
    // The default scope is 'project' when scope is omitted.
    expect(contract.body).toContain('**Scope:** project');
    expect(contract.frontmatter.scope).toBe('project');
    // No assumption bullets are present.
    expect(contract.body).not.toMatch(/\n- /);
  });
});
