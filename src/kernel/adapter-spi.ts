/**
 * K-3 Adapter SPI (BP-1) — the five-verb provider boundary (IF-01, IF-05).
 *
 * IF-01: The Adapter SPI SHALL expose exactly five verbs:
 *   launch(command, env), send(ctx-pack), events(stream),
 *   interrupts(pause|resume|cancel), artifacts(location).
 *   Provider extensions are declared capabilities only and never required
 *   internal types.
 *
 * IF-05: Every external provider binding SHALL publish an Enforcement Map
 *   declaring in-band, out-of-band-compensated, and advisory enforcement, and
 *   each in-band/out-of-band claim SHALL be provocation-tested.
 *
 * INV-7 (no side channels): adapters may not reach the kernel or lib through
 *   any channel other than the declared verbs and the enforcement map.
 *
 * P2 scope: the SPI surface, the conformance assertion, and the enforcement
 * map validator. A concrete provider adapter (BP-2…BP-11) is P2+ and lives
 * outside the kernel; this module defines the contract that those adapters
 * must satisfy.
 *
 * @forge-trace {"component_id":"kernel-adapter-spi","problems":["P02"],"heritage":["K03","INV-7"],"decisions":["DEC-01","DEC-32","DEC-33"],"bp_ids":["BP-1"],"ac_ids":["AC-BP1"]}
 */

/** The five verbs an adapter MUST expose (IF-01). Exactly five — no more. */
export const ADAPTER_VERBS = ['launch', 'send', 'events', 'interrupts', 'artifacts'] as const;
export type AdapterVerb = (typeof ADAPTER_VERBS)[number];

/** The three enforcement tiers an in-band/out-of-band claim may take (IF-05). */
export const ENFORCEMENT_TIERS = ['inBand', 'outOfBandCompensated', 'advisory'] as const;
export type EnforcementTier = (typeof ENFORCEMENT_TIERS)[number];

/** A single Enforcement Map entry (IF-05). Strict: no unknown fields. */
export interface EnforcementMapEntry {
  /** The control surface this entry governs (e.g. "tool.gate"). Non-empty. */
  control: string;
  /** Whether the adapter enforces this control in-band (inside the verb). */
  inBand: boolean;
  /**
   * Whether the adapter compensates for this control out-of-band (e.g. via
   * a harness-level guard). An in-band claim MUST declare its out-of-band
   * posture — the field is required, the value may be true or false.
   */
  outOfBandCompensated: boolean;
  /** Whether this control is advisory only (no enforcement claim). */
  advisory: boolean;
}

/**
 * The Enforcement Map: the adapter's declared enforcement posture for each
 * control surface it touches (IF-05).
 */
export type EnforcementMap = EnforcementMapEntry[];

/** The interrupt kinds accepted by the `interrupts` verb (IF-01). */
export const INTERRUPT_KINDS = ['pause', 'resume', 'cancel'] as const;
export type InterruptKind = (typeof INTERRUPT_KINDS)[number];

/** Result of the `launch` verb — an opaque instance handle. */
export interface LaunchResult {
  instanceId: string;
}

/** Result of the `send` / `interrupts` verbs. */
export interface AckResult {
  ok: boolean;
}

/** The Adapter SPI contract (IF-01). An adapter MUST implement exactly this. */
export interface AdapterSpi {
  /** Launch a governed instance. */
  launch(command: { command: string; env: Record<string, string> }): LaunchResult;
  /** Send a context pack to the running instance. */
  send(ctxPack: unknown): AckResult;
  /** Read the event stream for the instance. */
  events(stream: unknown): unknown[];
  /** Interrupt the instance (pause | resume | cancel). */
  interrupts(kind: InterruptKind): AckResult;
  /** Read artifacts produced by the instance. */
  artifacts(location: unknown): unknown[];
  /** The adapter's declared enforcement posture (IF-05). */
  enforcementMap: EnforcementMap;
  /** The capabilities this adapter declares (IF-01). Must match map controls. */
  declaredCapabilities: string[];
}

/** The set of fields permitted on an Enforcement Map entry (strict check). */
const ENFORCEMENT_ENTRY_FIELDS = new Set<keyof EnforcementMapEntry>([
  'control',
  'inBand',
  'outOfBandCompensated',
  'advisory',
]);

