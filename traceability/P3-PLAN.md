# FOrGE P3 Plan — Claims / Knowledge Phase

**Standard:** FORGE-SRS-1.0 §4.1 (phased rollout P0–P9), §3.8 (FR-S4 Intelligence),
§3.11 (FR-ART), §3.12 (FR-LAUND), §5 (constraints), §6 (NFRs)
**Date:** 2026-08-28
**Status:** PLANNING — P2 gate is GREEN; this document defines the P3 work breakdown.

> "No phase starts while the previous gate is red." — FORGE-SRS-1.0 §4.1

P1 delivered the kernel foundation. P2 delivered the adapter boundary (K-3 = BP-1),
the continuity machinery (RunState event-sourcing, TaskContract enforcement), and the
K-5 agent lifecycle (SpawnContract, ContextGrant, Adoption Queue, routing). P3 builds
the **S4 intelligence plane** — the Claims/Knowledge layer that governs cross-layer
truth — plus the **Replayer** (K-1 fold across separated checkpoints), the **PKP
portability doctrine** (DEC-40), and the first three **T-LAUND** trust-laundering
provocations (Write/Persist/Retrieve, DEC-42.3).

P3 is the largest knowledge phase. Its gate (SRS §15 line 335) requires:

- **Zero-model-call staleness** — deterministic hash comparison at read time, no model
  in the loop (FR-S4-5).
- **Scope-bleed pass** — cross-scope privacy bleed blocked and tested (FR-S4-12).
- **Authority-resolved conflict** — explicit supersession, narrowest scope wins,
  newer-wins-without-supersession rejected (FR-S4-11).
- **Replayer live** — K-1 fold across separated checkpoints (FR-LAUND-3).
- **G7** — the staleness/laundering KPI derivable from K-1 replay (FR-GOV-5).
- **PKP export** — artifact package preserving provenance, no authority upgrade (IF-06,
  FR-ART-2).
- **T-LAUND-W/P/R** — Write, Persist, Retrieve provocation tests (FR-LAUND-1).

---

## 1. P3 Requirement Scope

Requirements tagged `[P3]` (or with a P3 enforcement milestone) in the SRS, plus
P1/P2-deferred items routed to P3.

### Interfaces (IF-series)

| ID    | Requirement (verbatim / condensed)                                                                                                          | Source line |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| IF-06 | PKP export/import SHALL follow the package layout and preserve provenance, hashes, evidence refs, versions, lifecycle states, scope limits. | 113         |

### Functional Requirements — S4 Intelligence, Claims & Evidence (FR-S4)

| ID       | Requirement (condensed)                                                                                                                                                                                                                                                                   | Source line                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| FR-S4-1  | Every cross-layer knowledge reference SHALL be a Claim; Tier B content SHALL never be cited directly (DEC-27).                                                                                                                                                                            | 182                         |
| FR-S4-2  | All meaningful intake SHALL create `Claim(proposed)` — minimum-belief state; poisoning containment is structural (intake can only enter at the floor).                                                                                                                                    | 183                         |
| FR-S4-3  | Claim fields SHALL include `statement, scope, provenance[], confidence, state, evidence_ref{kind, locator, version_hash, pinned_at}, trust_label, staleness_mode ∈ {deterministic_hash, heuristic, manual_only}, supersedes?, challenged_by?, evidence_bundle_id, origin_agent, version`. | 184                         |
| FR-S4-4  | Claim state machine: `proposed →(≥N evidence)→ supported →(hash mismatch)→ stale →(recheck true)→ supported                                                                                                                                                                               | (recheck false)→ superseded | refuted`; any state `→(counter-evidence)→ contested →(decision)→…`. | 185 |
| FR-S4-5  | Deterministic staleness SHALL be derived at read time with zero model calls (hash comparison); stale claims SHALL surface lazily in ongoing work and never disappear silently.                                                                                                            | 186                         |
| FR-S4-6  | trust_label SHALL be schema-mandatory on every Claim and Tier-A governed artifact, computed at creation as the weakest of contributing sources; `derived` SHALL inherit the weakest of its sources; labels persist across summarization, re-encoding, transfer, composition.              | 187                         |
| FR-S4-7  | Any `EvidenceRef(kind: run_journal, locator: k1:[…])` SHALL inherit the weakest trust label of the underlying material; a journal range SHALL never be a trust source by itself.                                                                                                          | 188                         |
| FR-S4-8  | Injection scanning SHALL run at every claim/knowledge/skill ingestion; scanner failure for TC-4-class content SHALL fail-closed (no entry).                                                                                                                                               | 189                         |
| FR-S4-9  | Staleness for non-artifact-grounded knowledge SHALL be `heuristic` (scheduled recheck) or `manual_only`; the system SHALL NOT claim deterministic staleness for it.                                                                                                                       | 190                         |
| FR-S4-10 | Eight knowledge types with authority order `Constraint > Decision > Fact > Environmental > Heuristic > Preference`; Assumptions enter at zero confidence; Skills via their own lifecycle.                                                                                                 | 196                         |
| FR-S4-11 | Conflict resolution SHALL apply: higher authority → explicit supersession (naming what is voided and why, evidence-linked) → else `conflict_pending` → narrowest scope wins (`Global ⊂ Org ⊂ Project ⊂ Task`); newer-wins without supersession SHALL be rejected.                         | 197                         |
| FR-S4-12 | Scope promotion private→shared SHALL pass a lifecycle gate; cross-scope privacy bleed SHALL be blocked (anti-bleed), tested.                                                                                                                                                              | 198                         |
| FR-S4-13 | Forgetting SHALL be policy-driven: use/last-access tracking, reversible auto-archive, visible tombstones for human erasure, per-type decay; silent deletion prohibited.                                                                                                                   | 199                         |
| FR-S4-14 | The Context Composer SHALL select Claims by relevance × authority × freshness and SHALL emit labeled context via pre-send; project truth SHALL override model prior at conflict.                                                                                                          | 200                         |

