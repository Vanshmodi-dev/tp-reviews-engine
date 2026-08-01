# Part 14 — Task Breakdown: Publication, Hardening, and Launch

*Tasks T-258 through T-342. Phases PH-18 through PH-25 plus hardening. Milestones MS-7, MS-8, MS-9. Sprints SP-6 through SP-8. Weeks 12–16.*

*Column conventions are defined at the head of Part 12. Reserved ID blocks: PH-18…PH-25 → T-961…T-980; SP-8 hardening and defect repair → T-981…T-999.*

---

# PH-18 · Git Publisher and Hash-Gating

**Sprint SP-6 · Week 12 · 32 IEH · 11 tasks · Difficulty D3**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-258 | `infra/git.mjs` — core operations | Checkout, stage, commit against a temp repository; **no force flags anywhere** (PUB-04) | T-257 | D3 | P0 | 4 | Module | `--force`/`--force-with-lease` absent from the repository | Repository-wide grep, recorded in the PR | Revert |
| T-259 | `infra/git.mjs` — injection safety | `node:child_process` receives **no** value derived from acquired content, issue text, or config free-text (TR-DEP-001, GH-02) | T-258 | D4 | P0 | 3 | Implementation + review record | Every argument traced to a trusted origin | **Second reviewer traces each call site** | Revert |
| T-260 | Fetch-rebase-retry push | Up to three attempts (TR-PUB-003) | T-258 | D3 | P0 | 3 | Function | Conflict resolves; artifacts identical after rebase | CH-11 at PH-21 | Revert |
| T-261 | `adapters/publisher/git-data.mjs` — staging | Stage accepted artifacts into the `data` checkout | T-258, T-121 | D3 | P0 | 3 | Module | Only post-gate artifacts reach staging | Architecture assertion | Revert (`filesystem` publisher) |
| T-262 | **Hash-gating** | Skip the write entirely when new bytes equal current bytes (PUB-02, TR-PUB-001) | T-261 | D4 | P0 | 4 | Logic | Byte comparison, not timestamp comparison | Reviewer runs two identical harvests | Revert |
| T-263 | **Hash-gating integration test** | Two identical runs ⇒ **zero writes, zero commits** on the second | T-262 | D4 | P0 | 2.5 | Integration test | The single most valuable regression guard for IR-06 | Reviewer runs it | Revert |
| T-264 | One commit per shard per branch | Batched commits (PUB-03, CON-13) | T-262 | D3 | P0 | 2.5 | Logic | Commit count equals shard count, not target count | Count commits after a 3-target run | Revert |
| T-265 | Commit message format | Machine-generated Conventional Commits | T-264 | D2 | P0 | 1.5 | Function | Parseable by `release.yml` | Format test | Revert |
| T-266 | **Publish order: payload then state** | Never the reverse (PUB-01, EDR-025) | T-264 | D4 | P0 | 3 | Sequencing | Crash between writes is self-healing on the next run | Crash-injection test | Revert |
| T-267 | **Post-gate reachability architecture test** | `adapters/publisher/` reachable only from the post-gate branch (TR-TEST-071, PUB-05) | T-261 | D3 | P0 | 3 | Architecture test | A pre-gate call path fails the build | Reviewer adds one | Revert |
| T-268 | `tests/integration/publish.git.test.mjs` | Staging, hash-gating, commit format, rebase-retry against a temp repository | T-266 | D3 | P0 | 2.5 | Integration test | Green offline | CI | Revert |

**PH-18 totals: 11 tasks · 32 IEH.**

---

# PH-19 · Harvest Workflow and Composite Action

**Sprint SP-6 · Week 13 · 30 IEH · 11 tasks · Difficulty D3 · Closes MS-7 at DG-08**

