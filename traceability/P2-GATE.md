# FOrGE P2 Gate — Adapter + Continuity Phase Completion

**Standard:** FORGE-SRS-1.0 §4.1 (phased rollout P0–P9), §5 (constraints), §6 (NFRs)
**Date:** 2026-08-28
**Status:** 🟡 PROVISIONAL — provocation tests consolidated; CI guards + full CI pending (P2-8/P2-9)

> "No phase starts while the previous gate is red." — FORGE-SRS-1.0 §4.1

This document is the P2 gate record. It consolidates every provocation test
written across P2-2…P2-6 (per C-07: provocation-first), maps each to its
requirement, file, and verification status, and records the gate decision.

P1 delivered the kernel foundation. P2 builds the **adapter boundary**
(K-3 = BP-1) and the **continuity machinery** (RunState event-sourcing,
TaskContract enforcement, K-5 lifecycle) on top of that kernel.

---

## 1. P2 Gate Criteria (from FORGE-SRS-1.0 §4.1)

| #   | Criterion                                                                                                       | Status        |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | End-to-end task demo: contract → instance → events → forced kill → K-1 resume → manual closure                   | ✅ MET (P2-6) |
| 2   | Out-of-contract tool rejection: a tool call outside SpawnContract declared capabilities is rejected             | ✅ MET (P2-5) |
| 3   | AC-BP1: adapter five-verb conformance (drills manual)                                                            | ✅ MET (P2-2) |
| 4   | Full CI green: lint, format, build, test:coverage (≥90% kernel/lib, NFR-11), ci-guards                           | 🟡 PENDING    |

Criterion 4 is pending the P2-8 CI guards update (plane gate allowlist) and
the P2-9 full pipeline run. Criteria 1–3 are met by the provocation tests
consolidated in §3.

---

## 2. CI Pipeline Verification (P2-9 — to be re-run after P2-8)

The complete `npm run ci` pipeline (last run, pre-P2-8):

```
npm run lint && npm run format && npm run build && npm run test:coverage && tsx scripts/ci-guards.ts
```

| Step      | Tool                   | Result                              |
| --------- | ---------------------- | ----------------------------------- |
| Lint      | ESLint 9 (flat config) | ✅ 0 errors, 0 warnings             |
| Format    | Prettier --check       | ✅ All files formatted              |
| Build     | tsc --noEmit (strict)  | ✅ 0 type errors                    |
| Tests     | Vitest                 | ✅ 351 tests passing (15 files)     |
| Coverage  | c8/v8                  | ✅ All thresholds ≥90% (NFR-11)     |
| CI Guards | scripts/ci-guards.ts   | ✅ 20 modules checked (pre-plane)  |

### Coverage Breakdown (NFR-11: ≥90% kernel/lib — GLOBAL threshold)

| File                          | Stmts   | Branch  | Funcs | Lines   |
| ----------------------------- | ------- | ------- | ----- | ------- |
| kernel/adapter-spi.ts         | 98.43%  | 96.87%  | 100%  | 98.43%  |
| kernel/adoption-queue.ts      | 96.96%  | 83.33%  | 100%  | 96.96%  |
| kernel/agent-registry.ts      | 100%    | 100%    | 100%  | 100%    |
| kernel/canonical-json.ts      | 100%    | 100%    | 100%  | 100%    |
| kernel/context-grant.ts       | 100%    | 88.88%  | 100%  | 100%    |
| kernel/contract-store.ts      | 100%    | 100%    | 100%  | 100%    |
| kernel/event-journal.ts       | 94.59%  | 94.44%  | 100%  | 94.44%  |
| kernel/policy-hooks.ts        | 97.36%  | 66.66%  | 100%  | 97.14%  |
| kernel/run-state.ts           | 96.77%  | 85%     | 100%  | 96.77%  |
| kernel/routing.ts             | 100%    | 100%    | 100%  | 100%    |
| kernel/spawn-contract.ts      | 93.75%  | 83.33%  | 100%  | 93.75%  |
| kernel/storage-memory.ts      | 100%    | 93.75%  | 100%  | 100%    |
| kernel/task-contract.ts       | 95.55%  | 85%     | 100%  | 95.55%  |
| kernel/trust-label.ts         | 100%    | 100%    | 100%  | 100%    |
| lib/hash.ts                   | 100%    | 100%    | 100%  | 100%    |
| lib/secret-patterns.ts        | 100%    | 100%    | 100%  | 100%    |
| lib/ulid.ts                   | 100%    | 66.66%  | 100%  | 100%    |
| **All files**                 | **98.21%** | **91.77%** | **100%** | **98.44%** |

