# Part 10 — Testing Implementation

*Sections 54 through 62. Audience: the QA architect and every engineer. The TRD (§61) specifies **what** the test portfolio contains. This part specifies **when each test is written, by whom, in what order, and what blocks on it.* The governing constraint is unchanged: the default suite runs offline in under three minutes, because a suite slower than that stops being run locally, which is when it stops preventing defects.*

---

# 54. Testing Implementation

## 54.1 The Implementation Position

| Principle | Plan Consequence |
|---|---|
| Tests land with the code they test (X-5, ID-04) | There is no "testing phase". There is no task called "write tests for module X" |
| Properties before implementation for D4/D5 (ID-13) | PT-01, PT-02, PT-07, PT-10, PT-11 are written as **failing tests** before their modules exist |
| The suite is a development tool, not a report | Budget: **< 3 min default, < 45 s pre-push, < 3 s pre-commit** |
| Every defect becomes a permanent test (X-9) | The PR template asks "which test would have caught this?" and reviewers reject bug fixes without one |
| Safety mechanisms without tests are decoration | The gate and redaction are at 100%; the property laws and chaos scenarios are release gates |

## 54.2 The Ten Suites and When They Start

| Suite | Directory | First Test Written | Complete By | Blocking In CI |
|---|---|---|---|---|
| Unit | `tests/unit/` | PH-00 (trivial) → PH-01 (real) | PH-22 | ✅ |
| **Property** | `tests/property/` | **PH-02** | PH-22 | ✅ |
| Regression | `tests/regression/` | PH-13 | PH-16 | ✅ |
| Contract | `tests/contract/` | **PH-11** | PH-22 | ✅ |
| Architecture | `tests/architecture/` | **PH-01** | PH-18 | ✅ |
| Integration | `tests/integration/` | PH-08 | PH-19 | ✅ |
| Chaos | `tests/chaos/` | PH-21 | PH-21 | ✅ |
| Budgets | `tests/budgets/` | PH-06 | PH-23 | ✅ |
| Security | `tests/security/` | **PH-02** | PH-24 | ✅ |
| Live | `tests/live/` | PH-19 | PH-25 | ❌ **advisory only** |

**Three suites start earlier than intuition suggests**, and each for a reason:

| Suite | Starts At | Why Not Later |
|---|---|---|
| Architecture | PH-01 | DR-1 and DR-2 must be enforced from the first `core/` file. Adding them at PH-07 means auditing six phases of imports retroactively |
| Property | PH-02 | PT-10 and PT-11 are the normalizer's acceptance criteria, not a follow-up |
| Security | PH-02 | `security.xss-fixture` is the normalizer's other acceptance criterion |

## 54.3 Test Ownership

| Suite | Written By | Reviewed By |
|---|---|---|
| Unit | The implementing engineer | Any reviewer |
| Property | **QA architect for D4/D5 modules**, engineer otherwise | Architect |
| Regression / fixtures | QA architect + backend | Backend lead |
| Contract | Backend lead (in PH-11) | Architect |
| Architecture | Backend lead | Architect |
| Integration | Implementing engineer | QA |
| **Chaos** | **QA architect** | Architect |
| Budgets | Implementing engineer | QA |
| Security | Security engineer + implementing engineer | Security |
| Live | DevOps | Backend lead |

**The chaos suite is written by the QA architect, not by the engineer who wrote the code.** An engineer writing failure-injection tests for their own module injects the failures they already thought about. The whole value of CH-01…CH-14 is the failures they did not.

## 54.4 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-205 ten suite directories with READMEs · DEL-206 `tests/README.md` suite catalogue · DEL-207 the traceability table (§54.5) maintained per phase |
| **Acceptance** | Every suite has a stated purpose, runtime budget, and network policy; the default suite is offline |
| **Exit** | The traceability table has no empty cell for any invariant; suite timing printed in CI on every run |

## 54.5 Traceability Is Maintained, Not Produced at the End

TRD §61.15 gives the invariant → test mapping. **This plan requires the mapping to be updated in the same PR that adds the test**, so that at any moment the answer to "is INV-03 enforced?" is a table lookup and not an investigation.

