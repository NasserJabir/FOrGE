#!/usr/bin/env tsx
/**
 * FOrGE CLI (S7) — entrypoint / composition root (IF-02).
 *
 * This file is the composition root: it wires commander commands to the
 * command implementations in commands.ts. It is EXEMPT from the @forge-trace
 * requirement (per scripts/ci-guards.ts) because it contains no governed
 * logic — only command wiring and exit-code propagation.
 *
 * Exit codes (IF-02 / IF-03):
 *   0 = success
 *   1 = error (validation failure, not found, etc.)
 *   2 = OWNER DECISION REQUIRED stop
 *   3 = other (unexpected internal error)
 *
 * Usage:
 *   npx tsx src/cli/index.ts <command> [options]
 *   npm run cli -- <command> [options]
 */
import { Command } from 'commander';
import {
  cmdInit,
  cmdJournalAppend,
  cmdJournalVerify,
  cmdJournalReplay,
  cmdContractCreate,
  cmdContractValidate,
  cmdContractList,
  cmdContractHistory,
  cmdContractSupersede,
  cmdPolicyLoad,
  cmdHooksRun,
  cmdIdentityCreate,
  cmdIdentityList,
  cmdIdentityValidate,
  cmdTraceCheck,
  cmdKpiReport,
  cmdDecisionRecord,
  type ExitCode,
} from './commands.js';

const program = new Command();

program
  .name('forge')
  .description('FOrGE — agent-agnostic governance and truth substrate (FORGE-SRS-1.0)')
  .version('0.1.0')
  .option('-r, --root <path>', 'workspace root directory (default: cwd)');

// Helper: resolve --root from the parent program options.
function rootOf(cmd: Command): string | undefined {
  const opts = cmd.parent?.opts() ?? {};
  return typeof opts.root === 'string' ? opts.root : undefined;
}

// --- init ---
program
  .command('init')
  .description('initialize a FOrGE workspace (creates .forge/ and content/ dirs)')
  .action(() => {
    const root = rootOf(program);
    exit(cmdInit({ root }));
  });

// --- journal ---
const journal = program.command('journal').description('K-1 event journal operations');

journal
  .command('append')
  .description('append an event to the journal')
  .requiredOption('-a, --actor <id>', 'actor identity id')
  .requiredOption('-k, --kind <domain.action>', 'event kind (namespaced)')
  .requiredOption('-p, --payload <json>', 'event payload as JSON')
  .option('-t, --task-ref <ref>', 'task reference id')
  .action((opts) => {
    exit(
      cmdJournalAppend({
        root: rootOf(program),
        actor: opts.actor,
        kind: opts.kind,
        payload: opts.payload,
        taskRef: opts.taskRef,
      }),
    );
  });

journal
  .command('verify')
  .description('verify the K-1 chain integrity (FR-K1-5 / NFR-1)')
  .option('-f, --from-id <id>', 'verify starting from this event id')
  .action((opts) => {
    exit(cmdJournalVerify({ root: rootOf(program), fromId: opts.fromId }));
  });

journal
  .command('replay')
  .description('replay (fold over) a range of events (FR-K1-6)')
  .option('-f, --from-id <id>', 'start event id (inclusive)')
  .option('-t, --to-id <id>', 'end event id (inclusive)')
  .action((opts) => {
    exit(
      cmdJournalReplay({
        root: rootOf(program),
        fromId: opts.fromId,
        toId: opts.toId,
      }),
    );
  });

// --- contract ---
const contract = program.command('contract').description('K-2 contract store operations');

contract
  .command('create')
  .description('create and store a Tier-A artifact from a JSON file')
  .requiredOption('-f, --file <path>', 'artifact JSON file (frontmatter + body)')
  .action((opts) => {
    exit(cmdContractCreate({ root: rootOf(program), file: opts.file }));
  });

contract
  .command('validate')
  .description('validate an artifact without storing (FR-K2-3)')
  .requiredOption('-f, --file <path>', 'artifact JSON file')
  .action((opts) => {
    exit(cmdContractValidate({ root: rootOf(program), file: opts.file }));
  });

contract
  .command('list')
  .description('list stored artifacts, optionally filtered by type')
  .option('-t, --type <type>', 'artifact type filter')
  .action((opts) => {
    exit(cmdContractList({ root: rootOf(program), type: opts.type }));
  });

