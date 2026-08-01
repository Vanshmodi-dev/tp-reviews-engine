# Part 9 — Extensibility Preparation

*Sections 51 through 53. Audience: the architect and every engineer tempted to build one more useful thing. This part specifies exactly how much of the future v1.0 builds: **the seam, and nothing behind it.** TRD rule A-10 is binding — sections §76–§91 of the TRD exist so that v1.0's seams are correct, not so that v1.0 builds them.*

---

## The Governing Rule

> **EP-12 — Leave the seam, don't build the future.**

| What v1.0 Builds | What v1.0 Does Not Build |
|---|---|
| An interface file in `ports/` | Any second implementation of it beyond what v1.0 needs |
| A contract test suite that a future implementation must pass | The future implementation |
| A dispatcher with a `noop` default | Any non-`noop` behaviour |
| A path template in one module | A second storage backend |
| A capability descriptor honestly declaring what an adapter cannot do | Adapters for sources v1.0 does not serve |

**The test for whether something is a seam or future work:** a seam has no behaviour. If it does anything at runtime beyond routing or declaring, it is future work and belongs to a later version.

---

# 51. Future API Layer Preparation

**Phases PH-07, PH-08 · Sprints SP-3 · Difficulty D2 · counted within those phases**

| Field | Value |
|---|---|
| **Purpose** | Ensure that a future REST/GraphQL API, dashboard, portal, or database can be added without changing the engine's core — by making the publication and state boundaries genuine interfaces in v1.0. |
| **Objectives** | (1) `PublisherPort` and `StatePort` are real interfaces with two implementations each at some point in v1.0. (2) Path construction confined to one module per store. (3) The payload contract is versioned and treated as public. (4) Health and manifest data are schema-governed, so a future dashboard has a stable source. (5) No API code is written. |
| **Dependencies** | PH-07 (ports), PH-08 (first implementations) |
| **Estimated Complexity** | **D2** — the discipline, not the code |
| **Estimated Time** | 0 additional IEH; this is a constraint on how PH-07/PH-08 are built, not extra work |
| **Risks** | A port with exactly one implementation forever, which is a rename rather than an interface · path strings assembled at call sites, so a future backend has to find and change forty of them · treating the payload as internal, so a future consumer is broken by a "harmless" field change |

## 51.1 The Four Seams That Must Be Correct

| Seam | Interface | v1.0 Implementations | Future Consumers |
|---|---|---|---|
| **Publication** | `PublisherPort` | `git-data`, `filesystem` | Object storage (v3), REST API (v3), webhooks (v2) |
| **State** | `StatePort` | `git-state` (+ temp-dir doubles in tests) | Database (v2, TRD §87), Redis cache (v2, TRD §88) |
| **Notification** | `NotifierPort` | `github-issues`, `webhook`, `console` | Any alerting target |
| **Public data contract** | `payload.v1.schema.json` | — | Dashboard (v2), portal (v2), analytics (v2), any client site |

| ID | Requirement |
|---|---|
| API-PREP-01 | `PublisherPort` and `NotifierPort` MUST have **at least two** implementations in v1.0. Two is the minimum number at which an interface is validated rather than described (the same argument as X-8 for adapters). |
| API-PREP-02 | Path templates MUST be constructed in exactly one module per store (TR-STD-110). This single rule is what makes a future storage backend a one-file change. |
| API-PREP-03 | The payload schema MUST be treated as a **public contract** from the first publication: additive changes only within `schema_version: 1`; a breaking change requires a parallel-publish plan (REL-07). |
| API-PREP-04 | Health records and run manifests MUST be schema-governed, because a future dashboard's data source is exactly these two files and an unschema'd stream cannot be consumed safely. |

## 51.2 What Is Explicitly Not Built

| Not Built | TRD § | Why the Seam Is Enough |
|---|---|---|
| REST API | §84 | The payload is already a static JSON contract; an API in front of it adds a server to operate, which CON-08 forbids for v1 |
| GraphQL API | §85 | Same, plus a schema layer with no consumer |
| Webhooks | §86 | `NotifierPort` + the `webhook` implementation already exist for alerting; payload webhooks need a subscriber, and there is none |
| Dashboard / admin panel / client portal | §81–§83 | All three read health and manifest data, which v1.0 produces in schema-governed form |
| Database / Redis | §87–§88 | `StatePort` is the seam; Git is the v1.0 implementation and it is sufficient at the planned scale |
| Docker / Kubernetes / multi-region | §89–§91 | There is no persistent process to containerise |