| Invariant | Enforcing Test | Written In |
|---|---|---|
| INV-01 | Consumer network assertion per recipe | PH-23 |
| INV-02 | CH-01, CH-04, CH-05, CH-06; full gate suite | PH-06, PH-21 |
| **INV-03** | **PT-07, CH-04** | **PH-05, PH-21** |
| INV-04 | PT-01, CH-12 | PH-05, PH-21 |
| INV-05 | PT-10, CH-14, `security.xss-fixture` | PH-02, PH-21 |
| INV-06 | Schema validation, manifest test | PH-06, PH-20 |
| INV-07 | CH-03, `retry-policy.blocked-never` | PH-07, PH-21 |
| INV-08 | `security.redaction` | PH-07 |
| INV-09 | `security.isolation`, `fail-fast: false` | PH-14, PH-19 |
| INV-10 | PT-08, migration drill | PH-03, PH-22 |

**Stop Condition.** If any cell in the "Written In" column passes without its test existing, the phase does not close. This table *is* the invariant enforcement audit.

---

# 55. Unit Testing Order

**Spans PH-01 through PH-22 · ~350 tests · < 10 s total**

| Field | Value |
|---|---|
| **Purpose** | Exhaustively test the pure core, where six of eleven stages live and where every silent-failure defect would otherwise hide. |
| **Objectives** | (1) Per-module coverage thresholds met. (2) Builders, not literals. (3) Fixed clock and seeded random in every test. (4) One logical assertion per test. (5) Full-sentence behaviour names. |
| **Dependencies** | PH-00 (helpers) |
| **Estimated Complexity** | D2 individually, D3 in aggregate — the discipline is the difficulty |
| **Estimated Time** | Distributed; ~25% of every implementation task's estimate |

## 55.1 The Order

Unit tests follow their modules exactly. The order is the build order, and this table exists to make the coverage obligations visible per phase.

| # | Module | Phase | Threshold | Notable Cases |
|---|---|---|---|---|
| 1 | `core/util/result` | PH-01 | ≥ 90% | Every combinator; error propagation |
| 2 | `core/util/hash` | PH-01 | ≥ 95% | Canonical serialisation; key-order independence |
| 3 | `core/model/errors` | PH-01 | ≥ 90% | **Taxonomy completeness against SAD Appendix B** |
| 4 | **`core/normalize/*`** | PH-02 | **≥ 95%** | **The adversarial corpus (§37.3): nested entities, bidi, ZWJ, 10,000 graphemes, CJK, RTL, controls** |
| 5 | `core/dates/*` | PH-03 | ≥ 95% | Full locale matrix; **singular forms**; unparseable phrases; pinning |
| 6 | `core/lang/detect` | PH-03 | ≥ 90% | Script ranges; null below 12 graphemes |
| 7 | `core/identity/*` | PH-03 | ≥ 95% | **Homoglyphs must NOT merge**; diacritics must; 512-grapheme append tolerance |
| 8 | `core/validate/*` | PH-04 | ≥ 95% | Each finding; **every threshold boundary**; four completeness values |
| 9 | **`core/reconcile/*`** | PH-05 | **≥ 95%** | **Every decision branch; the asymmetry; streak arithmetic; tombstones; suppressions** |
| 10 | `core/project/*` | PH-06 | ≥ 95% | Determinism; sort stability; filters; aggregate arithmetic |
| 11 | **`core/gate/*`** | PH-06 | **100%** | **Every rule independently, first-publish exception, every force combination** |
| 12 | `infra/retry/*` | PH-07 | ≥ 95% | Policy per class; **blocked-never** |
| 13 | **`infra/logger/redact`** | PH-07 | **100%** | **Sentinels at every level and position** |
| 14 | `infra/breaker`, `limiter` | PH-07 | ≥ 90% | Transitions; pessimistic accounting; fail-closed |
| 15 | `app/config/*` | PH-09 | ≥ 90% | Precedence matrix; ceilings; unknown variables |
| 16 | `app/registry`, `shard-planner` | PH-17 | ≥ 90% | Due-set matrix; balance quality; determinism |
| 17 | `core/selectors/*` | PH-12 | ≥ 90% | Pack validation; strategy ordering; health |
| 18 | `core/extract/*` | PH-13 | ≥ 90% | Rating cascade P1/P2/P3; reply isolation; missing optionals |
| 19 | Adapters | PH-11/16/22 | ≥ 80% | Capability descriptors; CSV row isolation; OAuth failure |

## 55.2 The Standards That Are Enforced in Review