**Stop Condition.** This phase makes the first live-source contact. Only one engineer performs it, from one machine, with the rate limiter active (§7.6).

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-269 | `setup-engine` composite action | Node from `.nvmrc`, npm cache, `npm ci`, Playwright version detection, **exact-key** browser cache, conditional install (CI-01) | T-268 | D3 | P0 | 4 | `action.yml` | Setup exists exactly once | Reviewer confirms no duplicated setup in any workflow | Revert |
| T-270 | **Versions banner** | Node, npm, Playwright, browser, engine version printed into the job log (CI-02, TR-CI-140) | T-269 | D2 | P0 | 1 | Step | "Which browser produced this payload?" answerable from the log | Read a job log | Revert |
| T-271 | Cold/warm cache timing measurement | Record both, verifying TA-03 | T-269 | D2 | P0 | 1.5 | Recorded numbers | Cold-start cost known, not assumed | Reviewer reads the record | N/A |
| T-272 | `plan` job emitting the shard matrix | Matrix as a job output, **never hard-coded** (EDR-029, SCHED-05) | T-269, T-248 | D3 | P0 | 3 | Workflow job | Matrix visible in the run | Read the run | Revert |
| T-273 | `harvest` matrix job with `fail-fast: false` | Per-shard execution with isolation (INV-09) | T-272 | D3 | P0 | 3 | Workflow job | One shard failing does not cancel others | Force one shard to fail | Revert |
| T-274 | **`data` and `state` checkouts in every publishing job** | Both, always, with a comment stating why (CI-03, TR-CI-022, IR-10) | T-273 | D3 | P0 | 2.5 | Workflow steps | Gate comparison works | Reviewer removes the `data` checkout in a scratch branch and confirms the gate degrades | Revert |
| T-275 | Exit-code classification step | 0/4/5/6/7 ⇒ success; 1/2/3 ⇒ failure (CI-04, EDR-030) | T-273 | D3 | P0 | 3 | Step | A gate rejection is not a red build | One dispatch per code | Revert |
| T-276 | `collect` job | Manifest assembly, artifact upload, retention per TRD §63.4 | T-273 | D2 | P0 | 3 | Workflow job | Retention set per artifact class | Inspect artifacts | Revert |
| T-277 | `alert` job with **no `contents`** | Structurally incapable of touching data (TR-CI-130) | T-276 | D3 | P0 | 2 | Workflow job | Permission block has no `contents` | Reviewer reads the block | Revert |
| T-278 | Four cron schedules, tier-offset | Premium 6 h, standard 12 h, economy 24 h; offset from the canary (§28.3) | T-273 | D2 | P0 | 2 | Schedules | No two tiers share a start minute; canary offset from all | Reviewer compares cron expressions | Disable schedules |
| T-279 | **First live-source contact** | One manual dispatch against the canary reference listing with `--no-publish`; TA-01/TA-04 verified | T-278 | D4 | P0 | 5 | Run record + measurements | Rate limiter active; one machine; one engineer | Recorded run URL and observed behaviour | Disable the schedule immediately |

**PH-19 totals: 11 tasks · 30 IEH.**

---

# PH-20 · Diagnostics, Health, and Alerting