All four global thresholds (branches/functions/lines/statements) are ≥90%.
Per-file branch coverage may dip below 90% (e.g. policy-hooks 66.66%,
adoption-queue 83.33%) — NFR-11 is a GLOBAL threshold on `src/kernel/**` and
`src/lib/**`, not per-file. The global branch coverage is 91.77% ≥ 90%.

---

## 3. Provocation Test Consolidation (C-07: provocation-first)

**This is the central P2-7 deliverable.** Per C-07, every provocation/attack
test was written FIRST (must fail before implementation, pass after). The
table below collects, names, and references every provocation test from
P2-2…P2-6. Each row links the provocation ID to its requirement, target
module, test file, and verification status.

### 3.1 Consolidation Table

| Provocation  | Target                                    | Task | Requirement        | Test file                          | Status    |
| ------------ | ----------------------------------------- | ---- | ------------------ | ---------------------------------- | --------- |
| T-BP1-1..4   | Adapter five-verb conformance             | P2-2 | IF-01, IF-05, AC-BP1 | tests/kernel/adapter-spi.test.ts    | ✅ PASS   |
| T-RS-1..4    | RunState declared states + write-ahead     | P2-3 | FR-S3-1, FR-K1-9, NFR-5, NFR-6 | tests/kernel/run-state.test.ts     | ✅ PASS   |
| T-TC-1..2    | TaskContract before managed execution     | P2-4 | FR-K2-6, AC-BP10   | tests/kernel/task-contract.test.ts | ✅ PASS   |
| T-AUTH-1..2  | Authority = identity ∩ contract           | P2-5 | FR-K5-3, INV-2, NFR-8 | tests/kernel/lifecycle.test.ts      | ✅ PASS   |
| T-GRANT-1..2 | ContextGrant scope/reason                 | P2-5 | FR-K5-5            | tests/kernel/lifecycle.test.ts      | ✅ PASS   |
| T-ADOPT-1    | Unmanaged spawn not auto-adopted          | P2-5 | FR-K5-7            | tests/kernel/lifecycle.test.ts      | ✅ PASS   |
| T-ROUTE-1    | Limitations before capability claims      | P2-5 | FR-K5-2, INV-6     | tests/kernel/lifecycle.test.ts      | ✅ PASS   |
| T-RECOVER-1  | End-to-end crash recovery                 | P2-6 | NFR-5, NFR-6, FR-K1-9, FR-K2-6 | tests/kernel/recoverability.test.ts | ✅ PASS   |

**Total: 15 named provocation IDs across 5 test files, 108 tests.**

### 3.2 Provocation Detail

#### T-BP1-1..4 — Adapter five-verb conformance (P2-2, IF-01/IF-05/AC-BP1)

- **T-BP1-1**: An adapter exposing a sixth verb (e.g. `restart`, `migrate`)
  is rejected by `assertAdapterConformance()`. (lines 71–92)
- **T-BP1-2**: An adapter omitting one of the five verbs (launch/send/events/
  interrupts/artifacts), or with a verb that is not a function, is rejected.
  (lines 94–128)
- **T-BP1-3**: An Enforcement Map missing a tier field
  (`outOfBandCompensated`, `advisory`, `control`), with an empty control
  string, or with an unknown extra field, is rejected (IF-05 completeness).
  An in-band claim with no out-of-band compensation is flagged. (lines 154–218)
- **T-BP1-4**: A provider extension that introduces a required internal type
  (a `declaredCapabilities` entry with no matching enforcement-map control)
  is rejected (IF-01: "never required internal types"). (lines 220–268)
- **T-BP1-5** (supplementary): Missing `enforcementMap` / `declaredCapabilities`
  fields, non-array capabilities, non-string entries, and non-object impls are
  rejected. (lines 285–339)

**File:** `tests/kernel/adapter-spi.test.ts` — 35 tests.
**Target module:** `src/kernel/adapter-spi.ts` (`kernel-adapter-spi`).

#### T-RS-1..4 — RunState declared states + write-ahead (P2-3, FR-S3-1/FR-K1-9/NFR-5/NFR-6)