| Standard | Enforcement |
|---|---|
| Full-sentence names — *"retains last known good when coverage is below threshold"* | Review |
| No shared mutable state between tests | Review + lint |
| Builders over literals (TR-TEST-033) | Review |
| Fixed clock, seeded random (TR-TEST-032) | Review; **a test reading the system clock will eventually fail at 2 a.m. for no reason** |
| One logical assertion per test | Review |
| Arrange–Act–Assert, visually separated | Review |

## 55.3 Coverage Is a Floor, Not a Goal

TRD §61.3.1: *"A module at 92% with the wrong assertions is worse than one at 80% with the right ones."* The gates that carry real weight are the property laws, the chaos scenarios, and the two 100% modules. Coverage percentages are a check that nothing was forgotten, not evidence that anything is correct.

## 55.4 Exit / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Exit** | Every threshold in §55.1 met at its phase's close; no module below its floor at any point on `main` |
| **Verification** | Reviewer picks two tests at random per PR and checks they assert behaviour rather than implementation |
| **Documentation** | `tests/README.md` standards section |
| **Future** | Mutation testing on `core/gate/` and `core/reconcile/` (v1.1) — the natural successor to 100% statement coverage |

---

# 56. Integration Testing Order

**Spans PH-08 through PH-19 · ~25 tests · < 60 s · localhost only**

| Field | Value |
|---|---|
| **Purpose** | Prove that components composed together behave as their contracts claim, using real filesystems, a real browser, a real Git repository, and a local fixture server — but never the internet. |
| **Objectives** | (1) State round-trip. (2) Publish to a real Git repository. (3) Hash-gating. (4) Full pipeline against the fixture server. (5) Context isolation **including a failing target**. (6) Config resolution. (7) Alert lifecycle. |
| **Dependencies** | PH-08 onward |
| **Estimated Complexity** | D3 |
| **Estimated Time** | Distributed across phases |
| **Risks** | Integration tests reaching the network, making CI flaky (TR-TEST-080) · tests sharing a temp directory and interfering under parallelism · the isolation test covering only the success path (TR-TEST-081) |

## 56.1 The Order

| # | Test | Phase | Asserts |
|---|---|---|---|
| 1 | **State round-trip** | PH-08 | Ledger write/read fidelity, atomic rename, **unknown-field preservation** |
| 2 | Atomic write crash injection | PH-08 | Temp file present, target untouched |
| 3 | Config resolution from layered fixtures | PH-09 | Precedence matrix correct; trace accurate |
| 4 | CLI offline harvest (`--dry-run --from-fixture`) | PH-11 | Complete pipeline, zero writes |
| 5 | CSV harvest → filesystem payload | PH-11 | **MS-5's demo — the first end-to-end path** |
| 6 | Fixture server self-test | PH-15 | Six capabilities behave |
| 7 | Full pipeline against the fixture server | PH-15 | Navigation, pagination, expansion, extraction, pure pipeline |
| 8 | **Pagination stall** | PH-15 | `stopReason: stalled` → `partial` → **gate rejects** |
| 9 | Resource blocking measurement | PH-15 | Images/fonts/media blocked; **byte reduction recorded as a number** |
| 10 | **Context isolation, including a failing target** | PH-14/17 | No carryover; open-context count returns to zero |
| 11 | Orchestrator with two targets, one failing | PH-17 | Isolation; both outcomes recorded |
| 12 | Budget exhaustion | PH-17 | Remaining targets `deferred`, not `failed` |
| 13 | **Publish to a real Git repository** | PH-18 | Staging, hash-gating, commit format, rebase-retry |
| 14 | **Hash-gating** | PH-18 | **Two identical runs ⇒ zero writes, zero commits** |
| 15 | Alert lifecycle | PH-20 | Open → comment → close, deduped by fingerprint, rate-limited |
| 16 | Health series concurrent append | PH-20 | Two shards, zero record loss |
| 17 | Workflow dispatch end to end | PH-19 | A `data` commit results |

| ID | Requirement |
|---|---|
| INT-01 | Integration tests MUST use only localhost (TR-TEST-080). |
| INT-02 | The context-isolation test MUST include a run in which a target **fails** (TR-TEST-081), because the failure path is where `finally` blocks get skipped. |
| INT-03 | Tests touching a temp Git repository MUST run without parallelism within their file, and MUST create their own repository rather than sharing one. |