**Sprint SP-7 · Week 14 · 36 IEH · 11 tasks · Difficulty D2**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-280 | `schemas/health-record.v1.schema.json` | The health record contract (HLTH-03) | T-279 | D2 | P0 | 2 | Schema | Validates a real record | Schema check | Revert |
| T-281 | `infra/health/recorder.mjs` | **Append-only** JSONL, one record per target per run, every outcome (HLTH-01/02, EDR-033) | T-280, T-149 | D3 | P0 | 4 | Module | Never read-modify-writes the series | Concurrent two-shard append test | Revert |
| T-282 | Derived signals | Yield delta, coverage, duration percentile, strategy histogram, computed **at read time** (HLTH-04) | T-281 | D3 | P0 | 3.5 | Functions | No stored running aggregates | Reviewer checks for stored aggregates | Revert |
| T-283 | `schemas/run-manifest.v1.schema.json` + manifest write | Per-run rollup persisted to `state` | T-281 | D2 | P0 | 2.5 | Schema + writer | Every target present | Manifest test | Revert |
| T-284 | Metric computation | The nine metrics of §46.1 from the health series | T-282 | D2 | P0 | 4 | Functions + tests | Each verified against a synthetic 30-day series | Reviewer hand-computes two | Revert |
| T-285 | **`MET-commit-churn`** | Commit-count trend on `data` (MET-02, IR-06) | T-284 | D3 | P0 | 2 | Metric | Detects a hash-gating regression | Deliberately break hash-gating in a scratch branch | Revert |
| T-286 | `infra/diagnostics/snapshot.mjs` | Sanitised HTML and screenshot capture; strips tokens and cookies | T-253 | D3 | P0 | 3.5 | Module | No secret in any capture | `security.redaction` extension | Revert |
| T-287 | `infra/diagnostics/bundle.mjs` | The seven-file per-target bundle with config secrets stripped | T-286 | D3 | P0 | 3 | Module | Bundle reproducible; **the serialised subtree is fixture-shaped** (SER-03) | Reviewer replays a bundle as a fixture | Revert |
| T-288 | `adapters/notifier/github-issues.mjs` | Fingerprint dedup, open → comment → close lifecycle, rate limiting (MON-01, MON-04) | T-284 | D3 | P0 | 5 | Module | **Never fails the run** (MON-02) | Force a notifier error; run still succeeds | Revert (`console`) |
| T-289 | `webhook.mjs` and `console.mjs` notifiers | Secondary and local implementations (API-PREP-01) | T-288 | D2 | P1 | 2.5 | Two modules | Two implementations validate the port | Contract-style test | Revert |
| T-290 | Alert lifecycle integration test + maintenance mode | Open, comment, close, dedupe; `TPRE_MAINTENANCE_MODE` suppresses non-critical only (MON-05) | T-288 | D3 | P0 | 4 | Integration test | Three occurrences ⇒ one issue, two comments | Reviewer triggers three times | Revert |

**PH-20 totals: 11 tasks · 36 IEH.**

---

# PH-21 · Chaos Suite

**Sprint SP-7 · Weeks 14–15 · 34 IEH · 13 tasks · Difficulty D4 · Written by the QA architect**