- **T-RS-1**: The eight declared states (`QUEUED, RUNNING, SUSPENDED,
  INTERRUPTED, RECOVERING, RESUMING, ABORTED, CLOSED`) match the SRS state
  diagram exactly; `QUEUED → RUNNING` is legal. (lines 41–61)
- **T-RS-2**: A transition journals `runstate.transition` BEFORE the in-memory
  state advances (write-ahead, FR-K1-9). The in-memory state is disposable —
  reconstructing from the journal yields the journaled state. (lines 63–81)
- **T-RS-3**: After a forced kill (drop in-memory state, reconstruct from
  K-1), the RunState matches the last journaled state, NOT any unjournaled
  intermediate (NFR-5/NFR-6). An instance with no journaled transitions has
  no state (null). Multiple instances are tracked independently via
  `task_ref`. (lines 83–112)
- **T-RS-4**: Illegal transitions (`CLOSED → RUNNING`, `ABORTED → RUNNING`,
  `QUEUED → SUSPENDED`, unknown state) are rejected. A rejected illegal
  transition is NOT journaled (no phantom event). (lines 114–167)

**File:** `tests/kernel/run-state.test.ts` — 20 tests.
**Target module:** `src/kernel/run-state.ts` (`kernel-run-state`).

#### T-TC-1..2 — TaskContract before managed execution (P2-4, FR-K2-6/AC-BP10)

- **T-TC-1**: An attempt to start managed execution without a TaskContract is
  rejected (fail-closed) and journals a `taskcontract.required` event carrying
  the `taskId` and reason. The rejection is journaled BEFORE the gate returns
  (write-ahead). A valid TaskContract does NOT trigger a rejection event.
  (lines 55–102)
- **T-TC-2**: A task with a TaskContract but unrecorded assumptions is
  accepted, but the assumptions enter as `assumption.claim` events at zero
  confidence (FR-K2-6 second clause). Every Assumption claim carries
  `confidence = 0` (never elevated). A TaskContract with no assumptions
  yields zero Assumption claims. (lines 104–181)

**File:** `tests/kernel/task-contract.test.ts` — 19 tests.
**Target module:** `src/kernel/task-contract.ts` (`kernel-task-contract`).

#### T-AUTH-1..2 — Authority = identity ∩ contract (P2-5, FR-K5-3/INV-2/NFR-8)

- **T-AUTH-1**: An identity with `authorityClass = OBSERVER` and a
  SpawnContract granting `COMMITTER` results in effective authority `OBSERVER`
  (the intersection via `Math.min`), NOT `COMMITTER`. Escalation via contract
  is impossible (INV-2, NFR-8). (lines 101–148)
- **T-AUTH-2**: `can_commit` defaults false — a SpawnContract without
  explicit `can_commit: true` does not authorize commits (FR-K5-3).
  (lines 152–183)

**File:** `tests/kernel/lifecycle.test.ts` — 29 tests (shared with T-GRANT/ADOPT/ROUTE).
**Target module:** `src/kernel/spawn-contract.ts` (`kernel-spawn-contract`).

#### T-GRANT-1..2 — ContextGrant scope/reason (P2-5, FR-K5-5)

- **T-GRANT-1**: A ContextGrant with `scope: 'write'` is rejected (FR-K5-5:
  read-only/read-comment, never write). (lines 187–218)
- **T-GRANT-2**: A ContextGrant without a `reason` is rejected (FR-K5-5:
  reason required). (lines 222–266)

**File:** `tests/kernel/lifecycle.test.ts`.
**Target module:** `src/kernel/context-grant.ts` (`kernel-context-grant`).

#### T-ADOPT-1 — Unmanaged spawn not auto-adopted (P2-5, FR-K5-7)

- **T-ADOPT-1**: An instance entering the Adoption Queue is NOT auto-adopted,
  NOT auto-trusted, and NOT silently destroyed. A provocation that asserts
  auto-adoption fails. Adoption is manual only, with explicit adopter +
  reason. (lines 270–364)

**File:** `tests/kernel/lifecycle.test.ts`.
**Target module:** `src/kernel/adoption-queue.ts` (`kernel-adoption-queue`).

#### T-ROUTE-1 — Limitations before capability claims (P2-5, FR-K5-2/INV-6)

