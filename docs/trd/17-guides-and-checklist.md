# Part 17 — Guides and Final Checklist

*Sections 97 through 100. Audience: new engineers, operators, and the person doing the first production deployment. §100 is the acceptance gate for v1.0.*

---

# 97. Developer Setup Guide

**Target: from a clean machine to a green offline test run in under four hours, including reading time.**

## 97.1 Prerequisites

| Requirement | Version | Verify With |
|---|---|---|
| Node.js | Matching `.nvmrc`, LTS ≥ 20 | `node --version` |
| npm | Bundled with Node | `npm --version` |
| Git | ≥ 2.30 | `git --version` |
| Disk space | ~2 GB free | — |
| Editor | Any with JSDoc / `checkJs` support | — |
| Network | Required for setup only; **not for testing** | — |

## 97.2 Hour 1 — Orientation (Read, Do Not Code)

| # | Read | Why |
|---|---|---|
| 1 | SAD §0.8 — the ten invariants | Everything else is in service of these |
| 2 | SAD Appendix G — the quick-reference card | One page, pinned above the desk |
| 3 | TRD §0.5 — how to use this document | Especially A-1 through A-10 |
| 4 | TRD §1 — technical overview | The shape of a run |
| 5 | TRD §22.5 — the asymmetry rule | The single most consequential piece of logic |
| 6 | TRD §92.2 — the five risks worth re-reading before coding | What goes wrong, and why it goes wrong silently |

**The five things to hold in memory:**

1. The website never talks to the review source.
2. A failed harvest must never make the client's site worse. **Last Known Good, always.**
3. **Absence is not deletion.**
4. Volatile knowledge lives in data files, not code.
5. A challenge means **stop**, not try harder.

## 97.3 Hour 2 — Local Setup

| # | Step | Expected Result |
|---|---|---|
| 1 | Clone the repository | — |
| 2 | `nvm use` (or install the pinned Node major) | Version matches `.nvmrc` |
| 3 | `npm ci` | Dependency tree installed from the lockfile exactly |
| 4 | `npx playwright install chromium` | Pinned browser present |
| 5 | `cp .env.example .env` | Local overrides available |
| 6 | **`npm test`** | **Green, offline, under three minutes** |
| 7 | `node bin/tpre.mjs doctor` | Versions, caches, secrets, checkouts reported |
| 8 | `node bin/tpre.mjs plan` | Due set printed; **no side effects** |

**Step 6 is the gate for "the environment works."** If the full default suite is green with the network disconnected, setup is correct.

| ID | Requirement |
|---|---|
| TR-STD-140 | `npm ci` MUST be used, never `npm install`. An install that resolves ranges produces a different tree — including potentially a different browser build. |

## 97.4 Hour 3 — Run the Pipeline Offline

| # | Step | What It Demonstrates |
|---|---|---|
| 1 | `npm run parse:fixture -- 001` | The pure extractor against saved markup — the inner loop of incident repair |
| 2 | `npm run parse:fixture -- 014` | An adversarial fixture classifying as `partial` |
| 3 | `node fixtures/server/serve.mjs` in one terminal | A real HTTP server for real browser tests |
| 4 | Run the integration suite against it | Navigation, pagination, stall detection, expansion |
| 5 | `tpre harvest --client <test> --dry-run` | The full eleven-stage pipeline with zero writes |
| 6 | `tpre project --client <test>` | Payload regeneration from the Ledger with no network |
| 7 | Inspect `.publish/` | What a payload actually looks like |

**By the end of hour 3, a new engineer has run every stage of the system without touching the internet.** That is the property that makes this codebase pleasant to work on.

## 97.5 Hour 4 — Client Onboarding Walkthrough (Dry Run)

| # | Step |
|---|---|
| 1 | `node scripts/new-client.mjs` — scaffold a config from the template |
| 2 | Read `clients/_template.config.json` and every field's comment |
| 3 | `tpre validate-config --explain` — see the six-layer resolution trace |
| 4 | Deliberately break a rule (mismatch the slug) and observe V-1 fail |
| 5 | Deliberately set `adapter: google:dom` without an authorisation block; observe **V-3** fail |
| 6 | Deliberately exceed a hard ceiling; observe the **error, not a clamp** |
| 7 | Delete the config |