### Functional Requirements — Artifact & Portability Doctrine (FR-ART)

| ID       | Requirement (condensed)                                                                                                                                                                  | Source line |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FR-ART-1 | All ten Tier-A entity classes SHALL exist as explicit human-readable versionable artifacts; no durable governed knowledge SHALL exist exclusively in a session/provider store/opaque DB. | 255         |
| FR-ART-2 | PKP import SHALL route: Portable Artifact → External/Raw Material → Claim(proposed) → Admission Gate → Evidence + Review → Approved (if accepted); import SHALL NOT upgrade authority.   | 256         |
| FR-ART-3 | Compatibility metadata (representation version, required/optional capabilities, tested environments, interpretation limits) SHALL be declared, never inferred.                           | 257         |
| FR-ART-4 | Human-facing lifecycle progression SHALL be a representation layer only; the internal state machines remain the sole normative machines; no second lifecycle SHALL be created.           | 258         |

### Functional Requirements — Trust-Laundering Defense Lab (FR-LAUND)

| ID         | Requirement (condensed)                                                                                                                                                                                                     | Source line |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FR-LAUND-1 | The five-stage memory lifecycle — Write, Persist, Retrieve, Compose, Act — SHALL each be independently gated and provocation-tested (T-LAUND-W/P/R/C/A series). **P3 delivers W/P/R.**                                      | 265         |
| FR-LAUND-2 | The four attack paths — Experience→Claim, Claim→Knowledge, Knowledge→Skill, Context composition — SHALL each be provoked for authority escalation via derivation; blocked AND recorded; no silent promotion.                | 266         |
| FR-LAUND-3 | Sleeper scenarios SHALL be testable: inject → unrelated sessions → transformation/summarization → delayed retrieval → attempted action, using the Replayer across separated checkpoints.                                    | 267         |
| FR-LAUND-4 | Derivation operations (summarize, re-encode, context-pack reconstruction, cross-agent transfer) SHALL produce outputs labeled as the weakest of their inputs; laundering through "clean" intermediary provably ineffective. | 268         |

### Functional Requirements — Kernel (P3 enforcement milestone)

| ID      | Requirement (condensed)                                                                                                                                                        | Source line |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| FR-K2-1 | K-2 SHALL store typed Tier-A artifacts incl. claim/skill/evidence-bundle manifests. **P3 realizes Claim/EvidenceBundle storage.**                                              | 133         |
| FR-K2-6 | A task SHALL NOT start managed execution without a TaskContract; remaining assumptions SHALL enter as Assumption claims at zero confidence. **P3 realizes Assumption claims.** | 138         |

### Non-Functional Requirements

| ID     | Requirement (condensed)                                                                                           | Source line |
| ------ | ----------------------------------------------------------------------------------------------------------------- | ----------- |
| NFR-3  | Auditability: every governed boundary crossing reconstructable as Event, Artifact, or Claim — no invisible state. | 276         |
| NFR-11 | Testability: ≥90% branch coverage on `src/kernel/**`; provocation suite green is a merge precondition.            | 284         |

### Governance (P3 KPI)

| ID       | Requirement (condensed)                                                                                    | Source line |
| -------- | ---------------------------------------------------------------------------------------------------------- | ----------- |
| FR-GOV-5 | All KPIs G1–G7 SHALL be derivable exclusively from K-1 replays (no parallel counters). **P3 delivers G7.** | 249         |

### P2-deferred items routed to P3

| Item                                  | Requirement                              | Routed from |
| ------------------------------------- | ---------------------------------------- | ----------- |
| Trust label enforcement on claims     | FR-S4-6 (P3 enforced milestone)          | P2-GATE §9  |
| Concrete provider bindings BP-2…BP-11 | (NOT P3 — deferred; see §9 Out of Scope) | P2-GATE §9  |

> **Note on provider bindings:** The P2-PLAN §9 listed "Concrete provider bindings
> BP-2…BP-11" as P3+. The SRS §4.1 line 81 phases them implicitly across later phases
> (BP-3 grounding provider and BP-9 orchestrator engine are OWNER DECISION REQUIRED,
> SRS §14 line 324). P3 is the **claims/knowledge** phase, not the provider-binding
> phase. Concrete BP-2…BP-11 bindings are deferred to P5+ (multi-agent) and beyond,
> where external engines are actually exercised. P3 delivers the knowledge substrate
> those bindings will govern.

---

## 2. P3 Gate Criteria

From FORGE-SRS-1.0 §15 (line 335), the P3 gate requires:

