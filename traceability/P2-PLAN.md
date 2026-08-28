# FOrGE P2 Plan — Adapter + Continuity Phase

**Standard:** FORGE-SRS-1.0 §4.1 (phased rollout P0–P9), §5 (constraints), §6 (NFRs)
**Date:** 2026-08-28
**Status:** PLANNING — P1 gate is GREEN; this document defines the P2 work breakdown.

> "No phase starts while the previous gate is red." — FORGE-SRS-1.0 §4.1

P1 delivered the kernel foundation: K-1 Event Journal, K-2 Contract Store, K-4 Policy
Hooks (shadow-locked), K-5 Agent Registry (structure + CRUD), trust labels, storage
port, and the S7 CLI. P2 builds the **adapter boundary** (K-3 = BP-1) and the
**continuity machinery** (RunState event-sourcing, TaskContract enforcement, K-5
lifecycle) on top of that kernel.

---

## 1. P2 Requirement Scope

Requirements tagged `[P2]` in the SRS, plus P1-deferred items routed to P2.

### Interfaces (IF-series)

| ID    | Requirement (verbatim / condensed)                                                                                                                                                                                                                                          | Source line |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| IF-01 | The Adapter SPI (K-3 = BP-1) SHALL expose exactly five verbs: `launch(command, env)`, `send(ctx-pack)`, `events(stream)`, `interrupts(pause\|resume\|cancel)`, `artifacts(location)`; provider extensions are declared capabilities only and never required internal types. | 108         |
| IF-05 | Every external provider binding SHALL publish an Enforcement Map declaring in-band, out-of-band-compensated, and advisory enforcement, and each in-band/out-of-band claim SHALL be provocation-tested.                                                                      | 112         |

### Functional Requirements — Kernel

| ID      | Requirement (condensed)                                                                                                                                    | Source line |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FR-K1-9 | State transitions of governed runtimes SHALL be journaled before effect application (write-ahead); a crash mid-apply SHALL leave the prior declared state. | 127         |
| FR-K2-6 | A task SHALL NOT start managed execution without a TaskContract; remaining assumptions SHALL enter as Assumption claims at zero confidence.                | 138         |

### Functional Requirements — K-5 Agent Lifecycle

| ID      | Requirement (condensed)                                                                                                                                                                                                                 | Source line |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FR-K5-1 | (lifecycle portion) Manage durable AgentIdentity records through their lifecycle.                                                                                                                                                       | 156         |
| FR-K5-2 | Routing SHALL evaluate `domain × level × authority` and SHALL surface `known_limitations` before capability claims (INV-6).                                                                                                             | 157         |
| FR-K5-3 | Every managed spawn SHALL carry a SpawnContract; effective authority SHALL be `Identity authority ∩ contract grant` — nothing outside the intersection is authorized; `can_commit` defaults false; empty context grants = full privacy. | 158         |
| FR-K5-4 | SpawnContract enforcement SHALL be delivered to the adapter as operational constraints AND independently monitored by `pre-tool` hooks (the contract is not a trust document).                                                          | 159         |
| FR-K5-5 | Every ContextGrant SHALL be explicit: granter, grantee, items[{kind, locator, hash}], scope read-only/read-comment (never write), TTL, revocable, logged, reason required; grants and revocations SHALL be K-1 events.                  | 160         |
| FR-K5-7 | Instances spawned outside managed channels SHALL enter an Adoption Queue; they SHALL NOT be auto-adopted, auto-trusted, or silently destroyed; contents become Candidates.                                                              | 162         |

### Functional Requirements — S3 Execution Plane

| ID      | Requirement (condensed)                                                                                                                       | Source line |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FR-S3-1 | RunState SHALL be event-sourced from K-1 with declared states `QUEUED → RUNNING ⇄ SUSPENDED → INTERRUPTED → RECOVERING → (RESUMING → RUNNING) | ABORTED     | CLOSED`; rebuild on any crash SHALL be from the journal, never from a dead session's memory. | 169 |

### Non-Functional Requirements

| ID    | Requirement (condensed)                                                                                   | Source line |
| ----- | --------------------------------------------------------------------------------------------------------- | ----------- |
| NFR-5 | Recoverability: a crashed governed runtime SHALL be reconstructable from K-1 to its last journaled state. | 278         |
| NFR-6 | Continuity: no silent loss of declared state across crashes.                                              | 279         |
| NFR-7 | Replaceability: a provider binding is replaceable without kernel changes (DEC-32).                        | 280         |
| NFR-8 | Least privilege: effective authority is the intersection, never the union (INV-2).                        | 281         |

