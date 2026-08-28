/**
 * K-15 RunState — event-sourced execution state machine (FR-S3-1, FR-K1-9, NFR-5).
 *
 * FR-S3-1: RunState SHALL be event-sourced from K-1 with declared states
 *   QUEUED → RUNNING ⇄ SUSPENDED → INTERRUPTED → RECOVERING →
 *   (RESUMING → RUNNING) | ABORTED | CLOSED; rebuild on any crash SHALL be
 *   from the journal, never from a dead session's memory.
 * FR-K1-9: state transitions of governed runtimes SHALL be journaled before
 *   effect application (write-ahead); a crash mid-apply SHALL leave the prior
 *   declared state.
 * NFR-5: after forced kill mid-task, the system SHALL reconstruct declared
 *   state from K-1 and resume without the dead session.
 * NFR-6: every BP-conformant provider SHALL be substitutable without changes
 *   to K-1…K-5/S1–S7 (RunState lives above the journal, not the session).
 *
 * The in-memory state is a disposable cache. The journal is the source of
 * truth. A crash drops the cache; reconstruction replays runstate.transition
 * events from K-1.
 *
 * @forge-trace {"component_id":"kernel-run-state","problems":["P95"],"heritage":["K15","R4"],"decisions":["DEC-25"],"bp_ids":[],"ac_ids":[]}
 */
import type { EventJournal } from './event-journal.js';

/** The declared RunState states (FR-S3-1). */
export const RUN_STATES = [
  'QUEUED',
  'RUNNING',
  'SUSPENDED',
  'INTERRUPTED',
  'RECOVERING',
  'RESUMING',
  'ABORTED',
  'CLOSED',
] as const;
export type RunStateValue = (typeof RUN_STATES)[number];

/** Terminal states — once entered, no outgoing transition is legal. */
const TERMINAL_STATES: ReadonlySet<RunStateValue> = new Set(['ABORTED', 'CLOSED']);

/**
 * The legal transition table (FR-S3-1 state diagram).
 * Each source state maps to the set of destination states reachable from it.
 * Terminal states (ABORTED, CLOSED) map to an empty set.
 *
 * Diagram:
 *   QUEUED → RUNNING | ABORTED | CLOSED
 *   RUNNING → SUSPENDED | INTERRUPTED | ABORTED | CLOSED
 *   SUSPENDED → RUNNING | INTERRUPTED | ABORTED | CLOSED
 *   INTERRUPTED → RECOVERING | ABORTED | CLOSED
 *   RECOVERING → RESUMING | ABORTED | CLOSED
 *   RESUMING → RUNNING | ABORTED | CLOSED
 *   ABORTED → (terminal)
 *   CLOSED → (terminal)
 */
export const LEGAL_TRANSITIONS: Readonly<Record<RunStateValue, readonly RunStateValue[]>> = {
  QUEUED: ['RUNNING', 'ABORTED', 'CLOSED'],
  RUNNING: ['SUSPENDED', 'INTERRUPTED', 'ABORTED', 'CLOSED'],
  SUSPENDED: ['RUNNING', 'INTERRUPTED', 'ABORTED', 'CLOSED'],
  INTERRUPTED: ['RECOVERING', 'ABORTED', 'CLOSED'],
  RECOVERING: ['RESUMING', 'ABORTED', 'CLOSED'],
  RESUMING: ['RUNNING', 'ABORTED', 'CLOSED'],
  ABORTED: [],
  CLOSED: [],
};

/** The event kind used to journal state transitions. */
export const RUNSTATE_TRANSITION_KIND = 'runstate.transition';

/** A transition result. */
export type TransitionResult =
  | { ok: true; from: RunStateValue; to: RunStateValue; eventId: string }
  | { ok: false; reason: string };

/** The payload journaled for a runstate.transition event. */
export interface TransitionPayload {
  instanceId: string;
  from: RunStateValue;
  to: RunStateValue;
  reason: string;
}

