/**
 * S7 CLI command implementations — IF-02.
 *
 * IF-02: The CLI (S7) SHALL implement: init, journal append/verify/replay,
 *   contract create/validate/list/history/supersede, policy load, hooks run,
 *   identity create/list/validate, trace check, kpi report, decision record
 *   with exit codes 0/1/2/3 (2 = OWNER DECISION REQUIRED stop).
 * IF-03: Exit code 2 SHALL be emitted whenever an operation encounters an
 *   OWNER DECISION REQUIRED item, with a generated decision-request document;
 *   the blocked path SHALL halt while non-blocked tasks continue.
 *
 * Exit codes:
 *   0 = success
 *   1 = error (validation failure, not found, etc.)
 *   2 = OWNER DECISION REQUIRED stop (IF-03)
 *   3 = other (unexpected internal error)
 *
 * The CLI is the composition root: it wires kernel modules together and
 * performs filesystem I/O. It imports kernel/lib (never reverse — C-09).
 *
 * @forge-trace {"component_id":"cli-commands","problems":["P08","P01","P22","P30","P09","P93","P74"],"heritage":["K01","K02","K04","K05"],"decisions":["DEC-01","DEC-22","DEC-41"],"bp_ids":[],"ac_ids":["AC-P01"]}
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';

import { EventJournal } from '../kernel/event-journal.js';
import { MemoryJournalStorage } from '../kernel/storage-memory.js';
import { ContractStore } from '../kernel/contract-store.js';
import {
  PolicyHookRunner,
  HOOK_POINTS,
  type HookContext,
} from '../kernel/policy-hooks.js';
import { AgentRegistry } from '../kernel/agent-registry.js';
import { canonicalJson } from '../kernel/canonical-json.js';
import { sha256Hex } from '../lib/hash.js';
import { ulid } from '../lib/ulid.js';

// ---------------------------------------------------------------------------
// Exit codes (IF-02 / IF-03)
// ---------------------------------------------------------------------------
export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_OWNER_DECISION = 2;
export const EXIT_OTHER = 3;

export type ExitCode = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Workspace layout — FOrGE stores Tier-A artifacts under content/ as Markdown.
// ---------------------------------------------------------------------------
const CONTENT_DIRS = [
  'task-contracts',
  'decision-records',
  'policies',
  'identities',
  'evidence-bundles',
  'context-grants',
  'authority-matrices',
  'skills',
  'pkps',
  'knowledge',
] as const;

const FORGE_DIR = '.forge';
const JOURNAL_FILE = 'journal.jsonl';

/**
 * The CLI context — a composition of the kernel modules plus the workspace
 * root. Commands receive this and operate against it.
 */
export interface CliContext {
  root: string;
  journal: EventJournal;
  contracts: ContractStore;
  hooks: PolicyHookRunner;
  registry: AgentRegistry;
}

/**
 * Resolve the workspace root. If a path is given, use it; otherwise use cwd.
 */
function resolveRoot(given?: string): string {
  return resolve(given ?? process.cwd());
}

/**
 * Load the journal from a JSONL file on disk. Each line is a canonical-JSON
 * StoredEventRow. Returns a MemoryJournalStorage pre-populated with the rows.
 * If the file does not exist, returns an empty storage.
 */
function loadJournalStorage(journalPath: string): MemoryJournalStorage {
  const storage = new MemoryJournalStorage();
  if (!existsSync(journalPath)) return storage;
  const text = readFileSync(journalPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as Record<string, unknown>;
      // Re-insert each row; storage is idempotent by event_id.
      storage.insert({
        event_id: String(row.event_id ?? ''),
        ts: String(row.ts ?? ''),
        actor: String(row.actor ?? ''),
        task_ref: row.task_ref === null ? null : String(row.task_ref ?? ''),
        kind: String(row.kind ?? ''),
        payload_hash: String(row.payload_hash ?? ''),
        prev_hash: String(row.prev_hash ?? ''),
        hash: String(row.hash ?? ''),
        body: String(row.body ?? ''),
      });
    } catch {
      // Skip malformed lines — but the journal verify will catch tampering.
    }
  }
  return storage;
}

/**
 * Persist the journal to disk as JSONL (one canonical row per line).
 * Append-only: we rewrite the file from the in-memory rows (the storage is
 * the source of truth; this is a flush, not a mutation).
 */