**Steps 4 through 6 matter more than steps 1 through 3.** Understanding what the system refuses to do, and why, is what prevents an engineer from later "fixing" a validation rule that is working as intended.

## 97.6 Deep Reading by Role

| Role | Read Next |
|---|---|
| Backend | §15–§30, §49–§58 |
| DevOps | §11–§14, §31–§36, §62–§66 |
| QA | §61, §38–§40, §65–§66 |
| Security | §47–§54 |
| Frontend / integrator | §52, §24, §51, §70 |

## 97.7 First Supervised Tasks

Ordered so each builds on the last and each is verifiable.

| # | Task | Teaches |
|---|---|---|
| 1 | Add a locale phrase to the date phrase table with tests | The data-not-code principle |
| 2 | Add a fixture from a saved snapshot and write its `expected.json` | The regression loop |
| 3 | Add a per-record validation finding | The verdicts-not-mutations rule |
| 4 | Add a gate rule (behind a warn verdict) with 100% coverage | The gate's testing discipline |
| 5 | Add a new error class end to end: taxonomy, retry table, severity, runbook | The mechanical-classification model |

**Task 5 is the graduation exercise.** Adding an error class correctly requires touching the taxonomy, the retry policy, the severity map, the recovery matrix, and a runbook — which means understanding how the mechanical parts of the system fit together.

## 97.8 Where to Ask

| Question | Source |
|---|---|
| "Why is it built this way?" | The SAD's ADR set |
| "How exactly do I build this?" | This document |
| "What broke and what do I do?" | `docs/runbooks/` |
| "What does this config value do?" | §8.4, or `tpre validate-config --explain` |
| "Which test would catch this?" | §61.15 traceability tables |

---

# 98. Local Development Guide

## 98.1 Development Defaults

| Setting | Value | Reason |
|---|---|---|
| `TPRE_ENV` | `development` | Enables `.env` loading |
| `TPRE_NO_PUBLISH` | `true` | A local run must never write to a real branch |
| Publisher | `filesystem` | Writes to `.publish/` for inspection |
| Notifier | `console` | No issues opened from a laptop |
| Log format | `pretty` | Human-readable |
| `resolution.allow_search` | `true` | Convenience during onboarding; **forbidden in production** |
| Browser | headless (`--headed` available locally) | §17 |

| ID | Requirement |
|---|---|
| TR-ENV-050 | The config loader MUST refuse to read `.env` unless `TPRE_ENV=development`. A stray local file must not be able to influence a production run. |

## 98.2 The Inner Loops

Four loops of increasing cost. **Use the cheapest one that can reproduce the problem.**

| Loop | Command | Round-trip | Use For |
|---|---|---|---|
| **Pure logic** | `npm run test:watch` | < 1 s | Reconciliation, normalisation, hashing, gate rules |
| **Extraction** | `npm run parse:fixture -- <nnn>` | < 10 s | Selector packs, field parsing, date locales |
| **Browser** | fixture server + integration test | < 60 s | Navigation, pagination, stall detection, expansion |
| **Full pipeline** | `tpre harvest --dry-run --from-fixture` | < 90 s | End-to-end behaviour, gate decisions |

**The extraction loop is the one that matters most operationally.** It is the inner loop of the selector-repair runbook, and getting a production failure into it takes one file copy from the diagnostics bundle.

## 98.3 Reproducing a Production Failure Locally

| # | Step | Time |
|---|---|---|
| 1 | Download the diagnostics bundle from the failed run's artifacts | 2 min |
| 2 | Read `error.json` and `selector-health.json` | 5 min |
| 3 | Copy `snapshot.html` into `fixtures/dom/google/<nnn>-<description>/page.html` | 1 min |
| 4 | Write `meta.json` recording capture date and pack version | 2 min |
| 5 | `npm run parse:fixture -- <nnn>` — **reproduce the failure offline** | < 1 min |
| 6 | Iterate on the selector pack until extraction is correct | 10–20 min |
| 7 | Write `expected.json` | 3 min |
| 8 | Run the full golden suite: the new pack passes new + pack-agnostic fixtures; **old packs still pass theirs** | 2 min |