## 56.2 Exit / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Exit** | All seventeen green; total integration runtime < 60 s; zero network access verified by running the suite with networking disabled |
| **Verification** | QA runs the full suite on an air-gapped machine; confirms tests 8, 10, and 14 individually, since each is a named invariant enforcement |
| **Documentation** | Each test's purpose in `tests/integration/README.md` |
| **Future** | A second fixture-server profile simulating a slower source (v1.1) |

---

# 57. End-to-End Testing Order

**Spans PH-15 through PH-25 · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Prove the complete path — real browser, real markup, all eleven stages, a real Git commit, a real CDN URL, a real web page — without ever depending on the internet in the blocking path. |
| **Objectives** | (1) Engine-side E2E on localhost. (2) Consumer-side E2E against a served payload. (3) Live smoke tests, opt-in only. (4) The GA demonstration path. |
| **Dependencies** | PH-15 (fixture server + browser), PH-18 (publisher), PH-23 (renderer) |
| **Estimated Complexity** | D3 |

## 57.1 What E2E Means Here

There is no user-facing application to drive. E2E means: **a real browser, driving real markup, through the complete eleven-stage pipeline, to a real Git commit — all on localhost with no internet** (TRD §61.8.1). The fixture server is what makes this possible and flake-free.

## 57.2 The Order

| # | E2E Path | Phase | Network |
|---|---|---|---|
| 1 | Fixture page → browser → payload on the filesystem | PH-15 | localhost |
| 2 | Fixture page → browser → payload committed to a temp Git repository | PH-18 | localhost |
| 3 | Fixture page → browser → workflow → commit on the real `data` branch | PH-19 | GitHub only |
| 4 | Payload → served locally → renderer → rendered page | PH-23 | localhost |
| 5 | **Consumer network assertion per recipe** | PH-23 | localhost |
| 6 | Empty-state behaviour with the payload URL blocked | PH-23 | localhost |
| 7 | Layout stability (CLS 0) and accessibility | PH-23 | localhost |
| 8 | **Live smoke harvest with `--no-publish`** | PH-19 | **real source — opt-in** |
| 9 | **GA path: real listing → payload → CDN → real page → zero third-party requests** | PH-25 | real |

| ID | Requirement |
|---|---|
| E2E-01 | Paths 1–7 MUST be in the default suite and MUST NOT touch the internet. |
| E2E-02 | Path 8 MUST live in `tests/live/`, excluded from the default runner (TR-TEST-021). **A live test failure never blocks a PR; it opens an issue** (TRD §61.12). |
| E2E-03 | Path 5 MUST be run for **every** shipped recipe (INV-01). This is the consumer-side proof of the architecture's central claim. |
| E2E-04 | Path 9 is MS-9's demo and is executed once, manually, with the network waterfall captured as evidence. |

## 57.3 Why Live Tests Never Block

TRD §61.12: *"A flaky, network-dependent test in the blocking path trains engineers to re-run CI until it passes, which destroys the value of every other test in the suite."* IR-18 registers this as a risk. The plan's enforcement is structural: `tests/live/` is excluded from the default runner configuration, and that exclusion is **proven** in PH-00 by adding a deliberately failing live test and confirming `npm test` stays green.

## 57.4 Exit / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Exit** | Paths 1–7 green in CI; path 8 runnable and green manually; path 9 executed at GA with evidence captured |
| **Verification** | QA runs path 5 with the browser network panel open for the static and React recipes personally |
| **Documentation** | The GA demonstration script, so it can be repeated for the second client |
| **Future** | Automated visual regression on the renderer (v1.1) |

---

# 58. Performance Testing

**PH-06 (budgets configured) → PH-21 (measured) · Difficulty D2**

| Field | Value |
|---|---|
| **Purpose** | Enforce the deterministic performance budgets as blocking gates, and monitor the non-deterministic ones without ever blocking a build on them. |
| **Objectives** | (1) Pure pipeline CPU benchmark. (2) Payload and renderer size budgets. (3) Blocked-bytes effectiveness. (4) Duration, cold start, and RSS monitored. (5) The blocking/monitored split enforced. |
| **Dependencies** | PH-06 (projector), PH-13 (extraction), PH-15 (browser), PH-23 (renderer) |
| **Estimated Complexity** | D2 |
| **Estimated Time** | 10 IEH across PH-06, PH-21, PH-23 |

## 58.1 Blocking vs Monitored — The Distinction That Makes the Gate Work

