/**
 * K-2 TaskContract enforcement — FR-K2-6, AC-BP10.
 *
 * FR-K2-6: A task SHALL NOT start managed execution without a TaskContract;
 *   remaining assumptions SHALL enter as Assumption claims at zero confidence.
 * AC-BP10: Task contract before managed execution (P2/P3).
 *
 * The TaskContractGate is the enforcement point. `requireContract(taskId)`
 * returns `{ok, contract, assumptionClaims}` when an active TaskContract
 * exists for the task, or `{ok: false, reason}` and journals a
 * `taskcontract.required` event (fail-closed) when none exists.
 *
 * Remaining assumptions recorded on the TaskContract enter as Assumption
 * claims at zero confidence — journaled as `assumption.claim` events. They are
 * surfaced (never silently dropped), but never elevated: confidence is always
 * exactly 0 (FR-K2-6 second clause).
 *
 * @forge-trace {"component_id":"kernel-task-contract","problems":["P01"],"heritage":["K02"],"decisions":["DEC-01"],"bp_ids":[],"ac_ids":["AC-BP10"]}
 */
import type { EventJournal } from './event-journal.js';

/** The event kind journaled when managed execution is refused (no TaskContract). */
export const TASKCONTRACT_REQUIRED_KIND = 'taskcontract.required';

/** The event kind journaled for each Assumption claim at zero confidence. */
export const ASSUMPTION_CLAIM_KIND = 'assumption.claim';

/** An assumption recorded on a TaskContract (free text, enters at zero confidence). */
export interface AssumptionInput {
  text: string;
}

/** A resolved Assumption claim — journaled at confidence 0. */
export interface AssumptionClaim {
  claimType: 'Assumption';
  text: string;
  confidence: number;
  taskId: string;
  eventId: string;
}

/** Input for creating a TaskContract artifact. */
export interface TaskContractInput {
  taskId: string;
  objective: string;
  scope?: string;
  createdBy: string;
  assumptions: AssumptionInput[];
}

/** The result of requireContract — ok when a contract exists, fail-closed otherwise. */
export type RequireContractResult =
  | {
      ok: true;
      contract: {
        artifactId: string;
        frontmatter: { artifactType: string; lifecycleState: string };
      };
      assumptionClaims: AssumptionClaim[];
    }
  | { ok: false; reason: string };

/** Options for constructing a TaskContractGate. */
export interface TaskContractGateOptions {
  store: TaskContractStoreLike;
  journal: EventJournal;
}

/**
 * The subset of ContractStore the gate depends on. Kept as an interface so the
 * gate is testable against a stub and so the dependency direction is explicit.
 */
export interface TaskContractStoreLike {
  listByType(type: 'TaskContract'): Array<{
    frontmatter: {
      artifactId: string;
      lifecycleState: string;
      status: string;
    };
    body: string;
  }>;
}

/**
 * K-2 TaskContract enforcement gate (FR-K2-6, AC-BP10).
 *
 * A task SHALL NOT start managed execution without a TaskContract. The gate
 * is fail-closed: when no active contract exists for the task, it refuses and
 * journals a `taskcontract.required` event so the refusal is auditable.
 *
 * Remaining assumptions on the contract enter as Assumption claims at zero
 * confidence (FR-K2-6 second clause). Each is journaled as an `assumption.claim`
 * event. They are surfaced but never elevated — confidence is always exactly 0.
 */
export class TaskContractGate {
  private readonly store: TaskContractStoreLike;
  private readonly journal: EventJournal;

  constructor(opts: TaskContractGateOptions) {
    this.store = opts.store;
    this.journal = opts.journal;
  }

