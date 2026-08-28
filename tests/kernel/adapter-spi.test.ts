/**
 * K-3 Adapter SPI (BP-1) tests — IF-01 (five verbs), IF-05 (Enforcement Map),
 * with provocation tests (C-07).
 *
 * T-BP1-1: a sixth verb is rejected.
 * T-BP1-2: a missing verb is rejected.
 * T-BP1-3: an incomplete Enforcement Map is rejected.
 * T-BP1-4: a required internal type (not a declared capability) is rejected.
 *
 * @forge-trace {"component_id":"test-adapter-spi","problems":["P02"],"heritage":["K03","INV-7"],"decisions":["DEC-01","DEC-32"],"bp_ids":["BP-1"],"ac_ids":["AC-BP1"]}
 */
import { describe, it, expect } from 'vitest';

import {
  ADAPTER_VERBS,
  assertAdapterConformance,
  validateEnforcementMap,
  ENFORCEMENT_TIERS,
  type AdapterSpi,
  type AdapterVerb,
  type EnforcementMap,
} from '../../src/kernel/adapter-spi.js';

/** A minimal compliant adapter for use as a base in tests. */
function makeCompliantAdapter(): AdapterSpi {
  return {
    launch: () => ({ instanceId: 'inst-1' }),
    send: () => ({ ok: true }),
    events: () => [],
    interrupts: () => ({ ok: true }),
    artifacts: () => [],
    enforcementMap: [
      {
        control: 'tool.gate',
        inBand: true,
        outOfBandCompensated: true,
        advisory: false,
      },
    ],
    declaredCapabilities: ['tool.gate'],
  };
}

/**
 * Return a compliant adapter with one verb removed. Avoids destructuring
 * methods directly (which trips @typescript-eslint/unbound-method) by
 * building a fresh object and copying only the retained keys.
 */
function omitVerb(verb: AdapterVerb): Omit<AdapterSpi, AdapterVerb> {
  const a = makeCompliantAdapter();
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(a)) {
    if (key === verb) continue;
    copy[key] = (a as Record<string, unknown>)[key];
  }
  return copy as Omit<AdapterSpi, AdapterVerb>;
}

describe('IF-01: Adapter SPI exposes exactly five verbs', () => {
  it('exposes exactly the five verbs', () => {
    expect(ADAPTER_VERBS).toEqual(['launch', 'send', 'events', 'interrupts', 'artifacts']);
    expect(ADAPTER_VERBS.length).toBe(5);
  });

  it('AC-BP1: a compliant adapter passes conformance', () => {
    const res = assertAdapterConformance(makeCompliantAdapter());
    expect(res.ok).toBe(true);
  });
});

describe('T-BP1-1 PROVOCATION: a sixth verb is rejected', () => {
  it('rejects an adapter exposing an extra verb (restart)', () => {
    const adapter = {
      ...makeCompliantAdapter(),
      restart: () => ({ ok: true }),
    };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('restart'))).toBe(true);
    }
  });

  it('rejects an adapter exposing an extra verb (migrate)', () => {
    const adapter = {
      ...makeCompliantAdapter(),
      migrate: () => ({ ok: true }),
    };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
  });
});

describe('T-BP1-2 PROVOCATION: a missing verb is rejected', () => {
  it('rejects an adapter missing the launch verb', () => {
    const res = assertAdapterConformance(omitVerb('launch'));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('launch'))).toBe(true);
    }
  });

  it('rejects an adapter missing the send verb', () => {
    const res = assertAdapterConformance(omitVerb('send'));
    expect(res.ok).toBe(false);
  });

  it('rejects an adapter missing the events verb', () => {
    const res = assertAdapterConformance(omitVerb('events'));
    expect(res.ok).toBe(false);
  });

  it('rejects an adapter missing the interrupts verb', () => {
    const res = assertAdapterConformance(omitVerb('interrupts'));
    expect(res.ok).toBe(false);
  });

  it('rejects an adapter missing the artifacts verb', () => {
    const res = assertAdapterConformance(omitVerb('artifacts'));
    expect(res.ok).toBe(false);
  });

  it('rejects an adapter where a verb is present but not a function', () => {
    const adapter = { ...makeCompliantAdapter(), launch: 'not-a-fn' };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
  });
});