### P1-deferred items routed to P2

| Item                | Requirement                           | Routed from |
| ------------------- | ------------------------------------- | ----------- |
| FR-K2-6 enforcement | TaskContract before managed execution | P1-GATE §5  |
| FR-K5-1 lifecycle   | AgentIdentity lifecycle management    | P1-GATE §5  |

---

## 2. P2 Gate Criteria

From FORGE-SRS-1.0 §4.1 (line 334), the P2 gate requires:

1. **End-to-end task demo:** contract → instance → events → forced kill →
   K-1 resume → manual closure.
2. **Out-of-contract tool rejection:** a tool call outside the SpawnContract's
   declared capabilities is rejected.
3. **AC-BP1:** adapter five-verb conformance (drills manual).
4. **Full CI green:** lint, format, build, test:coverage (≥90% kernel/lib,
   NFR-11), ci-guards.

---

## 3. Module Structure (new files for P2)

All new modules carry `@forge-trace` records (C-04/NFR-10). Kernel modules are
covered by the NFR-11 ≥90% threshold. Plane modules are gated by C-03 (updated
for P2 — see §6).

### New kernel modules (`src/kernel/`)

| component_id            | Path                           | Implements                                                                 | Coverage |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------- | -------- |
| `kernel-adapter-spi`    | `src/kernel/adapter-spi.ts`    | IF-01: five-verb boundary interface + Enforcement Map type (IF-05)         | ≥90%     |
| `kernel-run-state`      | `src/kernel/run-state.ts`      | FR-S3-1: RunState event-sourced from K-1; FR-K1-9: write-ahead transitions | ≥90%     |
| `kernel-spawn-contract` | `src/kernel/spawn-contract.ts` | FR-K5-3: SpawnContract + effective authority = Identity ∩ contract         | ≥90%     |
| `kernel-context-grant`  | `src/kernel/context-grant.ts`  | FR-K5-5: explicit ContextGrant, grants/revocations as K-1 events           | ≥90%     |
| `kernel-adoption-queue` | `src/kernel/adoption-queue.ts` | FR-K5-7: unmanaged spawns enter Adoption Queue, never auto-adopted         | ≥90%     |
| `kernel-routing`        | `src/kernel/routing.ts`        | FR-K5-2: routing evaluates domain × level × authority, limitations first   | ≥90%     |
| `kernel-task-contract`  | `src/kernel/task-contract.ts`  | FR-K2-6: TaskContract enforcement gate before managed execution            | ≥90%     |

### New plane module (`src/planes/`)

| component_id      | Path                      | Implements                                                          | Coverage |
| ----------------- | ------------------------- | ------------------------------------------------------------------- | -------- |
| `plane-execution` | `src/planes/execution.ts` | S3 execution plane: orchestrates adapter verbs + RunState lifecycle | exempt*  |

\* Plane modules are excluded from coverage (vitest.config.ts excludes
`src/planes/**`), but MUST carry `@forge-trace` and pass C-02/C-09.

### Updated existing modules

| component_id            | Path                           | P2 change                                                               |
| ----------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `kernel-agent-registry` | `src/kernel/agent-registry.ts` | Add lifecycle methods: spawn authorization check, adoption queue wiring |
| `kernel-contract-store` | `src/kernel/contract-store.ts` | Add `createSpawnContract()`, `createContextGrant()` factory methods     |
| `kernel-event-journal`  | (no source change)             | Register new event kinds via `allowedKinds` option at composition time  |
| `kernel-policy-hooks`   | (no source change)             | `pre-tool` hook used by SpawnContract enforcement (FR-K5-4)             |
| `scripts/ci-guards`     | `scripts/ci-guards.ts`         | Update `checkPlanesGate()` to allow P2-phase plane modules (see §6)     |

---

## 4. Event Kinds (new, registered via `allowedKinds`)

New K-1 event kinds for P2 (all match the `domain.action` regex
`/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/`):

