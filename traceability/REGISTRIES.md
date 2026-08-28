# FOrGE Traceability Registries

**Standard:** FORGE-SRS-1.0 §3.1 (C-04), §5, NFR-10
**Purpose:** Machine-checkable traceability records for every implementation module. CI (`scripts/ci-guards.ts`) validates each module's `@forge-trace` record against these registries.

Every module under `src/` (except `src/cli/index.ts`, the composition root) MUST carry a header block:

```ts
/**
 * @forge-trace {"component_id":"...","problems":[],"heritage":[],"decisions":[],"bp_ids":[],"ac_ids":[]}
 */
```

---

## Component IDs (component_id)

Format: `<kernel|lib|cli|plane>-<name>`

| component_id           | Path                          | Phase | Summary                                                             |
| ---------------------- | ----------------------------- | ----- | ------------------------------------------------------------------- |
| kernel-canonical-json  | src/kernel/canonical-json.ts  | P1    | Fixed canonical JSON algorithm (sorted keys, no whitespace, UTF-8)  |
| kernel-event-journal   | src/kernel/event-journal.ts   | P1    | K-1 append-only content-addressed event journal                     |
| kernel-contract-store  | src/kernel/contract-store.ts  | P1    | K-2 typed Tier-A artifact store                                     |
| kernel-policy-hooks    | src/kernel/policy-hooks.ts    | P1    | K-4 five hook points, shadow-locked                                 |
| kernel-adapter-spi     | src/kernel/adapter-spi.ts     | P2    | K-3 Adapter SPI (BP-1): five verbs + Enforcement Map (IF-01/IF-05)  |
| kernel-run-state       | src/kernel/run-state.ts       | P2    | K-15 RunState event-sourced from K-1, write-ahead (FR-S3-1/FR-K1-9) |
| kernel-agent-registry  | src/kernel/agent-registry.ts  | P1    | K-5 durable AgentIdentity records (structure)                       |
| kernel-trust-label     | src/kernel/trust-label.ts     | P1    | Trust label computation (weakest-of) — DEC-42.1                     |
| kernel-storage-port    | src/kernel/storage-port.ts    | P1    | Storage abstraction (better-sqlite3 behind port)                    |
| kernel-storage-memory  | src/kernel/storage-memory.ts  | P1    | In-memory JournalStorage (tests + reference impl)                   |
| kernel-schema-registry | src/kernel/schema-registry.ts | P1    | Event kind + artifact type schema registration                      |
| lib-ulid               | src/lib/ulid.ts               | P1    | ULID generation (C-01)                                              |
| lib-hash               | src/lib/hash.ts               | P1    | SHA-256 hashing helpers                                             |
| lib-secret-patterns    | src/lib/secret-patterns.ts    | P1    | Secret pattern set for FR-K1-7                                      |
| cli-commands           | src/cli/commands.ts           | P1    | S7 CLI command implementations                                      |
| cli-index              | src/cli/index.ts              | P1    | CLI entrypoint (composition root, exempt from trace)                |

---

## Problem IDs (problems[])

Problems are the FORGE-MASTER-2.0 problem register (P01…P100). Key P1 mappings:

| Problem | Title                                       | P1 relevance             |
| ------- | ------------------------------------------- | ------------------------ |
| P01     | Task contracts before execution             | FR-K2-6                  |
| P02     | Adapter five-verb boundary                  | IF-01 (P2, schema P1)    |
| P03     | Context composer labeled context            | FR-S4-14 (P3, schema P1) |
| P05     | Evidence-bundle-gated closure               | FR-S4-23 (P6, schema P1) |
| P07     | Dependency gate                             | FR-SEC-2 (P8, event P1)  |
| P08     | Journal integrity                           | FR-K1                    |
| P09     | Scoped grants, no ambient permissions       | FR-K5-3/5, NFR-8         |
| P10     | Trust labels gate critical actions          | FR-SEC-1                 |
| P11     | Test authorship downgrades evidence         | FR-S4-20 (schema P1)     |
| P13     | Stop conditions                             | FR-GOV-1 (schema P1)     |
| P18     | Deterministic staleness, zero model calls   | FR-S4-5                  |
| P19     | Stale claims surface lazily                 | FR-S4-5/14               |
| P22     | Decision records with rejected alternatives | FR-K2-7                  |
| P23     | Claims govern cross-layer truth             | FR-S4-1                  |
| P30     | Policy as data, no code-authored rules      | FR-K4-2, C-11            |
| P49     | WorkLease prevents intent collision         | FR-S3-5 (schema P1)      |
| P55-57  | Skills registry, no fork                    | FR-S4-15 (schema P1)     |
| P61     | Injection scan at skill ingestion           | FR-S4-8/18               |
| P63     | Eight knowledge types, authority order      | FR-S4-10 (schema P1)     |
| P65     | Conflict resolution, no newer-wins          | FR-S4-11 (schema P1)     |
| P66     | Forgetting policy-driven, no silent delete  | FR-S4-13 (schema P1)     |
| P67     | Anti-bleed scope promotion                  | FR-S4-12 (schema P1)     |
| P68     | Poisoning containment at intake floor       | FR-S4-2, FR-LAUND        |
| P74     | Hash chain integrity                        | FR-K1-2, NFR-1           |
| P76     | Nine verification tiers, risk-weighted      | FR-S4-19 (schema P1)     |
| P78     | Evidence-bound progress                     | FR-S3-4 (schema P1)      |
| P82     | Tool gate, checksum monitoring              | FR-SEC-3 (event P1)      |
| P83     | Secret shield pre-journal                   | FR-K1-7, FR-SEC-4        |
| P84/86  | Egress governance                           | FR-SEC-5 (event P1)      |
| P89     | No network in kernel/lib                    | C-02                     |
| P90     | Human-always immutable                      | FR-K2-8, C-10            |
| P91     | Oversight economy                           | FR-GOV-2 (schema P1)     |
| P92     | Stop-condition engine                       | FR-GOV-1 (schema P1)     |
| P93     | Audit service pure query over K-1           | FR-GOV-4                 |
| P95     | RunState event-sourced                      | FR-S3-1 (schema P1)      |
| P97     | Repeated failure diagnosis                  | FR-S3-3 (schema P1)      |
| P98     | Replay/fold over journal                    | FR-K1-6                  |