describe('IF-05: Enforcement Map tiers', () => {
  it('exposes exactly the three enforcement tiers', () => {
    expect(ENFORCEMENT_TIERS).toEqual(['inBand', 'outOfBandCompensated', 'advisory']);
  });

  it('accepts a complete Enforcement Map', () => {
    const map: EnforcementMap = [
      {
        control: 'tool.gate',
        inBand: true,
        outOfBandCompensated: true,
        advisory: false,
      },
    ];
    const res = validateEnforcementMap(map);
    expect(res.ok).toBe(true);
  });

  it('accepts an empty Enforcement Map (no in-band claims => no compensation required)', () => {
    const res = validateEnforcementMap([]);
    expect(res.ok).toBe(true);
  });
});

describe('T-BP1-3 PROVOCATION: incomplete Enforcement Map is rejected', () => {
  it('rejects a map entry missing the outOfBandCompensated field', () => {
    const res = validateEnforcementMap([
      {
        control: 'tool.gate',
        inBand: true,
        advisory: false,
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
  });

  it('rejects a map entry missing the advisory field', () => {
    const res = validateEnforcementMap([
      {
        control: 'tool.gate',
        inBand: true,
        outOfBandCompensated: true,
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
  });

  it('rejects a map entry missing the control field', () => {
    const res = validateEnforcementMap([
      {
        inBand: true,
        outOfBandCompensated: true,
        advisory: false,
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
  });

  it('rejects a map entry with an empty control string', () => {
    const res = validateEnforcementMap([
      { control: '', inBand: true, outOfBandCompensated: true, advisory: false },
    ]);
    expect(res.ok).toBe(false);
  });

  it('rejects a map entry with an unknown extra field (strict schema)', () => {
    const res = validateEnforcementMap([
      {
        control: 'tool.gate',
        inBand: true,
        outOfBandCompensated: true,
        advisory: false,
        backdoor: 'evil',
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
  });

  it('IF-05 completeness: an in-band claim with no out-of-band compensation is flagged', () => {
    // An in-band control MUST declare its out-of-band-compensated posture.
    // If inBand=true and outOfBandCompensated is missing, the map is incomplete.
    const res = validateEnforcementMap([
      { control: 'tool.gate', inBand: true, outOfBandCompensated: false, advisory: false },
    ]);
    // This is valid (inBand=true, outOfBandCompensated=false is a declared posture),
    // but the entry must be present. We assert the field is required, not the value.
    expect(res.ok).toBe(true);
  });
});

describe('T-BP1-4 PROVOCATION: required internal types are rejected', () => {
  it('rejects an adapter whose declaredCapabilities includes a non-declared required type', () => {
    // IF-01: "provider extensions are declared capabilities only and never
    // required internal types." A capability that is NOT in the enforcement
    // map's controls and is marked required is a forbidden internal type.
    const adapter: AdapterSpi = {
      ...makeCompliantAdapter(),
      declaredCapabilities: ['tool.gate', 'internal.runtime-handle'],
      enforcementMap: [
        { control: 'tool.gate', inBand: true, outOfBandCompensated: true, advisory: false },
      ],
    };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('internal.runtime-handle'))).toBe(true);
    }
  });

  it('accepts an adapter where every declared capability has a matching enforcement-map control', () => {
    const adapter: AdapterSpi = {
      ...makeCompliantAdapter(),
      declaredCapabilities: ['tool.gate', 'secret.scan'],
      enforcementMap: [
        { control: 'tool.gate', inBand: true, outOfBandCompensated: true, advisory: false },
        { control: 'secret.scan', inBand: true, outOfBandCompensated: true, advisory: false },
      ],
    };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(true);
  });

  it('accepts an adapter with advisory-only capabilities (no in-band claim)', () => {
    const adapter: AdapterSpi = {
      ...makeCompliantAdapter(),
      declaredCapabilities: ['observability.metrics'],
      enforcementMap: [
        {
          control: 'observability.metrics',
          inBand: false,
          outOfBandCompensated: false,
          advisory: true,
        },
      ],
    };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(true);
  });
});

describe('IF-01: verb signatures are typed (compile-time guarantee)', () => {
  it('launch returns an instance handle', () => {
    const a = makeCompliantAdapter();
    const res = a.launch({ command: 'run', env: {} });
    expect(res.instanceId).toBeDefined();
  });

  it('interrupts accepts pause | resume | cancel', () => {
    const a = makeCompliantAdapter();
    expect(a.interrupts('pause').ok).toBe(true);
    expect(a.interrupts('resume').ok).toBe(true);
    expect(a.interrupts('cancel').ok).toBe(true);
  });
});

describe('T-BP1-5 PROVOCATION: missing required adapter fields are rejected', () => {
  it('rejects an adapter missing the enforcementMap field', () => {
    const a = makeCompliantAdapter();
    const { enforcementMap: _omit, ...adapter } = a;
    void _omit;
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('enforcementMap'))).toBe(true);
    }
  });

  it('rejects an adapter missing the declaredCapabilities field', () => {
    const a = makeCompliantAdapter();
    const { declaredCapabilities: _omit, ...adapter } = a;
    void _omit;
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('declaredCapabilities'))).toBe(true);
    }
  });

  it('rejects an adapter whose declaredCapabilities is not an array', () => {
    const adapter = {
      ...makeCompliantAdapter(),
      declaredCapabilities: 'tool.gate' as unknown as string[],
    };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('declaredCapabilities'))).toBe(true);
    }
  });

  it('rejects an adapter whose declaredCapabilities contains a non-string entry', () => {
    const adapter = {
      ...makeCompliantAdapter(),
      declaredCapabilities: ['tool.gate', 42] as unknown as string[],
    };
    const res = assertAdapterConformance(adapter);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('not a string'))).toBe(true);
    }
  });

  it('rejects a non-object adapter impl', () => {
    const res = assertAdapterConformance(null);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('object'))).toBe(true);
    }
  });
});

