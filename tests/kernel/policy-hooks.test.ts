/**
 * K-4 Policy Hook Points tests — FR-K4-1…5, with provocation tests (C-07).
 *
 * T-SHADOW-1 (FR-K4-3): provocation test proving shadow mode cannot block.
 *
 * @forge-trace {"component_id":"test-policy-hooks","problems":["P10","P09","P83","P92","P13","P30"],"heritage":["E02"],"decisions":["DEC-01","DEC-30","DEC-35"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyHookRunner, HOOK_POINTS } from '../../src/kernel/policy-hooks.js';
import { EventJournal } from '../../src/kernel/event-journal.js';
import { MemoryJournalStorage } from '../../src/kernel/storage-memory.js';
import type { PolicyRule } from '../../src/kernel/policy-hooks.js';

function makeRunner(): { runner: PolicyHookRunner; journal: EventJournal } {
  const journal = new EventJournal({ storage: new MemoryJournalStorage() });
  const runner = new PolicyHookRunner(journal);
  return { runner, journal };
}

describe('FR-K4-1: exactly five hook points', () => {
  it('exposes exactly the five hook points', () => {
    expect(HOOK_POINTS).toEqual([
      'pre-send',
      'pre-tool',
      'post-result',
      'pre-commit',
      'periodic-tick',
    ]);
    expect(HOOK_POINTS.length).toBe(5);
  });

  it('journals each evaluation outcome as hook.evaluated', () => {
    const { runner, journal } = makeRunner();
    runner.evaluate({
      hookPoint: 'pre-tool',
      actionClass: 'file.write',
      payload: { path: '/x' },
      labels: [],
    });
    const events = journal.all().filter((e) => e.kind === 'hook.evaluated');
    expect(events.length).toBe(1);
    expect(events[0]!.payload.hookPoint).toBe('pre-tool');
  });
});

describe('FR-K4-2: K-4 contains no rule logic; rules load from data', () => {
  it('loads valid policy rules from Tier-A data', () => {
    const { runner } = makeRunner();
    const rules: PolicyRule[] = [
      {
        ruleId: 'r1',
        hookPoint: 'pre-tool',
        actionClass: 'file.write',
        effect: 'deny',
        failPosture: 'fail-closed',
        conditions: [{ path: '/etc/**' }],
      },
    ];
    const res = runner.loadRules(rules);
    expect(res.ok).toBe(true);
  });

  it('PROVOCATION: rejects malformed policy rules (strict schema)', () => {
    const { runner } = makeRunner();
    const res = runner.loadRules([
      { ruleId: 'r1', hookPoint: 'invalid-hook', actionClass: 'x', effect: 'deny', failPosture: 'fail-closed', conditions: [] },
    ]);
    expect(res.ok).toBe(false);
  });

  it('PROVOCATION: the runner has no embedded rule logic (no hardcoded deny)', () => {
    // The runner with NO loaded rules should produce wouldBeEffect='allow'.
    const { runner } = makeRunner();
    const out = runner.evaluate({
      hookPoint: 'pre-tool',
      actionClass: 'file.write',
      payload: {},
      labels: [],
    });
    expect(out.wouldBeEffect).toBe('allow');
    expect(out.matchedRules).toEqual([]);
  });
});

describe('FR-K4-3 / T-SHADOW-1: P1 hook runner hard-locked to shadow', () => {
  beforeEach(() => {
    // Ensure no test pollution.
  });

  it('the runner mode is always shadow in P1', () => {
    const { runner } = makeRunner();
    expect(runner.getMode()).toBe('shadow');
  });

  it('T-SHADOW-1 PROVOCATION: a deny rule in shadow mode does NOT block the caller', () => {
    const { runner } = makeRunner();
    runner.loadRules([
      {
        ruleId: 'block-etc',
        hookPoint: 'pre-tool',
        actionClass: 'file.write',
        effect: 'deny',
        failPosture: 'fail-closed',
        conditions: [{ path: '/etc/**' }],
      },
    ]);

    // The rule matches and would deny...
    const out = runner.evaluate({
      hookPoint: 'pre-tool',
      actionClass: 'file.write',
      payload: { path: '/etc/passwd' },
      labels: ['sensitive'],
    });
    expect(out.wouldBeEffect).toBe('deny');
    expect(out.matchedRules).toContain('block-etc');
    // ...but the decision delivered to the caller is 'allow' (shadow cannot block).
    expect(out.decision).toBe('allow');
    expect(out.enforced).toBe(false);
  });

  it('T-SHADOW-1 PROVOCATION: even with many deny rules, shadow never blocks', () => {
    const { runner } = makeRunner();
    runner.loadRules([
      { ruleId: 'd1', hookPoint: 'pre-send', actionClass: 'msg', effect: 'deny', failPosture: 'fail-closed', conditions: [] },
      { ruleId: 'd2', hookPoint: 'pre-tool', actionClass: 'msg', effect: 'deny', failPosture: 'fail-closed', conditions: [] },
      { ruleId: 'd3', hookPoint: 'pre-commit', actionClass: 'msg', effect: 'deny', failPosture: 'fail-closed', conditions: [] },
    ]);
    for (const hp of HOOK_POINTS) {
      const out = runner.evaluate({
        hookPoint: hp,
        actionClass: 'msg',
        payload: {},
        labels: [],
      });
      expect(out.decision).toBe('allow');
    }
  });

  it('no action class is enforced in P1 (enforcedClasses empty)', () => {
    const { runner } = makeRunner();
    expect(runner.isEnforced('file.write')).toBe(false);
    expect(runner.isEnforced('anything')).toBe(false);
  });

  it('shadow records the would-be outcome, matched rules, and labels as events', () => {
    const { runner, journal } = makeRunner();
    runner.loadRules([
      { ruleId: 'adv1', hookPoint: 'pre-send', actionClass: 'msg', effect: 'advise', failPosture: 'fail-open', conditions: [] },
    ]);
    runner.evaluate({
      hookPoint: 'pre-send',
      actionClass: 'msg',
      payload: { text: 'hi' },
      labels: ['external'],
    });
    const ev = journal.all().filter((e) => e.kind === 'hook.evaluated')[0]!;
    expect(ev.payload.wouldBeEffect).toBe('advise');
    expect(ev.payload.matchedRules).toEqual(['adv1']);
    expect(ev.payload.labels).toEqual(['external']);
    expect(ev.payload.mode).toBe('shadow');
    expect(ev.payload.decision).toBe('allow');
  });
});
