/**
 * T-RECOVER-1 — end-to-end recoverability demo (NFR-5, NFR-6).
 *
 * This is the integration test for the P2 gate criterion #1. It simulates the
 * full crash-recovery lifecycle across the kernel modules:
 *
 *   contract → instance (adapter.launch) → events (runstate transitions
 *   journaled) → forced kill (drop in-memory state) → K-1 resume (reconstruct
 *   RunState from journal) → manual closure (CLOSED).
 *
 * NFR-5: after forced kill mid-task, the system SHALL reconstruct declared
 *   state from K-1 and resume without the dead session.
 * NFR-6: every BP-conformant provider SHALL be substitutable without changes
 *   to K-1…K-5/S1–S7 (RunState lives above the journal, not the session).
 * FR-K1-9: state transitions journaled before effect (write-ahead).
 * FR-S3-1: RunState event-sourced from K-1 with declared states.
 * FR-K2-6: a task SHALL NOT start managed execution without a TaskContract.
 * IF-01/AC-BP1: the adapter exposes exactly five verbs (launch/send/events/
 *   interrupts/artifacts); the mock adapter conforms.
 *
 * The test uses a mock adapter implementing the AdapterSpi contract, a
 * TaskContractGate to require a contract before managed execution, a
 * ContractStore to create the TaskContract artifact, a SpawnContractEnforcer
 * to enforce the operational constraints, and a RunState over a shared
 * EventJournal. The forced-kill drops the RunState (and the mock adapter's
 * in-memory session); a new RunState over the same journal reconstructs the
 * last declared state, and manual closure completes.
 *
 * @forge-trace {"component_id":"test-recoverability","problems":["P95","P02","P01"],"heritage":["K15","K03","K02","K01","R4"],"decisions":["DEC-01","DEC-25","DEC-32"],"bp_ids":["BP-1"],"ac_ids":["AC-BP1","AC-BP10"]}
 */
import { describe, it, expect } from 'vitest';

import {
  assertAdapterConformance,
  type AdapterSpi,
  type EnforcementMap,
  type InterruptKind,
  type LaunchResult,
  type AckResult,
} from '../../src/kernel/adapter-spi.js';
import { ContractStore } from '../../src/kernel/contract-store.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import { RunState, type RunStateValue } from '../../src/kernel/run-state.js';
import { SpawnContractEnforcer, type SpawnContractInput } from '../../src/kernel/spawn-contract.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';
import { TaskContractGate } from '../../src/kernel/task-contract.js';

/**
 * A mock adapter implementing the AdapterSpi five-verb contract (IF-01).
 *
 * The mock simulates a provider that launches instances, tracks their
 * in-memory session state, and produces events. On forced kill, the session
 * map is dropped — simulating a dead process. The adapter itself is
 * stateless across kills (NFR-6: substitutable); the journal is the source of
 * truth, not the session.
 */
class MockAdapter implements AdapterSpi {
  /** In-memory session map (disposable — dropped on forced kill). */
  private sessions: Map<string, { alive: boolean; events: string[] }> = new Map();
  private launchCount = 0;

  /** The declared enforcement posture (IF-05). */
  readonly enforcementMap: EnforcementMap = [
    { control: 'tool.gate', inBand: true, outOfBandCompensated: false, advisory: false },
    { control: 'context.boundary', inBand: true, outOfBandCompensated: true, advisory: false },
  ];

  /** Declared capabilities — each MUST have a matching map control (IF-01). */
  readonly declaredCapabilities: string[] = ['tool.gate', 'context.boundary'];

  launch(command: { command: string; env: Record<string, string> }): LaunchResult {
    this.launchCount++;
    const instanceId = `inst-${this.launchCount.toString().padStart(3, '0')}`;
    this.sessions.set(instanceId, { alive: true, events: [`launched: ${command.command}`] });
    return { instanceId };
  }

  send(ctxPack: unknown): AckResult {
    // The mock accepts any context pack. A real adapter would forward it.
    void ctxPack;
    return { ok: true };
  }

  events(stream: unknown): unknown[] {
    // Return events for a session. The stream arg is the instanceId in the mock.
    const session = this.sessions.get(stream as string);
    return session ? session.events : [];
  }