1. **Zero-model-call staleness:** a deterministic-hash staleness check that provably
   makes no model calls, verified by a test that asserts zero model invocations on
   the read path (FR-S4-5).
2. **Scope-bleed pass:** a cross-scope privacy-bleed provocation that is blocked and
   recorded (FR-S4-12).
3. **Authority-resolved conflict:** a conflict resolution provocation where
   newer-wins-without-supersession is rejected and the higher-authority /
   narrowest-scope rule wins (FR-S4-11).
4. **Replayer live:** a K-1 fold across **separated checkpoints** (two distinct
   journal segments / sessions) reconstructing a coherent timeline (FR-LAUND-3).
5. **G7:** the staleness/laundering KPI derived from K-1 replay, no parallel counters
   (FR-GOV-5).
6. **PKP export:** an exported PKP package preserving provenance, hashes, evidence
   refs, versions, lifecycle states, scope limits; import does NOT upgrade authority
   (IF-06, FR-ART-2, AC-P03 negative test).
7. **T-LAUND-W/P/R:** Write, Persist, Retrieve provocation tests registered in the
   ac-registry, each escalation attempt blocked AND recorded (FR-LAUND-1/2).
8. **Full CI green:** lint, format, build, test:coverage (≥90% kernel/lib, NFR-11),
   ci-guards (C-02/C-03/C-04/C-09).

---

## 3. Module Structure (new files for P3)

All new modules carry `@forge-trace` records (C-04/NFR-10). Kernel modules are covered
by the NFR-11 ≥90% threshold. Plane modules are gated by C-03 (updated for P3 — §6).

### New kernel modules (`src/kernel/`)

| component_id               | Path                              | Implements                                                                                      | Coverage |
| -------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| `kernel-claim`             | `src/kernel/claim.ts`             | FR-S4-1/2/3/4: Claim entity, state machine (proposed→supported→stale→…), Claim store over K-2   | ≥90%     |
| `kernel-evidence-ref`      | `src/kernel/evidence-ref.ts`      | FR-S4-7: EvidenceRef + run_journal trust-label inheritance (weakest of underlying material)     | ≥90%     |
| `kernel-staleness`         | `src/kernel/staleness.ts`         | FR-S4-5/9: deterministic_hash (zero model calls) / heuristic / manual_only staleness derivation | ≥90%     |
| `kernel-knowledge-types`   | `src/kernel/knowledge-types.ts`   | FR-S4-10: eight knowledge types + authority order, Assumptions at zero confidence               | ≥90%     |
| `kernel-conflict-resolver` | `src/kernel/conflict-resolver.ts` | FR-S4-11: conflict resolution (authority → supersession → conflict_pending → narrowest scope)   | ≥90%     |
| `kernel-scope-bleed`       | `src/kernel/scope-bleed.ts`       | FR-S4-12: scope promotion lifecycle gate, anti-bleed block                                      | ≥90%     |
| `kernel-forgetting`        | `src/kernel/forgetting.ts`        | FR-S4-13: policy-driven forgetting, use/last-access tracking, reversible archive, tombstones    | ≥90%     |
| `kernel-injection-scan`    | `src/kernel/injection-scan.ts`    | FR-S4-8: injection scanning at ingestion, scanner failure for TC-4-class ⇒ fail-closed          | ≥90%     |
| `kernel-context-composer`  | `src/kernel/context-composer.ts`  | FR-S4-14: select Claims by relevance × authority × freshness, emit labeled context via pre-send | ≥90%     |
| `kernel-pkp`               | `src/kernel/pkp.ts`               | IF-06/FR-ART-2/3: PKP export/import package, compatibility metadata, no authority upgrade       | ≥90%     |
| `kernel-replayer`          | `src/kernel/replayer.ts`          | FR-LAUND-3: K-1 fold across separated checkpoints (multi-segment replay)                        | ≥90%     |
| `kernel-kpi-g7`            | `src/kernel/kpi-g7.ts`            | FR-GOV-5: G7 (staleness/laundering) KPI derived from K-1 replay, no parallel counters           | ≥90%     |
| `kernel-trust-laundering`  | `src/kernel/trust-laundering.ts`  | FR-LAUND-1/2/4: T-LAUND gating (W/P/R), derivation weakest-of, escalation blocked+recorded      | ≥90%     |

### New plane module (`src/planes/`)

| component_id      | Path                      | Implements                                                                | Coverage |
| ----------------- | ------------------------- | ------------------------------------------------------------------------- | -------- |
| `plane-knowledge` | `src/planes/knowledge.ts` | S4 intelligence plane: composes claim/knowledge kernel modules + pre-send | exempt*  |

\* Plane modules are excluded from coverage (vitest.config.ts excludes
`src/planes/**`), but MUST carry `@forge-trace` and pass C-02/C-09.

### Updated existing modules

| component_id            | Path                           | P3 change                                                                                                        |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `kernel-contract-store` | `src/kernel/contract-store.ts` | Add `createClaim()`, `createEvidenceBundle()` factory methods (Claim/EvidenceBundle already in `ARTIFACT_TYPES`) |
| `kernel-trust-label`    | `src/kernel/trust-label.ts`    | Already implements weakest-of/journalRangeTrustLabel; P3 wires it into Claim ingestion (enforced milestone)      |
| `kernel-event-journal`  | (no source change)             | Register P3 event kinds via `allowedKinds` at composition time                                                   |
| `scripts/ci-guards`     | `scripts/ci-guards.ts`         | Update `checkPlanesGate()` allowlist to admit P3-phase plane modules (see §6)                                    |