/** Result of a validation pass. */
export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Validate an Enforcement Map (IF-05). Rejects:
 *  - entries missing any of the four required fields,
 *  - entries with an empty `control`,
 *  - entries carrying unknown extra fields (strict schema).
 *
 * Note: `inBand`/`outOfBandCompensated`/`advisory` are required booleans; the
 * value `false` is a valid declared posture (e.g. inBand=true,
 * outOfBandCompensated=false means "in-band only, no out-of-band
 * compensation"). The field's presence is what is enforced, not a particular
 * value — except that `control` must be non-empty.
 */
export function validateEnforcementMap(map: unknown): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(map)) {
    return { ok: false, errors: ['enforcementMap must be an array'] };
  }
  for (let i = 0; i < map.length; i++) {
    const entry = map[i] as Record<string, unknown> | null;
    if (entry === null || typeof entry !== 'object') {
      errors.push(`enforcementMap[${i}]: not an object`);
      continue;
    }
    // Strict: reject unknown extra fields (no side channels, INV-7).
    for (const key of Object.keys(entry)) {
      if (!ENFORCEMENT_ENTRY_FIELDS.has(key as keyof EnforcementMapEntry)) {
        errors.push(`enforcementMap[${i}]: unknown field '${key}'`);
      }
    }
    // control: required, non-empty string.
    if (!('control' in entry) || typeof entry.control !== 'string' || entry.control === '') {
      errors.push(`enforcementMap[${i}]: missing or empty 'control'`);
    }
    // inBand: required boolean.
    if (!('inBand' in entry) || typeof entry.inBand !== 'boolean') {
      errors.push(`enforcementMap[${i}]: missing or non-boolean 'inBand'`);
    }
    // outOfBandCompensated: required boolean (value may be false — presence is enforced).
    if (!('outOfBandCompensated' in entry) || typeof entry.outOfBandCompensated !== 'boolean') {
      errors.push(`enforcementMap[${i}]: missing or non-boolean 'outOfBandCompensated'`);
    }
    // advisory: required boolean.
    if (!('advisory' in entry) || typeof entry.advisory !== 'boolean') {
      errors.push(`enforcementMap[${i}]: missing or non-boolean 'advisory'`);
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * Assert that an implementation conforms to the Adapter SPI (IF-01, AC-BP1).
 * Rejects:
 *  - any extra verb beyond the five (no side channels, INV-7),
 *  - a missing verb,
 *  - a verb that is present but not a function,
 *  - a declared capability that has no matching enforcement-map control
 *    (a "required internal type" — IF-01 forbids these),
 *  - an invalid enforcement map (delegates to validateEnforcementMap).
 */
export function assertAdapterConformance(impl: unknown): ValidationResult {
  const errors: string[] = [];
  if (impl === null || typeof impl !== 'object') {
    return { ok: false, errors: ['adapter impl must be an object'] };
  }
  const obj = impl as Record<string, unknown>;

  // 1. Exactly the five verbs, each a function (IF-01).
  const verbSet = new Set<string>(ADAPTER_VERBS as readonly string[]);
  for (const key of Object.keys(obj)) {
    if (verbSet.has(key)) continue;
    // An unknown key that is not part of the SPI surface is an extra verb
    // only if it looks like a verb (a function). Non-function extra fields
    // (enforcementMap, declaredCapabilities) are checked separately.
    if (typeof obj[key] === 'function') {
      errors.push(`extra verb '${key}' — adapters expose exactly five verbs`);
    }
  }
  for (const verb of ADAPTER_VERBS) {
    if (!(verb in obj)) {
      errors.push(`missing verb '${verb}'`);
    } else if (typeof obj[verb] !== 'function') {
      errors.push(`verb '${verb}' is not a function`);
    }
  }

  // 2. enforcementMap must be present and valid (IF-05).
  if (!('enforcementMap' in obj)) {
    errors.push("missing 'enforcementMap'");
  } else {
    const mapRes = validateEnforcementMap(obj.enforcementMap);
    if (!mapRes.ok) {
      errors.push(...mapRes.errors);
    }
  }

  // 3. declaredCapabilities must be present and an array of strings.
  if (!('declaredCapabilities' in obj)) {
    errors.push("missing 'declaredCapabilities'");
  } else if (!Array.isArray(obj.declaredCapabilities)) {
    errors.push("'declaredCapabilities' must be an array");
  } else {
    const caps = obj.declaredCapabilities as unknown[];
    for (let i = 0; i < caps.length; i++) {
      if (typeof caps[i] !== 'string') {
        errors.push(`declaredCapabilities[${i}]: not a string`);
      }
    }
  }

  // 4. Every declared capability MUST have a matching enforcement-map control
  //    (IF-01: provider extensions are declared capabilities only and never
  //    required internal types). A capability with no map entry is a forbidden
  //    internal type leaking through the boundary.
  if (Array.isArray(obj.declaredCapabilities) && Array.isArray(obj.enforcementMap)) {
    const controls = new Set<string>(
      (obj.enforcementMap as EnforcementMapEntry[])
        .map((e) =>
          e && typeof e === 'object' && 'control' in e
            ? String((e as { control: unknown }).control)
            : '',
        )
        .filter((c) => c !== ''),
    );
    for (const cap of obj.declaredCapabilities as string[]) {
      if (typeof cap !== 'string') continue;
      if (!controls.has(cap)) {
        errors.push(
          `declared capability '${cap}' has no matching enforcement-map control — required internal types are forbidden (IF-01)`,
        );
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