| Test | Target | Blocking? | Why |
|---|---|---|---|
| Pure pipeline CPU, 1,000 reviews | ≤ 2 s | ✅ | Deterministic; also catches IR-15 (all-pairs) and IR-24 (array ledger) |
| `reviews.json`, 200 reviews | ≤ 180 KB raw / ≤ 60 KB gzip | ✅ | Deterministic |
| `latest.json` | ≤ 24 KB / ≤ 9 KB | ✅ | Deterministic |
| Renderer bundle | ≤ 5 KB minified | ✅ | Deterministic |
| Blocked-bytes effectiveness | Non-trivial, recorded | ✅ | Deterministic against the fixture server |
| Harvest duration p95 | ≤ 180 s | ❌ **monitored** | Shared runner variance |
| Cold start | ≤ 60 s warm cache | ❌ monitored | Runner and cache variance |
| Peak RSS per target | ≤ 700 MB | ❌ monitored | Environment-dependent |

| ID | Requirement |
|---|---|
| PERF-01 | Size and CPU budgets MUST be blocking (TR-TEST-100) because they are deterministic. |
| PERF-02 | Wall-clock duration MUST NOT be blocking (TR-TEST-101). **A flaky performance gate trains engineers to re-run CI until it passes, which destroys the value of every other test.** |
| PERF-03 | Monitored metrics MUST still be recorded in health, so a regression is visible as a trend even though it does not fail a build. |

## 58.2 Exit / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Exit** | Five blocking budgets green; three monitored metrics recorded in health with baselines from the first production runs |
| **Verification** | Reviewer deliberately regresses the projector to O(n²) and confirms the CPU benchmark fails |
| **Documentation** | The budget table with measured actuals recorded at GA |
| **Future** | Per-stage CPU attribution (v1.1); a size-trend chart in `data` (v1.1) |

---

# 59. Load Testing

**PH-21 · Difficulty D2 · 8 IEH**

| Field | Value |
|---|---|
| **Purpose** | Establish, before the first client, how the system behaves at 10×, 50×, and the designed 5,000-review ceiling — using synthetic data and the fixture server, never the live source. |
| **Objectives** | (1) Ledger and pipeline behaviour at 1,000 and 5,000 reviews. (2) Multi-client shard behaviour at 10 and 50 synthetic clients. (3) Memory ceiling verified. (4) Payload sharding path exercised. (5) **Zero live-source load testing.** |
| **Dependencies** | PH-17 (orchestrator), PH-15 (fixture server), fixture 018 |
| **Estimated Complexity** | D2 |
| **Estimated Time** | 8 IEH |
| **Risks** | Load testing performed against the live source — a rate-limit and reputation event, and a direct violation of the pacing discipline · synthetic clients that all share one listing, so shard balancing is never exercised |

## 59.1 The Load Scenarios

| # | Scenario | Method | Asserts |
|---|---|---|---|
| 1 | One listing, 1,000 reviews | Synthetic ledger + fixture | Pure pipeline ≤ 2 s; ledger operations sub-linear |
| 2 | One listing, **5,000 reviews (the ceiling)** | Fixture 018 | Cap respected; memory under budget; `full_capped` completeness |
| 3 | Payload above `payload_shard_threshold` | Synthetic | Sharding path produces `reviews.page-<n>.json` |
| 4 | 10 synthetic clients, 4 shards | Synthetic configs | Balance within 25%; all outcomes recorded |
| 5 | 50 synthetic clients, 8 shards | Synthetic configs | Shard planner scales; run budget triggers deferral correctly |
| 6 | Run budget exhaustion under load | Synthetic | Remaining targets `deferred`; exit 4; **no data loss** |

| ID | Requirement |
|---|---|
| LOAD-01 | Load testing MUST NOT touch the live source, ever. Synthetic data and the fixture server are the only permitted inputs. |
| LOAD-02 | Scenario 5 MUST use **distinct** synthetic listings with varied cost profiles, or shard balancing is not exercised. |
| LOAD-03 | Findings MUST be recorded as numbers in the test, not as pass/fail alone, so that regressions are visible in diffs. |

## 59.2 Exit / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Exit** | All six scenarios executed with recorded numbers; the 5,000-review ceiling verified against fixture 018; no live-source contact |
| **Verification** | QA confirms the fixture server logs show zero external requests during the load run |
| **Documentation** | A load-characteristics note in `docs/maintenance.md`: what the system does at each scale, and where the next bottleneck is |
| **Future** | 500-client simulation ahead of the SAD §37 scalability tier (v2) |