---

## 4. Event Kinds (new, registered via `allowedKinds`)

New K-1 event kinds for P3 (all match the `domain.action` regex
`/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/`):

| Kind                    | Emitted by                 | Payload (key fields)                                                                    |
| ----------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| `claim.created`         | `kernel-claim`             | `{claimId, statement, scope, state:'proposed', trustLabel, stalenessMode, originAgent}` |
| `claim.transition`      | `kernel-claim`             | `{claimId, from, to, reason, evidenceRef?}`                                             |
| `claim.superseded`      | `kernel-claim`             | `{claimId, supersededBy, reason, evidenceRefs[]}`                                       |
| `claim.contested`       | `kernel-claim`             | `{claimId, challengedBy, counterEvidenceRef}`                                           |
| `claim.stale`           | `kernel-staleness`         | `{claimId, expectedHash, actualHash, detectedAt}`                                       |
| `conflict.resolved`     | `kernel-conflict-resolver` | `{conflictId, winningClaimId, rule:'authority                                           | supersession                    | narrowest-scope', scope}`                                 |
| `conflict.pending`      | `kernel-conflict-resolver` | `{conflictId, claimIds[], scope}`                                                       |
| `scope.promotion`       | `kernel-scope-bleed`       | `{claimId, fromScope, toScope, gate:'passed                                             | blocked', reason}`              |
| `forget.archived`       | `kernel-forgetting`        | `{claimId, policy, lastAccessAt, tombstoneId}`                                          |
| `forget.tombstone`      | `kernel-forgetting`        | `{claimId, erasedBy, reason}`                                                           |
| `injection.detected`    | `kernel-injection-scan`    | `{claimId, scanner, tier:'TC-4', action:'blocked', reason}`                             |
| `injection.scan-failed` | `kernel-injection-scan`    | `{claimId, scanner, action:'fail-closed', reason}`                                      |
| `context.composed`      | `kernel-context-composer`  | `{taskId, selectedClaims[], labels[], override:'project-truth'}`                        |
| `pkp.exported`          | `kernel-pkp`               | `{pkpId, artifactIds[], provenance, hashes, scopeLimits}`                               |
| `pkp.imported`          | `kernel-pkp`               | `{pkpId, sourceClaimId, admission:'admitted                                             | rejected', authorityDelta:'0'}` |
| `replay.checkpoint`     | `kernel-replayer`          | `{checkpointId, segmentRange, eventCount, foldResult}`                                  |
| `laund.blocked`         | `kernel-trust-laundering`  | `{path:'W                                                                               | P                               | R', attackId, blocked:true, recorded:true, derivedLabel}` |

The P1/P2 kinds (`journal.append_rejected`, `hook.evaluated`, `runstate.transition`,
`spawn.contract`, `context.grant`, `context.revoke`, `adoption.queued`,
`adoption.adopted`, `taskcontract.required`, `adapter.launched`,
`adapter.interrupted`, `contract.superseded`, `claim.transition`-family) remain.

---

## 5. Task Breakdown (provocation-first, C-07)

Each task writes provocation/attack tests FIRST (must fail before impl, pass after),
then implements, then verifies CI. The mandatory negative suite items that fall in P3
(SRS §5 line 291): Tier-B→Tier-A write (claim ingestion); injected skill content
(partial — full skill is P4); PKP authority upgrade; full T-LAUND W/P/R series.

### Task P3-2: Claim entity + state machine (FR-S4-1/2/3/4)

**Requirements:** FR-S4-1, FR-S4-2, FR-S4-3, FR-S4-4
**Heritage:** E01, K05–K08
**Decisions:** DEC-27, DEC-42.1
**BP/AC:** —

**Provocation tests (write first):**

- `T-CLAIM-1` (Tier-B direct citation rejection): an attempt to cite Tier-B content
  directly (not wrapped as a Claim) in a governed cross-layer reference is rejected
  (FR-S4-1, DEC-27).
- `T-CLAIM-2` (intake floor — proposed-only): all meaningful intake creates
  `Claim(proposed)`; a provocation that asserts intake enters at `supported` or higher
  fails (FR-S4-2, P68).
- `T-CLAIM-3` (schema-mandatory fields): a Claim missing a mandatory field
  (`trust_label`, `staleness_mode`, `evidence_ref.kind`, `confidence`, `scope`,
  `origin_agent`, `version`) is rejected (FR-S4-3).
- `T-CLAIM-4` (state machine — proposed without ≥N evidence): a transition from
  `proposed → supported` without the required evidence threshold (≥N) is rejected
  (FR-S4-4).
- `T-CLAIM-5` (state machine — illegal transition): a transition `refuted → supported`
  (re-raise without recheck) is rejected (FR-S4-4).

**Implementation:**

- `Claim` schema (zod) with all FR-S4-3 fields; `artifactType: 'Claim'` in
  ContractStore via `createClaim()`.