**Ownership rule (§54.3):** these are written by someone who did not write the code under test. Each task's acceptance includes the **protection-removal check** — remove the protection, confirm the test fails.

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-291 | Injection harness | Fourteen switchable injections driven from the fixture server and temp repositories (§60.1) | T-290 | D3 | P0 | 4 | Harness | All fourteen reproducible on localhost | QA runs each | Revert |
| T-292 | **CH-01** network timeout | Retry ×2 with backoff, target fails, **LKG retained** | T-291 | D4 | P0 | 2 | Test | Asserts LKG, health record, severity, exit code | Remove the LKG retention; test fails | N/A |
| T-293 | **CH-02** HTTP 429 | Hour budget zeroed, 60 s backoff; second 429 opens the breaker | T-291 | D4 | P0 | 2 | Test | Breaker state asserted | Protection-removal check | N/A |
| T-294 | **CH-03** challenge served | **Terminal, zero retries**, breaker opens, `critical` alert, LKG retained (INV-07) | T-291 | D4 | P0 | 2.5 | Test | Asserts zero retry attempts, not just failure | Add a retry; test fails | N/A |
| T-295 | **CH-04** pagination stalls at 12 of 118 | **`partial`, additions merged, NO streak increments, gate rejects on G-05** — three independent assertions (INV-03, TR-TEST-091) | T-291 | D5 | P0 | 4 | Test | **All three protections asserted separately** | **Remove the completeness gate in streak logic; CH-04 must fail** | N/A |
| T-296 | **CH-05 / CH-06** structure absent / reviews vanish | `ERR-PARSE-STRUCTURE`; `ERR-PARSE-EMPTY-UNEXPECTED` or G-02 rejection | T-291 | D4 | P0 | 3 | Two tests | Fails loudly; never returns three silent reviews | Protection-removal check | N/A |
| T-297 | **CH-07 / CH-08** selector breaks | One field's strategies broken ⇒ fallback + health alert; all strategies broken ⇒ quarantine ⇒ gate rejects | T-291 | D4 | P0 | 3 | Two tests | Extraction still correct in CH-07 | Scratch packs | N/A |
| T-298 | **CH-09** browser crash mid-pagination | One retry; on repeat, target fails cleanly **with the context closed** | T-291 | D4 | P0 | 2.5 | Test | Open-context count returns to zero | Remove the `finally`; test fails | N/A |
| T-299 | **CH-10** ledger corruption | `ERR-STATE-CORRUPT`, target aborts, LKG retained, runbook referenced | T-291 | D4 | P0 | 2 | Test | No partial application | Protection-removal check | N/A |
| T-300 | **CH-11 / CH-12** push conflict / permanent failure | Rebase-retry ×3 succeeds; permanent failure ⇒ artifacts uploaded and **the next run reproduces byte-identically** (INV-04) | T-291 | D4 | P0 | 3.5 | Two tests | Byte-identical reproduction asserted | Compare artifact bytes across runs | N/A |
| T-301 | **CH-13** run budget exhausted | Remaining targets **`deferred`** (not failed); exit 4; no data loss | T-291 | D4 | P0 | 2 | Test | Outcome enum asserted, not just the exit code | Change to `failed`; test fails | N/A |
| T-302 | **CH-14** malicious markup | Stripped at normalisation; self-check passes; payload is plain text (INV-05) | T-291 | D4 | P0 | 2 | Test | Asserts absence of markup in the final payload bytes | Protection-removal check | N/A |
| T-303 | Load scenarios (§59.1) | Six scenarios: 1,000 and 5,000 reviews, sharding path, 10 and 50 synthetic clients, budget exhaustion — **zero live-source contact** (LOAD-01) | T-291 | D3 | P0 | 4 | Load tests | Numbers recorded, not just pass/fail (LOAD-03) | QA confirms zero external requests | N/A |

**PH-21 totals: 13 tasks · 34 IEH. All fourteen chaos scenarios are a hard release gate (TR-TEST-090).**

---

# PH-22 · API Adapters

**Sprint SP-7 · Week 15 · 40 IEH · 11 tasks · Difficulty D3 · Closes MS-8 at DG-09**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-304 | `google-places-api/client.mjs` | HTTP client with quota accounting, using `infra/http.mjs` | T-141 | D3 | P1 | 4 | Module | Quota consumed pessimistically | Unit | Revert |
| T-305 | `google-places-api/map.mjs` | Response → `ExtractedReview[]` mapping | T-304 | D3 | P1 | 3.5 | Module | Unsupported fields are `null`, never fabricated | Contract assertion 7 | Revert |
| T-306 | `google-places-api/index.mjs` | Adapter entry declaring the **~5-review ceiling honestly** | T-305 | D3 | P1 | 3 | Module | Capability descriptor states the limit | Contract assertion 1 | **Cuttable (§9.5 item 3)** |
| T-307 | `google-business-profile-api/auth.mjs` | OAuth refresh with per-client `GBP_REFRESH_TOKEN__<SLUG>` | T-141 | D3 | P0 | 5 | Module | **Missing secret ⇒ `ERR-CONFIG-SECRET-MISSING`, exit 2** | Remove a secret and run | Revert |
| T-308 | **No-fallback assertion** | An API adapter with a missing secret MUST NOT fall back to `google:dom` (ADP-04, TR-SEC-010, SEC-4) | T-307 | D4 | P0 | 2 | Test | No fallback path exists in code | Reviewer greps for adapter substitution | Revert |
| T-309 | `google-business-profile-api/client.mjs` | Paginated listing retrieval | T-307 | D3 | P0 | 4 | Module | Pagination complete; budget respected | Fixtures | Revert |
| T-310 | `google-business-profile-api/map.mjs` + `index.mjs` | Mapping and adapter entry with full capability declaration | T-309 | D3 | P0 | 4 | Modules | Complete data declared honestly | Contract assertions | Revert |
| T-311 | API fixtures | `fixtures/api/places/` and `fixtures/api/business-profile/` recorded responses | T-305, T-310 | D2 | P0 | 3 | Fixtures | Contract suite runs without network | Air-gapped run | Revert |
| T-312 | **Contract suite × 4** | Run the unchanged PH-11 suite against all four adapters (ADP-02, TR-TEST-060) | T-311, T-245, T-182 | D3 | P0 | 3 | Test runs | Nine assertions × four adapters | Reviewer confirms the suite is unmodified | Revert |
| T-313 | **PT-08 against real output from four adapters** | The real proof of INV-10 (§36.2) | T-312 | D4 | P0 | 3.5 | Extended property test | Same logical review ⇒ same identity hash across all four | CI | Revert |
| T-314 | **Adapter migration drill** | The six-step drill of §52.3 on a scratch client, target < 1 hour (S7) | T-313 | D3 | P0 | 5 | Drill record | **Identity hashes match; no review appears as new** | Reviewer observes the drill | N/A |

