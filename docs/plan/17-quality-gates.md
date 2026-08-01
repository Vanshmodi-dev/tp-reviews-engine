# Part 17 — Quality Gates

*Audience: every engineer, every reviewer, every agent. A quality gate is a check that blocks. This part defines the six criteria classes that every phase must satisfy, the fourteen named gates that implement them, and the per-phase matrix showing which apply where.*

---

## 17.0 The Rule That Makes Gates Work

> **A non-blocking quality gate is a report, and reports are not read** (TR-CI-072).

Every gate in this part either blocks a merge, blocks a phase closure, or blocks a release. There is no advisory tier except one — the live smoke suite — and its advisory status is itself a deliberate, justified decision (§57.3).

---

# 17.1 The Six Criteria Classes

Every phase defines all six. Most are satisfied by the same mechanised gates; the phase-specific content is in the phase's own Exit Criteria (Parts 3–10).

| Class | Question | Enforced By | Blocks |
|---|---|---|---|
| **Build Success** | Does it compile, lint, type-check, and format cleanly? | `ci.yml` groups 1–4 | Merge |
| **Code Review** | Does it preserve the invariants, the layering, and the standards? | Human review against a fixed checklist | Merge |
| **Testing** | Do the right tests exist, and do they test the requirement? | `ci.yml` groups 5–8, 14 + coverage | Merge |
| **Performance** | Is it within the deterministic budgets? | `ci.yml` group 9 | Merge |
| **Documentation** | Can the next person operate and maintain it? | Review + phase exit criteria | Phase closure |
| **Release** | Is the whole system fit to ship? | §63–§65 checklists | Release |

---

# 17.2 Build Success Criteria

## QG-01 · Compilation and Type Safety

| # | Criterion | Threshold | Blocks |
|---|---|---|---|
| 1 | `npm run typecheck` | **Zero errors** | Merge |
| 2 | No `any` without an adjacent written justification | Zero unjustified | Merge |
| 3 | No baseline of "known errors" exists | None permitted (TS-04) | Merge |
| 4 | No transpilation or build step introduced | No `build` script (NODE-02) | Merge |
| 5 | `.nvmrc` and `engines.node` agree | Consistency test green | Merge |

## QG-02 · Lint and Format

| # | Criterion | Threshold | Blocks |
|---|---|---|---|
| 1 | `npm run lint` | **Zero errors and zero warnings** (`--max-warnings 0`) | Merge |
| 2 | Structural limits: complexity ≤ 10, function ≤ 60 lines, file ≤ 400 lines, params ≤ 4, nesting ≤ 3 | All | Merge |
| 3 | Prohibited patterns absent (TRD §67.3) | All | Merge |
| 4 | Any lint disable carries an inline reason | All (LINT-03) | Merge |
| 5 | `npm run format:check` | Zero differences | Merge |

## QG-03 · Architecture Conformance

| # | Criterion | Threshold | Blocks |
|---|---|---|---|
| 1 | DR-1: `core/` imports nothing from other layers or packages | Pass | Merge |
| 2 | DR-2: `core/` has no clock, randomness, environment, fs, or fetch | Pass | Merge |
| 3 | DR-3: no adapter imports another; **exactly one file imports `playwright`** | Pass | Merge |
| 4 | DR-4: `app/` imports no concrete adapter | Pass | Merge |
| 5 | DR-5: only `cli/composition.mjs` constructs implementations | Pass | Merge |
| 6 | DR-6: no import reaches past a package index | Pass | Merge |
| 7 | Acyclicity within `core/` | Pass | Merge |
| 8 | `adapters/publisher/` reachable only post-gate | Pass (from PH-18) | Merge |
| 9 | `ports/` contains no executable behaviour | Pass (from PH-07) | Merge |
| 10 | `tpre project` closure contains no acquisition adapter or HTTP client | Pass (from PH-10) | Merge |

## QG-04 · Dependency Discipline

| # | Criterion | Threshold | Blocks |
|---|---|---|---|
| 1 | Production dependency count | **≤ 2** | Merge |
| 2 | Every production dependency has a merged DEP-1 justification | All | Merge |
| 3 | `core/` has zero package dependencies | Zero | Merge |
| 4 | `frontend/renderer/` has zero dependencies | Zero (DEP-6) | Merge |
| 5 | `npm audit` high-severity findings | **Zero** | Merge |
| 6 | Lockfile committed; CI installs with `npm ci` only | Always | Merge |

---

# 17.3 Code Review Criteria

## QG-05 · The Reviewer Checklist

Reviewers check these **in this order**. Check 1 is first because it is the only one whose failure is unrecoverable.

