# Part 7 — Publication, Rollback, and Recovery

*Sections 39 through 43. Audience: the lead implementer, DevOps, and whoever is on call. This part contains the mechanism that stands between a bad harvest and every client website simultaneously. The gate is built in week 5; the publisher that it guards is built in week 12.*

**Build-order reminder.**

| § | System | Built In | Sprint | Difficulty |
|---|---|---|---|---|
| 39 | JSON builder (projector) | PH-06 | SP-2 | D4 |
| 40 | JSON validator (gate + schemas) | PH-06 | SP-2 | **D4, 100% coverage** |
| 41 | Publication pipeline | PH-18 | SP-6 | D3 |
| 42 | Rollback engine | PH-10 (`project`) + PH-18 | SP-3, SP-6 | D3 |
| 43 | Recovery engine | PH-10, PH-20 | SP-3, SP-7 | D3 |

**Seven phases separate the gate from the publisher.** That gap is the design (EP-08): by the time anything can write to the `data` branch, the thing that decides whether it may has been green, at 100% coverage, for seven weeks.

---

# 39. JSON Builder

**Phase PH-06 · Sprint SP-2 · Difficulty D4 · 20 IEH of the 40 IEH PH-06 block**

| Field | Value |
|---|---|
| **Purpose** | Project the private ledger into the public artifacts — deterministically, byte-identically for identical inputs, with a stable total sort order and full provenance. |
| **Objectives** | (1) `reviews.json` full payload. (2) `latest.json` top-N slice. (3) `stats.json` aggregates. (4) `schema-org.json` opt-in. (5) Client and listing manifests. (6) Display filters and ordering applied from config. (7) Minified output with stable key order. (8) PT-12 and PT-13. |
| **Dependencies** | PH-05 (ledger shape and semantics), PH-01 (payload model), `schemas/payload.v1.schema.json` |
| **Estimated Complexity** | **D4.** Determinism is a hard requirement (byte-determinism underpins hash-gating), and a non-total sort order produces intermittent churn that looks like a Git problem |
| **Estimated Time** | 20 IEH |
| **Risks** | Non-total sort key, so two reviews compare equal and their order varies between runs (PT-13) · `generated_at` included in the hashed content (IR-06) · aggregates recomputed from the filtered set rather than the full ledger, inflating or deflating counts · `advertised_total` substituted for the real count in structured data · suppressed reviews reaching a projection (PT-04) |

## 39.1 Implementation Order

| # | Step | Test |
|---|---|---|
| 1 | `project/payload.mjs` — ledger → payload with filters and field selection | Filters applied; tombstoned and suppressed excluded |
| 2 | **Total, stable composite sort key** | **PT-13** — no two distinct reviews compare equal |
| 3 | Minified serialisation with stable key order (EDR-021) | Byte-identical across runs |
| 4 | Provenance block: engine version, pack version, run id, adapter id | Schema validation; INV-06 |
| 5 | `project/latest.mjs` — top-N slice, no aggregate recomputation | Slice correctness |
| 6 | `project/stats.mjs` — count, mean, distribution, languages, completeness | Arithmetic tests; **counts never inflated** |
| 7 | `project/schema-org.mjs` — opt-in, defaults `false` | `advertised_total` never substituted |
| 8 | Manifests: listing, client, global | Freshness pointer correctness |
| 9 | **PT-12 determinism** | Same ledger + config ⇒ byte-identical artifacts |