**PH-22 totals: 11 tasks · 40 IEH.**

---

# PH-23 · Frontend Renderer and Recipes

**Sprint SP-8 · Week 16 · 34 IEH · 11 tasks · Difficulty D2 (D4 constraint on safety)**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-315 | `frontend/renderer/tp-reviews.mjs` | Fetch, parse, render using **text-only DOM APIs**, zero dependencies (FE-01, FE-02) | T-313 | D4 | P0 | 6 | Module | No HTML-injection API present | `security.renderer-api` scan | Revert |
| T-316 | `tests/security/renderer-api.test.mjs` | Source scan asserting no injection API (TR-STD-002) | T-315 | D3 | P0 | 2 | Security test | Deliberate use fails | Add one; test fails | Revert |
| T-317 | `frontend/renderer/tp-reviews.css` | Unopinionated base with CSS custom properties | T-315 | D2 | P0 | 3 | Stylesheet | Themeable without editing the module | Manual | Revert |
| T-318 | Empty state | Clean empty state when the payload is unavailable; **no visible error** | T-315 | D3 | P0 | 2.5 | Behaviour | Blocking the URL shows an empty state | Reviewer blocks the URL | Revert |
| T-319 | Pre-sized containers | CLS 0 | T-317 | D2 | P0 | 2 | CSS + markup | Lighthouse reports CLS 0 | Lighthouse | Revert |
| T-320 | Accessibility | Text equivalent for star ratings; keyboard-operable pagination | T-317 | D3 | P0 | 3 | Implementation | Automated + manual checks pass | Reviewer tabs through | Revert |
| T-321 | `tests/budgets/renderer-size.test.mjs` | **≤ 5 KB minified, blocking** (FE-05, TR-TEST-100) | T-315 | D2 | P0 | 1.5 | Budget test | Fails above budget | Add bulk; test fails | Revert |
| T-322 | `SAFETY.md` | Why text-only DOM APIs, and what never to do | T-315 | D2 | P0 | 2 | Doc | A future contributor is warned | Reviewer reads | Revert |
| T-323 | Recipes: static HTML and React | The two non-cuttable recipes, each with a network assertion (FE-03) | T-315 | D2 | P0 | 5 | Two recipes + tests | **Zero third-party requests asserted** (INV-01) | Reviewer opens the network panel | Revert |
| T-324 | Recipes: Next.js, Astro, Vue, schema.org | The four cuttable recipes | T-323 | D2 | P2 | 5 | Four recipes | Each with a network assertion | Tests | **Cuttable (§9.5 item 4)** |
| T-325 | Worked examples | `frontend/examples/static/` and `examples/nextjs/` | T-323 | D2 | P1 | 2 | Two examples | Build and render a real payload | Manual | Revert |

**PH-23 totals: 11 tasks · 34 IEH.**