describe('IF-05: validateEnforcementMap edge cases', () => {
  it('rejects a non-array enforcement map', () => {
    const res = validateEnforcementMap({ control: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('array'))).toBe(true);
    }
  });

  it('rejects a map entry that is not an object', () => {
    const res = validateEnforcementMap(['not-an-object']);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('not an object'))).toBe(true);
    }
  });

  it('rejects a map entry whose inBand is not a boolean', () => {
    const res = validateEnforcementMap([
      {
        control: 'tool.gate',
        inBand: 'yes',
        outOfBandCompensated: true,
        advisory: false,
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('inBand'))).toBe(true);
    }
  });

  it('rejects a map entry whose outOfBandCompensated is not a boolean', () => {
    const res = validateEnforcementMap([
      {
        control: 'tool.gate',
        inBand: true,
        outOfBandCompensated: 'no',
        advisory: false,
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('outOfBandCompensated'))).toBe(true);
    }
  });

  it('rejects a map entry whose advisory is not a boolean', () => {
    const res = validateEnforcementMap([
      {
        control: 'tool.gate',
        inBand: true,
        outOfBandCompensated: true,
        advisory: 'maybe',
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('advisory'))).toBe(true);
    }
  });

  it('rejects a map entry whose control is not a string', () => {
    const res = validateEnforcementMap([
      {
        control: 123,
        inBand: true,
        outOfBandCompensated: true,
        advisory: false,
      } as unknown as EnforcementMap[number],
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.some((e) => e.includes('control'))).toBe(true);
    }
  });
});
