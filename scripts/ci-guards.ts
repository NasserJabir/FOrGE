#!/usr/bin/env tsx
/**
 * FOrGE CI Guards — enforces SRS design constraints at CI time.
 *
 * C-02: No network facilities in src/kernel/** or src/lib/**
 * C-03: No implementation source in src/planes/** before its phase gate
 * C-04: Every module carries a machine-checkable traceability record
 * C-09: Dependency direction cli -> kernel -> lib (planes import kernel, never reverse)
 * NFR-10: 100% of implementation modules carry complete triples
 *
 * Exit codes: 0 = pass, 1 = guard failure
 *
 * [P1] (trace: C-02, C-03, C-04, C-09, NFR-10; DEC-22, DEC-41)
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

// C-02: forbidden network module specifiers in kernel/lib.
// Match actual import/require of network facilities, not substrings in
// comments or identifiers. Patterns target import/require statements only.
const NETWORK_IMPORT_PATTERNS: RegExp[] = [
  // import ... from 'node:net' / 'net' / 'node:http' / 'http' / etc.
  /\bimport\s+(?:[^'"]+\s+from\s+)?['"](?:node:)?(?:net|http|https|dgram|tls|undici|fetch)['"]/,
  // require('node:net') / require('net') / etc.
  /\brequire\s*\(\s*['"](?:node:)?(?:net|http|https|dgram|tls|undici|fetch)['"]\s*\)/,
  // dynamic import('node:net') / import('net') / etc.
  /\bimport\s*\(\s*['"](?:node:)?(?:net|http|https|dgram|tls|undici|fetch)['"]\s*\)/,
  // global fetch( call (undici-based web fetch)
  /\bfetch\s*\(/,
];

// C-09: forbidden upward imports
// kernel MUST NOT import from cli or planes
// lib MUST NOT import from cli, kernel, or planes
// planes MAY import from kernel and lib (not cli)
const FORBIDDEN_IMPORTS: Record<string, RegExp[]> = {
  kernel: [/\bfrom\s+['"].*(?:\/cli\/|\/planes\/)/, /\bcli\//, /\bplanes\//],
  lib: [/\bfrom\s+['"].*(?:\/cli\/|\/kernel\/|\/planes\/)/, /\bcli\//, /\bkernel\//, /\bplanes\//],
};

let failures = 0;
const fail = (msg: string): void => {
  console.error(`CI GUARD FAIL: ${msg}`);
  failures++;
};

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith('.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function checkNetworkAndImports(filePath: string): void {
  const rel = relative(SRC, filePath);
  const content = readFileSync(filePath, 'utf8');
  const tier = rel.split(/[\\/]/)[0];
  if (!tier) return;

  // C-02: no network facilities imported in kernel/lib
  if (tier === 'kernel' || tier === 'lib') {
    for (const pattern of NETWORK_IMPORT_PATTERNS) {
      if (pattern.test(content)) {
        fail(`C-02 violation: network facility import matched by ${String(pattern)} in ${rel}`);
      }
    }
  }

  // C-09: dependency direction
  const forbidden = FORBIDDEN_IMPORTS[tier];
  if (forbidden) {
    for (const pattern of forbidden) {
      if (pattern.test(content)) {
        fail(`C-09 violation: forbidden upward import in ${rel} (pattern ${String(pattern)})`);
      }
    }
  }
}

// C-04 / NFR-10: traceability record in every module
const TRACEABILITY_HEADER = /@forge-trace\s+(?<json>\{[^}]*\})/s;
interface TraceRecord {
  component_id: string;
  problems: string[];
  heritage: string[];
  decisions: string[];
  bp_ids: string[];
  ac_ids: string[];
}

function checkTraceability(filePath: string): void {
  const rel = relative(SRC, filePath);
  // CLI entrypoint index.ts is exempt (it's a composition root, not a governed module)
  if (rel === 'cli/index.ts') return;

  const content = readFileSync(filePath, 'utf8');
  const match = TRACEABILITY_HEADER.exec(content);
  if (!match || !match.groups || !match.groups.json) {
    fail(`C-04/NFR-10 violation: no @forge-trace record in ${rel}`);
    return;
  }
  let rec: TraceRecord;
  try {
    rec = JSON.parse(match.groups.json) as TraceRecord;
  } catch {
    fail(`C-04 violation: malformed @forge-trace JSON in ${rel}`);
    return;
  }
  const required: (keyof TraceRecord)[] = [
    'component_id',
    'problems',
    'heritage',
    'decisions',
    'bp_ids',
    'ac_ids',
  ];
  for (const key of required) {
    if (!(key in rec)) {
      fail(`C-04 violation: missing '${key}' in trace record of ${rel}`);
    }
  }
}

// C-03: no planes implementation before phase gate
function checkPlanesGate(): void {
  const planesDir = join(SRC, 'planes');
  if (!existsSync(planesDir)) return;
  const files = walk(planesDir);
  // P1 gate: only .gitkeep or empty marker files allowed; no .ts implementation
  const tsFiles = files.filter((f) => f.endsWith('.ts'));
  for (const f of tsFiles) {
    fail(`C-03 violation: implementation source ${relative(SRC, f)} in src/planes before its phase gate`);
  }
}

function main(): void {
  if (!existsSync(SRC)) {
    fail('src/ directory missing');
    process.exit(failures > 0 ? 1 : 0);
  }
  const allTs = walk(SRC);
  for (const f of allTs) {
    checkNetworkAndImports(f);
    checkTraceability(f);
  }
  checkPlanesGate();

  if (failures > 0) {
    console.error(`\n${failures} CI guard failure(s).`);
    process.exit(1);
  }
  console.log(`CI guards passed (${allTs.length} module(s) checked).`);
}

main();