| Kind                    | Emitted by              | Payload (key fields)                                       |
| ----------------------- | ----------------------- | ---------------------------------------------------------- |
| `runstate.transition`   | `kernel-run-state`      | `{instanceId, from, to, reason, taskId}`                   |
| `spawn.contract`        | `kernel-spawn-contract` | `{spawnContractId, identityId, grant, effectiveAuthority}` |
| `context.grant`         | `kernel-context-grant`  | `{grantId, granter, grantee, items, scope, ttl, reason}`   |
| `context.revoke`        | `kernel-context-grant`  | `{grantId, reason, revokedBy}`                             |
| `adoption.queued`       | `kernel-adoption-queue` | `{instanceId, source, observedAt}`                         |
| `adoption.adopted`      | `kernel-adoption-queue` | `{instanceId, candidateId, adoptedBy, reason}`             |
| `taskcontract.required` | `kernel-task-contract`  | `{taskId, reason: "no TaskContract"}`                      |
| `adapter.launched`      | `plane-execution`       | `{instanceId, command, env}`                               |
| `adapter.interrupted`   | `plane-execution`       | `{instanceId, signal: pause\|resume\|cancel}`              |

The `journal.append_rejected` and `hook.evaluated` kinds from P1 remain.

---

## 5. Task Breakdown (provocation-first, C-07)

Each task writes provocation/attack tests FIRST (must fail before impl, pass
after), then implements, then verifies CI.

### Task P2-2: Adapter SPI (K-3 = BP-1)

**Requirements:** IF-01, IF-05, NFR-7, AC-BP1
**Heritage:** K03, INV-7
**Decisions:** DEC-01, DEC-32
**BP/AC:** BP-1, AC-BP1

**Provocation tests (write first):**

- `T-BP1-1`: An adapter implementation exposing a sixth verb (e.g. `restart`)
  is rejected by the SPI conformance check.
- `T-BP1-2`: An adapter implementation omitting one of the five verbs is
  rejected.
- `T-BP1-3`: An Enforcement Map missing the `out-of-band-compensated` tier for
  an in-band-claimed control is rejected (IF-05 completeness).
