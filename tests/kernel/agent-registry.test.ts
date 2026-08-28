/**
 * K-5 Agent Registry tests — FR-K5-1 (structure), with provocation tests (C-07).
 *
 * @forge-trace {"component_id":"test-agent-registry","problems":["P09","P90"],"heritage":["K05","INV-2","INV-6"],"decisions":["DEC-02","DEC-03"],"bp_ids":[],"ac_ids":[]}
 */
import { describe, it, expect } from 'vitest';
import { AgentRegistry, AUTHORITY_CLASSES, CAPABILITY_LEVELS } from '../../src/kernel/agent-registry.js';
import type { AgentIdentity } from '../../src/kernel/agent-registry.js';

function makeIdentity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    identityId: 'agent-1',
    privateMemoryNs: 'agent-1/private',
    privateSkills: [],
    experienceLedger: [],
    capabilityMatrix: [{ domain: 'typescript', level: 'L3', certifiedBy: ['owner'], expires: '2027-01-01' }],
    knownLimitations: ['cannot access network'],
    authorityClass: 'EXECUTOR',
    evolutionBoundary: { mayLearnIn: ['project'], mayTouchShared: false, maySpawnAgents: false },
    confidenceModel: { default: 0.5 },
    ...over,
  };
}

describe('FR-K5-1: AgentIdentity structure', () => {
  it('exposes the four authority classes', () => {
    expect(AUTHORITY_CLASSES).toEqual(['OBSERVER', 'EXECUTOR', 'COMMITTER', 'APPROVER']);
  });
  it('exposes capability levels L0–L4', () => {
    expect(CAPABILITY_LEVELS).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
  });

  it('registers a valid AgentIdentity', () => {
    const r = new AgentRegistry();
    const res = r.register(makeIdentity());
    expect(res.ok).toBe(true);
    expect(r.get('agent-1')).not.toBeNull();
  });

  it('lists registered identities', () => {
    const r = new AgentRegistry();
    r.register(makeIdentity({ identityId: 'a1' }));
    r.register(makeIdentity({ identityId: 'a2' }));
    expect(r.list().length).toBe(2);
  });

  it('PROVOCATION: rejects an invalid authority class', () => {
    const r = new AgentRegistry();
    const res = r.register(makeIdentity({ authorityClass: 'SUPERUSER' as never }));
    expect(res.ok).toBe(false);
  });

  it('PROVOCATION: rejects an invalid capability level', () => {
    const r = new AgentRegistry();
    const res = r.register(
      makeIdentity({ capabilityMatrix: [{ domain: 'x', level: 'L9' as never, certifiedBy: [] }] }),
    );
    expect(res.ok).toBe(false);
  });

  it('PROVOCATION: rejects unknown keys (strict schema)', () => {
    const r = new AgentRegistry();
    const res = r.register({ ...makeIdentity(), backdoor: 'evil' });
    expect(res.ok).toBe(false);
  });

  it('PROVOCATION: rejects duplicate identity registration', () => {
    const r = new AgentRegistry();
    r.register(makeIdentity({ identityId: 'dup' }));
    const res = r.register(makeIdentity({ identityId: 'dup' }));
    expect(res.ok).toBe(false);
  });

  it('known_limitations are stored (INV-6: surfaced before capability claims)', () => {
    const r = new AgentRegistry();
    r.register(makeIdentity({ identityId: 'lim', knownLimitations: ['no network', 'no shell'] }));
    const id = r.get('lim')!;
    expect(id.knownLimitations).toEqual(['no network', 'no shell']);
  });
});