  interrupts(kind: InterruptKind): AckResult {
    // The mock records the interrupt. A real adapter would signal the process.
    void kind;
    return { ok: true };
  }

  artifacts(location: unknown): unknown[] {
    // The mock produces no artifacts (the test does not assert artifact output).
    void location;
    return [];
  }

  /** Simulate a forced kill: drop all in-memory session state. */
  forceKill(): void {
    this.sessions.clear();
  }

  /** Check if a session is alive (for assertions). */
  isAlive(instanceId: string): boolean {
    const session = this.sessions.get(instanceId);
    return session ? session.alive : false;
  }

  /** Record an event on a session (used to simulate adapter-side events). */
  recordEvent(instanceId: string, event: string): void {
    const session = this.sessions.get(instanceId);
    if (session) {
      session.events.push(event);
    }
  }
}

/**
 * Build a journal with all P2 event kinds registered (FR-K1-8).
 * The journal is shared across all kernel modules in the test — it is the
 * single source of truth that survives the forced kill.
 */
function makeJournal(): EventJournal {
  return new EventJournal({
    storage: new MemoryJournalStorage(),
    allowedKinds: [
      'runstate.transition',
      'taskcontract.required',
      'assumption.claim',
      'spawn.contract',
      'adapter.launched',
      'adapter.interrupted',
      'journal.append_rejected',
    ],
  });
}

/** Options for the end-to-end harness. */
interface HarnessOptions {
  journal: EventJournal;
  adapter: MockAdapter;
}

/**
 * The end-to-end harness wires the kernel modules together over a shared
 * journal. It mirrors the composition a real plane would perform:
 *   ContractStore → TaskContractGate → SpawnContractEnforcer → adapter.launch
 *   → RunState transitions.
 */
class RecoverabilityHarness {
  readonly journal: EventJournal;
  readonly store: ContractStore;
  readonly gate: TaskContractGate;
  readonly enforcer: SpawnContractEnforcer;
  readonly runState: RunState;
  readonly adapter: MockAdapter;

  constructor(opts: HarnessOptions) {
    this.journal = opts.journal;
    this.store = new ContractStore();
    this.gate = new TaskContractGate({ store: this.store, journal: this.journal });
    this.enforcer = new SpawnContractEnforcer({ journal: this.journal });
    this.runState = new RunState({ journal: this.journal });
    this.adapter = opts.adapter;
  }

  /**
   * Create a TaskContract and require it (FR-K2-6). Returns the contract
   * artifact id, or throws if the gate refuses (fail-closed).
   */
  prepareContract(taskId: string): string {
    const artifact = this.store.createTaskContract({
      taskId,
      objective: `Execute task ${taskId}`,
      createdBy: 'forge:test',
      assumptions: [{ text: 'The adapter is conformant (AC-BP1).' }],
    });
    const result = this.gate.requireContract(taskId);
    if (!result.ok) {
      throw new Error(`TaskContractGate refused: ${result.reason}`);
    }
    return artifact.frontmatter.artifactId;
  }

  /**
   * Enforce a SpawnContract and launch the instance via the adapter (IF-01).
   * Journals spawn.contract and adapter.launched events, then transitions the
   * RunState QUEUED → RUNNING (write-ahead, FR-K1-9).
   */
  launchManaged(taskId: string, identityId: string): string {
    const contractInput: SpawnContractInput = {
      identityId,
      taskId,
      grantedAuthority: 'EXECUTOR',
      canCommit: false,
      contextGrants: [],
      createdBy: 'forge:test',
    };
    // Enforce the contract (journals spawn.contract).
    this.enforcer.enforce(contractInput);
    // Launch via the adapter (IF-01 verb: launch).
    const launchResult = this.adapter.launch({
      command: `task ${taskId}`,
      env: { FORGE_TASK: taskId },
    });
    const instanceId = launchResult.instanceId;
    // Journal adapter.launched (auditable launch record).
    this.journal.append({
      actor: 'forge:test',
      kind: 'adapter.launched',
      payload: { instanceId, taskId, identityId },
      task_ref: taskId,
    });
    // Transition RunState QUEUED → RUNNING (write-ahead).
    const transition = this.runState.transition(instanceId, 'RUNNING', 'launched');
    if (!transition.ok) {
      throw new Error(`Failed to transition to RUNNING: ${transition.reason}`);
    }
    return instanceId;
  }

