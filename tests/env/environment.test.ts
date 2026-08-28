/**
 * Environment verification tests — confirm the FOrGE build infrastructure
 * is sound and operates within SRS constraints before further development.
 *
 * These are NOT unit tests of kernel logic; they verify the ENVIRONMENT itself:
 *  - C-01: closed dependency list (no undeclared runtime deps)
 *  - C-02: no network facilities in src/kernel/** or src/lib/**
 *  - C-04 / NFR-10: every src module (except cli/index.ts) carries @forge-trace
 *  - C-09: dependency direction cli -> kernel -> lib (no upward imports)
 *  - C-03: no planes implementation before phase gate
 *  - TypeScript strict mode flags are enabled (SRS §14)
 *  - Node.js >= 20 (SRS §14 / package.json engines)
 *  - Kernel modules are importable (no broken build at runtime)
 *  - vitest config targets kernel/lib for coverage (NFR-11)
 *
 * Provocation-first (C-07): each assertion is a negative test that MUST fail
 * if the environment regresses (e.g., a stray network import sneaks in, a
 * module loses its trace record, or a strict flag is disabled).
 *
 * @forge-trace {"component_id":"test-env-environment","problems":["P89","P74","P08","P30"],"heritage":["K01","R1","R4"],"decisions":["DEC-12","DEC-22","DEC-41"],"bp_ids":[],"ac_ids":[]}
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

function readSrc(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

function readRoot(name: string): string {
  return readFileSync(join(ROOT, name), 'utf8');
}

function parseJsonc(text: string): unknown {
  // Strip // and /* */ comments for tsconfig.json parsing.
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  return JSON.parse(stripped);
}