## 51.3 Acceptance / Exit / Verification

| Field | Content |
|---|---|
| **Acceptance** | Each of the four seams has an interface file with documentation and no behaviour; two implementations exist for publisher and notifier; path construction is centralised |
| **Exit** | Architecture test asserts `ports/` contains no executable behaviour; a code search confirms no path string is assembled outside its store module; `schemas/README.md` states the versioning and compatibility policy |
| **Verification** | Reviewer attempts a thought experiment: "what files change if state moves to a database?" The answer must be one adapter file plus its tests. If it is more, the seam is wrong |
| **Documentation** | `ports/` README describing each interface and its intended future implementations |
| **Future** | Everything in TRD §76–§91, in the order the roadmap sets |

---

# 52. Adapter Layer Preparation

**Phases PH-11 (CSV), PH-16 (DOM), PH-22 (two APIs) · Sprints SP-4, SP-5, SP-7 · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Prove that acquisition is genuinely source-agnostic by shipping four materially different adapters against **one** contract suite, so that losing a source is a configuration change rather than a project. |
| **Objectives** | (1) `AcquisitionPort` defined before any adapter. (2) Capability descriptors declared honestly. (3) One contract suite executed against all four adapters. (4) Cross-adapter identity proven (PT-08). (5) Static registration in the composition root. (6) Adapters never import each other. (7) A migration drill completed under one hour. |
| **Dependencies** | PH-07 (port), PH-11, PH-16, PH-22 |
| **Estimated Complexity** | **D3** |
| **Estimated Time** | 24 IEH (PH-11) + 40 IEH (PH-22); DOM adapter counted in Part 5 |
| **Risks** | **IR-23 — the CSV adapter deferred**, so the interface is never validated against a second implementation (rated `High` impact) · an adapter fabricating fields it cannot supply, which silently corrupts data for every consumer · a "helpful" fallback from an API adapter to the DOM adapter when a secret is missing — a policy violation arising from a trivial operational event (TR-SEC-010) · dynamic adapter loading, which makes the dependency graph unanalysable |

## 52.1 Why Four Adapters in v1.0

The TRD is explicit: *"Running one suite against four genuinely different adapters is what validates the abstraction. An interface tested against a single implementation is not an interface, it is a rename."*

| Adapter | Materially Different Because | Built In |
|---|---|---|
| `file:csv` | No network, no auth, per-row error isolation, complete data | PH-11 |
| `google:dom` | Browser, pagination, challenge risk, reduced capabilities | PH-16 |
| `google:places-api` | HTTP, API key, quota accounting, **~5 reviews only** | PH-22 |
| `google:business-profile-api` | OAuth refresh, per-client secrets, paginated, complete | PH-22 |

**The Places adapter's five-review ceiling is why capability descriptors exist.** An adapter that declares reduced capability honestly lets the validator and gate reason about coverage correctly; one that pretends to be complete makes every downstream safety rule wrong.

## 52.2 The Contract Suite

One suite, nine assertions, four adapters (TRD §61.6). Written **in PH-11** against the CSV adapter, then applied unchanged to each subsequent adapter.

| # | Assertion |
|---|---|
| 1 | `capabilities()` returns a valid descriptor naming supported fields |
| 2 | `resolve()` returns a `ResolvedListing` or a classified error, **never throws raw** |
| 3 | `acquire()` respects the supplied budget and aborts cleanly when exceeded |
| 4 | `acquire()` returns an `AcquisitionReport` with counts, stop reason, and timings |
| 5 | The adapter never writes to the ledger or payload |
| 6 | **Missing required secret ⇒ fail closed, never a silent downgrade** (API adapters) |
| 7 | Fields the adapter cannot supply are `null`, **never fabricated** |
| 8 | Errors are drawn from the canonical taxonomy |
| 9 | Reviews reconcile with reviews from another adapter for the same logical review (paired with PT-08) |