---

# 60. Failure Simulation

**PH-21 · Difficulty D4 · part of the 34 IEH chaos block**

| Field | Value |
|---|---|
| **Purpose** | Inject each failure the system is designed to survive, and assert the specific safety property that survives it — rather than asserting merely that nothing crashed. |
| **Objectives** | (1) Injection mechanisms for network, HTTP, browser, parse, state, and Git failures. (2) Each injection asserts a **named** property. (3) None results in a degraded published payload. (4) Diagnostics produced for each. |
| **Dependencies** | PH-20 (observability to assert against), all prior phases |
| **Estimated Complexity** | **D4** — designing an injection that actually reproduces the failure is the hard part |
| **Estimated Time** | Within PH-21 |

## 60.1 Injection Mechanisms

| Failure Class | Injection Mechanism | Realistic? |
|---|---|---|
| Network timeout | Fixture server delays past the navigation timeout | ✅ |
| HTTP 429 | Fixture server returns 429 | ✅ |
| Challenge page | Fixture server serves fixture 016 | ✅ |
| Pagination stall | Fixture server stops yielding after batch N | ✅ **the most valuable one** |
| Structure change | Fixture 015 | ✅ |
| Empty with no marker | Synthetic fixture | ✅ |
| Selector break, one field | Scratch pack with strategy 0 broken | ✅ |
| Selector break, all strategies | Scratch pack with all strategies broken | ✅ |
| Browser crash | Kill the browser process mid-pagination | ✅ |
| Ledger corruption | Write invalid JSON into a temp state repo | ✅ |
| Git push conflict | Push a competing commit to the temp repo between fetch and push | ✅ |
| Permanent push failure | Read-only temp repository | ✅ |
| Run budget exhaustion | Set a tiny run budget | ✅ |
| Malicious markup | Fixture 019 | ✅ |

**All fourteen are reproducible on localhost.** That is a property of the fixture-server design and is why the chaos suite runs in under 45 seconds on every PR rather than being a quarterly exercise.

## 60.2 The Assertion Discipline

| Weak Assertion | Required Assertion |
|---|---|
| "The run did not crash" | "LKG retained, health record written, alert severity `warn`, exit code 4" |
| "The error was caught" | "`ERR-NET-TIMEOUT` classified, retried twice with backoff, then the target failed" |
| "Extraction returned fewer reviews" | "Completeness `partial`, **zero streak increments**, gate rejected on G-05" |

**Every chaos test names the invariant it protects in a comment** (TR-TEST-042). A chaos test without a named invariant is a smoke test.

## 60.3 Exit / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Exit** | All fourteen injections implemented and reproducible; each asserts a named property; none produces a degraded payload |
| **Verification** | Architect reads all fourteen assertions and confirms each is specific rather than "no crash" |
| **Documentation** | The injection catalogue: how each failure is simulated, so it can be reproduced during a real incident |
| **Future** | Randomised failure injection across a full run (v2) |

---

# 61. Regression Testing

**PH-13 (corpus) → PH-16 (complete) → continuous · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Turn every past and future upstream change into an offline unit test, so that a live-site incident becomes a fixture rather than a recurring emergency. |
| **Objectives** | (1) Twenty golden fixtures with `page.html`, `meta.json`, `expected.json`. (2) Fixtures tested against **their** pack version. (3) Adversarial fixtures asserting correct failure. (4) Sanitisation pipeline. (5) Regression discipline enforced by the PR template. (6) Quarterly re-capture scheduled. |
| **Dependencies** | PH-12 (packs), PH-13 (extraction) |
| **Estimated Complexity** | D3 — capture and sanitisation are fiddly; the discipline is the value |
| **Estimated Time** | 18 IEH across PH-13 and SP-2/SP-3 capture work |
| **Risks** | Fixtures captured as full pages, making them enormous and slow (TR-TEST-011) · sanitisation stripping review text, which destroys the parser correctness the corpus exists to test · fixtures tested only against the current pack, so the corpus tests today's markup rather than extraction (TR-TEST-051) |

## 61.1 The Corpus and Its Ownership