- **T-ROUTE-1**: Routing surfaces `known_limitations` BEFORE capability
  claims (INV-6) — a candidate with limitations is not presented as
  unlimited. Routing evaluates `domain × level × authority`. (lines 368–480)

**File:** `tests/kernel/lifecycle.test.ts`.
**Target module:** `src/kernel/routing.ts` (`kernel-routing`).

#### T-RECOVER-1 — End-to-end crash recovery (P2-6, NFR-5/NFR-6/FR-K1-9/FR-K2-6)

- **T-RECOVER-1**: The full lifecycle — contract → instance (adapter.launch)
  → events (runstate transitions journaled) → forced kill (drop in-memory
  state) → K-1 resume (reconstruct RunState from journal) → manual closure
  (CLOSED). Asserts the resumed state matches the last journaled state
  (INTERRUPTED) and closure completes. Verifies `spawn.contract` event
  (effectiveAuthority=EXECUTOR, canCommit=false, fullPrivacy=true),
  `adapter.launched` event, 3 `runstate.transition` events, `assumption.claim`
  events (confidence=0), and CLOSED is terminal. (lines 268–348)
- **NFR-6 (sub-test)**: A second conformant adapter is substituted without
  kernel changes — adapter A launches + interrupts, forced kill, resume from
  journal, adapter B closes through a harness wired to the same journal.
  (lines 378–414)
- **FR-K2-6 (sub-test)**: Managed execution is refused without a
  TaskContract — `requireContract` returns `{ok:false}`, journals
  `taskcontract.required` with reason containing `FR-K2-6`. (lines 416–434)
- **NFR-5 (sub-test)**: Journal integrity survives the kill —
  `journal.verify()` passes before and after forced kill + reconstruction,
  `checked === count`. (lines 436–467)
- **FR-K1-9 (sub-test)**: Write-ahead — a fresh `RunState` over the same
  journal sees the state immediately after each transition (RUNNING after
  launch, INTERRUPTED after interrupt), 2 transition events total.
  (lines 469–496)

**File:** `tests/kernel/recoverability.test.ts` — 5 tests.
**Target modules:** `src/kernel/event-journal.ts`, `src/kernel/contract-store.ts`,
`src/kernel/task-contract.ts`, `src/kernel/spawn-contract.ts`,
`src/kernel/run-state.ts`, `src/kernel/adapter-spi.ts` (integration).

---

## 4. P2 Requirement Traceability Matrix

### Interfaces (IF-series)

| ID    | Requirement                                                                                           | Status | Evidence                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| IF-01 | Adapter SPI exposes exactly five verbs; provider extensions are declared capabilities only           | ✅ MET | src/kernel/adapter-spi.ts — `ADAPTER_VERBS`, `assertAdapterConformance()`; T-BP1-1..4 (35 tests)                |
| IF-05 | Every provider binding publishes an Enforcement Map; in-band/OOB claims are provocation-tested       | ✅ MET | src/kernel/adapter-spi.ts — `EnforcementMap`, `validateEnforcementMap()`; T-BP1-3 (IF-05 completeness)             |

### Functional Requirements — Kernel

| ID      | Requirement                                                                                              | Status | Evidence                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| FR-K1-9 | State transitions journaled before effect (write-ahead); crash mid-apply leaves prior declared state    | ✅ MET | src/kernel/run-state.ts — `transition()` journals before `states.set()`; T-RS-2, T-RECOVER-1 (FR-K1-9 sub-test)                 |
| FR-K2-6 | No managed execution without TaskContract; remaining assumptions enter as Assumption claims at 0 conf. | ✅ MET | src/kernel/task-contract.ts — `requireContract()` (fail-closed); T-TC-1..2, T-RECOVER-1 (FR-K2-6 sub-test)                      |

### Functional Requirements — K-5 Agent Lifecycle