| ID | Requirement |
|---|---|
| ADP-01 | The contract suite MUST be written in PH-11, before the DOM adapter exists. A suite written after the DOM adapter will encode DOM assumptions. |
| ADP-02 | Adding a fifth adapter (TRD §76–§79) MUST mean **running the same suite**, not writing a new one (TR-TEST-060). |
| ADP-03 | Adapters MUST be statically registered in the composition root (EDR-038). Dynamic loading defeats the architecture test and makes the dependency graph unanalysable. |
| ADP-04 | An adapter whose required secret is missing MUST raise `ERR-CONFIG-SECRET-MISSING` and exit 2. It MUST NOT fall back to the DOM adapter (TR-SEC-010, SEC-4). |
| ADP-05 | Adapters MUST NOT import each other (DR-3). The Places adapter borrowing a mapping helper from the DOM adapter is the specific violation named in the TRD. |

## 52.3 The Migration Drill

RISK-03 (ToS enforcement) has a designed contingency: migrate a client from `google:dom` to an official API adapter. **A contingency that has never been executed is not a contingency.**

| Drill Step | Target Time |
|---|---|
| 1 · Create a scratch client on `google:dom` with a small ledger | 10 min |
| 2 · Obtain/simulate the API credential | 10 min |
| 3 · Change one config line: `adapter` | 1 min |
| 4 · Run a harvest | 5 min |
| 5 · **Verify identity hashes match** — no review appears as new | 10 min |
| 6 · Verify the payload is unchanged or improved | 10 min |
| **Total** | **< 1 hour** (TRD §64.2 step 16) |

**Step 5 is the whole point** and is what PT-08 proves in the abstract. The drill proves it in practice, and it is scheduled in SP-7 as a named task.

## 52.4 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-194 `ports/acquisition.mjs` · DEL-195 `core/model/capabilities.mjs` · DEL-196 `adapters/acquisition/file-csv/*` + `COLUMNS.md` · DEL-197 `google-places-api/*` · DEL-198 `google-business-profile-api/*` · DEL-199 `tests/contract/acquisition-adapter.contract.test.mjs` · DEL-200 migration drill record |
| **Acceptance** | All four adapters pass the same suite; capabilities honest; fail-closed on missing secrets; no cross-adapter imports; static registration |
| **Exit** | Contract suite green × 4; **PT-08 green against real output from all four**; migration drill completed under one hour with identity hashes matching; DR-3 architecture test green |

## 52.5 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Any adapter can be disabled by configuration (INV-10). Losing one adapter is a config change per client, which is the entire architectural bet — and the drill is what proves the bet pays |
| **Verification** | Reviewer runs the contract suite against each adapter separately and confirms nine assertions each; removes an API secret and confirms exit 2 with no DOM fallback |
| **Testing** | Contract × 4 · Property PT-08 · Unit: capability descriptors, CSV per-row isolation, OAuth refresh failure |
| **Documentation** | `file-csv/COLUMNS.md` (the column contract); the capability descriptor reference; the migration procedure (TRD §15.7.1) |
| **Future** | Facebook, JustDial, Trustpilot adapters (v2, TRD §77–§79) — each is "implement the port, run the suite" |

---

# 53. Plugin System Preparation

**Phases PH-07, PH-17 · Sprint SP-3, SP-6 · Difficulty D2**

| Field | Value |
|---|---|
| **Purpose** | Establish the one extension point v1.0 needs — enrichment — as a dispatcher with a deterministic no-op default, so that AI analysis, sentiment, or topic extraction can be added later without touching the pipeline. |
| **Objectives** | (1) `app/enrich/index.mjs` dispatcher. (2) `app/enrich/noop.mjs` doing nothing, deterministically. (3) Stage 7 wired into the orchestrator as always-optional. (4) Enrichment failure never fails a target. (5) No plugin loading mechanism is built. |
| **Dependencies** | PH-07, PH-17 |
| **Estimated Complexity** | **D2** |
| **Estimated Time** | 6 IEH |
| **Risks** | A plugin loader built "since we're here", introducing dynamic `import()` of a path built from configuration — a prohibited pattern (TRD §67.3) and an injection vector · enrichment failure propagating and failing a target · enrichment mutating records rather than annotating them, which would break projection determinism (PT-12) |