- `CLAIM_STATES` const tuple: `proposed, supported, stale, superseded, refuted,
contested`.
- `ClaimStore` over ContractStore: `propose()` (creates at `proposed`), `support()`
  (requires ≥N evidence refs), `markStale()`, `recheck()`, `supersede()`, `refute()`,
  `contest()`.
- State machine enforced via `LEGAL_CLAIM_TRANSITIONS` table; journals
  `claim.created` / `claim.transition` / `claim.superseded` / `claim.contested`.

### Task P3-3: Staleness + zero-model-call derivation (FR-S4-5/9)

**Requirements:** FR-S4-5, FR-S4-9, AC-BP3
**Heritage:** E01
**Decisions:** DEC-42.1
**BP/AC:** AC-BP3

**Provocation tests (write first):**

- `T-STALE-1` (zero-model-call): a deterministic staleness check on an
  artifact-grounded claim invokes zero model calls — instrumented via a model-call
  counter that must remain 0 across the read path (FR-S4-5).
- `T-STALE-2` (hash mismatch ⇒ stale, surfaces lazily): a claim whose pinned
  `version_hash` no longer matches the artifact's current hash transitions to `stale`
  at read time and surfaces (never disappears silently) (FR-S4-5, P19).
- `T-STALE-3` (non-artifact-grounded ⇒ no deterministic claim): a claim without an
  artifact ground cannot set `staleness_mode: 'deterministic_hash'`; it must be
  `heuristic` or `manual_only` (FR-S4-9, OR-3).

**Implementation:**

- `StalenessMode` type: `'deterministic_hash' | 'heuristic' | 'manual_only'`.
- `checkStaleness(claim, artifactStore)`: for `deterministic_hash`, compares pinned
  `version_hash` to artifact `contentHash` — **pure function, no model calls**.
- `deriveStalenessMode(claim)`: enforces FR-S4-9 — no `deterministic_hash` without an
  artifact ground.
- Journals `claim.stale` on detection; stale claims surface lazily via the Context
  Composer (P3-7), never silently dropped.

### Task P3-4: Knowledge types + conflict resolution + anti-bleed + forgetting (FR-S4-10/11/12/13)

**Requirements:** FR-S4-10, FR-S4-11, FR-S4-12, FR-S4-13
**Heritage:** E01, K05–K08
**Decisions:** DEC-27
**BP/AC:** —

**Provocation tests (write first):**

- `T-KTYPE-1` (eight types + authority order): a claim typed outside the eight
  knowledge types is rejected; two conflicting claims resolve by authority order
  `Constraint > Decision > Fact > Environmental > Heuristic > Preference`
  (FR-S4-10, P63).
- `T-KTYPE-2` (Assumptions at zero confidence): an Assumption claim created with
  `confidence > 0` is rejected/downgraded to 0 (FR-S4-10).
- `T-CONFLICT-1` (newer-wins-without-supersession rejected): two conflicting claims
  where the newer one lacks explicit supersession of the older ⇒ `conflict_pending`,
  NOT silent newer-wins (FR-S4-11, P65).
- `T-CONFLICT-2` (narrowest scope wins): a Task-scope claim overrides a Global-scope
  claim at conflict when authorities are equal and no supersession — narrowest scope
  wins (`Global ⊂ Org ⊂ Project ⊂ Task`) (FR-S4-11).
- `T-BLEED-1` (scope-bleed blocked): a private→shared scope promotion without passing
  the lifecycle gate is blocked and recorded (FR-S4-12, P67).
- `T-FORGET-1` (silent deletion prohibited): an attempt to silently delete a claim
  (no tombstone, no archive) is rejected; forgetting must be policy-driven with a
  visible tombstone (FR-S4-13, P66).

**Implementation:**

- `KNOWLEDGE_TYPES` const tuple (8) + `AUTHORITY_ORDER` map.
- `ConflictResolver`: `resolve(claimA, claimB)` → applies authority → supersession →
  `conflict_pending` → narrowest-scope; journals `conflict.resolved` /
  `conflict.pending`.
- `ScopeBleedGuard`: `promoteScope(claimId, fromScope, toScope)` — lifecycle gate;
  private→shared requires explicit gate pass; journals `scope.promotion`
  (passed/blocked).
- `ForgettingService`: `archive()` (reversible auto-archive, use/last-access tracked),
  `tombstone()` (visible tombstone for human erasure); per-type decay policy; journals
  `forget.archived` / `forget.tombstone`.

### Task P3-5: Trust label enforcement on claims + EvidenceRef run_journal (FR-S4-6/7)

**Requirements:** FR-S4-6, FR-S4-7
**Heritage:** INV-4
**Decisions:** DEC-42.1, DEC-42.2
**BP/AC:** —

**Provocation tests (write first):**

- `T-TLABEL-1` (schema-mandatory, weakest-of): a Claim created without a `trust_label`
  is rejected; a Claim derived from `web/untrusted` + `tool-output` sources gets
  `web/untrusted` (weakest), NOT `trusted/user` (FR-S4-6, DEC-42.1).
- `T-TLABEL-2` (derived inherits weakest): a derivation (summarize/re-encode) over
  inputs with labels `tool-output` and `web/untrusted` yields an output labeled
  `web/untrusted` — laundering through the derivation is ineffective (FR-S4-6,
  DEC-42.1, FR-LAUND-4).