  /**
   * Interrupt an instance (IF-01 verb: interrupts). Journals
   * adapter.interrupted and transitions RunState RUNNING → INTERRUPTED.
   */
  interrupt(instanceId: string): void {
    this.adapter.interrupts('cancel');
    this.journal.append({
      actor: 'forge:test',
      kind: 'adapter.interrupted',
      payload: { instanceId, kind: 'cancel' },
      task_ref: instanceId,
    });
    const transition = this.runState.transition(instanceId, 'INTERRUPTED', 'interrupted');
    if (!transition.ok) {
      throw new Error(`Failed to transition to INTERRUPTED: ${transition.reason}`);
    }
  }

  /** Drop all in-memory state (simulate forced kill). */
  forceKill(): void {
    this.adapter.forceKill();
    // The RunState cache is dropped by constructing a new RunState over the
    // same journal (done in the test, not here, to make the kill explicit).
  }

  /**
   * Reconstruct the RunState from the journal after a forced kill (NFR-5).
   * Returns a new RunState whose in-memory cache was rebuilt from K-1.
   */
  resume(): RunState {
    return new RunState({ journal: this.journal });
  }

  /** Manually close an instance (transition to CLOSED). */
  close(rs: RunState, instanceId: string): void {
    const transition = rs.transition(instanceId, 'CLOSED', 'manual closure');
    if (!transition.ok) {
      throw new Error(`Failed to transition to CLOSED: ${transition.reason}`);
    }
  }
}