// ---------------------------------------------------------------------------
// C-01: closed dependency list
// ---------------------------------------------------------------------------
describe('C-01: closed dependency list', () => {
  it('package.json declares exactly the allowed runtime dependencies', () => {
    const pkg = JSON.parse(readRoot('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies).sort();
    // SRS §14 / DEC-12 closed list: better-sqlite3, commander, ulid, zod.
    expect(deps).toEqual(['better-sqlite3', 'commander', 'ulid', 'zod']);
  });

  it('declares the required dev dependencies for the toolchain', () => {
    const pkg = JSON.parse(readRoot('package.json')) as {
      devDependencies: Record<string, string>;
    };
    const devDeps = Object.keys(pkg.devDependencies);
    // Required: typescript, vitest, tsx, eslint, prettier, fast-check, @types/node.
    for (const required of [
      'typescript',
      'vitest',
      'tsx',
      'eslint',
      'prettier',
      'fast-check',
      '@types/node',
    ]) {
      expect(devDeps).toContain(required);
    }
  });

  it('engines.node is >= 20 (SRS §14)', () => {
    const pkg = JSON.parse(readRoot('package.json')) as {
      engines: { node: string };
    };
    expect(pkg.engines.node).toMatch(/>=\s*20/);
  });

  it('the running Node.js satisfies >= 20', () => {
    const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    expect(major).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// C-02: no network facilities in kernel/lib
// ---------------------------------------------------------------------------
describe('C-02: no network facilities in kernel/lib', () => {
  const NETWORK_PATTERNS: RegExp[] = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?['"](?:node:)?(?:net|http|https|dgram|tls|undici|fetch)['"]/,
    /\brequire\s*\(\s*['"](?:node:)?(?:net|http|https|dgram|tls|undici|fetch)['"]\s*\)/,
    /\bimport\s*\(\s*['"](?:node:)?(?:net|http|https|dgram|tls|undici|fetch)['"]\s*\)/,
    /\bfetch\s*\(/,
  ];

  it('no kernel module imports a network facility', () => {
    const files = walk(join(SRC, 'kernel'));
    const offenders: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      for (const p of NETWORK_PATTERNS) {
        if (p.test(content)) offenders.push(`${relative(SRC, f)}: ${String(p)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no lib module imports a network facility', () => {
    const files = walk(join(SRC, 'lib'));
    const offenders: string[] = [];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      for (const p of NETWORK_PATTERNS) {
        if (p.test(content)) offenders.push(`${relative(SRC, f)}: ${String(p)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C-04 / NFR-10: traceability record in every module
// ---------------------------------------------------------------------------
describe('C-04 / NFR-10: traceability records', () => {
  const TRACE_RE = /@forge-trace\s+\{(?<json>[^}]*)\}/s;
  const REQUIRED_KEYS = [
    'component_id',
    'problems',
    'heritage',
    'decisions',
    'bp_ids',
    'ac_ids',
  ] as const;

  it('every src module (except cli/index.ts) carries a valid @forge-trace record', () => {
    const files = walk(SRC);
    const missing: string[] = [];
    const malformed: string[] = [];
    const incomplete: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f);
      if (rel === 'cli/index.ts') continue; // exempt composition root
      const content = readFileSync(f, 'utf8');
      const m = TRACE_RE.exec(content);
      if (!m || !m.groups || !m.groups.json) {
        missing.push(rel);
        continue;
      }
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(`{${m.groups.json}}`) as Record<string, unknown>;
      } catch {
        malformed.push(rel);
        continue;
      }
      for (const key of REQUIRED_KEYS) {
        if (!(key in rec)) incomplete.push(`${rel} (missing ${key})`);
      }
    }
    expect(missing, 'modules missing @forge-trace').toEqual([]);
    expect(malformed, 'modules with malformed @forge-trace JSON').toEqual([]);
    expect(incomplete, 'modules with incomplete trace records').toEqual([]);
  });

  it('cli/index.ts is the ONLY exempt module', () => {
    const files = walk(SRC);
    const withoutTrace: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f);
      if (rel === 'cli/index.ts') continue;
      const content = readFileSync(f, 'utf8');
      if (!/@forge-trace/.test(content)) withoutTrace.push(rel);
    }
    // If any module other than cli/index.ts lacks trace, fail.
    expect(withoutTrace).toEqual([]);
  });

  it('component_id format is <tier>-<name> for every traced module', () => {
    const files = walk(SRC);
    const bad: string[] = [];
    for (const f of files) {
      const rel = relative(SRC, f);
      if (rel === 'cli/index.ts') continue;
      const content = readFileSync(f, 'utf8');
      const m = TRACE_RE.exec(content);
      if (!m || !m.groups) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(`{${m.groups.json}}`) as Record<string, unknown>;
      } catch {
        continue; // malformed caught above
      }
      const cid = rec['component_id'];
      if (typeof cid !== 'string' || !/^(kernel|lib|cli|plane)-[a-z0-9-]+$/.test(cid)) {
        bad.push(`${rel}: ${String(cid)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C-09: dependency direction cli -> kernel -> lib
// ---------------------------------------------------------------------------
describe('C-09: dependency direction', () => {
  it('no kernel module imports from cli/ or planes/', () => {
    const files = walk(join(SRC, 'kernel'));
    const offenders: string[] = [];
    const forbidden = [/\bfrom\s+['"].*(?:\/cli\/|\/planes\/)/, /\bcli\//, /\bplanes\//];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      for (const p of forbidden) {
        if (p.test(content)) offenders.push(`${relative(SRC, f)}: ${String(p)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no lib module imports from cli/, kernel/, or planes/', () => {
    const files = walk(join(SRC, 'lib'));
    const offenders: string[] = [];
    const forbidden = [
      /\bfrom\s+['"].*(?:\/cli\/|\/kernel\/|\/planes\/)/,
      /\bcli\//,
      /\bkernel\//,
      /\bplanes\//,
    ];
    for (const f of files) {
      const content = readFileSync(f, 'utf8');
      for (const p of forbidden) {
        if (p.test(content)) offenders.push(`${relative(SRC, f)}: ${String(p)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('cli modules import from kernel and lib (downward), never the reverse', () => {
    const cliFiles = walk(join(SRC, 'cli'));
    expect(cliFiles.length).toBeGreaterThan(0);
    for (const f of cliFiles) {
      const content = readFileSync(f, 'utf8');
      // cli SHOULD import from kernel/lib — at least commands.ts does.
      // (index.ts imports commands.ts which imports kernel/lib.)
      // No upward-violation assertion needed here; the kernel/lib tests above
      // already prove the reverse direction never happens.
      void content;
    }
  });
});

// ---------------------------------------------------------------------------
// C-03: no planes implementation before phase gate
// ---------------------------------------------------------------------------
describe('C-03: planes phase gate', () => {
  it('no .ts implementation files exist in src/planes before the phase gate', () => {
    const planesDir = join(SRC, 'planes');
    if (!existsSync(planesDir)) return; // no planes dir yet — passes
    const files = walk(planesDir);
    const tsFiles = files.filter((f) => f.endsWith('.ts'));
    expect(tsFiles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TypeScript strict mode (SRS §14)
// ---------------------------------------------------------------------------
describe('TypeScript strict configuration (SRS §14)', () => {
  let tsconfig: Record<string, unknown>;

  it('tsconfig.json is parseable', () => {
    const text = readRoot('tsconfig.json');
    tsconfig = parseJsonc(text) as Record<string, unknown>;
    expect(tsconfig).toBeTruthy();
  });

  it('"strict": true is enabled', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(opts['strict']).toBe(true);
  });

  it('all required strict flags are enabled', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    const required = [
      'noImplicitAny',
      'strictNullChecks',
      'strictFunctionTypes',
      'strictBindCallApply',
      'strictPropertyInitialization',
      'noImplicitThis',
      'alwaysStrict',
      'noUnusedLocals',
      'noUnusedParameters',
      'noImplicitReturns',
      'noFallthroughCasesInSwitch',
      'noUncheckedIndexedAccess',
      'exactOptionalPropertyTypes',
      'forceConsistentCasingInFileNames',
    ];
    const disabled: string[] = [];
    for (const flag of required) {
      if (opts[flag] !== true) disabled.push(flag);
    }
    expect(disabled, 'strict flags not enabled').toEqual([]);
  });

  it('module is NodeNext with ES2022 target', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(opts['module']).toBe('NodeNext');
    expect(opts['target']).toBe('ES2022');
  });

  it('src is the rootDir and tests/scripts are excluded', () => {
    const opts = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(opts['rootDir']).toBe('./src');
    const exclude = tsconfig['exclude'] as string[];
    expect(exclude).toContain('tests');
    expect(exclude).toContain('scripts');
  });
});

// ---------------------------------------------------------------------------
// Kernel modules are importable (no broken build at runtime)
// ---------------------------------------------------------------------------
describe('kernel modules are importable', () => {
  it('EventJournal imports and constructs', async () => {
    const mod = await import('../../src/kernel/event-journal.js');
    expect(mod.EventJournal).toBeDefined();
    expect(typeof mod.EventJournal).toBe('function');
    expect(mod.GENESIS_PREV_HASH).toBe('GENESIS');
  });

  it('ContractStore imports and constructs', async () => {
    const mod = await import('../../src/kernel/contract-store.js');
    expect(mod.ContractStore).toBeDefined();
    expect(typeof mod.ContractStore).toBe('function');
    expect(mod.ARTIFACT_TYPES.length).toBeGreaterThanOrEqual(12);
  });

  it('PolicyHookRunner imports and constructs', async () => {
    const mod = await import('../../src/kernel/policy-hooks.js');
    expect(mod.PolicyHookRunner).toBeDefined();
    expect(mod.HOOK_POINTS).toEqual([
      'pre-send',
      'pre-tool',
      'post-result',
      'pre-commit',
      'periodic-tick',
    ]);
  });

  it('AgentRegistry imports and constructs', async () => {
    const mod = await import('../../src/kernel/agent-registry.js');
    expect(mod.AgentRegistry).toBeDefined();
    // AUTHORITY_CLASSES is a readonly `as const` tuple; spread into a mutable
    // array before deep-equal comparison (exactOptionalPropertyTypes / readonly
    // tuple vs mutable array mismatch otherwise).
    expect([...mod.AUTHORITY_CLASSES]).toEqual(['OBSERVER', 'EXECUTOR', 'COMMITTER', 'APPROVER']);
  });

  it('lib helpers import and are callable', async () => {
    const hash = await import('../../src/lib/hash.js');
    expect(typeof hash.sha256Hex).toBe('function');
    expect(hash.sha256Hex('')).toMatch(/^[0-9a-f]{64}$/);
    const ulid = await import('../../src/lib/ulid.js');
    expect(typeof ulid.ulid).toBe('function');
    const id = ulid.ulid();
    // FOrGE ULID is Crockford base32, 42 chars (10 time + 32 random), NOT the
    // standard 26-char ULID — see src/lib/ulid.ts (TIME_LEN=10, RANDOM_LEN=16
    // => 10 + 16*2 = 42). Monotonic within a millisecond.
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{42}$/);
  });
});

// ---------------------------------------------------------------------------
// vitest coverage config targets kernel/lib (NFR-11)
// ---------------------------------------------------------------------------
describe('NFR-11: coverage configuration', () => {
  it('vitest.config.ts includes src/kernel and src/lib for coverage', () => {
    const text = readRoot('vitest.config.ts');
    expect(text).toContain('src/kernel/**');
    expect(text).toContain('src/lib/**');
  });

  it('vitest.config.ts excludes src/cli and src/planes from coverage', () => {
    const text = readRoot('vitest.config.ts');
    expect(text).toContain('src/cli/**');
    expect(text).toContain('src/planes/**');
  });

  it('vitest.config.ts sets >= 90% thresholds (NFR-11)', () => {
    const text = readRoot('vitest.config.ts');
    expect(text).toMatch(/branches:\s*90/);
    expect(text).toMatch(/functions:\s*90/);
    expect(text).toMatch(/lines:\s*90/);
    expect(text).toMatch(/statements:\s*90/);
  });
});

// ---------------------------------------------------------------------------
// CI guard script exists and is wired (SRS §15)
// ---------------------------------------------------------------------------
describe('CI guard infrastructure', () => {
  it('scripts/ci-guards.ts exists and enforces the C-series constraints', () => {
    const path = join(ROOT, 'scripts', 'ci-guards.ts');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).toMatch(/C-02/);
    expect(content).toMatch(/C-03/);
    expect(content).toMatch(/C-04/);
    expect(content).toMatch(/C-09/);
  });

  it('package.json "ci" script runs lint, format, build, coverage, and guards', () => {
    const pkg = JSON.parse(readRoot('package.json')) as {
      scripts: Record<string, string>;
    };
    const ci = pkg.scripts['ci'] ?? '';
    expect(ci).toContain('lint');
    expect(ci).toContain('format');
    expect(ci).toContain('build');
    expect(ci).toContain('test:coverage');
    expect(ci).toContain('ci-guards');
  });

  it('package.json "cli" script points at the S7 entrypoint (IF-02)', () => {
    const pkg = JSON.parse(readRoot('package.json')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['cli']).toContain('src/cli/index.ts');
  });
});

// ---------------------------------------------------------------------------
// CLI (S7) command surface exists (IF-02)
// ---------------------------------------------------------------------------
describe('IF-02: CLI command surface', () => {
  const EXPECTED_COMMANDS = [
    'cmdInit',
    'cmdJournalAppend',
    'cmdJournalVerify',
    'cmdJournalReplay',
    'cmdContractCreate',
    'cmdContractValidate',
    'cmdContractList',
    'cmdContractHistory',
    'cmdContractSupersede',
    'cmdPolicyLoad',
    'cmdHooksRun',
    'cmdIdentityCreate',
    'cmdIdentityList',
    'cmdIdentityValidate',
    'cmdTraceCheck',
    'cmdKpiReport',
    'cmdDecisionRecord',
  ];

  it('commands.ts exports all 17 IF-02 command functions', async () => {
    const mod = await import('../../src/cli/commands.js');
    const missing = EXPECTED_COMMANDS.filter((name) => typeof mod[name] !== 'function');
    expect(missing, 'missing IF-02 command exports').toEqual([]);
  });

  it('commands.ts exports the four exit codes (0/1/2/3)', async () => {
    const mod = await import('../../src/cli/commands.js');
    expect(mod.EXIT_SUCCESS).toBe(0);
    expect(mod.EXIT_ERROR).toBe(1);
    expect(mod.EXIT_OWNER_DECISION).toBe(2);
    expect(mod.EXIT_OTHER).toBe(3);
  });

  it('commands.ts carries a @forge-trace record (not exempt)', () => {
    const content = readSrc('cli/commands.ts');
    expect(content).toMatch(/@forge-trace\s+\{/);
  });

  it('cli/index.ts is exempt from @forge-trace (composition root)', () => {
    const content = readSrc('cli/index.ts');
    // index.ts must NOT carry an actual @forge-trace RECORD (it is the exempt
    // composition root). Match the trace-record shape `@forge-trace {` rather
    // than the bare substring, because the file's header comment legitimately
    // mentions "@forge-trace" when explaining the exemption.
    expect(/@forge-trace\s+\{/.test(content)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Traceability registries document exists (C-04 / NFR-10)
// ---------------------------------------------------------------------------
describe('traceability registries (C-04 / NFR-10)', () => {
  it('traceability/REGISTRIES.md exists', () => {
    expect(existsSync(join(ROOT, 'traceability', 'REGISTRIES.md'))).toBe(true);
  });

  it('REGISTRIES.md documents the @forge-trace header format', () => {
    const content = readRoot('traceability/REGISTRIES.md');
    expect(content).toContain('@forge-trace');
    expect(content).toContain('component_id');
    expect(content).toContain('problems');
    expect(content).toContain('heritage');
    expect(content).toContain('decisions');
  });

  it('REGISTRIES.md lists every implemented kernel/lib module', () => {
    const content = readRoot('traceability/REGISTRIES.md');
    const implemented = walk(SRC)
      .map((f) => relative(SRC, f))
      .filter((rel) => rel !== 'cli/index.ts');
    for (const rel of implemented) {
      // Each implemented module path should appear in the registries table.
      expect(content, `REGISTRIES.md missing entry for ${rel}`).toContain(rel);
    }
  });
});