function saveJournal(journalPath: string, storage: MemoryJournalStorage): void {
  const rows = storage.all();
  const lines = rows.map((r) => canonicalJson(r));
  mkdirSync(dirname(journalPath), { recursive: true });
  writeFileSync(journalPath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8');
}

/**
 * Build a CliContext for a workspace root. Loads the journal from disk and
 * wires the kernel modules.
 */
export function loadContext(rootGiven?: string): CliContext {
  const root = resolveRoot(rootGiven);
  const forgeDir = join(root, FORGE_DIR);
  const journalPath = join(forgeDir, JOURNAL_FILE);
  const storage = loadJournalStorage(journalPath);
  const journal = new EventJournal({ storage });
  const contracts = new ContractStore();
  const hooks = new PolicyHookRunner(journal);
  const registry = new AgentRegistry();
  return { root, journal, contracts, hooks, registry };
}

/**
 * Flush the journal context to disk.
 */
export function saveContext(ctx: CliContext): void {
  const journalPath = join(ctx.root, FORGE_DIR, JOURNAL_FILE);
  const storage = ctx.journal['storage'] as unknown;
  if (storage instanceof MemoryJournalStorage) {
    saveJournal(journalPath, storage);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function out(msg: string): void {
  process.stdout.write(msg + '\n');
}

function err(msg: string): void {
  process.stderr.write(msg + '\n');
}

function readJsonFile(path: string): unknown {
  const text = readFileSync(path, 'utf8');
  return JSON.parse(text);
}

/**
 * Parse a JSON string from a CLI argument. Returns {ok, value} or {ok:false, error}.
 */
function parseJsonArg(arg: string, label: string):
  | { ok: true; value: unknown }
  | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(arg) };
  } catch {
    return { ok: false, error: `invalid JSON for ${label}: ${arg}` };
  }
}