- `T-TLABEL-3` (run_journal range never a trust source): an `EvidenceRef(kind:
run_journal, locator: k1:[…])` whose underlying material is `web/untrusted` inherits
  `web/untrusted`, NOT a bare `trusted` just because it came through the journal
  (FR-S4-7, DEC-42.2).

**Implementation:**

- `EvidenceRef` schema with `kind` (`run_journal | artifact | external`), `locator`,
  `version_hash`, `pinned_at`.
- `resolveEvidenceRefTrustLabel(ref, materialLabels)`: for `run_journal`, delegates to
  `journalRangeTrustLabel()` (already in `kernel-trust-label`); the range confers no
  trust by itself.
- Claim ingestion enforces `trust_label` computed via `weakestOf(sourceLabels)` at
  creation; missing label ⇒ rejection (enforced milestone of FR-S4-6).

### Task P3-6: Injection scanning at ingestion, fail-closed (FR-S4-8)

**Requirements:** FR-S4-8
**Heritage:** E01
**Decisions:** DEC-33
**BP/AC:** —

**Provocation tests (write first):**

- `T-INJECT-1` (scanner failure fail-closed): when the injection scanner throws on
  TC-4-class content, the claim is NOT ingested — fail-closed (no entry)
  (FR-S4-8, DEC-33).
- `T-INJECT-2` (injection detected ⇒ blocked + recorded): a claim body containing a
  planted prompt-injection pattern (from the test corpus, per DEC-42.5) is blocked at
  ingestion and journals `injection.detected` (FR-S4-8, P61/P68).

**Implementation:**

- `InjectionScanner`: `scan(content)` → `{clean, tier, pattern?}`; pattern set from
  the DEC-42.5 test corpus (threat-model patterns as test corpora only — unverified
  literature does not enter as fact).
- `ingestClaim()` pipeline: `scan()` → on `clean:false` block + journal
  `injection.detected`; on scanner throw for TC-4-class block + journal
  `injection.scan-failed` (fail-closed).

### Task P3-7: Context Composer pre-send labeled context (FR-S4-14)

**Requirements:** FR-S4-14
**Heritage:** E01
**Decisions:** DEC-27
**BP/AC:** —

**Provocation tests (write first):**

- `T-CTX-1` (project truth overrides model prior): at a conflict between a project
  Claim and a model-prior statement, the composed context labels the project Claim as
  overriding (FR-S4-14, P03).
- `T-CTX-2` (labeled context via pre-send): the Context Composer emits context with
  per-claim labels (`trust_label`, `authority`, `freshness`, `staleness`) attached;
  unlabeled context is rejected (FR-S4-14).
- `T-CTX-3` (stale surfaces lazily, not silently dropped): a stale claim is included
  in the composed context with a `stale` label (lazily surfaced), not removed
  silently (FR-S4-5/14, P19).

**Implementation:**

- `ContextComposer`: `compose(taskId, claims)` → selects by
  `relevance × authority × freshness`; emits labeled context payload for `pre-send`
  hook.
- Wires into K-4 `pre-send` hook point (shadow in P1, exercised here for context
  emission — enforcement flips remain P8).
- Journals `context.composed`.

### Task P3-8: PKP export/import + compatibility metadata + no authority upgrade (IF-06, FR-ART-2/3/4)

**Requirements:** IF-06, FR-ART-2, FR-ART-3, FR-ART-4, AC-P03
**Heritage:** K04/K05
**Decisions:** DEC-40 (AU-04, AU-06, AU-09)
**BP/AC:** AC-P03

**Provocation tests (write first):**

- `T-PKP-1` (authority upgrade rejected — AC-P03): a PKP import whose artifacts would
  upgrade authority (e.g., an imported `Approved` claim becoming `Approved` locally
  without local evidence/review) is rejected; import routes through
  `Claim(proposed)` Admission Gate (FR-ART-2, DEC-40.3).
- `T-PKP-2` (compatibility metadata declared, not inferred): a PKP without explicit
  compatibility metadata (`representation_version`, `required_capabilities`,
  `tested_environments`, `interpretation_limits`) is rejected; the system does NOT
  infer provider support from syntactic readability (FR-ART-3, AU-09).
- `T-PKP-3` (export preserves provenance/hashes/scope): an exported PKP package
  round-trips with preserved `provenance[]`, `contentHash`es, `evidenceRefs[]`,
  `version`s, `lifecycleState`s, and `scope` limits (IF-06).
- `T-PKP-4` (no second lifecycle — FR-ART-4): the human-facing lifecycle progression
  is a representation layer only; a provocation that asserts a second normative
  lifecycle is created on import fails (FR-ART-4, AU-06).

**Implementation:**

- `PKP` schema (`artifactType: 'PKP'`, already in `ARTIFACT_TYPES`): package layout
  with `artifacts[]`, `provenance`, `hashes`, `evidenceRefs`, `versions`,
  `lifecycleStates`, `scopeLimits`, `compatibility{representation_version,
required_capabilities, optional_capabilities, tested_environments,
interpretation_limits}`.
- `exportPkp(artifactIds)`: assembles package, journals `pkp.exported`.
- `importPkp(pkp)`: routes Portable Artifact → External/Raw Material →
  `Claim(proposed)` → Admission Gate → Evidence + Review → Approved (if accepted);
  authority delta enforced = 0; journals `pkp.imported`.