- `T-BP1-4`: A provider extension that introduces a _required_ internal type
  (not a declared capability) is rejected (IF-01: "never required internal
  types").

**Implementation:**

- `AdapterSpi` interface: exactly five verbs with typed signatures.
- `EnforcementMap` type: `{ control, inBand, outOfBandCompensated, advisory }[]`.
- `assertAdapterConformance(impl)`: validates exactly five verbs, no more, no
  less; validates Enforcement Map completeness.
- No network imports (C-02 applies to kernel). The SPI is a pure boundary
  contract; concrete provider bindings (BP-2…BP-11) are P3+.

### Task P2-3: RunState event-sourced (FR-S3-1, FR-K1-9, NFR-5, NFR-6)

**Requirements:** FR-S3-1, FR-K1-9, NFR-5, NFR-6
**Heritage:** K15
**Decisions:** DEC-25
**BP/AC:** —

**Provocation tests (write first):**

- `T-RS-1`: A transition to an undeclared state (e.g. `PAUSED`) is rejected.
- `T-RS-2`: A transition that skips the write-ahead journal step (tries to
  apply effect before journaling) is detected — the state machine refuses to
  apply without a prior `runstate.transition` event.
- `T-RS-3`: After a forced kill (simulated by dropping the in-memory state and
  reconstructing from K-1), the RunState matches the last journaled state, NOT
  any unjournaled intermediate (NFR-5/NFR-6).
- `T-RS-4`: An illegal transition (e.g. `CLOSED → RUNNING`) is rejected.

**Implementation:**

- `RUN_STATES` const tuple: `QUEUED, RUNNING, SUSPENDED, INTERRUPTED,
RECOVERING, RESUMING, ABORTED, CLOSED`.
- `RunState` class: wraps an `EventJournal`, reconstructs via `replay()` fold
  over `runstate.transition` events.
- `transition(instanceId, to, reason)`: journals `runstate.transition` BEFORE
  updating the in-memory state (write-ahead, FR-K1-9). On crash, the journal
  holds the declared state; the in-memory state is disposable.
- `reconstruct(instanceId)`: replays from K-1 to rebuild state (NFR-5).
- Legal transition table enforced (FR-S3-1 state diagram).

### Task P2-4: TaskContract enforcement (FR-K2-6, AC-BP10)

**Requirements:** FR-K2-6, AC-BP10
**Heritage:** K02
**Decisions:** DEC-01
**BP/AC:** AC-BP10

**Provocation tests (write first):**

- `T-TC-1`: An attempt to start managed execution without a TaskContract is
  rejected and journals `taskcontract.required` (exit posture: fail-closed).
- `T-TC-2`: A task with a TaskContract but unrecorded assumptions is accepted,
  but the assumptions enter as Assumption claims at zero confidence (FR-K2-6
  second clause).

**Implementation:**

- `TaskContractGate`: `requireContract(taskId, contracts)` — returns
  `{ok, contract}` or `{ok: false, reason}`.
- `createTaskContract()` factory in ContractStore (frontmatter artifactType
  `TaskContract`).
- Composition: `plane-execution` calls `TaskContractGate` before invoking
  `adapter.launch()`.

### Task P2-5: K-5 lifecycle (FR-K5-2/3/4/5/7, NFR-8)

**Requirements:** FR-K5-2, FR-K5-3, FR-K5-4, FR-K5-5, FR-K5-7, NFR-8
**Heritage:** INV-2, INV-6, INV-7
**Decisions:** DEC-02, DEC-03, DEC-32, DEC-33
**BP/AC:** —

**Provocation tests (write first):**

- `T-AUTH-1` (authority-escalation via derivation): an identity with
  `authorityClass = OBSERVER` and a SpawnContract granting `COMMITTER` results
  in effective authority `OBSERVER` (intersection), NOT `COMMITTER`. Escalation
  via contract is impossible (INV-2, NFR-8).
- `T-AUTH-2`: `can_commit` defaults false — a SpawnContract without explicit
  `can_commit: true` does not authorize commits.
- `T-GRANT-1`: A ContextGrant with `scope: 'write'` is rejected (FR-K5-5:
  read-only/read-comment, never write).
- `T-GRANT-2`: A ContextGrant without a `reason` is rejected.
- `T-ADOPT-1` (unmanaged spawn auto-adopt rejection): an instance entering the
  Adoption Queue is NOT auto-adopted, NOT auto-trusted, and NOT silently
  destroyed. A provocation that asserts auto-adoption fails.
- `T-ROUTE-1`: routing surfaces `known_limitations` BEFORE capability claims
  (INV-6) — a candidate with limitations is not presented as unlimited.

**Implementation:**

- `kernel-spawn-contract`:
  - `SpawnContract` schema (artifactType already in `ARTIFACT_TYPES`).
  - `effectiveAuthority(identity, contract)` = intersection of identity
    `authorityClass` and contract grant (INV-2). `canCommit` defaults false.
  - Empty context grants = full privacy (FR-K5-3 last clause).
- `kernel-context-grant`:
  - `ContextGrant` schema with `scope ∈ {read-only, read-comment}` (never
    write), TTL, revocable, reason required.
  - `grant()` and `revoke()` journal `context.grant` / `context.revoke` as
    K-1 events (FR-K5-5).
- `kernel-adoption-queue`:
  - `AdoptionQueue`: `enqueue(instance)`, `listCandidates()`, `adopt(id, by,
reason)` (manual only). No auto-adopt, no auto-trust, no silent destroy
    (FR-K5-7).
- `kernel-routing`:
  - `route(candidates, taskDomain, taskLevel, requiredAuthority)`:
    evaluates `domain × level × authority`, sorts `known_limitations` before
    capability claims (INV-6).
- `kernel-spawn-contract` enforcement is delivered to the adapter as
  operational constraints AND monitored by `pre-tool` hooks (FR-K5-4): the
  contract is not a trust document.

### Task P2-6: Recoverability demo (NFR-5, NFR-6)

**Requirements:** NFR-5, NFR-6
**This is the integration test for the P2 gate criterion #1.**

**Test (end-to-end):**

- `T-RECOVER-1`: contract → instance (adapter.launch) → events (runstate
  transitions journaled) → forced kill (drop in-memory state) → K-1 resume
  (reconstruct RunState from journal) → manual closure (CLOSED). Asserts the
  resumed state matches the last journaled state and closure completes.

### Task P2-7: Provocation test consolidation

All provocation tests from P2-2…P2-6 are written FIRST (C-07). This task
ensures they are collected, named, and referenced in the P2 gate document.

| Provocation  | Target                                 | Task |
| ------------ | -------------------------------------- | ---- |
| T-BP1-1..4   | Adapter five-verb conformance          | P2-2 |
| T-RS-1..4    | RunState declared states + write-ahead | P2-3 |
| T-TC-1..2    | TaskContract before managed execution  | P2-4 |
| T-AUTH-1..2  | Authority = identity ∩ contract        | P2-5 |
| T-GRANT-1..2 | ContextGrant scope/reason              | P2-5 |
| T-ADOPT-1    | Unmanaged spawn not auto-adopted       | P2-5 |
| T-ROUTE-1    | Limitations before capability claims   | P2-5 |
| T-RECOVER-1  | End-to-end crash recovery              | P2-6 |

---

## 6. CI Guards Update (Task P2-8)

`scripts/ci-guards.ts` `checkPlanesGate()` currently rejects ANY `.ts` file in
`src/planes/`. For P2, the S3 execution plane is in scope, so the gate must
allow P2-phase plane modules while still blocking planes that belong to later
phases.

**Change:** Replace the blanket rejection with a phase-allowlist check. A
plane module is allowed if its `@forge-trace` record declares a P2 (or
earlier) phase, OR if it is listed in an explicit P2 allowlist in the guard
script. Planes not on the allowlist are rejected with the same C-03 message.

Concretely:

- Add a `P2_ALLOWED_PLANES` set (e.g. `['plane-execution']`).
- For each `.ts` in `src/planes/`, parse the `@forge-trace` `component_id`;
  allow if in the set, else fail C-03.
- C-02 (no network) and C-09 (dependency direction) already apply correctly:
  planes MAY import from kernel/lib, not cli. No change needed there.
- Traceability check (C-04/NFR-10) already applies to all non-exempt modules;
  plane modules must carry `@forge-trace`. No change needed.

---

## 7. Traceability Mappings (for `@forge-trace` records)

New component IDs to register (REGISTRIES.md will be updated at P2 gate):

| component_id            | problems | heritage     | decisions      | bp_ids | ac_ids  |
| ----------------------- | -------- | ------------ | -------------- | ------ | ------- |
| `kernel-adapter-spi`    | P02      | K03, INV-7   | DEC-01, DEC-32 | BP-1   | AC-BP1  |
| `kernel-run-state`      | P95      | K15          | DEC-25         |        |         |
| `kernel-spawn-contract` | P09      | INV-2, INV-7 | DEC-02, DEC-32 |        |         |
| `kernel-context-grant`  | P09      | INV-7        | DEC-03         |        |         |
| `kernel-adoption-queue` | P09      | INV-7        | DEC-32, DEC-33 |        |         |
| `kernel-routing`        | P09      | INV-2, INV-6 | DEC-02         |        |         |
| `kernel-task-contract`  | P01      | K02          | DEC-01         |        | AC-BP10 |
| `plane-execution`       | P02, P95 | K03, K15     | DEC-25, DEC-32 | BP-1   | AC-BP1  |

---

## 8. Execution Order

```
P2-2 (Adapter SPI)        ──┐
P2-3 (RunState)           ──┼── P2-5 (K-5 lifecycle) ──┐
P2-4 (TaskContract)       ──┘                          ├── P2-6 (recover demo) ── P2-8 (CI guards) ── P2-9 (full CI) ── P2-10 (gate)
P2-7 (provocation-first) ──── written before each impl ┘
```

Provocation tests (P2-7) are written **before** each implementation task, per
C-07. The dependencies are: P2-5 depends on P2-2/3/4 (it uses the adapter SPI,
RunState, and TaskContract). P2-6 is the integration demo depending on all.
P2-8 unblocks the plane module in CI. P2-9 is the full pipeline. P2-10 is the
gate document and commit/push/PR.

---

## 9. Out of Scope (deferred to P3+)

| Item                                  | Target |
| ------------------------------------- | ------ |
| Concrete provider bindings BP-2…BP-11 | P3+    |
| Trust label enforcement on claims     | P3     |
| Enforcement flips (shadow→enforce)    | P8     |
| Experience ledger writes (FR-K5-6)    | P5/P7  |
| Agent-to-agent exchange (FR-K5-8)     | P5     |
| NFR-9 production benchmarking         | Gate   |

---

## 10. Gate Readiness Checklist

- [ ] All P2-tagged requirements implemented with traceability triples
- [ ] Provocation tests green (T-BP1, T-RS, T-TC, T-AUTH, T-GRANT, T-ADOPT,
      T-ROUTE, T-RECOVER)
- [ ] End-to-end demo passes: contract → instance → events → forced kill →
      K-1 resume → manual closure
- [ ] Out-of-contract tool rejection verified
- [ ] AC-BP1 (adapter five-verb conformance) verified
- [ ] CI green: lint, format, build, test:coverage ≥90%, ci-guards
- [ ] REGISTRIES.md updated with new component IDs
- [ ] P2-GATE.md written with traceability matrix + gate decision
- [ ] Committed, pushed, PR updated