**Total to a reproducible offline test: about ten minutes.** That is the payoff of EDR-015 (extraction operates on a string) and TR-EXT-012 (snapshots are fixture-compatible).

## 98.4 Common Development Tasks

| Task | Command |
|---|---|
| Check the environment | `tpre doctor` |
| See what is due | `tpre plan` |
| Explain where a config value came from | `tpre validate-config --explain` |
| Test a client offline | `tpre harvest --client X --dry-run` |
| Rebuild payloads with no network | `tpre project --client X` |
| Compare ledger against published payload | `tpre project --client X --verify` |
| Reproduce an extraction failure | `npm run parse:fixture -- <nnn>` |
| Add a client | `node scripts/new-client.mjs` |
| Capture a fixture | `node scripts/capture-fixture.mjs` |
| Export a client's data | `tpre export --client X` |
| Check size budgets | `npm run size` |

## 98.5 Development Safety Rails

| Rail | Mechanism | Prevents |
|---|---|---|
| No accidental publish | `TPRE_NO_PUBLISH=true` default + `filesystem` publisher | Writing to a real `data` branch |
| No accidental alert | `console` notifier default | Opening issues during local testing |
| No accidental live request | Default suites are offline; live tests opt-in | Source requests on every test run |
| No stale `.env` in CI | Loader refuses `.env` outside development | Local settings influencing production |
| No secret commit | `.gitignore` on `.env`; push-time scanning | An irreversible public exposure |
| No headed mode in CI | `--headed` refused outside development | Non-reproducible behaviour |

## 98.6 Debugging Guidance

| Symptom | First Check | Then |
|---|---|---|
| Pagination stalls unexpectedly | The growth curve in `acquisition-report.json` | Run headed locally and watch the container scroll |
| Extraction returns zero | Is the empty-state signal present? | Reproduce against the fixture |
| A field is null for every record | `selector-health.json` — which strategy index resolved | Pack repair |
| Dates are all null | Is the context locale correct for this client? | Locale phrase table |
| Gate rejects unexpectedly | The itemised reasons in the verdict | Compare candidate vs current counts |
| Every run writes every file | Content hash includes something volatile | §54.5 failure-mode table |
| A property test fails intermittently | Something in `core/` is reading the clock or randomness | DR-2 |

---

# 99. Production Deployment Guide

## 99.1 Pre-Deployment Requirements

| # | Requirement | Verify |
|---|---|---|
| 1 | All CI gates green on `main` | CI run |
| 2 | Branch protection active on `main` | Settings |
| 3 | `data` and `state` orphan branches created | `git branch -a` |
| 4 | Machine branches writable only by the workflow token and admins | Settings |
| 5 | All eight workflows present, each with an explicit `permissions` block | Workflow lint |
| 6 | Repository variables configured | Settings |
| 7 | Secrets configured for any API adapters in use | `tpre doctor` |
| 8 | **CDN response headers verified and recorded in `docs/runbooks/`** | Manual |
| 9 | **Offsite clone including `data` and `state` created** | Manual |
| 10 | Keepalive run manually, no spurious issue | Workflow run |

## 99.2 Deployment Sequence

| # | Step | Verification |
|---|---|---|
| 1 | Create the repository; decide public or private | Repository exists |
| 2 | Push the engine to `main` | CI green |
| 3 | Configure branch protection | Settings verified |
| 4 | Create `data` orphan branch with `.nojekyll`, `robots.txt`, `_headers`, `README.md` | Branch exists, no shared history |
| 5 | Create `state` orphan branch with placeholders and `README.md` | Branch exists |
| 6 | Enable Pages from the `data` branch root | A test file served over HTTPS |
| 7 | **Verify and record actual response headers** | Documented |
| 8 | Configure repository variables | Visible in settings |
| 9 | Configure secrets | `tpre doctor` reports present |
| 10 | Enable and verify all schedules | All schedules active |
| 11 | Run `keepalive` manually | Green, no issue opened |
| 12 | **Create the offsite clone** | Clone exists outside the primary account |
| 13 | Onboard the first client | Payload published |
| 14 | Run payload verification manually | Reachable, schema-valid, non-empty |
| 15 | Configure a custom domain if used; **re-verify headers** | HTTPS on the custom domain |
| 16 | Run the adapter migration drill on a scratch client | Completed under one hour |
| 17 | Begin the 30-day soak | Criteria tracked |