### Task P3-9: Replayer across separated checkpoints + G7 KPI (FR-LAUND-3, FR-GOV-5)

**Requirements:** FR-LAUND-3, FR-GOV-5
**Heritage:** E02, K15
**Decisions:** DEC-42.3
**BP/AC:** —

**Provocation tests (write first):**

- `T-REPLAY-1` (separated checkpoints): a replay across two separated journal
  segments (simulating unrelated sessions / checkpoints) reconstructs a coherent
  timeline; a provocation that asserts the segments cannot be correlated fails
  (FR-LAUND-3, DEC-42.3).
- `T-REPLAY-2` (sleeper across checkpoints): inject → session A → transformation →
  checkpoint → session B → delayed retrieval → attempted action; the Replayer
  reconstructs the full path and the attempted action is evaluable (FR-LAUND-3).
- `T-G7-1` (G7 from replay, no parallel counters): the G7 KPI (staleness/laundering
  detection count) is derived exclusively from a K-1 replay; a provocation that
  asserts a parallel counter is maintained fails (FR-GOV-5).

**Implementation:**

- `Replayer`: `replayAcross(checkpoints[])` — folds over multiple K-1 segments in
  chronological order, reconstructing a unified timeline; journals
  `replay.checkpoint` per segment.
- `G7Kpi`: `derive(journal)` — a pure fold over K-1 events counting
  `claim.stale` + `laund.blocked` + `injection.detected` events; NO parallel counter
  state; G7 = count from replay.

### Task P3-10: T-LAUND-W/P/R provocation + derivation weakest-of (FR-LAUND-1/2/4)

**Requirements:** FR-LAUND-1 (W/P/R), FR-LAUND-2, FR-LAUND-4
**Heritage:** E02, INV-4/5
**Decisions:** DEC-42.1/2/3/4
**BP/AC:** —

**Provocation tests (write first):**

- `T-LAUND-W` (Write stage — Experience→Claim escalation): an attempt to write an
  experience-derived claim at an escalated trust label (stronger than its source) is
  blocked AND recorded; any silent promotion = failure (FR-LAUND-1/2, DEC-42.4).
- `T-LAUND-P` (Persist stage — Claim→Knowledge escalation): persisting a Claim into
  Knowledge at an escalated label (above the weakest of inputs) is blocked AND
  recorded (FR-LAUND-1/2).
- `T-LAUND-R` (Retrieve stage — laundering through "clean" intermediary): a
  derivation (summarize/re-encode) that routes through a "clean" intermediary to
  shed the weak label is provably ineffective — output label = weakest of inputs
  (FR-LAUND-1/4, DEC-42.1/2).
- `T-LAUND-DERIVE-1` (derivation weakest-of invariant): every derivation operation
  (summarize, re-encode, context-pack reconstruction) produces an output labeled
  `weakestOf(inputLabels)`; a provocation asserting a stronger output fails
  (FR-LAUND-4).

**Implementation:**

- `TrustLaunderingLab`: gating at Write (`gateWrite(experience, sourceLabels)`),
  Persist (`gatePersist(claim, knowledgeLabels)`), Retrieve
  (`gateRetrieve(derivedInputs)`). Each enforces `weakestOf` and journals
  `laund.blocked` with `path: 'W'|'P'|'R'`.
- Reuses `weakestOf` / `weakerOf` from `kernel-trust-label` (no duplication of the
  invariant).
- Compose/C/A stages (FR-LAUND-1 full series) deferred to P5/P8/P9 per the
  P3→P9 mapping (SRS §3.12 line 265).

### Task P3-11: CI guards plane allowlist update for P3

`scripts/ci-guards.ts` `checkPlanesGate()` currently allows only `plane-execution`
(P2 allowlist). For P3, the S4 knowledge plane is in scope.

**Change:** Add `plane-knowledge` to the allowlist (rename `P2_ALLOWED_PLANES` to a
phase-agnostic `ALLOWED_PLANES` or add a `P3_ALLOWED_PLANES` set unioned with P2).
Plane modules not in the allowlist are rejected with the same C-03 message. C-02
(no network) and C-09 (dependency direction) already apply correctly.

### Task P3-12: Provocation consolidation + full CI + gate

Collect all P3-2…P3-10 provocation IDs into `P3-GATE.md` (§3 consolidation table),
run full CI (`npm run ci`), verify ≥90% coverage on `src/kernel/**` and `src/lib/**`
with the new modules, finalize the gate document as GREEN, commit, push, update PR.

---

## 6. CI Guards Update (Task P3-11)

`scripts/ci-guards.ts` `checkPlanesGate()` uses `P2_ALLOWED_PLANES = new
Set(['plane-execution'])`. For P3, add `plane-knowledge`.

**Change:** Extend the allowlist to admit P3-phase plane modules. Concretely, either:

- Rename to `ALLOWED_PLANES` and add both `plane-execution` and `plane-knowledge`, OR
- Add `P3_ALLOWED_PLANES = new Set(['plane-knowledge'])` and union with P2.

The check continues to parse `@forge-trace` `component_id`; allow if in the combined
set, else fail C-03 with the reason. C-02 (no network) and C-09 (dependency direction)
already apply correctly. Traceability (C-04) already applies to all non-exempt
modules. No change needed there.