// ===========================================================================
// init — initialize a FOrGE workspace
// ===========================================================================
export function cmdInit(opts: { root: string | undefined }): ExitCode {
  const root = resolveRoot(opts.root);
  const forgeDir = join(root, FORGE_DIR);
  mkdirSync(forgeDir, { recursive: true });
  for (const dir of CONTENT_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  // Create an empty journal file if it does not exist.
  const journalPath = join(forgeDir, JOURNAL_FILE);
  if (!existsSync(journalPath)) {
    writeFileSync(journalPath, '', 'utf8');
  }
  out(`Initialized FOrGE workspace at ${root}`);
  out(`  ${FORGE_DIR}/${JOURNAL_FILE}`);
  for (const dir of CONTENT_DIRS) {
    out(`  ${dir}/`);
  }
  return EXIT_SUCCESS;
}

// ===========================================================================
// journal append — append an event to the K-1 journal
// ===========================================================================
export function cmdJournalAppend(opts: {
  root: string | undefined;
  actor: string;
  kind: string;
  payload: string;
  taskRef?: string;
}): ExitCode {
  const ctx = loadContext(opts.root);
  const payloadParsed = parseJsonArg(opts.payload, 'payload');
  if (!payloadParsed.ok) {
    err(payloadParsed.error);
    return EXIT_ERROR;
  }
  const appendInput: {
    actor: string;
    kind: string;
    payload: Record<string, unknown>;
    task_ref?: string;
  } = {
    actor: opts.actor,
    kind: opts.kind,
    payload: payloadParsed.value as Record<string, unknown>,
  };
  if (opts.taskRef !== undefined) appendInput.task_ref = opts.taskRef;
  const res = ctx.journal.append(appendInput);
  saveContext(ctx);
  if (res.kind === 'appended') {
    out(canonicalJson(res.event));
    return EXIT_SUCCESS;
  }
  if (res.kind === 'duplicate') {
    out(canonicalJson(res.event));
    return EXIT_SUCCESS;
  }
  // rejected
  err(`append rejected: ${res.reason}`);
  if (res.patternId) err(`  pattern: ${res.patternId}`);
  return EXIT_ERROR;
}

// ===========================================================================
// journal verify — verify the K-1 chain integrity (FR-K1-5 / NFR-1)
// ===========================================================================
export function cmdJournalVerify(opts: { root: string | undefined; fromId?: string }): ExitCode {
  const ctx = loadContext(opts.root);
  const result = ctx.journal.verify(opts.fromId);
  if (result.ok) {
    out(`OK: ${result.checked} event(s) verified, chain intact.`);
    return EXIT_SUCCESS;
  }
  err(`BROKEN: ${result.checked} event(s) checked, first broken at ${result.firstBroken?.eventId ?? '?'}`);
  err(`  reason: ${result.firstBroken?.reason ?? 'unknown'}`);
  return EXIT_ERROR;
}

// ===========================================================================
// journal replay — fold over a range of events (FR-K1-6)
// ===========================================================================
export function cmdJournalReplay(opts: {
  root: string | undefined;
  fromId?: string;
  toId?: string;
}): ExitCode {
  const ctx = loadContext(opts.root);
  const events = ctx.journal.replay(
    opts.fromId ?? null,
    opts.toId ?? null,
    [] as ReturnType<typeof ctx.journal.all>,
    (acc, e) => {
      acc.push(e);
      return acc;
    },
  );
  for (const e of events) {
    out(canonicalJson(e));
  }
  return EXIT_SUCCESS;
}

// ===========================================================================
// contract create — create and store a Tier-A artifact from a file
// ===========================================================================
export function cmdContractCreate(opts: { root: string | undefined; file: string }): ExitCode {
  const ctx = loadContext(opts.root);
  let raw: unknown;
  try {
    raw = readJsonFile(opts.file);
  } catch (e) {
    err(`cannot read artifact file: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT_ERROR;
  }
  const res = ctx.contracts.store(raw);
  if (!res.ok) {
    for (const e of res.errors) err(`  ${e}`);
    return EXIT_ERROR;
  }
  out(canonicalJson({ artifactId: res.artifact.frontmatter.artifactId, ok: true }));
  return EXIT_SUCCESS;
}

// ===========================================================================
// contract validate — validate an artifact without storing (FR-K2-3)
// ===========================================================================
export function cmdContractValidate(opts: { root: string | undefined; file: string }): ExitCode {
  const ctx = loadContext(opts.root);
  let raw: unknown;
  try {
    raw = readJsonFile(opts.file);
  } catch (e) {
    err(`cannot read artifact file: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT_ERROR;
  }
  const res = ctx.contracts.validate(raw);
  if (!res.ok) {
    for (const e of res.errors) err(`  ${e}`);
    return EXIT_ERROR;
  }
  out(`OK: artifact ${res.artifact.frontmatter.artifactId} is valid.`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// contract list — list stored artifacts, optionally filtered by type
// ===========================================================================
export function cmdContractList(opts: { root: string | undefined; type?: string }): ExitCode {
  const ctx = loadContext(opts.root);
  const list = opts.type ? ctx.contracts.listByType(opts.type as never) : ctx.contracts.list();
  for (const art of list) {
    out(
      `${art.frontmatter.artifactId}\t${art.frontmatter.artifactType}\tv${art.frontmatter.version}\t${art.frontmatter.lifecycleState}`,
    );
  }
  out(`(${list.length} artifact(s))`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// contract history — show the supersession chain for an artifact (FR-K2-4)
// ===========================================================================
export function cmdContractHistory(opts: { root: string | undefined; artifactId: string }): ExitCode {
  const ctx = loadContext(opts.root);
  const chain = ctx.contracts.historyOf(opts.artifactId);
  if (chain.length === 0) {
    out(`No supersession history for ${opts.artifactId}.`);
    return EXIT_SUCCESS;
  }
  out(`Supersession chain for ${opts.artifactId}:`);
  for (const id of chain) out(`  -> ${id}`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// contract supersede — supersede an artifact with explicit reason (FR-K2-4)
// ===========================================================================
export function cmdContractSupersede(opts: {
  root: string | undefined;
  oldId: string;
  newId: string;
  reason: string;
}): ExitCode {
  const ctx = loadContext(opts.root);
  const res = ctx.contracts.supersede({
    oldArtifactId: opts.oldId,
    newArtifactId: opts.newId,
    reason: opts.reason,
  });
  if (!res.ok) {
    err(`supersede failed: ${res.reason ?? 'unknown'}`);
    return EXIT_ERROR;
  }
  out(`Superseded: ${opts.oldId} -> ${opts.newId} (${opts.reason})`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// policy load — load policy rules from a JSON file (FR-K4-2 / C-11)
// ===========================================================================
export function cmdPolicyLoad(opts: { root: string | undefined; file: string }): ExitCode {
  const ctx = loadContext(opts.root);
  let raw: unknown;
  try {
    raw = readJsonFile(opts.file);
  } catch (e) {
    err(`cannot read policy file: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT_ERROR;
  }
  if (!Array.isArray(raw)) {
    err('policy file must be an array of rules');
    return EXIT_ERROR;
  }
  const res = ctx.hooks.loadRules(raw);
  if (!res.ok) {
    for (const e of res.errors ?? []) err(`  ${e}`);
    return EXIT_ERROR;
  }
  out(`Loaded ${raw.length} policy rule(s). Mode: ${ctx.hooks.getMode()}.`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// hooks run — evaluate a hook point (shadow mode in P1, FR-K4-3)
// ===========================================================================
export function cmdHooksRun(opts: {
  root: string | undefined;
  hookPoint: string;
  actionClass: string;
  payload: string;
  labels?: string;
}): ExitCode {
  const ctx = loadContext(opts.root);
  if (!HOOK_POINTS.includes(opts.hookPoint as never)) {
    err(`invalid hook point: ${opts.hookPoint}`);
    err(`  valid: ${HOOK_POINTS.join(', ')}`);
    return EXIT_ERROR;
  }
  const payloadParsed = parseJsonArg(opts.payload, 'payload');
  if (!payloadParsed.ok) {
    err(payloadParsed.error);
    return EXIT_ERROR;
  }
  const labels = opts.labels ? opts.labels.split(',').map((s) => s.trim()) : [];
  const hookCtx: HookContext = {
    hookPoint: opts.hookPoint as never,
    actionClass: opts.actionClass,
    payload: payloadParsed.value as Record<string, unknown>,
    labels,
  };
  const outcome = ctx.hooks.evaluate(hookCtx);
  saveContext(ctx); // hook.evaluated journaled
  out(canonicalJson(outcome));
  // In P1 shadow mode, decision is always 'allow' — but if a future enforce
  // mode returns 'deny' on a critical path, that would be exit 2 (OWNER
  // DECISION) per IF-03. In P1 we always return success.
  return EXIT_SUCCESS;
}

// ===========================================================================
// identity create — register an AgentIdentity from a file (FR-K5-1)
// ===========================================================================
export function cmdIdentityCreate(opts: { root: string | undefined; file: string }): ExitCode {
  const ctx = loadContext(opts.root);
  let raw: unknown;
  try {
    raw = readJsonFile(opts.file);
  } catch (e) {
    err(`cannot read identity file: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT_ERROR;
  }
  const res = ctx.registry.register(raw);
  if (!res.ok) {
    for (const e of res.errors) err(`  ${e}`);
    return EXIT_ERROR;
  }
  out(`Registered identity: ${res.identity.identityId} (${res.identity.authorityClass})`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// identity list — list registered identities (FR-K5-1)
// ===========================================================================
export function cmdIdentityList(opts: { root: string | undefined }): ExitCode {
  const ctx = loadContext(opts.root);
  const list = ctx.registry.list();
  for (const id of list) {
    out(`${id.identityId}\t${id.authorityClass}\t${id.privateMemoryNs}`);
  }
  out(`(${list.length} identity/identities)`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// identity validate — validate an identity record without storing (FR-K5-1)
// ===========================================================================
export function cmdIdentityValidate(opts: { root: string | undefined; file: string }): ExitCode {
  const ctx = loadContext(opts.root);
  let raw: unknown;
  try {
    raw = readJsonFile(opts.file);
  } catch (e) {
    err(`cannot read identity file: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_ERROR;
  }
  const res = ctx.registry.validate(raw);
  if (!res.ok) {
    for (const e of res.errors) err(`  ${e}`);
    return EXIT_ERROR;
  }
  out('OK: identity is valid.');
  return EXIT_SUCCESS;
}

// ===========================================================================
// trace check — verify all src modules carry @forge-trace records (C-04/NFR-10)
// ===========================================================================
export function cmdTraceCheck(opts: { root: string | undefined }): ExitCode {
  const root = resolveRoot(opts.root);
  const srcDir = join(root, 'src');
  if (!existsSync(srcDir)) {
    err(`src/ directory not found at ${srcDir}`);
    return EXIT_ERROR;
  }
  const TRACEABILITY_HEADER = /@forge-trace\s+\{[^}]*\}/s;
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (existsSync(full) && isDir(full)) {
        walk(full);
      } else if (entry.endsWith('.ts')) {
        files.push(full);
      }
    }
  }
  function isDir(p: string): boolean {
    try {
      return readdirSync(p) !== null;
    } catch {
      return false;
    }
  }
  walk(srcDir);
  let missing = 0;
  let checked = 0;
  for (const f of files) {
    const rel = relative(srcDir, f);
    // cli/index.ts is exempt (composition root).
    if (rel === 'cli/index.ts') {
      checked++;
      continue;
    }
    const content = readFileSync(f, 'utf8');
    if (!TRACEABILITY_HEADER.test(content)) {
      err(`MISSING @forge-trace: ${rel}`);
      missing++;
    }
    checked++;
  }
  if (missing > 0) {
    err(`\n${missing} module(s) missing traceability records (of ${checked} checked).`);
    return EXIT_ERROR;
  }
  out(`OK: ${checked} module(s) carry @forge-trace records.`);
  return EXIT_SUCCESS;
}

// ===========================================================================
// kpi report — report P1 KPIs (NFR-11 coverage, journal count, artifact count)
// ===========================================================================
export function cmdKpiReport(opts: { root: string | undefined }): ExitCode {
  const ctx = loadContext(opts.root);
  const journalCount = ctx.journal.count();
  const artifactCount = ctx.contracts.list().length;
  const identityCount = ctx.registry.list().length;
  const hookMode = ctx.hooks.getMode();

  // Coverage: count kernel/lib modules with trace records.
  const srcDir = join(ctx.root, 'src');
  let moduleCount = 0;
  let tracedCount = 0;
  if (existsSync(srcDir)) {
    const TRACEABILITY_HEADER = /@forge-trace\s+\{[^}]*\}/s;
    const files: string[] = [];
    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (existsSync(full) && isDir(full)) {
          walk(full);
        } else if (entry.endsWith('.ts')) {
          files.push(full);
        }
      }
    }
    function isDir(p: string): boolean {
      try {
        return readdirSync(p) !== null;
      } catch {
        return false;
      }
    }
    walk(srcDir);
    for (const f of files) {
      const rel = relative(srcDir, f);
      moduleCount++;
      if (rel === 'cli/index.ts') {
        tracedCount++;
        continue;
      }
      const content = readFileSync(f, 'utf8');
      if (TRACEABILITY_HEADER.test(content)) tracedCount++;
    }
  }
  const coverage = moduleCount > 0 ? Math.round((tracedCount / moduleCount) * 100) : 0;

  out('FOrGE KPI Report (P1)');
  out('======================');
  out(`Journal events:     ${journalCount}`);
  out(`Artifacts:          ${artifactCount}`);
  out(`Identities:         ${identityCount}`);
  out(`Hook mode:           ${hookMode}`);
  out(`Traceability:       ${tracedCount}/${moduleCount} modules (${coverage}%)`);

  // NFR-11: ≥90% kernel coverage. If below 90%, emit OWNER DECISION REQUIRED.
  if (coverage < 90) {
    err(`\nNFR-11: kernel coverage ${coverage}% < 90% threshold.`);
    err('OWNER DECISION REQUIRED: coverage gap must be closed before P1 gate.');
    return EXIT_OWNER_DECISION;
  }
  return EXIT_SUCCESS;
}

// ===========================================================================
// decision record — create a DecisionRecord (FR-K2-7)
// ===========================================================================
export function cmdDecisionRecord(opts: {
  root: string | undefined;
  context: string;
  chosenOption: string;
  rejectedAlternative: string;
  rejectionReason: string;
  approver: string;
  evidenceRefs?: string;
  scope?: string;
}): ExitCode {
  const ctx = loadContext(opts.root);
  let evidenceRefs: { kind: string; locator: string; version_hash?: string; pinned_at?: string }[] = [];
  if (opts.evidenceRefs) {
    const parsed = parseJsonArg(opts.evidenceRefs, 'evidenceRefs');
    if (!parsed.ok) {
      err(parsed.error);
      return EXIT_ERROR;
    }
    if (!Array.isArray(parsed.value)) {
      err('evidenceRefs must be a JSON array');
      return EXIT_ERROR;
    }
    evidenceRefs = parsed.value as typeof evidenceRefs;
  }
  const drInput: {
    context: string;
    chosenOption: string;
    rejectedAlternative: string;
    rejectionReason: string;
    evidenceRefs: typeof evidenceRefs;
    approver: string;
    scope?: string;
  } = {
    context: opts.context,
    chosenOption: opts.chosenOption,
    rejectedAlternative: opts.rejectedAlternative,
    rejectionReason: opts.rejectionReason,
    evidenceRefs,
    approver: opts.approver,
  };
  if (opts.scope !== undefined) drInput.scope = opts.scope;
  const dr = ctx.contracts.createDecisionRecord(drInput);
  out(`Created DecisionRecord: ${dr.frontmatter.artifactId}`);
  return EXIT_SUCCESS;
}

// Re-export for the entrypoint.
export { ulid, sha256Hex, canonicalJson };