## 99.3 The Soak Period

Thirty days with the first client before onboarding a second.

| Signal | Healthy | Investigate |
|---|---|---|
| Harvest success rate | > 98% | < 95% |
| Coverage | > 0.97 | < 0.95 |
| Gate rejections | < 2% | > 10% |
| Selector strategy index-0 rate | 100% | < 95% |
| p95 harvest duration | < 150 s | > 240 s |
| Payload age p95 | < 8 h | > 24 h |
| **Challenges in 30 days** | **0** | **≥ 1** |
| Commits per client per week | < 5 | > 30 |
| Peak RSS per target | < 700 MB | rising across a shard |

| ID | Requirement |
|---|---|
| TR-ENV-060 | A second client MUST NOT be onboarded until the soak completes with no unresolved `high` or `critical` condition. The soak exists to find the problems that only appear against real, changing upstream data. |

## 99.4 Steady-State Operations

| Activity | Frequency | Effort |
|---|---|---|
| Reading the weekly digest | Weekly | 10 min |
| Responding to `warn` alerts | ~monthly | 30 min |
| Selector pack repair | 1–3 × / year | 2–8 h each |
| Dependency and browser updates | Quarterly | 1–2 h |
| Fixture corpus refresh | Quarterly | 1–2 h |
| Data history truncation | Quarterly | 30 min |
| Document and assumption review | Quarterly | 2 h |
| DR drills | Per §60.9 | ~1 h/quarter |
| Client onboarding | Per client | 20 min |
| **Steady-state total** | | **2–6 h/quarter, plus 4–8 h spikes 1–3 × / year** |

**This is the honest maintenance cost and must be represented accurately in any commercial model.** The engine is not zero-maintenance; it is *low and predictable* maintenance, which is a different and more defensible claim.

## 99.5 Emergency Levers

| Situation | Action |
|---|---|
| Stop all DOM acquisition now | `TPRE_POLICY_DOM_ENABLED=false` |
| Stop everything now | `TPRE_POLICY_ENABLED=false` |
| Undo a bad payload | `tpre project`, or `git revert` on `data` |
| Undo a bad selector pack | Revert the one-line pin in the profile |
| Silence non-critical alerts | `TPRE_MAINTENANCE_MODE=true` |
| Reduce source pressure | Lower `MAX_PARALLEL`; move clients to a slower tier |

## 99.6 When In Doubt

> **Do not publish. Stale correct data beats fresh wrong data, every time.**

---

# 100. Final Technical Checklist

**This is the acceptance gate for v1.0.** Every item is verifiable, and every unchecked item is a conformance gap.

## 100.1 Architecture Conformance

| # | Item | Verified By |
|---|---|---|
| 1 | All eleven pipeline stages implemented in order | Integration test |
| 2 | Six pure stages provably pure | DR-1, DR-2 architecture tests |
| 3 | `core/` imports nothing from other layers | DR-1 |
| 4 | `core/` references no clock, randomness, environment, or I/O | DR-2 |
| 5 | No adapter imports another adapter | DR-3 |
| 6 | `app/` imports no concrete adapter | DR-4 |
| 7 | Only `cli/composition.mjs` constructs implementations | DR-5 |
| 8 | No import reaches past a package index | DR-6 |
| 9 | `playwright` imported by exactly one file | DR-3 |
| 10 | No cycles within `core/` | Architecture test |

## 100.2 Invariant Enforcement