contract
  .command('history')
  .description('show the supersession chain for an artifact (FR-K2-4)')
  .requiredOption('-i, --artifact-id <id>', 'artifact id')
  .action((opts) => {
    exit(cmdContractHistory({ root: rootOf(program), artifactId: opts.artifactId }));
  });

contract
  .command('supersede')
  .description('supersede an artifact with explicit reason (FR-K2-4)')
  .requiredOption('--old-id <id>', 'old artifact id')
  .requiredOption('--new-id <id>', 'new (successor) artifact id')
  .requiredOption('--reason <text>', 'supersession reason (required)')
  .action((opts) => {
    exit(
      cmdContractSupersede({
        root: rootOf(program),
        oldId: opts.oldId,
        newId: opts.newId,
        reason: opts.reason,
      }),
    );
  });

// --- policy ---
const policy = program.command('policy').description('K-4 policy operations');

policy
  .command('load')
  .description('load policy rules from a JSON array file (FR-K4-2 / C-11)')
  .requiredOption('-f, --file <path>', 'policy rules JSON array file')
  .action((opts) => {
    exit(cmdPolicyLoad({ root: rootOf(program), file: opts.file }));
  });

// --- hooks ---
const hooks = program.command('hooks').description('K-4 hook evaluation operations');

hooks
  .command('run')
  .description('evaluate a hook point (shadow mode in P1, FR-K4-3)')
  .requiredOption('-p, --hook-point <point>', 'hook point (pre-send|pre-tool|post-result|pre-commit|periodic-tick)')
  .requiredOption('-c, --action-class <class>', 'action class')
  .requiredOption('--payload <json>', 'payload as JSON')
  .option('-l, --labels <csv>', 'comma-separated labels')
  .action((opts) => {
    exit(
      cmdHooksRun({
        root: rootOf(program),
        hookPoint: opts.hookPoint,
        actionClass: opts.actionClass,
        payload: opts.payload,
        labels: opts.labels,
      }),
    );
  });

// --- identity ---
const identity = program.command('identity').description('K-5 agent registry operations');

identity
  .command('create')
  .description('register an AgentIdentity from a JSON file (FR-K5-1)')
  .requiredOption('-f, --file <path>', 'identity JSON file')
  .action((opts) => {
    exit(cmdIdentityCreate({ root: rootOf(program), file: opts.file }));
  });

identity
  .command('list')
  .description('list registered identities (FR-K5-1)')
  .action(() => {
    exit(cmdIdentityList({ root: rootOf(program) }));
  });

identity
  .command('validate')
  .description('validate an identity record without storing (FR-K5-1)')
  .requiredOption('-f, --file <path>', 'identity JSON file')
  .action((opts) => {
    exit(cmdIdentityValidate({ root: rootOf(program), file: opts.file }));
  });

// --- trace ---
program
  .command('trace')
  .description('traceability operations')
  .command('check')
  .description('verify all src modules carry @forge-trace records (C-04 / NFR-10)')
  .action(() => {
    exit(cmdTraceCheck({ root: rootOf(program) }));
  });

// --- kpi ---
program
  .command('kpi')
  .description('KPI operations')
  .command('report')
  .description('report P1 KPIs (NFR-11 coverage, journal/artifact/identity counts)')
  .action(() => {
    exit(cmdKpiReport({ root: rootOf(program) }));
  });

// --- decision ---
program
  .command('decision')
  .description('decision operations')
  .command('record')
  .description('create a DecisionRecord (FR-K2-7)')
  .requiredOption('--context <text>', 'decision context')
  .requiredOption('--chosen-option <text>', 'chosen option')
  .requiredOption('--rejected-alternative <text>', 'rejected alternative')
  .requiredOption('--rejection-reason <text>', 'rejection reason')
  .requiredOption('--approver <id>', 'approver identity')
  .option('--evidence-refs <json>', 'evidence refs as JSON array')
  .option('--scope <scope>', 'scope (default: project)')
  .action((opts) => {
    exit(
      cmdDecisionRecord({
        root: rootOf(program),
        context: opts.context,
        chosenOption: opts.chosenOption,
        rejectedAlternative: opts.rejectedAlternative,
        rejectionReason: opts.rejectionReason,
        approver: opts.approver,
        evidenceRefs: opts.evidenceRefs,
        scope: opts.scope,
      }),
    );
  });

/**
 * Propagate the command exit code to the process.
 * Exit codes: 0=success, 1=error, 2=OWNER DECISION, 3=other (IF-02/IF-03).
 */
function exit(code: ExitCode): void {
  process.exit(code);
}

program.parse(process.argv);