  /**
   * Require a TaskContract for a task (FR-K2-6, AC-BP10).
   *
   * Returns `{ok, contract, assumptionClaims}` when an active (non-superseded)
   * TaskContract exists for the task. Returns `{ok: false, reason}` and
   * journals a `taskcontract.required` event (fail-closed) when none exists.
   *
   * Remaining assumptions on the contract enter as Assumption claims at zero
   * confidence — each journaled as an `assumption.claim` event.
   */
  requireContract(taskId: string): RequireContractResult {
    const contract = this.findActiveContract(taskId);

    if (!contract) {
      // Fail-closed (FR-K2-6): refuse managed execution and journal the
      // refusal so it is auditable. Write-ahead: the rejection is journaled
      // before the gate returns.
      const reason = `no TaskContract for task '${taskId}' (FR-K2-6)`;
      this.journal.append({
        actor: 'forge:task-contract',
        kind: TASKCONTRACT_REQUIRED_KIND,
        payload: { taskId, reason },
        task_ref: taskId,
      });
      return { ok: false, reason };
    }

    // The contract exists. Surface remaining assumptions as Assumption claims
    // at zero confidence (FR-K2-6 second clause). Each is journaled.
    const assumptionClaims: AssumptionClaim[] = [];
    const assumptions = this.extractAssumptions(contract);
    for (const assumption of assumptions) {
      const appendRes = this.journal.append({
        actor: 'forge:task-contract',
        kind: ASSUMPTION_CLAIM_KIND,
        payload: {
          taskId,
          text: assumption,
          confidence: 0,
          claimType: 'Assumption',
        },
        task_ref: taskId,
      });
      // The event is sealed (appended or duplicate). Either way it is journaled.
      const eventId =
        appendRes.kind === 'appended' || appendRes.kind === 'duplicate'
          ? appendRes.event.event_id
          : '';
      assumptionClaims.push({
        claimType: 'Assumption',
        text: assumption,
        confidence: 0,
        taskId,
        eventId,
      });
    }

    return {
      ok: true,
      contract: {
        artifactId: contract.frontmatter.artifactId,
        frontmatter: {
          artifactType: 'TaskContract',
          lifecycleState: contract.frontmatter.lifecycleState,
        },
      },
      assumptionClaims,
    };
  }

  /**
   * Find the active (non-superseded, non-deprecated) TaskContract for a task.
   * The contract body carries the taskId; we scan active TaskContract artifacts.
   */
  private findActiveContract(taskId: string): {
    frontmatter: { artifactId: string; lifecycleState: string; status: string };
    body: string;
  } | null {
    const contracts = this.store.listByType('TaskContract');
    // The most recent active contract for the task wins (version-monotonic).
    for (let i = contracts.length - 1; i >= 0; i--) {
      const c = contracts[i];
      if (!c) continue;
      // Superseded/deprecated artifacts are moved to the deprecated tree by
      // ContractStore.supersede(), so they do not appear in listByType().
      // We still guard against lifecycleState defensively.
      if (c.frontmatter.lifecycleState === 'superseded') continue;
      if (this.contractMatchesTask(c.body, taskId)) {
        return c;
      }
    }
    return null;
  }

  /**
   * Does the contract body reference the given taskId? The TaskContract factory
   * embeds the taskId in the body; we match it back out.
   */
  private contractMatchesTask(body: string, taskId: string): boolean {
    return body.includes(`taskId: ${taskId}`);
  }

  /**
   * Extract remaining assumptions from the contract body. The factory writes
   * them under an `## Assumptions` section, one per line as `- <text>`. An
   * assumption with empty text is still a recorded assumption and MUST be
   * surfaced (FR-K2-6: remaining assumptions enter as Assumption claims at zero
   * confidence — none are silently dropped).
   */
  private extractAssumptions(contract: { body: string }): string[] {
    const body = contract.body;
    const marker = '## Assumptions';
    const idx = body.indexOf(marker);
    if (idx === -1) return [];
    const section = body.slice(idx + marker.length);
    // Stop at the next section marker (if any).
    const nextSection = section.indexOf('\n## ');
    const block = nextSection === -1 ? section : section.slice(0, nextSection);
    const lines = block.split('\n');
    const assumptions: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      // Each assumption is a bullet line: "- <text>". Match the prefix exactly
      // so an empty-text assumption ("- " trimmed to "-") is still captured as
      // an empty string rather than silently dropped.
      if (trimmed === '-') {
        assumptions.push('');
      } else if (trimmed.startsWith('- ')) {
        assumptions.push(trimmed.slice(2));
      }
    }
    return assumptions;
  }
}