| # | Invariant | Test |
|---|---|---|
| 11 | INV-01 — website never contacts a source | Consumer network assertion |
| 12 | INV-02 — failure never degrades the payload | CH-01, CH-04, CH-05, CH-06 |
| 13 | **INV-03 — absence is not deletion** | **PT-07, CH-04** |
| 14 | INV-04 — reconciliation idempotent | PT-01 |
| 15 | **INV-05 — output safe as untrusted text** | **PT-10, CH-14, `security.xss-fixture`** |
| 16 | INV-06 — full provenance on every payload | Schema validation |
| 17 | INV-07 — a challenge is terminal | CH-03, `retry-policy.blocked-never` |
| 18 | INV-08 — no secret in any artifact | `security.redaction` |
| 19 | INV-09 — client isolation | `security.isolation` |
| 20 | INV-10 — adapter switch by config only | PT-08, migration drill |

## 100.3 Correctness Mechanisms

| # | Item |
|---|---|
| 21 | The asymmetry rule increments streaks only on `full` harvests |
| 22 | Tombstones never resurrect (PT-03) |
| 23 | Suppressions never appear in any payload (PT-04) |
| 24 | `first_seen_at` and pinned dates never change after INSERT (PT-05, PT-06) |
| 25 | Rating integer post-check implemented |
| 26 | Owner-reply detachment happens before all other extraction |
| 27 | Normalisation runs the eight steps in the specified order |
| 28 | Length bounding is grapheme-cluster-aware |
| 29 | Homoglyph author names are not merged |
| 30 | Identity uses only cross-adapter-available fields |
| 31 | `relative_date` excluded from `content_hash` |
| 32 | `generated_at` excluded from every content hash |
| 33 | Projection is byte-deterministic (PT-12) |
| 34 | Publication order is payload-then-state |
| 35 | Rejection writes only a health record — not the ledger |

## 100.4 Safety and Resilience

| # | Item |
|---|---|
| 36 | All twelve gate rules implemented and independently testable |
| 37 | Gate statement coverage at 100% |
| 38 | First-publish exception skips exactly G-02–G-05 and G-12 |
| 39 | "No prior payload" distinguished from "could not read prior payload" |
| 40 | Force override cannot downgrade G-01, G-02, G-06, or G-07 |
| 41 | Every `ERR-BLOCKED-*` class returns retry `never` |
| 42 | Circuit breaker is per source-access pair |
| 43 | Six nested timeout levels, each strictly inside the next |
| 44 | Browser contexts closed in `finally` on every path |
| 45 | All fourteen chaos scenarios pass |

## 100.5 Security

| # | Item |
|---|---|
| 46 | Seven-layer output safety implemented |
| 47 | Redaction applied at the sink, seeded before the first log event |
| 48 | Redaction module at 100% coverage |
| 49 | URL host allowlist enforced; invalid URLs nulled |
| 50 | No secret in any file, config, ledger, or artifact |
| 51 | Adapters fail closed on a missing secret |
| 52 | Every workflow declares an explicit minimum `permissions` block |
| 53 | The `alert` job has no `contents` permission |
| 54 | All third-party actions SHA-pinned |
| 55 | No `pull_request_target` anywhere |
| 56 | No untrusted interpolation into `run:` blocks |
| 57 | Schemas set `additionalProperties: false` |
| 58 | No proxy, fingerprint, storage-state, or evasion code present |

## 100.6 Operations

| # | Item |
|---|---|
| 59 | Eight workflows present and each verified green at least once |
| 60 | Four cron entries with off-round minutes |
| 61 | Shard matrix emitted by the `plan` job |
| 62 | `fail-fast: false` on the harvest matrix |
| 63 | `data` checkout present in the shard job |
| 64 | Exit codes 5, 6, 7 do not fail the job |
| 65 | Diagnostics and manifest uploaded with `if: always()` |
| 66 | Health record written for every target on every run |
| 67 | Keepalive asserts the harvest workflow's active state |
| 68 | Payload verification job runs daily against the public URL |
| 69 | Alerts deduplicated by fingerprint and auto-closing |

## 100.7 Quality