---

# PH-24 · Remaining Workflows and Scripts

**Sprint SP-8 · Week 16 · 26 IEH · 9 tasks · Difficulty D2**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-326 | `validate-config.yml` | Network-free; schema + V-1…V-12; **PR comment showing the resolved effect** (TR-CI-080/081) | T-174 | D3 | P0 | 4 | Workflow | Comment shows resolved values and projected counts, not just "valid" | Open a config PR | Revert |
| T-327 | `canary.yml` | Every 3 h, offset; full harvest of the reference listing with `--no-publish`; assertion evaluation (TR-CI-090…092) | T-279, T-193 | D3 | P0 | 4 | Workflow | **Never publishes**; counts against the source budget | Reviewer reads the workflow | Disable |
| T-328 | `pages.yml` | Deploy `data` root; **no `contents` permission** (TR-CI-100/131) | T-018 | D2 | P0 | 2.5 | Workflow | Verifies `.nojekyll`, `_headers`, `robots.txt` present | Read the permission block | Disable |
| T-329 | `keepalive.yml` | Monthly; timestamp update **and** API assertion that `harvest` is enabled (TR-CI-110) | T-278 | D3 | P0 | 3 | Workflow | Detects a disabled schedule, not merely prevents dormancy | Disable `harvest` in a scratch setting; confirm the issue | Disable |
| T-330 | `release.yml` | On `v*` tag: **re-run the full suite at the tag**, verify CHANGELOG, verify schema version, generate notes (TR-CI-120) | T-268 | D3 | P0 | 4 | Workflow | Does not trust the last `main` run | Tag a scratch release | Revert |
| T-331 | `dependency-audit.yml` | Weekly; open an issue only for **new** high-severity advisories | T-044 | D2 | P2 | 2 | Workflow | No duplicate issues for tracked advisories | Manual trigger | **Cuttable (§9.5 item 5)** |
| T-332 | `tests/security/workflow-lint.test.mjs` | Permissions declared, actions SHA-pinned, no `pull_request_target`, no untrusted interpolation (CI-05/06, TR-CI-132) | T-330 | D3 | P0 | 3.5 | Security test | Each violation class fails | Add one of each in a scratch branch | Revert |
| T-333 | Operational scripts | `verify-payload.mjs`, `size-report.mjs`, `validate-all.mjs`, `new-client.mjs` | T-326 | D2 | P0 | 3 | Four scripts | Each runnable standalone | Run each | Revert |
| T-334 | `truncate-data-history.mjs` | History truncation with the mirror-first procedure documented (TRD §66.8) | T-333 | D3 | P2 | 2 | Script + runbook | **Refuses to run without a verified mirror** | Reviewer runs without a mirror | Revert |

**PH-24 totals: 9 tasks · 26 IEH.**

---

# PH-25 · First Client and Soak

**Sprint SP-8 · Week 16 · 20 IEH · 8 tasks · Difficulty D3 · Closes MS-9 at DG-10 / DG-11**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-335 | **Authorisation record merged** | `compliance/authorizations/commerce-insight.md` with the V-3 fields | External | D2 | P0 | 1.5 | Compliance file | V-3 passes; the client is authorised in writing | EM confirms the source document | **No workaround exists** |
| T-336 | Client configuration | `clients/commerce-insight.config.json`; slug and listing key chosen and understood to be **immutable** | T-335, T-326 | D3 | P0 | 3 | Config | `validate-config` green; PR comment shows the effect | Reviewer reads the resolved trace | Revert |
| T-337 | Business Profile API offer recorded | The client was offered the sanctioned adapter; the answer is in `notes` (SAD §15.3.1) | T-336 | D1 | P0 | 0.5 | Config `notes` | Recorded verbatim | EM confirms | N/A |
| T-338 | First production harvest | Manual dispatch; count and mean rating sane | T-336 | D3 | P0 | 2.5 | Run + payload | Payload published, schema-valid, non-empty | `scripts/verify-payload.mjs` | Disable schedule; `tpre project` |
| T-339 | **Public verification** | Payload reachable over HTTPS; headers match the recorded expectations | T-338 | D2 | P0 | 2 | Verification record | Matches `docs/runbooks/pages-headers.md` | Independent fetch | — |
| T-340 | **Client site integration + the two mandatory checks** | Render on the client site; verify the empty state and **zero third-party requests** (TR-CI-180 steps 6–7) | T-339, T-323 | D3 | P0 | 4 | Live page + evidence | Network waterfall screenshot captured | EM performs both checks personally | Remove the snippet |
| T-341 | Enable schedules and verify | All four tiers active; `keepalive` run manually with no spurious issue | T-338 | D2 | P0 | 2.5 | Settings + run records | Schedules visible and firing | Reviewer checks the workflow list | Disable |
| T-342 | **Start the 30-day soak** | S1–S8 tracking sheet initialised; post-deployment verification schedule set (§66) | T-341 | D2 | P0 | 4 | Tracking sheet | All eight criteria have owners and measurement methods | EM reviews the sheet | N/A |