| # | Check | Reject If |
|---|---|---|
| 1 | **Does this preserve the ten invariants?** Especially INV-02, INV-03, INV-05 | Any doubt. Escalate rather than approve |
| 2 | Does it respect the dependency rules? Is anything impure creeping into `core/`? | Any violation |
| 3 | Is every new error classified and in the taxonomy? | Any unclassified failure path |
| 4 | Is every new timing, threshold, or limit configurable with a named default? | Any magic number |
| 5 | Would the change be diagnosable from artifacts alone if it failed in production? | No |
| 6 | Is there a test that would have caught the bug being fixed? | Bug fix without a test |
| 7 | Is documentation or an ADR/EDR updated? | Behavioural change without a record |
| 8 | Could untrusted content reach a shell, a log format string, a workflow expression, or a client DOM? | Any path exists |
| 9 | **Is this client-specific in any way?** | Any conditional on a slug |
| 10 | Is it simpler than what it replaces? If not, is the added complexity justified in writing? | Unjustified complexity |

## QG-06 · Review Depth by Difficulty

| Difficulty | Reviewers | Depth | Turnaround |
|---|---|---|---|
| D1 | 1 (self-merge for docs only) | Diff scan | 24 h |
| D2 | 1 | Diff vs the TRD section | 24 h |
| D3 | 1 | **Line-by-line vs the TRD section** | 24 h |
| **D4** | **2**, one uninvolved | Line-by-line + independent adversarial construction | 48 h |
| **D5** | **2**, one being the Architect | Line-by-line + hand-tracing the algorithm + protection-removal check | 48 h |

## QG-07 · The Six Modules With Mandatory Architect Review

Any PR touching these requires the Architect as one of two reviewers, regardless of diff size:

`core/reconcile/**` · `core/normalize/**` · `core/gate/**` · `core/identity/**` · `infra/logger/redact.mjs` · `adapters/acquisition/google-dom/challenge-detect.mjs`

## QG-08 · PR Hygiene

| # | Criterion | Threshold |
|---|---|---|
| 1 | Diff size, excluding fixtures and generated files | ≤ ~400 lines |
| 2 | Branch age at merge | ≤ 48 h (≤ 24 h in SP-5) |
| 3 | PR description names the TRD section(s) implemented | Required |
| 4 | PR description names the invariant(s) touched | Required |
| 5 | For a fix: "which test would have caught this?" answered | Required |
| 6 | Refactor and behaviour change are separate commits | Required |
| 7 | Conventional Commit format with a `Refs:` footer | Required |

---

# 17.4 Testing Criteria

## QG-09 · Coverage Thresholds

Per-path, never global (TEST-CFG-01). All are **blocking**.

| Path | Threshold | Effective From |
|---|---|---|
| **`src/core/gate/**`** | **100% statement** | PH-06 |
| **`src/infra/logger/redact.mjs`** | **100% statement** | PH-07 |
| `src/core/normalize/**` | ≥ 95% | PH-02 |
| `src/core/dates/**` | ≥ 95% | PH-03 |
| `src/core/identity/**` | ≥ 95% | PH-03 |
| `src/core/validate/**` | ≥ 95% | PH-04 |
| `src/core/reconcile/**` | ≥ 95% | PH-05 |
| `src/core/project/**` | ≥ 95% | PH-06 |
| `src/infra/retry/**` | ≥ 95% | PH-07 |
| `src/core/extract/**` | ≥ 90% | PH-13 |
| `src/app/config/**` | ≥ 90% | PH-09 |
| `src/core/**` overall | ≥ 90% | PH-01 |
| Overall | ≥ 70% | PH-06 |

**Coverage is a floor, not a goal.** A module at 92% with the wrong assertions is worse than one at 80% with the right ones.

## QG-10 · Suite Completeness

| # | Criterion | Threshold | Effective From |
|---|---|---|---|
| 1 | All fifteen property laws pass | ≥ 1,000 cases each | Progressive; complete PH-22 |
| 2 | All twenty golden fixtures pass **against their pinned packs** | 100% | PH-13 |
| 3 | Contract suite passes against every adapter built | 100% | PH-11 |
| 4 | All fourteen chaos scenarios pass | 100% | PH-21 |
| 5 | Six architecture rules pass | 100% | PH-01 (progressive) |
| 6 | Six security tests pass | 100% | PH-02 (progressive) |
| 7 | Integration suite passes, **localhost only** | 100% | PH-08 |
| 8 | Schema validation across all schemas, fixtures, configs | 100% | PH-06 |
| 9 | Default suite duration | **< 3 minutes**, offline | Always |
| 10 | `tests/live/` excluded from the default runner | Proven | PH-00 |