| Category | Fixtures | Purpose | Captured By |
|---|---|---|---|
| Baseline | 001 | Happy path, 120 reviews | Backend, SP-2 |
| Boundary | 002, 003, 018 | Single, zero, 5,000-cap | Backend, SP-2 |
| Structural variety | 004, 008, 009, 010 | Replies, missing avatars, anonymous, rating-only | Backend, SP-2 |
| Text handling | 005, 006, 007, 020 | Truncated, RTL, emoji/CJK, mixed language | QA, SP-3 |
| Locale | 012, 013 | German, Hindi relative dates | QA, SP-3 |
| Identity hazards | 011 | Duplicate author names | QA, SP-3 |
| **Adversarial** | **014, 015, 016, 017, 019** | **Assert correct failure** | **QA + Backend, SP-3** |

## 61.2 The Adversarial Five Are the Point

| Fixture | Must Do | Must Not Do |
|---|---|---|
| 014 partial stalled | Classify `partial`; decrement no streak | Classify `full` |
| 015 structure changed | Fail loudly with `ERR-PARSE-STRUCTURE` | **Silently return three reviews** |
| 016 challenge page | Classify as a **terminal challenge** | Classify as a parse failure |
| 017 consent interstitial | Dismiss and proceed | Treat as a challenge |
| 019 markup in review text | Produce plain text with no markup | **Escape rather than remove** |

**A corpus containing only happy paths would pass while the system's safety properties silently rotted** (TRD §61.5.2). These five are scheduled as named tasks, not folded into "capture fixtures", precisely because they require constructing failure states rather than saving a normal page.

## 61.3 Regression Discipline

| Trigger | Required Addition | Enforced By |
|---|---|---|
| Any production incident | A test reproducing the root cause, referencing the issue | PR template |
| Any selector pack change | A new fixture from the changed markup | Review |
| Any upstream structural change | Fixture + updated canary assertions | Review |
| Any gate threshold change | Boundary tests at the new threshold | Review |
| Any identity or hashing change | Extended PT-08/PT-09 cases + a documented migration | Architect |
| Any security finding | A permanent test under `tests/security/` | Security |
| Any dependency major upgrade | Full suite + a live smoke run before merge | DevOps |

## 61.4 Exit / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Exit** | Twenty fixtures green against their pinned packs; the adversarial five assert correct failure; sanitisation pipeline verified to retain review text and strip scripts, tokens, cookies, tracking attributes, and inline handlers |
| **Verification** | Reviewer opens two fixtures and confirms they are subtree-trimmed, not full pages; confirms `expected.json` was generated by the engine and not hand-written |
| **Documentation** | `fixtures/README.md` capture, sanitisation, and provenance rules |
| **Future** | Quarterly baseline re-capture (TR-TEST-052) scheduled as a maintenance task in §68 |

---

# 62. Chaos Testing

**PH-21 · Sprint SP-7 · Difficulty D4 · 34 IEH · A release gate**

| Field | Value |
|---|---|
| **Purpose** | Assert, for each of fourteen injected failures, that the system's specific safety property holds — and that **none of them results in a degraded published payload**. |
| **Objectives** | (1) CH-01…CH-14 implemented. (2) Each names its invariant. (3) All fourteen green before release. (4) CH-04 given special scrutiny. (5) Suite completes in under 45 s. |
| **Dependencies** | Every prior phase; PH-20 for the observability the tests assert against |
| **Estimated Complexity** | **D4** |
| **Estimated Time** | 34 IEH |
| **Risks** | Scenarios written to pass rather than to probe · CH-04 implemented as a count check rather than a completeness check, which would pass while the protection it tests is absent · the suite growing past its runtime budget and being moved out of the default run |

## 62.1 The Fourteen