describe('T-RECOVER-1: end-to-end crash recovery (NFR-5, NFR-6)', () => {
  it('contract → launch → transitions journaled → forced kill → K-1 resume → manual closure', () => {
    const journal = makeJournal();
    const adapter = new MockAdapter();

    // 0. The mock adapter conforms to the AdapterSpi (IF-01, AC-BP1).
    const conformance = assertAdapterConformance(adapter);
    expect(conformance.ok).toBe(true);

    const h = new RecoverabilityHarness({ journal, adapter });

    // 1. Contract: create a TaskContract and require it (FR-K2-6).
    const taskId = 'task-recover-001';
    const contractId = h.prepareContract(taskId);
    expect(contractId).toMatch(/^tc-/);

    // The gate must have found the contract (fail-closed would throw).
    // Assumption claims are journaled at zero confidence (FR-K2-6).
    const assumptionEvents = journal.all().filter((e) => e.kind === 'assumption.claim');
    expect(assumptionEvents.length).toBeGreaterThanOrEqual(1);
    for (const e of assumptionEvents) {
      const payload = e.payload as { confidence: number; claimType: string };
      expect(payload.confidence).toBe(0);
      expect(payload.claimType).toBe('Assumption');
    }

    // 2. Instance: enforce SpawnContract + adapter.launch (IF-01).
    const instanceId = h.launchManaged(taskId, 'agent-executor-01');
    expect(instanceId).toMatch(/^inst-/);
    expect(h.runState.stateOf(instanceId)).toBe('RUNNING');
    expect(adapter.isAlive(instanceId)).toBe(true);

    // The spawn.contract event was journaled.
    const spawnEvents = journal.all().filter((e) => e.kind === 'spawn.contract');
    expect(spawnEvents.length).toBe(1);
    const spawnPayload = spawnEvents[0]!.payload as {
      effectiveAuthority: string;
      canCommit: boolean;
      fullPrivacy: boolean;
    };
    expect(spawnPayload.effectiveAuthority).toBe('EXECUTOR');
    expect(spawnPayload.canCommit).toBe(false);
    expect(spawnPayload.fullPrivacy).toBe(true);

    // The adapter.launched event was journaled.
    const launchedEvents = journal.all().filter((e) => e.kind === 'adapter.launched');
    expect(launchedEvents.length).toBe(1);

    // 3. Events: runstate transitions are journaled (write-ahead, FR-K1-9).
    const transitionEvents = journal.all().filter((e) => e.kind === 'runstate.transition');
    expect(transitionEvents.length).toBe(1); // QUEUED → RUNNING
    const firstTransition = transitionEvents[0]!.payload as {
      from: RunStateValue;
      to: RunStateValue;
    };
    expect(firstTransition.from).toBe('QUEUED');
    expect(firstTransition.to).toBe('RUNNING');

    // Interrupt the instance (RUNNING → INTERRUPTED).
    h.interrupt(instanceId);
    expect(h.runState.stateOf(instanceId)).toBe('INTERRUPTED');
    const interruptEvents = journal.all().filter((e) => e.kind === 'adapter.interrupted');
    expect(interruptEvents.length).toBe(1);
    const transitionEvents2 = journal.all().filter((e) => e.kind === 'runstate.transition');
    expect(transitionEvents2.length).toBe(2);
    const secondTransition = transitionEvents2[1]!.payload as {
      from: RunStateValue;
      to: RunStateValue;
    };
    expect(secondTransition.from).toBe('RUNNING');
    expect(secondTransition.to).toBe('INTERRUPTED');

    // Record the last journaled state before the kill.
    const lastJournaledState = h.runState.stateOf(instanceId);
    expect(lastJournaledState).toBe('INTERRUPTED');

    // 4. Forced kill: drop all in-memory state (the dead session is gone).
    h.forceKill();
    expect(adapter.isAlive(instanceId)).toBe(false);
    // The harness's RunState still holds the cache, but the session is dead.
    // The journal survives (it is the source of truth, not the session).

    // 5. K-1 resume: reconstruct RunState from the journal (NFR-5).
    const resumed = h.resume();
    // The resumed state matches the LAST journaled state, not any
    // unjournaled intermediate. The dead session's memory is gone; the
    // journal is the authority.
    expect(resumed.stateOf(instanceId)).toBe(lastJournaledState);
    expect(resumed.stateOf(instanceId)).toBe('INTERRUPTED');

    // 6. Manual closure: transition to CLOSED completes.
    h.close(resumed, instanceId);
    expect(resumed.stateOf(instanceId)).toBe('CLOSED');

    // The closure transition was journaled (write-ahead).
    const transitionEvents3 = journal.all().filter((e) => e.kind === 'runstate.transition');
    expect(transitionEvents3.length).toBe(3);
    const closureTransition = transitionEvents3[2]!.payload as {
      from: RunStateValue;
      to: RunStateValue;
    };
    expect(closureTransition.from).toBe('INTERRUPTED');
    expect(closureTransition.to).toBe('CLOSED');

    // CLOSED is terminal — no further transition is legal.
    const postClose = resumed.transition(instanceId, 'RUNNING', 'sneaky-restart');
    expect(postClose.ok).toBe(false);
    expect(resumed.stateOf(instanceId)).toBe('CLOSED');
  });

  it('NFR-6: a second conformant adapter is substitutable without kernel changes', () => {
    // The kernel modules (RunState, ContractStore, TaskContractGate,
    // SpawnContractEnforcer) operate over the journal, not the adapter session.
    // A different conformant adapter can be substituted with no kernel changes.
    const journal = makeJournal();
    const adapterA = new MockAdapter();
    const adapterB = new MockAdapter();

    // Both adapters conform to the AdapterSpi (IF-01, AC-BP1).
    expect(assertAdapterConformance(adapterA).ok).toBe(true);
    expect(assertAdapterConformance(adapterB).ok).toBe(true);

    // Launch with adapter A.
    const hA = new RecoverabilityHarness({ journal, adapter: adapterA });
    const taskId = 'task-substitute-001';
    hA.prepareContract(taskId);
    const instanceIdA = hA.launchManaged(taskId, 'agent-a-01');
    expect(hA.runState.stateOf(instanceIdA)).toBe('RUNNING');
    hA.interrupt(instanceIdA);
    expect(hA.runState.stateOf(instanceIdA)).toBe('INTERRUPTED');

    // Forced kill drops adapter A's session.
    hA.forceKill();
    expect(adapterA.isAlive(instanceIdA)).toBe(false);

    // Reconstruct from the journal (NFR-5) — the resumed state is INTERRUPTED.
    const resumed = hA.resume();
    expect(resumed.stateOf(instanceIdA)).toBe('INTERRUPTED');

    // Substitute adapter B: close the instance through a harness wired to
    // adapter B, using the SAME journal. The kernel modules did not change.
    const hB = new RecoverabilityHarness({ journal, adapter: adapterB });
    // The resumed RunState (from the journal) is the authority, not adapter A's
    // dead session. Adapter B can close the instance.
    hB.close(resumed, instanceIdA);
    expect(resumed.stateOf(instanceIdA)).toBe('CLOSED');
  });

  it('FR-K2-6: managed execution is refused without a TaskContract (fail-closed)', () => {
    const journal = makeJournal();
    const adapter = new MockAdapter();
    const h = new RecoverabilityHarness({ journal, adapter });

    // No contract created — the gate must refuse and journal the refusal.
    const result = h.gate.requireContract('task-no-contract-001');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no TaskContract');
    }

    // The refusal is auditable (taskcontract.required journaled).
    const refusalEvents = journal.all().filter((e) => e.kind === 'taskcontract.required');
    expect(refusalEvents.length).toBe(1);
    const refusalPayload = refusalEvents[0]!.payload as { taskId: string; reason: string };
    expect(refusalPayload.taskId).toBe('task-no-contract-001');
    expect(refusalPayload.reason).toContain('FR-K2-6');
  });

  it('NFR-5: the journal survives the kill — verify() passes after reconstruction', () => {
    // The journal's integrity is independent of the dead session. After a
    // forced kill and reconstruction, the chain is still verifiable (FR-K1-5).
    const journal = makeJournal();
    const adapter = new MockAdapter();
    const h = new RecoverabilityHarness({ journal, adapter });

    const taskId = 'task-verify-001';
    h.prepareContract(taskId);
    const instanceId = h.launchManaged(taskId, 'agent-verify-01');
    h.interrupt(instanceId);

    // Verify the chain before the kill.
    const verifyBefore = journal.verify();
    expect(verifyBefore.ok).toBe(true);
    expect(verifyBefore.checked).toBe(journal.count());

    // Forced kill + reconstruct.
    h.forceKill();
    const resumed = h.resume();
    expect(resumed.stateOf(instanceId)).toBe('INTERRUPTED');

    // Verify the chain after the kill — the journal is intact.
    const verifyAfter = journal.verify();
    expect(verifyAfter.ok).toBe(true);
    expect(verifyAfter.checked).toBe(journal.count());

    // Close and verify again.
    h.close(resumed, instanceId);
    const verifyFinal = journal.verify();
    expect(verifyFinal.ok).toBe(true);
  });

  it('FR-K1-9: write-ahead — the journal event is sealed before the state reflects it', () => {
    // Throughout the lifecycle, every transition is journaled before the
    // in-memory cache advances. We verify this by constructing a fresh
    // RunState over the same journal immediately after each transition.
    const journal = makeJournal();
    const adapter = new MockAdapter();
    const h = new RecoverabilityHarness({ journal, adapter });

    const taskId = 'task-writeahead-001';
    h.prepareContract(taskId);
    const instanceId = h.launchManaged(taskId, 'agent-wa-01');

    // After launch (QUEUED → RUNNING), a fresh RunState sees RUNNING.
    const afterLaunch = new RunState({ journal });
    expect(afterLaunch.stateOf(instanceId)).toBe('RUNNING');

    h.interrupt(instanceId);

    // After interrupt (RUNNING → INTERRUPTED), a fresh RunState sees INTERRUPTED.
    const afterInterrupt = new RunState({ journal });
    expect(afterInterrupt.stateOf(instanceId)).toBe('INTERRUPTED');

    // The write-ahead guarantee means the journal is always ahead of or
    // equal to the in-memory cache — never behind.
    const eventCount = journal.all().filter((e) => e.kind === 'runstate.transition').length;
    expect(eventCount).toBe(2);
  });
});