## QG-11 · Test Quality

Not mechanisable; enforced in review.

| # | Criterion |
|---|---|
| 1 | Every new test fails against the previous commit |
| 2 | Fixed clock and seeded random used |
| 3 | Test data built through builders, not inline literals |
| 4 | Test names are full sentences describing behaviour |
| 5 | One logical assertion per test |
| 6 | Chaos and property tests name their invariant in a comment |
| 7 | **A chaos test fails when its protection is removed** — verified for CH-04 and three randomly chosen others |
| 8 | No test asserts an implementation detail |

## QG-12 · The Invariant Traceability Gate

**If an invariant has no test, it is not enforced.** The traceability table (§54.5) is updated in the same PR that adds the test, and a phase does not close with an empty cell for any invariant it was supposed to enforce.

---

# 17.5 Performance Criteria

## QG-13 · Deterministic Budgets — Blocking

| # | Budget | Threshold | Effective From |
|---|---|---|---|
| 1 | Pure pipeline CPU, 1,000 reviews | **≤ 2 s** | PH-06 |
| 2 | `reviews.json`, 200 reviews | ≤ 180 KB raw / ≤ 60 KB gzip | PH-06 |
| 3 | `latest.json` | ≤ 24 KB raw / ≤ 9 KB gzip | PH-06 |
| 4 | Renderer bundle | **≤ 5 KB minified** | PH-23 |
| 5 | Blocked-bytes effectiveness | Non-trivial reduction, **number recorded** | PH-15 |
| 6 | Default suite duration | < 3 minutes | PH-00 |
| 7 | `ci.yml` total duration | < 5 minutes | PH-00 |

## QG-14 · Monitored, Non-Blocking

Recorded in health; never fails a build (TR-TEST-101, PERF-02).

| Metric | Healthy | Act |
|---|---|---|
| Harvest duration p95 | ≤ 180 s | > 240 s |
| Cold start, warm cache | ≤ 60 s | > 90 s |
| Peak RSS per target | ≤ 700 MB | Approaching runner limit |
| Commit churn | Stable | Sudden rise |

**Why duration is not blocking:** a flaky performance gate trains engineers to re-run CI until it passes, which destroys the value of every other test in the suite.

---

# 17.6 Documentation Criteria

## Documentation Gate (phase closure, not merge)

| # | Criterion | Applies To |
|---|---|---|
| 1 | Every exported function has JSDoc: purpose, params, returns, throws, and a `@see` to the governing SAD/TRD section | Every module |
| 2 | Every module header states its responsibility **and what it explicitly does not do** | Every module |
| 3 | Every non-obvious decision has an inline comment stating **why**, not what | Every module |
| 4 | Every new error class appears in the taxonomy table | PH-01 onward |
| 5 | Every config key documented in the schema `description` and §8 | PH-09 |
| 6 | Every selector strategy has a `notes` field | PH-12 |
| 7 | The phase's "Documentation Required" artifacts are merged | Every phase |
| 8 | Runbooks exist for every condition the phase introduces | PH-16 onward |
| 9 | The traceability table is current | Every phase |

## The Documentation Test

**A phase's documentation is sufficient when someone who did not build it can execute the phase's Verification Checklist without asking a question.** This is checked literally: the reviewer executes the checklist from the written text alone, and any question asked is a documentation defect fixed in the same session.

---

# 17.7 Release Criteria

Release criteria are the §63, §64, and §65 checklists in full. Summarised here as the gate:

| # | Criterion | Reference |
|---|---|---|
| 1 | All 14 `ci.yml` gate groups green at the tagged commit | §64.1 |
| 2 | The ten non-waivable items green | §64.4 |
| 3 | Deployment readiness complete, including measured Pages headers and a verified offsite clone | §63 |
| 4 | CHANGELOG entry; schema version unchanged or a parallel-publish plan signed | §64.2 |
| 5 | All five runbooks drilled | §64.3 |
| 6 | **Rollback path for this specific release identified before release** | TR-CI-190 |
| 7 | Canary dispatched and green; one client harvested manually and sane | §65.3 |
| 8 | Payload verified over the public CDN URL | §65.3 |
| 9 | First-client checks: zero third-party requests; clean empty state | §65.4 |
| 10 | Soak tracking started with S1–S8 owners | §65.4 |

---

# 17.8 The Per-Phase Gate Matrix

`■` = applies and blocks · `□` = applies from this phase onward · blank = not yet applicable