| ID      | Requirement                                                                                                                 | Status | Evidence                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| FR-K5-2 | Routing evaluates domain × level × authority; surfaces known_limitations before capability claims (INV-6)                 | ✅ MET | src/kernel/routing.ts — `route()`, `RoutingEngine`; T-ROUTE-1                                                    |
| FR-K5-3 | Every managed spawn carries a SpawnContract; effective authority = Identity ∩ contract; can_commit defaults false; empty grants = full privacy | ✅ MET | src/kernel/spawn-contract.ts — `effectiveAuthority()` (Math.min), `enforce()`; T-AUTH-1..2, T-RECOVER-1            |
| FR-K5-4 | SpawnContract delivered to adapter as constraints AND monitored by pre-tool hooks (contract is not a trust document)       | ✅ MET | src/kernel/spawn-contract.ts — `enforce()` journals `spawn.contract`; K-4 `pre-tool` hook (shadow-locked P1)      |
| FR-K5-5 | ContextGrant explicit: granter, grantee, items, scope read-only/read-comment (never write), TTL, revocable, logged, reason | ✅ MET | src/kernel/context-grant.ts — `grant()`/`revoke()` journal K-1 events; T-GRANT-1..2                              |
| FR-K5-7 | Unmanaged spawns enter Adoption Queue; NOT auto-adopted/trusted/destroyed; contents become Candidates                        | ✅ MET | src/kernel/adoption-queue.ts — `enqueue()`, `listCandidates()`, `adopt()` (manual); T-ADOPT-1                     |

### Functional Requirements — S3 Execution Plane

| ID      | Requirement                                                                                                                       | Status | Evidence                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| FR-S3-1 | RunState event-sourced from K-1 with declared states; rebuild on crash from journal, never from dead session memory               | ✅ MET | src/kernel/run-state.ts — `reconstruct()` replays `runstate.transition`; T-RS-1..4, T-RECOVER-1       |

### Non-Functional Requirements

| ID    | Requirement                                                                 | Status | Evidence                                                                                       |
| ----- | --------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| NFR-5 | Recoverability: crashed governed runtime reconstructable from K-1          | ✅ MET | src/kernel/run-state.ts — `reconstruct()`; T-RS-3, T-RECOVER-1 (NFR-5 sub-test)                |
| NFR-6 | Continuity: no silent loss of declared state across crashes                 | ✅ MET | T-RS-3, T-RECOVER-1 (NFR-6 sub-test: second adapter substitutable)                             |
| NFR-7 | Replaceability: provider binding replaceable without kernel changes        | ✅ MET | src/kernel/adapter-spi.ts — pure boundary interface; T-RECOVER-1 (NFR-6 sub-test)            |
| NFR-8 | Least privilege: effective authority is intersection, never union (INV-2) | ✅ MET | src/kernel/spawn-contract.ts — `effectiveAuthority()` = Math.min; T-AUTH-1                      |
| NFR-11 | ≥90% kernel/lib coverage                                                    | ✅ MET | vitest.config.ts global thresholds; §2 coverage table (98.21% stmts / 91.77% branches)         |

---

## 5. New Kernel Modules (P2)

All new modules carry `@forge-trace` records (C-04/NFR-10) and are covered by
the NFR-11 ≥90% global threshold.

| component_id            | Path                           | Implements                                                                 | @forge-trace problems | heritage     |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------- | --------------------- | ------------ |
| `kernel-adapter-spi`    | `src/kernel/adapter-spi.ts`    | IF-01: five-verb boundary + IF-05 Enforcement Map                          | P02                   | K03, INV-7   |
| `kernel-run-state`      | `src/kernel/run-state.ts`      | FR-S3-1: RunState event-sourced; FR-K1-9: write-ahead                      | P95                   | K15          |
| `kernel-spawn-contract` | `src/kernel/spawn-contract.ts` | FR-K5-3: SpawnContract + effective authority = Identity ∩ contract         | P09                   | INV-2, INV-7 |
| `kernel-context-grant`  | `src/kernel/context-grant.ts`  | FR-K5-5: explicit ContextGrant, grants/revocations as K-1 events         | P09                   | INV-7        |
| `kernel-adoption-queue` | `src/kernel/adoption-queue.ts` | FR-K5-7: unmanaged spawns enter Adoption Queue, never auto-adopted         | P09                   | INV-7        |
| `kernel-routing`        | `src/kernel/routing.ts`        | FR-K5-2: routing evaluates domain × level × authority, limitations first  | P09                   | INV-2, INV-6 |
| `kernel-task-contract`  | `src/kernel/task-contract.ts`  | FR-K2-6: TaskContract enforcement gate before managed execution           | P01                   | K02          |

### Updated existing modules

| component_id            | Path                             | P2 change                                                              |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `kernel-contract-store` | `src/kernel/contract-store.ts`   | Added `createSpawnContract()`, `createContextGrant()` factory methods |
| `kernel-event-journal`  | (no source change)               | New event kinds registered via `allowedKinds` at composition time       |
| `kernel-policy-hooks`   | (no source change)               | `pre-tool` hook used by SpawnContract enforcement (FR-K5-4)            |