/** Options for constructing a RunState. */
export interface RunStateOptions {
  journal: EventJournal;
}

/**
 * K-15 RunState — event-sourced execution state.
 *
 * The in-memory map is a cache rebuilt from the journal. transition() writes
 * to the journal FIRST (write-ahead, FR-K1-9), then updates the cache. On
 * crash, the cache is dropped and a new RunState over the same journal
 * reconstructs the last declared state (NFR-5).
 */
export class RunState {
  private readonly journal: EventJournal;
  /** instanceId → current state (disposable cache). */
  private readonly states: Map<string, RunStateValue> = new Map();

  constructor(opts: RunStateOptions) {
    this.journal = opts.journal;
    this.reconstruct();
  }

  /**
   * Transition an instance to a new state (FR-S3-1, FR-K1-9).
   *
   * Write-ahead: the transition event is journaled BEFORE the in-memory
   * cache is updated. A crash between the journal append and the cache
   * update leaves the journal holding the declared state; the cache is
   * disposable and rebuilt on the next construction.
   *
   * Returns ok:false (without journaling) for:
   *  - an unknown destination state,
   *  - an illegal transition (not in LEGAL_TRANSITIONS),
   *  - a transition from a terminal state.
   */
  transition(instanceId: string, to: RunStateValue, reason: string): TransitionResult {
    // Validate the destination state.
    if (!isRunState(to)) {
      return { ok: false, reason: `unknown state '${String(to)}'` };
    }

    const from = this.states.get(instanceId) ?? 'QUEUED';

    // Check legality against the transition table.
    if (!isLegalTransition(from, to)) {
      if (TERMINAL_STATES.has(from)) {
        return {
          ok: false,
          reason: `illegal transition '${from} → ${to}': '${from}' is a terminal state`,
        };
      }
      return {
        ok: false,
        reason: `illegal transition '${from} → ${to}' (not in the state diagram)`,
      };
    }

    // Write-ahead (FR-K1-9): journal BEFORE updating the in-memory cache.
    const payload: TransitionPayload = { instanceId, from, to, reason };
    const appendRes = this.journal.append({
      actor: 'forge:run-state',
      kind: RUNSTATE_TRANSITION_KIND,
      payload: payload as unknown as Record<string, unknown>,
      task_ref: instanceId,
    });

    if (appendRes.kind === 'rejected') {
      // The journal rejected the event (e.g. secret in payload). Do NOT
      // advance the in-memory state — write-ahead means the journal is the
      // authority, and it refused.
      return { ok: false, reason: `journal rejected: ${appendRes.reason}` };
    }

    // The event is sealed (appended or duplicate). Update the cache.
    const eventId =
      appendRes.kind === 'appended' ? appendRes.event.event_id : appendRes.event.event_id;
    this.states.set(instanceId, to);
    return { ok: true, from, to, eventId };
  }

  /**
   * Read the current state of an instance (from the in-memory cache, which
   * was reconstructed from the journal at construction).
   */
  stateOf(instanceId: string): RunStateValue | null {
    return this.states.get(instanceId) ?? null;
  }

  /**
   * Reconstruct the in-memory state from the journal (NFR-5).
   * Called at construction; may be called again after a forced kill.
   */
  reconstruct(): void {
    this.states.clear();
    this.journal.replay<Map<string, RunStateValue>>(null, null, this.states, (acc, event) => {
      if (event.kind === RUNSTATE_TRANSITION_KIND) {
        const p = event.payload as unknown as TransitionPayload;
        if (isRunState(p.to)) {
          acc.set(p.instanceId, p.to);
        }
      }
      return acc;
    });
  }
}

/** Type guard: is the value a declared RunState? */
function isRunState(value: unknown): value is RunStateValue {
  return typeof value === 'string' && (RUN_STATES as readonly string[]).includes(value);
}

/** Is the transition from → to legal per the state diagram? */
function isLegalTransition(from: RunStateValue, to: RunStateValue): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}