| ID | Injected Failure | Expected Behaviour | Asserts |
|---|---|---|---|
| CH-01 | Network timeout on navigation | Retry ×2 with backoff, target fails, **LKG retained** | Retry policy, INV-02 |
| CH-02 | HTTP 429 on first request | Hour budget zeroed, 60 s backoff; second 429 opens the breaker | Backpressure |
| CH-03 | Challenge page served | **Terminal, zero retries**, breaker opens, `critical` alert, LKG retained | **INV-07** |
| **CH-04** | **Pagination stalls at 12 of 118** | **`partial`, additions merged, NO streak increments, gate rejects on G-05** | **INV-03** |
| CH-05 | Review container absent, page otherwise valid | `ERR-PARSE-STRUCTURE`, target fails, `high` alert, LKG retained | Structure detection |
| CH-06 | All reviews vanish, no empty-state marker | `ERR-PARSE-EMPTY-UNEXPECTED`; if it passed, G-02 rejects | INV-02, G-02 |
| CH-07 | Selector pack broken for one field | Fallback strategies engage; strategy-health alert; extraction still correct | Selector resilience |
| CH-08 | Pack broken for all strategies of a required field | Records quarantined; threshold breached; gate rejects | G-06 |
| CH-09 | Browser crashes mid-pagination | One retry; on repeat, target fails cleanly with the context closed | Browser lifecycle |
| CH-10 | Ledger file corrupted | `ERR-STATE-CORRUPT`, target aborts, LKG retained, runbook referenced | State integrity |
| CH-11 | Git push conflict simulated | Rebase-retry ×3 succeeds; artifacts identical | Conflict handling |
| CH-12 | Git push fails permanently | `ERR-PUBLISH-CONFLICT`; artifacts uploaded; **next run reproduces byte-identically** | INV-04 |
| CH-13 | Run budget exhausted mid-shard | Remaining targets `deferred` (**not failed**); exit 4; no data loss | Budget semantics |
| CH-14 | Malicious markup in review text | Stripped at normalisation; validator self-check passes; payload is plain text | **INV-05** |

## 62.2 CH-04 Gets Its Own Review

TR-TEST-091: *"CH-04 is the single most important test in the suite. It simulates the exact failure that would otherwise silently delete a client's reviews, and asserts three independent protections engage."*

| Protection | Asserted How |
|---|---|
| 1 · Partial classification | `completeness === 'partial'` after a stall at 12 of 118 |
| 2 · Streak suppression | Every ledger record's `missing_streak` is **unchanged** from before the harvest |
| 3 · Gate rejection | The verdict rejects, naming the coverage rule |

**All three must be asserted separately.** A test asserting only the third would pass even if the first two protections were removed, because the gate alone would catch this particular case — and the first two are what protect the cases the gate does not catch.

**Verification requirement:** the reviewer removes protection 2 (the completeness check in the streak logic) and confirms CH-04 **fails**. A chaos test that still passes with a protection removed is testing something else.

## 62.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-208 `tests/chaos/failure-matrix.test.mjs` · DEL-209 fourteen injection helpers · DEL-210 per-scenario invariant comments · DEL-211 CH-04 three-protection assertions |
| **Acceptance** | Fourteen scenarios, each asserting a named property; none produces a degraded payload; suite under 45 s |
| **Exit** | **All fourteen green — a hard release gate (TR-TEST-090)**; CH-04's three assertions verified by protection removal; every scenario names its invariant |

## 62.4 Rollback / Verification / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Chaos tests are never rolled back. A failing chaos test blocks the release; the code is fixed, not the test (ID-10) |
| **Verification** | Architect independently removes one protection per scenario for three randomly chosen scenarios and confirms each test fails |
| **Documentation** | The scenario catalogue with injection method and asserted property |
| **Future** | Continuous chaos on a schedule against a scratch client (v2) |

---

## Part 10 Cross-Cutting Exit Criteria

| # | Criterion | Section |
|---|---|---|
| 1 | Default suite completes offline in under three minutes | §54 |
| 2 | `tests/live/` proven excluded from the default runner | §57 |
| 3 | Every invariant has at least one enforcing test, tracked in a maintained table | §54.5 |
| 4 | All fifteen property laws pass at ≥ 1,000 cases | §55 |
| 5 | Twenty golden fixtures pass against their pinned packs | §61 |
| 6 | All fourteen chaos scenarios pass | §62 |
| 7 | Contract suite passes against four adapters | §52 |
| 8 | Six architecture rules pass, including acyclicity | §54 |
| 9 | Blocking performance budgets green; monitored ones recorded | §58 |
| 10 | Six security tests pass | §54 |
| 11 | 100% coverage on `core/gate/` and `infra/logger/redact.mjs` | §55 |
| 12 | Load scenarios executed with recorded numbers, zero live-source contact | §59 |

**These twelve are the technical content of DG-09.** MS-8 does not close without all of them, and v1.0.0 is not tagged without MS-8.

---

*End of Part 10. Part 11 contains the deployment, release-candidate, production, post-deployment, rollback, maintenance, and upgrade checklists, and the V2 preparation register.*