**PH-25 totals: 8 tasks · 20 IEH.**

---

# SP-8 Hardening Allowance

**40 IEH · reserved IDs T-981…T-999 · no pre-assigned tasks**

This capacity is deliberately unallocated. It absorbs, in priority order:

| # | Consumer | Expected Draw |
|---|---|---|
| 1 | Defects found by the chaos suite in PH-21 | 10–15 IEH |
| 2 | Defects found during the first live contact (T-279) | 5–10 IEH |
| 3 | Documentation completion: runbooks, maintenance guide, client explainer | 8 IEH |
| 4 | Drill execution and the corrections drills always produce | 6 IEH |
| 5 | The §63/§64/§65 checklist evidence-gathering itself | 5 IEH |

**Manager Note.** If this allowance is untouched by the end of week 15, that is a signal the chaos suite is not probing hard enough — not a signal that the project is ahead. Historically, PH-21 finds between four and eight real defects in a system of this shape, and finding none usually means CH-04-style tests were written to pass.

---

## Part 14 Summary

| Phase | Tasks | IEH | Milestone | Key Exit |
|---|---|---|---|---|
| PH-18 | 11 | 32 | MS-7 | **Hash-gating: second run, zero commits** |
| PH-19 | 11 | 30 | MS-7 | Dispatched harvest commits to `data`; first live contact |
| PH-20 | 11 | 36 | MS-8 | Health append-only; alerts close themselves |
| PH-21 | 13 | 34 | MS-8 | **All fourteen chaos scenarios green** |
| PH-22 | 11 | 40 | MS-8 | **Contract × 4; PT-08 real; migration drill < 1 h** |
| PH-23 | 11 | 34 | MS-9 | Renderer ≤ 5 KB, zero deps, zero third-party requests |
| PH-24 | 9 | 26 | MS-9 | Eight workflows; `workflow-lint` green |
| PH-25 | 8 | 20 | MS-9 | **A real client's reviews on a real website** |
| Hardening | (reserved) | 40 | MS-9 | Defect repair and evidence gathering |
| **Total** | **85** | **292** | | |

## Whole-Plan Task Totals

| Part | Phases | Tasks | IEH |
|---|---|---|---|
| Part 12 | PH-00 … PH-06 | 126 | 294 |
| Part 13 | PH-07 … PH-17 | 131 | 384 |
| Part 14 | PH-18 … PH-25 + hardening | 85 | 292 |
| **Total** | **26 phases** | **342** | **970** |

*This 970 IEH is the plan's total planned draw — 930 IEH of assigned tasks plus the 40 IEH unallocated hardening allowance — against 1,095 IEH of raw team capacity across sixteen weeks (§0.8.1). The difference is the 11% reserve.*

---

*End of Part 14. Part 15 covers engineering management: sprint mechanics, the risk register, the dependency matrix, critical path, decision gates, and progress tracking.*