| Phase | QG-01 build | QG-02 lint | QG-03 arch | QG-04 deps | QG-05 review | QG-09 cov | QG-10 suites | QG-13 perf | Docs |
|---|---|---|---|---|---|---|---|---|---|
| PH-00 | □ | □ | | □ | ■ | □ | □ | □ | ■ |
| PH-01 | ■ | ■ | □ | ■ | ■ | □ | ■ | ■ | ■ |
| PH-02 | ■ | ■ | ■ | ■ | ■ | **■ 95%** | ■ | ■ | ■ |
| PH-03 | ■ | ■ | ■ | ■ | ■ | ■ 95% | ■ | ■ | ■ |
| PH-04 | ■ | ■ | ■ | ■ | ■ | ■ 95% | ■ | ■ | ■ |
| PH-05 | ■ | ■ | ■ | ■ | **■ ×2** | ■ 95% | ■ | ■ | ■ |
| PH-06 | ■ | ■ | ■ | ■ | **■ ×2** | **■ 100%** | ■ | ■ | ■ |
| PH-07 | ■ | ■ | ■ | ■ | ■ | **■ 100%** | ■ | ■ | ■ |
| PH-08 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-09 | ■ | ■ | ■ | ■ | ■ | ■ 90% | ■ | ■ | ■ |
| PH-10 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-11 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-12 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-13 | ■ | ■ | ■ | ■ | ■ | ■ 90% | ■ | ■ | ■ |
| PH-14 | ■ | ■ | **■ DR-3** | **■ +1 dep** | ■ | ■ | ■ | ■ | ■ |
| PH-15 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | **■ bytes** | ■ |
| PH-16 | ■ | ■ | ■ | ■ | **■ ×2** | ■ | ■ | ■ | ■ |
| PH-17 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-18 | ■ | ■ | **■ post-gate** | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-19 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-20 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-21 | ■ | ■ | ■ | ■ | ■ | ■ | **■ all 14** | ■ | ■ |
| PH-22 | ■ | ■ | ■ | ■ | ■ | ■ | **■ ×4** | ■ | ■ |
| PH-23 | ■ | ■ | ■ | **■ zero** | ■ | ■ | ■ | **■ 5 KB** | ■ |
| PH-24 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |
| PH-25 | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ | ■ |

---

# 17.9 Gate Failure Handling

| Failure | Response | Never |
|---|---|---|
| Build gate fails | Fix the code | Add a type suppression, relax a lint rule, or baseline the error |
| Architecture gate fails | Fix the import | Add an exception to the architecture test |
| Coverage gate fails | Add the missing tests | Lower the threshold |
| A property law fails | **Stop.** Either the implementation is wrong or the law is wrong — resolve which, with the Architect | Skip the test, reduce the case count, or narrow the generator |
| A chaos scenario fails | **Stop.** The system does not survive a failure it is designed to survive | Weaken the assertion |
| A golden fixture fails | Determine whether the output change was intended. If yes, regenerate and **say so explicitly** in the PR. If no, fix the code | Regenerate silently |
| A performance budget fails | Fix the regression | Raise the budget |
| A security test fails | **Stop and escalate to Security** | Anything else |
| The live smoke test fails | Open an issue; do not block the PR | Make it blocking "just this once" |

## 17.9.1 The Only Sanctioned Waiver Path

A blocking gate may be waived only by a **merged PCR** (§0.9) approved by the Engineering Manager, plus the Architect when an invariant is touched — and never for the ten non-waivable items (§64.4). The waiver records what was waived, why, who approved it, and the date by which it is resolved.

**In sixteen weeks this path should be used zero times.** It exists so that the answer to "can we ship without X?" is a documented decision rather than a quiet omission.

---

## Part 17 Summary

| Class | Named Gates | Blocks |
|---|---|---|
| Build Success | QG-01 compilation · QG-02 lint/format · QG-03 architecture · QG-04 dependencies | Merge |
| Code Review | QG-05 checklist · QG-06 depth by difficulty · QG-07 architect-review modules · QG-08 PR hygiene | Merge |
| Testing | QG-09 coverage · QG-10 suite completeness · QG-11 test quality · QG-12 traceability | Merge / phase |
| Performance | QG-13 blocking budgets · QG-14 monitored metrics | Merge / none |
| Documentation | The nine documentation criteria + the documentation test | Phase closure |
| Release | §63, §64, §65 in full, including the ten non-waivable items | Release |

**Two thresholds in this part are absolute and appear nowhere else in the plan as negotiable:** 100% statement coverage on `core/gate/**` and on `infra/logger/redact.mjs`. One stands between a bad harvest and every client website; the other stands between a secret and a permanent public record. Neither has a waiver path.

---

*End of Part 17. Part 18 contains the appendices: indexes, traceability, and the quick-reference card.*