---

## 6. Event Kinds (new in P2, registered via `allowedKinds`)

All new K-1 event kinds match the `domain.action` regex
`/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/`:

| Kind                    | Emitted by              | Payload (key fields)                                       |
| ----------------------- | ----------------------- | ---------------------------------------------------------- |
| `runstate.transition`   | `kernel-run-state`      | `{instanceId, from, to, reason, taskId}`                   |
| `spawn.contract`        | `kernel-spawn-contract` | `{spawnContractId, identityId, grant, effectiveAuthority}` |
| `context.grant`         | `kernel-context-grant`  | `{grantId, granter, grantee, items, scope, ttl, reason}`   |
| `context.revoke`        | `kernel-context-grant`  | `{grantId, reason, revokedBy}`                             |
| `adoption.queued`       | `kernel-adoption-queue` | `{instanceId, source, observedAt}`                         |
| `adoption.adopted`      | `kernel-adoption-queue` | `{instanceId, candidateId, adoptedBy, reason}`             |
| `taskcontract.required` | `kernel-task-contract`  | `{taskId, reason: "no TaskContract"}`                      |
| `assumption.claim`      | `kernel-task-contract`  | `{taskId, text, confidence: 0}`                            |
| `adapter.launched`      | (integration test)      | `{instanceId, command, env}`                               |
| `adapter.interrupted`   | (integration test)      | `{instanceId, signal: pause\|resume\|cancel}`              |

The `journal.append_rejected` and `hook.evaluated` kinds from P1 remain.

---

## 7. CI Guards Update (P2-8 — pending)

`scripts/ci-guards.ts` `checkPlanesGate()` currently rejects ANY `.ts` file in
`src/planes/`. For P2, the S3 execution plane is in scope, so the gate must
allow P2-phase plane modules while still blocking planes that belong to later
phases.

**Change (planned):**

- Add a `P2_ALLOWED_PLANES` set (e.g. `['plane-execution']`).
- For each `.ts` in `src/planes/`, parse the `@forge-trace` `component_id`;
  allow if in the set, else fail C-03.
- C-02 (no network) and C-09 (dependency direction) already apply correctly:
  planes MAY import from kernel/lib, not cli. No change needed there.
- Traceability check (C-04/NFR-10) already applies to all non-exempt modules;
  plane modules must carry `@forge-trace`. No change needed.

**Status:** 🟡 PENDING — to be implemented in P2-8, then full CI re-run in P2-9.

---

## 8. Gate Readiness Checklist

- [x] All P2-tagged requirements implemented with traceability triples (§4)
- [x] Provocation tests green: T-BP1, T-RS, T-TC, T-AUTH, T-GRANT, T-ADOPT,
      T-ROUTE, T-RECOVER (§3)
- [x] End-to-end demo passes: contract → instance → events → forced kill →
      K-1 resume → manual closure (T-RECOVER-1)
- [x] Out-of-contract tool rejection verified (T-AUTH-1..2, FR-K5-3)
- [x] AC-BP1 (adapter five-verb conformance) verified (T-BP1-1..4)
- [x] CI green: lint, format, build, test:coverage ≥90% (pre-P2-8 run)
- [ ] CI guards updated for P2 plane allowlist (P2-8)
- [ ] Full CI re-run after P2-8 (P2-9)
- [x] REGISTRIES.md updated with new component IDs (P2-5)
- [x] P2-GATE.md written with traceability matrix + gate decision (this doc)
- [ ] Committed, pushed, PR updated (P2-10)

---

## 9. Gate Decision

**Status:** 🟡 PROVISIONAL GREEN — provocation tests and requirements are met;
CI guards update (P2-8) and final full CI run (P2-9) remain to close the gate.

The P2 kernel + continuity machinery is complete and provocation-verified.
The only remaining work is the CI guards plane-allowlist update (P2-8) and
the final full CI pipeline run (P2-9). Once those are green, this document
will be marked ✅ GREEN, committed, pushed, and PR #3 updated (P2-10).

> "A phase is green when its gate criteria are met AND the full CI pipeline
> is green." — FORGE-SRS-1.0 §4.1 (paraphrased)