## 53.1 The Extension Point

| Property | v1.0 Value | Reason |
|---|---|---|
| Stage | 7, between Reconcile and Project | Enrichment annotates durable records, so it runs after reconciliation and before projection |
| Purity | impure (may call a network service in future) | Which is why it is **outside** `core/` |
| Failure semantics | **Always optional** — a failure is logged and the pipeline continues | An optional stage that can fail a target is not optional |
| v1.0 implementation | `noop`, deterministic identity | Zero behaviour, full seam |
| Registration | Static, in the composition root | EDR-038; no dynamic loading |

| ID | Requirement |
|---|---|
| PLG-01 | v1.0 MUST NOT implement a plugin discovery or loading mechanism. Dynamic `import()` of a path built from input is a prohibited pattern (TRD §67.3). |
| PLG-02 | Enrichment MUST annotate, never mutate. A mutation would make projection non-deterministic for the same ledger, breaking PT-12 and therefore hash-gating. |
| PLG-03 | An enrichment failure MUST NOT fail the target, and MUST be recorded in the health record so that a persistently failing enricher is visible. |
| PLG-04 | The `noop` implementation MUST be **tested** — it is the identity function, and asserting that it changes nothing is what proves the stage is wired correctly. |

## 53.2 Why This Is the Only Extension Point

Every other variability in the system is already handled by a mechanism that is not a plugin:

| Variability | Handled By |
|---|---|
| Different sources | Adapters (§52) |
| Different storage | Ports (§51) |
| Different alerting | Notifier implementations |
| Different markup | Selector packs — **data, not code** |
| Different client behaviour | Configuration — never a code path (CON-04) |
| Different thresholds | Configuration with named defaults |

**A plugin system would be a seventh mechanism for variability that six mechanisms already cover.** Its only genuine gap is enrichment, which is why enrichment is the only one built.

## 53.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-201 `app/enrich/index.mjs` · DEL-202 `app/enrich/noop.mjs` · DEL-203 stage-7 wiring · DEL-204 noop identity test |
| **Acceptance** | Dispatcher routes to a statically registered implementation; `noop` changes nothing; failure is non-fatal and recorded |
| **Exit** | Noop identity test green; a deliberately throwing enricher does not fail the target; no dynamic import anywhere (lint) |

## 53.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Remove the stage-7 call. The pipeline is ten stages and behaves identically, because the v1.0 implementation is the identity |
| **Verification** | Reviewer confirms the ledger before and after enrichment is byte-identical under `noop`; confirms a throwing enricher produces a health note and a successful target |
| **Testing** | Unit: dispatcher, noop identity, failure isolation |
| **Documentation** | `app/enrich/README.md` — what an enricher may and may not do (annotate, not mutate; fail softly; be deterministic if it wants payloads to be) |
| **Future** | AI enrichment (v2, TRD §80): sentiment, topic extraction, summarisation. The determinism constraint is the hard part and is stated now so it is not discovered later — a non-deterministic enricher makes PT-12 unsatisfiable and hash-gating useless |

---

## Part 9 Cross-Cutting Exit Criteria

| # | Criterion | Section |
|---|---|---|
| 1 | `ports/` contains interfaces with no executable behaviour | §51 |
| 2 | Publisher and notifier each have two implementations | §51 |
| 3 | Path templates centralised per store | §51 |
| 4 | One contract suite passes against four adapters | §52 |
| 5 | PT-08 proven against real output from all four | §52 |
| 6 | The migration drill completed in under one hour | §52 |
| 7 | No adapter imports another; registration is static | §52 |
| 8 | Enrichment is a dispatcher with a tested no-op | §53 |
| 9 | **Nothing from TRD §76–§91 is implemented** | all |

**Criterion 9 is enforced in review, on every PR, by the question: "is this a seam or is this future work?"** The answer is determined by whether it has runtime behaviour. Seams do not.

---

*End of Part 9. Part 10 specifies the testing implementation: what is written, in what order, and what each suite is allowed to depend on.*