| ID | Requirement |
|---|---|
| PROJ-01 | The sort key MUST be **total** (PT-13). Ties broken by identity hash guarantee totality; a sort on date alone is not total and produces churn every time two reviews share a date. |
| PROJ-02 | Payloads MUST be minified with stable key order; ledgers MUST be pretty-printed with stable key order (EDR-021). The reasons differ (bytes over the wire vs diff readability) and both are normative. |
| PROJ-03 | `generated_at` MUST appear in the payload and MUST be excluded from every content hash (EDR-022). These two requirements are a matched pair and are tested together. |
| PROJ-04 | Aggregates MUST be computed from the publishable set with the rules in TRD §24, and MUST NOT substitute `advertised_total` (which is the source's claim, not our observation). |
| PROJ-05 | The projector MUST NOT decide whether to publish. That is the gate's job, and merging the two is how a projector acquires a "just publish it" branch. |

## 39.2 Why Determinism Is a Correctness Property Here

Hash-gating (TR-PUB-001) skips the write entirely when new bytes equal current bytes. If projection is non-deterministic — an unstable sort, an unordered key, a floating-point formatting variation — then every run rewrites every file, and:

- commit churn rises ~50× (CON-13 violated);
- `MET-commit-churn` alerts constantly and is then ignored;
- the `data` branch grows without bound;
- and genuine changes become invisible in the noise.

**PT-12 is therefore not a nicety.** It is the test that keeps the publication model viable.

## 39.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-132 `core/project/payload.mjs` · DEL-133 `latest.mjs` · DEL-134 `stats.mjs` · DEL-135 `schema-org.mjs` · DEL-136 manifest builders · DEL-137 PT-12 · DEL-138 PT-13 |
| **Acceptance** | All four artifact types produced; filters and ordering from config; provenance complete; minified with stable key order |
| **Exit** | `core/project/**` ≥ 95%; **PT-12 and PT-13 green at ≥ 1,000 cases**; two runs with different clocks produce byte-identical payloads; payload size budgets met (≤ 180 KB raw / ≤ 60 KB gzip at 200 reviews) |

## 39.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | A projector defect is repaired forward and then `tpre project` regenerates every payload from the ledger with **zero source requests** (TR-CI-200). This is the single most operationally valuable property in the system |
| **Verification** | Reviewer runs the projector twice with different injected clocks and byte-compares; shuffles the ledger's internal order and confirms identical output |
| **Testing** | Unit: filters, ordering, aggregates, provenance, manifests · Property: PT-12, PT-13, PT-04 (suppression never appears) · Budgets: payload and latest size tests |
| **Documentation** | The public payload contract's field-by-field meaning (cross-reference TRD §52, do not restate); the sort key definition; why `schema_org` defaults to `false` |
| **Future** | Payload sharding beyond `publish.payload_shard_threshold` — the code path exists in v1.0 and is exercised by fixture 018 (v1.1 tuning); incremental payloads (v2) |

---

# 40. JSON Validator

**Phase PH-06 · Sprint SP-2 · Difficulty D4 · 20 IEH · The only 100%-coverage module besides redaction**

| Field | Value |
|---|---|
| **Purpose** | Decide, against safety rules rather than job success, whether a candidate payload may replace the live one — and produce every reason, never just the first. |
| **Objectives** | (1) `schemas/payload.v1.schema.json` as the runtime authority. (2) Schema validation of every artifact before publication. (3) Publish Gate rules G-01…G-12, evaluated in full. (4) First-publish exception. (5) Force-override semantics, with `quarantine_max` **not** overridable. (6) 100% statement coverage. (7) PT-14. |
| **Dependencies** | PH-05 (ledger), PH-06 §39 (projector), the schema files |
| **Estimated Complexity** | **D4.** This is the mechanism that makes INV-02 true |
| **Estimated Time** | 20 IEH |
| **Risks** | **IR-08 — the gate implemented with short-circuit evaluation**, so an operator sees one reason, fixes it, and hits the next on the following run · **IR-25 — the first-publish exception applied when the `data` checkout merely failed to read**, which publishes an empty payload over a healthy one · a force-override path that bypasses `quarantine_max` · rules implemented as inline conditionals rather than as independently testable data |
| **Plan risks** | PR-20 |

## 40.1 Implementation Order

| # | Step | Test |
|---|---|---|
| 1 | Schema files finalised: payload, ledger, client config, health record, run manifest | Every schema validates its fixtures |
| 2 | Schema validation wired as gate rule G-01-class (**`ERR-GATE-REJECT-SCHEMA`, critical**) | Invalid payload rejected |
| 3 | `gate/rules.mjs` — **each rule as independently testable data**, not an inline conditional | One test per rule, in isolation |
| 4 | `gate/index.mjs` — evaluates **all** rules, returns **all** reasons (EDR-023) | Multi-failure test: three violations ⇒ three reasons |
| 5 | Count-drop rule with `max_count_drop_ratio` | Boundary at exactly 0.20 |
| 6 | Rating-shift rule with `max_rating_shift` | Boundary at exactly 0.50 |
| 7 | Empty-payload rule (**critical**) | Zero reviews with a non-empty prior ⇒ reject |
| 8 | Coverage and quarantine rules | Boundaries; quarantine **not** force-overridable |
| 9 | Payload-size rule | Warn semantics |
| 10 | **First-publish exception**, distinguishing "no prior payload" from "could not read prior payload" | **IR-25**: unreadable prior ⇒ **not** a first publish |
| 11 | Force-override matrix | Every combination tested; `TPRE_FORCE_REASON` mandatory |
| 12 | **PT-14 monotone safety** | More reviews, same rating ⇒ still accepted |

| ID | Requirement |
|---|---|
| GATE-01 | The gate MUST evaluate **all** rules and return **all** reasons; it MUST NOT short-circuit (EDR-023, IR-08). An operator fixing one reason at a time across four harvest cycles is a day of latency per reason. |
| GATE-02 | Coverage MUST be **100% statement** on `core/gate/**` (TR-TEST-030), with each rule having a test proving it rejects **and** a test proving it does not reject spuriously. |
| GATE-03 | The first-publish exception MUST distinguish "there is no prior payload" from "the prior payload could not be read" (IR-25, TR-GATE-012). Conflating them publishes an empty payload over a healthy one — rated `Critical` impact. |
| GATE-04 | `gate.quarantine_max` MUST NOT be overridable by `--force-publish` (TRD §8.4.5). Every other threshold is; this one is not, because a high quarantine rate means the data is wrong, not merely different. |
| GATE-05 | Rejection MUST discard observations from **both** stores atomically — the ledger is **not** written (EDR-024). A rejected harvest that wrote its ledger would make the next run's comparison baseline the bad data. |

## 40.2 The `data` Checkout Is Not Optional

TRD's "five things a new implementer must not get wrong" names this fifth: **without the `data` checkout, the gate cannot compare change, and its four most valuable rules silently stop working** (IR-10, rated `Critical`).

| Consequence | Rule Affected |
|---|---|
| No prior count | G count-drop |
| No prior rating | G rating-shift |
| No prior payload | G empty-payload |
| No prior bytes | Hash-gating |

**This is a workflow requirement (TR-CI-022) enforced in PH-19**, but it is stated here because the gate is where the failure manifests: the gate does not error, it simply passes everything. The mitigation is a gate-level check: if the prior-payload source is `unreadable` rather than `absent`, the gate **rejects** rather than treating it as a first publish.

## 40.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-139 five schema files · DEL-140 `core/gate/rules.mjs` · DEL-141 `core/gate/index.mjs` · DEL-142 per-rule test suite (24+ tests) · DEL-143 force-override matrix tests · DEL-144 PT-14 · DEL-145 `scripts/validate-all.mjs` |
| **Acceptance** | All rules evaluated; all reasons returned; boundaries exact; first-publish exception correct; force semantics correct; schema is the runtime authority (EDR-039) |
| **Exit** | **`core/gate/**` at 100% statement coverage**; every G-rule has a rejects test and a does-not-reject test; the multi-failure test returns every reason; the unreadable-prior test rejects; PT-14 green; `ERR-GATE-REJECT-*` classes all reachable |

## 40.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | **Tighten, never loosen.** The safe emergency change to the gate is to lower thresholds (reject more). Loosening a threshold to unblock a client is a `--force-publish` decision with a mandatory recorded reason, not a config change |
| **Verification** | Reviewer constructs a candidate violating three rules and confirms three reasons; deletes the prior payload file and confirms first-publish; makes the prior payload unreadable (permissions) and confirms **rejection**; confirms `quarantine_max` resists `--force-publish` |
| **Testing** | Unit: 12 rules × 2 + boundaries + force matrix ≈ 40 tests · Property: PT-14 · Chaos: CH-05, CH-06, CH-08 |
| **Documentation** | The rule table with thresholds, overridability, and severity; **the reason each rule exists**, in one sentence each — because the pressure to loosen a rule arrives without its history |
| **Future** | Per-client learned thresholds from health history (v2) — deliberately not v1.0: a gate that learns from a degrading source learns to accept degradation |

---

# 41. Publication Pipeline

**Phase PH-18 · Sprint SP-6 · Difficulty D3 · 32 IEH**

| Field | Value |
|---|---|
| **Purpose** | Move accepted artifacts to the `data` branch with the minimum possible commit volume, never destructively, and never before the gate has accepted them. |
| **Objectives** | (1) Staging of accepted artifacts. (2) **Hash-gating: identical bytes ⇒ no write.** (3) One commit per shard per branch. (4) Fetch-rebase-retry push ×3. (5) No force flags, ever. (6) Publish order payload-then-state. (7) Architecture test: the publisher is reachable only post-gate. |
| **Dependencies** | PH-06 (gate), PH-08 (state, `fs-atomic`), PH-17 (orchestrator), `data`/`state` branches |
| **Estimated Complexity** | **D3** |
| **Estimated Time** | 32 IEH |
| **Risks** | Hash-gating regression producing ~50× commit churn (IR-06) · a force-push flag reaching the code "to resolve a conflict" (TR-PUB-003) · publish order inverted (state before payload), so a crash between them leaves state claiming a payload that does not exist · per-target commits instead of per-shard (CON-13) · the publisher reachable from a non-gated path |

## 41.1 The Publication Order Is Normative

**Payload first, then state** (EDR-025). The reasoning is asymmetric-failure:

| Crash Point | If Payload First (correct) | If State First (wrong) |
|---|---|---|
| Between the two writes | Payload is ahead of state. Next run re-reconciles and re-publishes identical bytes ⇒ hash-gated ⇒ no-op. **Self-healing** | State claims reviews the payload does not contain. Next run sees no change to make and the payload stays wrong. **Silently permanent** |

| ID | Requirement |
|---|---|
| PUB-01 | Publication order MUST be payload-then-state (EDR-025). The self-healing property depends entirely on it and on reconciliation's idempotence (PT-01). |
| PUB-02 | Writes MUST be skipped entirely when new bytes equal current bytes (TR-PUB-001). |
| PUB-03 | Commits MUST be one per shard per branch, never one per target (TR-PUB-002, CON-13). |
| PUB-04 | Push MUST use fetch-rebase-retry up to three times. `--force` and `--force-with-lease` MUST NOT appear anywhere in the codebase (TR-PUB-003) — enforced by a lint pattern and a code search in review. |
| PUB-05 | `adapters/publisher/` MUST be reachable only from the post-gate branch (TR-TEST-071), asserted by the architecture suite. |

## 41.2 Implementation Order

| # | Step | Test |
|---|---|---|
| 1 | `infra/git.mjs` — checkout, stage, commit, push-with-rebase-retry; **no force flags** | Unit against a temp repository |
| 2 | `adapters/publisher/git-data.mjs` — staging into the `data` checkout | Integration: temp repo |
| 3 | **Hash-gating**: compare candidate bytes to current bytes | **Two identical runs ⇒ zero writes, zero commits** |
| 4 | Commit message format (Conventional Commits, machine-generated) | Format assertion |
| 5 | Rebase-retry on conflict | **CH-11** — simulated conflict, three retries, artifacts identical |
| 6 | Permanent push failure handling | **CH-12** — `ERR-PUBLISH-CONFLICT`; artifacts uploaded; **next run reproduces byte-identically** |
| 7 | Publish order enforcement | Crash-between-writes test |
| 8 | Manifest freshness pointers updated | Listing/client/global manifests consistent |

## 41.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-146 `infra/git.mjs` · DEL-147 `adapters/publisher/git-data.mjs` · DEL-148 hash-gating integration test · DEL-149 `tests/integration/publish.git.test.mjs` · DEL-150 architecture assertion for post-gate reachability |
| **Acceptance** | Accepted artifacts staged and committed once per shard; identical bytes produce no write; rebase-retry succeeds; no force flags; order correct |
| **Exit** | Hash-gating proven (second identical run: zero commits); CH-11 and CH-12 green in PH-21; `--force` absent from the repository (code search recorded in the PR); publisher unreachable from a non-gated path (architecture test) |

## 41.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Switch the composition root to `adapters/publisher/filesystem.mjs`. The engine then produces artifacts locally and publishes nothing — a safe, fully functional degraded mode that keeps ledgers current |
| **Verification** | Reviewer runs the same harvest twice against a temp repository and confirms the second produces zero commits; greps for force flags; confirms the commit count equals the shard count, not the target count |
| **Testing** | Integration: publish to a temp repo, hash-gating, state round-trip · Chaos: CH-11, CH-12 |
| **Documentation** | `docs/runbooks/publish-conflict.md`; the commit message format; why payload-then-state |
| **Future** | Object-storage publisher (v3, seam is `PublisherPort`); signed commits for published artifacts (v1.1) |

---

# 42. Rollback Engine

**Phase PH-10 (`tpre project`) + PH-18 · Sprints SP-3, SP-6 · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Make every published artifact regenerable from durable state with zero network access, so that the answer to "the payload is wrong" is a command rather than an incident. |
| **Objectives** | (1) `tpre project` regenerates all artifacts from the ledger. (2) `--verify` reports the diff without writing. (3) Git revert paths documented and drilled. (4) The five rollback units (engine, config, pack, payload, ledger) each independently exercisable. (5) Rollback verification checks defined. |
| **Dependencies** | PH-05, PH-06 (the projector is the rollback engine), PH-08, PH-18 |
| **Estimated Complexity** | **D3** — the command is simple; the discipline of keeping it network-free is the requirement |
| **Estimated Time** | 12 IEH (`project` command) + 6 IEH (rollback drills and documentation) |
| **Risks** | `tpre project` acquiring a network path "to refresh advertised totals", which destroys its entire value · rollback procedures documented but never drilled, so their first execution is during an incident · `git revert` used where `tpre project` is correct, repairing the symptom rather than the cause |

## 42.1 The Five Rollback Units

| Unit | Mechanism | Time | Data Loss | Drilled In |
|---|---|---|---|---|
| **Engine** | `git revert` the merge on `main` | ~5 min | None — the engine holds no state | SP-6 |
| **Configuration** | `git revert` the config commit | ~2 min | None | SP-4 |
| **Selector pack** | Revert the one-line pin in a profile | **~1 min** | None | SP-7 |
| **Payload** | **`tpre project`** (preferred) or `git revert` on `data` | ~10 min | None | SP-6 |
| **Ledger** | `git checkout <sha> -- ledger/<slug>/<key>.json`, then harvest | ~15 min | Recent harvest history only, usually zero | SP-7 |

| ID | Requirement |
|---|---|
| RB-01 | `tpre project` MUST make **zero network requests** (TR-CI-200). Enforced by an architecture assertion: the `project` command's dependency closure contains no acquisition adapter and no HTTP client. |
| RB-02 | `tpre project` MUST be preferred over `git revert` whenever the ledger is sound, because it repairs the cause rather than the symptom. |
| RB-03 | Every rollback MUST end with the four checks in §67.7 — reachable, schema-valid, sane, and **a regression test exists** (TR-CI-210). |
| RB-04 | Each of the five units MUST be drilled once before GA, in the sprint named above. A procedure never executed is a procedure that does not work. |

## 42.2 The Preference Rule Explained

| Symptom | Wrong Response | Right Response | Why |
|---|---|---|---|
| Payload wrong but schema-valid | `git revert` on `data` | Fix the projector, then `tpre project` | Revert restores prior bytes and the next harvest reproduces the defect |
| Payload missing fields after a schema addition | Re-harvest every client | `tpre project` | Regenerates from state; no source contact; no rate budget consumed |
| Display config changed | Re-harvest | `tpre project` | The ledger already has the data |
| Ledger itself corrupt | `tpre project` | §66.6 ledger rollback, then harvest | Projection from corrupt state produces correct-looking wrong output |

## 42.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-151 `cli/commands/project.mjs` · DEL-152 `--verify` diff mode · DEL-153 five rollback runbook procedures · DEL-154 drill records |
| **Acceptance** | `tpre project --client X` regenerates every artifact identically to the last harvest's output; `--verify` reports a diff and writes nothing; each of the five units is documented with commands and expected timings |
| **Exit** | Architecture assertion proves `project` has no network path; the payload-rollback drill executed and timed; all five procedures merged into `docs/runbooks/` |

## 42.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | This *is* the rollback system. Its own failure mode is a projector defect, handled by §39 |
| **Verification** | Reviewer corrupts a payload file by hand, runs `tpre project`, and confirms restoration; runs it with the network disabled and confirms success |
| **Testing** | Integration: project-from-ledger equals harvest output · DR drill: full regeneration for all clients |
| **Documentation** | The five procedures with commands, timings, and data-loss statements; **TRD §66.8's irreversible list restated in the runbook** so nobody discovers it mid-incident |
| **Future** | `tpre project --all` with progress reporting (v1.1); point-in-time projection from a ledger at a given commit (v1.1) |

---

# 43. Recovery Engine

**Phase PH-10 (commands) + PH-20 (health-driven detection) · Sprints SP-3, SP-7 · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Return the system to a correct state after a failure — automatically where safe, and by a documented, drilled procedure where not. |
| **Objectives** | (1) Automatic recovery paths: retained LKG, idempotent re-derivation, breaker half-open probing. (2) Manual recovery procedures for each disaster class. (3) `tpre doctor` as the diagnostic entry point. (4) `tpre replay` for reproducing a failure offline. (5) Disaster recovery drills executed before GA. |
| **Dependencies** | PH-05 (idempotence — the foundation of automatic recovery), PH-07 (breaker), PH-08 (state), PH-20 (health) |
| **Estimated Complexity** | **D3** |
| **Estimated Time** | 10 IEH (commands) + 8 IEH (drills and runbooks) |
| **Risks** | Recovery procedures written but never executed · a recovery path that acquires from the source, consuming budget during an incident when the source may be the problem · automatic recovery that retries a terminal condition (a challenge) |

## 43.1 Automatic Recovery — What Heals Itself

| Failure | Automatic Recovery | Depends On |
|---|---|---|
| Transient network error | Retry with backoff, then LKG retained | Retry policy (§27) |
| Target budget exhausted | Target aborts; next cycle retries | Budget semantics (§28) |
| Run budget exhausted | Remaining targets `deferred`; next cycle picks them up | TR-APP-005, CH-13 |
| Push conflict | Fetch-rebase-retry ×3 | §41 |
| Permanent push failure | **Next run reproduces byte-identical artifacts** and publishes them | **PT-01 + PT-12** |
| Breaker open | Escalating cooldown, then half-open probe | §27 |
| Gate rejection | LKG retained; next cycle re-evaluates | §40 |
| Partial harvest | Additions merged, nothing removed | **INV-03, PT-07** |

**Eight of the system's failure modes recover with no human action**, and every one of them depends on a property proven in Part 6. This is the return on the D4/D5 investment in weeks 2–5.

## 43.2 Manual Recovery — The Documented Classes

| Class | Runbook | Drill Sprint |
|---|---|---|
| D-1 Bad payload published | `disaster-recovery.md` §D-1 → `tpre project` | SP-6 |
| D-2 Ledger corruption | §D-2 → checkout last valid, harvest | SP-7 |
| D-3/D-4 Branch loss | §D-3/D-4 → restore from mirror | SP-7 |
| D-5 Total repository loss | §D-5 → offsite clone (TR-CI-161) | SP-8 |
| D-6 CI platform outage | §D-6 → wait; payloads remain served | — |
| D-7 CDN outage | §D-7 → consumer empty-state behaviour | SP-8 (consumer side) |
| Selector break | `selector-break.md` | SP-7 |
| Bot challenge | `bot-challenge.md` | SP-7 |
| Stale client > 24 h | `stale-client.md` | SP-7 |
| Publish conflict | `publish-conflict.md` | SP-6 |

| ID | Requirement |
|---|---|
| REC-01 | Every runbook MUST be drilled at least once before GA, in the sprint named above. A drill produces a timing, a correction to the procedure, and a person who has done it. |
| REC-02 | No recovery procedure may require acquiring from the source as its first step. During an incident the source may be the cause, may be rate-limiting, or may be serving a challenge. |
| REC-03 | `tpre doctor` MUST be the documented first command of every runbook — versions, caches, secrets present, branch checkouts, connectivity. One command, one place to look. |

## 43.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-155 `cli/commands/doctor.mjs` · DEL-156 `cli/commands/replay.mjs` · DEL-157 five runbooks · DEL-158 drill records with timings · DEL-159 automatic-recovery test coverage |
| **Acceptance** | Every automatic path proven by a chaos scenario; every manual path drilled and timed; `doctor` reports every prerequisite |
| **Exit** | All ten runbook classes documented; the four highest-value drills (D-1, D-2, selector break, bot challenge) executed with recorded timings; CH-01, CH-10, CH-11, CH-12, CH-13 green |

## 43.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Not applicable — recovery is the rollback |
| **Verification** | Reviewer executes one drill personally, from the runbook text alone, without asking the author a question. Any question asked is a defect in the runbook and is fixed in the same session |
| **Testing** | Chaos: CH-01, CH-02, CH-03, CH-09, CH-10, CH-11, CH-12, CH-13 · Integration: replay from a stored raw artifact |
| **Documentation** | Five runbooks; the automatic-recovery table above, published in `docs/maintenance.md` so an operator knows what **not** to intervene in |
| **Future** | Automated stale-client detection raising an issue (already in PH-20); self-healing re-projection on schema version change (v1.1) |

---

## Part 7 Cross-Cutting Exit Criteria

| # | Criterion | Section | Enforcing Test |
|---|---|---|---|
| 1 | Projection is byte-deterministic | §39 | PT-12 |
| 2 | The sort order is total | §39 | PT-13 |
| 3 | The gate evaluates all rules and returns all reasons | §40 | Multi-failure unit test |
| 4 | The gate is at 100% statement coverage | §40 | Coverage gate |
| 5 | An unreadable prior payload is **not** a first publish | §40 | IR-25 unit test |
| 6 | Identical bytes produce no commit | §41 | Hash-gating integration test |
| 7 | No force flag exists in the repository | §41 | Code search + lint |
| 8 | The publisher is reachable only post-gate | §41 | Architecture test |
| 9 | `tpre project` makes zero network requests | §42 | Architecture assertion |
| 10 | Every runbook has been executed by a human once | §43 | Drill records |

**Criterion 10 is the one with no automated enforcement**, and it is the one most likely to be skipped in SP-8. It is listed in the §65 production checklist for exactly that reason.

---

*End of Part 7. Part 8 specifies health checks, monitoring, metrics, GitHub integration, Actions, the deployment pipeline, and website integration.*