---

## Heritage (heritage[])

Architecture/engineering elements (K01…K15, E01…E04, A01…A13, INV-1…8, R1…R5):

| Heritage | Name                                  |
| -------- | ------------------------------------- |
| K01      | Event Journal                         |
| K02      | Contract Store                        |
| K03      | Adapter SPI                           |
| K04      | Human-readable artifacts              |
| K05      | Content-addressed integrity           |
| K06      | Claims                                |
| K07      | Versioned artifacts                   |
| K08      | Decision records                      |
| K09      | Skills registry                       |
| K11      | Skill lifecycle                       |
| K13      | Human-always classes                  |
| K14      | Security gates                        |
| K15      | RunState                              |
| E01      | Claims & Evidence engine              |
| E02      | Enforcement engine                    |
| E03      | Verification orchestrator             |
| E04      | Evaluation harness                    |
| INV-2    | Authority = identity ∩ contract       |
| INV-3    | Subagents bound by human-always       |
| INV-4    | Monotonic versioning                  |
| INV-5    | Symmetric binding (Owner & assistant) |
| INV-6    | Limitations before capability claims  |
| INV-7    | No side channels                      |
| R1       | Dependency direction                  |
| R4       | Event law                             |
| R5       | Fail-closed/fail-open posture         |

---

## Decisions (decisions[])

DEC-01…DEC-42 from FORGE-MASTER-2.0 §13. Key P1 decisions:

| Decision | Title                                          |
| -------- | ---------------------------------------------- |
| DEC-01   | Kernel K-1…K-5 + five hook points              |
| DEC-02   | Agent identity (durable, scoped)               |
| DEC-03   | Context grants explicit                        |
| DEC-05   | content/ Tier-A data only                      |
| DEC-12   | Closed dependency list + AU-08 amendment       |
| DEC-22   | Traceability triples (C-04)                    |
| DEC-25   | Event-sourced RunState, write-ahead            |
| DEC-27   | Claims govern truth, no direct Tier-B citation |
| DEC-28   | Evidence-bundle-gated closure                  |
| DEC-30   | Policy as data, dual-key edits                 |
| DEC-35   | Shadow→enforce per action class                |
| DEC-41   | FOrGE name, closed stack                       |
| DEC-42   | Trust-laundering defense (T-LAUND)             |

---

## Bind Point IDs (bp_ids[])

| BP         | Name                             |
| ---------- | -------------------------------- |
| BP-1       | Adapter SPI (K-3)                |
| BP-2…BP-11 | External provider bindings (P2+) |

P1 touches BP-1 only at the schema level (IF-01).

---

## Acceptance Criteria IDs (ac_ids[])

| AC      | Name                                                 |
| ------- | ---------------------------------------------------- |
| AC-P01  | Human-readable artifacts inspectable in plain editor |
| AC-BP1  | Adapter five-verb conformance (P2)                   |
| AC-BP3  | Grounding provider deterministic staleness (P3)      |
| AC-BP7  | Stateless runners, one result (P6)                   |
| AC-BP9  | Orchestrator governance-blind (P5)                   |
| AC-BP10 | Task contract before managed execution (P2/P3)       |
| AC-P03  | PKP import no authority upgrade (P3)                 |
| AC-P06  | Broken skill caught (P4)                             |
| AC-P07  | Proposal without evidence fails review (continuous)  |

---

## Verification Tags

Each requirement carries `[phase] (trace: problems; decisions)`. The `@forge-trace` record in each module must list every problem/decision/heritage/bp/ac that the module implements or touches. CI rejects incomplete triples (C-04).