| # | Item |
|---|---|
| 70 | Default suite passes offline in under three minutes |
| 71 | All 15 property laws pass at ≥ 1,000 cases |
| 72 | All 20 golden fixtures pass against their pack versions |
| 73 | Contract suite passes against all four adapters |
| 74 | All 6 architecture rules pass |
| 75 | All 6 security tests pass |
| 76 | Size budgets enforced and passing |
| 77 | `core/` coverage ≥ 90%; overall ≥ 70% |
| 78 | Lint, format, and type check clean |
| 79 | Dependency audit clean of high-severity findings |
| 80 | `tests/live/` excluded from the default runner |

## 100.8 Configuration and Contracts

| # | Item |
|---|---|
| 81 | Six-layer precedence chain with a resolution trace |
| 82 | Effective config deeply frozen |
| 83 | Unknown `TPRE_*` variables rejected at startup |
| 84 | Ceiling breaches are errors, not clamps |
| 85 | Semantic rules V-1…V-12 implemented; V-1…V-7 blocking |
| 86 | Every config key has a code-level default |
| 87 | Payload validates against `payload.v1.schema.json` |
| 88 | `display.min_rating` defaults to `null` |
| 89 | `publish.schema_org` defaults to `false` |
| 90 | Client slugs and listing keys documented as immutable |

## 100.9 Delivery and Recovery

| # | Item |
|---|---|
| 91 | Hash-gating verified: a second identical run writes nothing |
| 92 | Push uses rebase-retry; no force-push against `data` or `state` |
| 93 | Commits batched one per shard per branch |
| 94 | Machine commit message format implemented |
| 95 | `tpre project` regenerates payloads with zero network requests |
| 96 | Ledger restorable from Git history |
| 97 | Offsite clone exists including `data` and `state` |
| 98 | Adapter migration drill completed in under one hour |
| 99 | All runbooks present and referenced from error classes |
| 100 | This document and the SAD are in sync with the implementation |

---

## 100.10 The Ten That Cannot Be Waived

If schedule pressure forces a partial release, these ten are the ones with no acceptable workaround. Every other item can be scheduled; **these define whether the system is safe to point at a paying client.**

| # | Item | Consequence of Omission |
|---|---|---|
| 13 | INV-03 — PT-07 and CH-04 | A partial page load begins a countdown to deleting a client's reviews |
| 15 | INV-05 — PT-10 and CH-14 | Stored XSS across every client site simultaneously |
| 37 | Gate coverage at 100% | The last line of defence is unverified |
| 39 | Unreadable-prior distinguished from no-prior | An infrastructure blip publishes an unvalidated payload |
| 41 | `ERR-BLOCKED-*` never retried | A soft block escalates into a durable one |
| 47 | Redaction seeded before the first log event | Irreversible secret exposure in a public repository |
| 51 | Adapters fail closed on a missing secret | A silent downgrade from a sanctioned API to unsanctioned scraping |
| 63 | `data` checkout present in the shard job | The four most valuable gate rules silently stop working |
| 91 | Hash-gating verified | 15× repository growth, invisible until unwieldy |
| 95 | `tpre project` works offline | The primary recovery path does not exist |

---

## 100.11 Sign-Off

| Role | Confirms | Signature | Date |
|---|---|---|---|
| Staff Software Architect | §100.1, §100.2, §100.3 | | |
| Senior Backend Engineer | §100.3, §100.4, §100.8 | | |
| DevOps Engineer | §100.6, §100.9 | | |
| QA Lead | §100.7, and every item in §100.10 | | |
| Security Engineer | §100.5 | | |
| Product | §100.8 disclosure obligations, soak criteria | | |

---

*End of the Technical Requirements Document.*

**A closing note for whoever implements this.** The hardest parts of this system are not technically difficult. Reconciliation is a map merge; normalisation is a string pipeline; the gate is twelve comparisons. What makes them hard is that **each has a plausible simpler version that is wrong in a way no test catches unless the test was written on purpose.** That is why this document names those tests, names the specific wrong implementations, and explains why each one is tempting. Build it in the given order, write the named tests first, and the rest is ordinary engineering.