---

## 7. Traceability Mappings (for `@forge-trace` records)

New component IDs to register (REGISTRIES.md will be updated at P3 gate):

| component_id               | problems                    | heritage     | decisions        | bp_ids | ac_ids |
| -------------------------- | --------------------------- | ------------ | ---------------- | ------ | ------ |
| `kernel-claim`             | P23, P68                    | E01, K05–K08 | DEC-27, DEC-42.1 |        |        |
| `kernel-evidence-ref`      | P23                         | E01, INV-4   | DEC-42.2         |        |        |
| `kernel-staleness`         | P18, P19                    | E01          | DEC-42.1         | BP-3   | AC-BP3 |
| `kernel-knowledge-types`   | P63                         | E01, K05     | DEC-27           |        |        |
| `kernel-conflict-resolver` | P65                         | E01, K08     | DEC-27           |        |        |
| `kernel-scope-bleed`       | P67                         | E01, K08     | DEC-27           |        |        |
| `kernel-forgetting`        | P66                         | E01, K08     | DEC-27           |        |        |
| `kernel-injection-scan`    | P61, P68                    | E01          | DEC-33           |        |        |
| `kernel-context-composer`  | P03, P19                    | E01, K07     | DEC-27           |        |        |
| `kernel-pkp`               | P46, P74                    | K04, K05     | DEC-40           |        | AC-P03 |
| `kernel-replayer`          | P68                         | E02, K15     | DEC-42.3         |        |        |
| `kernel-kpi-g7`            | P93                         | E02          | DEC-42.3         |        |        |
| `kernel-trust-laundering`  | P68                         | E02, INV-4/5 | DEC-42.1/2/3/4   |        |        |
| `plane-knowledge`          | P03, P18, P19, P23, P63–P68 | E01, K05–K08 | DEC-27/40/42     |        |        |

---

## 8. Execution Order

```
P3-2 (Claim entity)        ──┐
P3-3 (Staleness)           ──┤
P3-5 (Trust label/EvRef)   ──┼── P3-4 (Knowledge/conflict/bleed/forget) ──┐
P3-6 (Injection scan)      ──┘                                            ├── P3-9 (Replayer + G7) ──┐
P3-7 (Context Composer)    ──── depends on P3-2/3/4/5                     │                         ├── P3-11 (CI guards) ── P3-12 (gate)
P3-8 (PKP)                 ──── depends on P3-2/5                         ┘                         │
P3-10 (T-LAUND W/P/R)      ──── depends on P3-2/3/5, P3-9 (Replayer) ─────────────────────────────┘
```

Provocation tests are written **before** each implementation task, per C-07. P3-5
(trust label enforcement) is the enforced milestone of FR-S4-6 and unblocks the
claim ingestion pipeline; it is written early. P3-9 (Replayer) unblocks P3-10
(sleeper scenarios across checkpoints). P3-11 unblocks the plane module in CI.
P3-12 is the gate document and commit/push/PR.

---

## 9. Out of Scope (deferred to P4+)

| Item                                              | Target |
| ------------------------------------------------- | ------ |
| Concrete provider bindings BP-2…BP-11             | P5+    |
| Skills registry + lifecycle (FR-S4-15..18)        | P4     |
| T-LAUND Compose/Act stages (C/A)                  | P5/P8  |
| Knowledge→Skill attack path                       | P4     |
| Context composition attack path (full)            | P5     |
| Enforcement flips (shadow→enforce)                | P8     |
| Nine-tier verification (FR-S4-19..23)             | P6     |
| Five drills + DEC-29 single-source (FR-S4-24..26) | P7     |
| Multi-day sleeper variants                        | P9     |
| NFR-9 production benchmarking                     | Gate   |

> **OWNER DECISION REQUIRED (SRS §14 line 324):** BP-3 grounding provider, BP-9
> orchestrator engine, PKP manifest extensions, NFR-9 production targets. P3 uses
> dev stubs only and does not resolve these by assumption.

---

## 10. Gate Readiness Checklist

- [ ] All P3-tagged requirements implemented with traceability triples (§1)
- [ ] Provocation tests green: T-CLAIM, T-STALE, T-KTYPE, T-CONFLICT, T-BLEED,
      T-FORGET, T-TLABEL, T-INJECT, T-CTX, T-PKP, T-REPLAY, T-G7, T-LAUND-W/P/R
      (§5)
- [ ] Zero-model-call staleness verified (FR-S4-5)
- [ ] Scope-bleed pass verified (FR-S4-12)
- [ ] Authority-resolved conflict verified (FR-S4-11)
- [ ] Replayer across separated checkpoints live (FR-LAUND-3)
- [ ] G7 KPI derived from K-1 replay, no parallel counters (FR-GOV-5)
- [ ] PKP export preserves provenance; import does not upgrade authority (IF-06,
      FR-ART-2, AC-P03)
- [ ] T-LAUND-W/P/R registered and green (FR-LAUND-1/2)
- [ ] CI green: lint, format, build, test:coverage ≥90%, ci-guards
- [ ] CI guards updated for P3 plane allowlist (P3-11)
- [ ] REGISTRIES.md updated with new component IDs
- [ ] P3-GATE.md written with traceability matrix + gate decision
- [ ] Committed, pushed, PR updated
