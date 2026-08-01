# Part 8 — Observability, Integration, and Delivery

*Sections 44 through 50. Audience: DevOps, the on-call engineer, and the frontend integrator. Monitoring in this system is not bought; it is built, from files and issues, under a zero-recurring-cost constraint (CON-01). That constraint is not a limitation to work around — it produces observability that lives in version control and diffs in pull requests.*

**Build-order reminder.**

| § | System | Built In | Sprint |
|---|---|---|---|
| 44 | Health check system | PH-20 | SP-7 |
| 45 | Monitoring system | PH-20 | SP-7 |
| 46 | Metrics | PH-20 | SP-7 |
| 47 | GitHub integration | PH-08 (state) + PH-18 (publisher) + PH-20 (notifier) | SP-3, SP-6, SP-7 |
| 48 | GitHub Actions | PH-19 (harvest) + PH-24 (the other seven) | SP-6, SP-8 |
| 49 | Deployment pipeline | PH-24, PH-25 | SP-8 |
| 50 | Website integration | PH-23 | SP-8 |

---

# 44. Health Check System

**Phase PH-20 · Sprint SP-7 · Difficulty D2 · 12 IEH**

| Field | Value |
|---|---|
| **Purpose** | Record one durable, append-only fact per target per run, so that every question about the system's behaviour over time is answerable from files rather than from memory. |
| **Objectives** | (1) Append-only JSONL health records on `state`. (2) One record per target per run, for **every** outcome. (3) Derived signals: yield delta, coverage, duration percentile, strategy health. (4) Never read-modify-write the series. (5) `health-record.v1.schema.json` validation. (6) `tpre doctor` environment diagnostics. |
| **Dependencies** | PH-08 (state adapter), PH-17 (outcomes), PH-07 (clock) |
| **Estimated Complexity** | **D2** — simple mechanism, high leverage |
| **Estimated Time** | 12 IEH |
| **Risks** | Read-modify-write of the series, which loses records under concurrent shards (EDR-033) · records written only for failures, making success-rate computation impossible · unbounded growth of `health/<slug>.jsonl` · records written before the outcome is final, so a deferred target appears failed |

## 44.1 Design Constraints That Are Easy to Get Wrong

| ID | Requirement |
|---|---|
| HLTH-01 | Health records MUST be **append-only** (EDR-033). Shards run in parallel; a read-modify-write of one file from two shards loses records silently. Appending is the only concurrency-safe operation available without a lock, and there are no locks by design (EDR-035). |
| HLTH-02 | A record MUST be written for **every** outcome — `succeeded`, `rejected`, `blocked`, `challenged`, `deferred`, `failed` (TRD §2.4.1). Writing only failures makes success rate, the primary health metric, uncomputable. |
| HLTH-03 | Records MUST validate against `health-record.v1.schema.json`. An unvalidated observability stream degrades into a stream nobody can parse. |
| HLTH-04 | Derived signals MUST be computed at read time from the series, never stored as running aggregates. A stored aggregate is a second source of truth that drifts. |

## 44.2 What One Record Contains

Shape is specified in TRD §42 and the schema; the plan's contribution is *why each field earns its place*:

| Field Group | Answers |
|---|---|
| Identity: run id, client, listing, adapter, pack version | "Which code and which knowledge produced this?" |
| Outcome and error class | "What happened?" |
| Counts: observed, extracted, quarantined, published | "How much, and how much was lost where?" |
| Coverage and completeness | "How complete was it, and by which measure?" |
| Timings: total, per stage | "Where did the time go?" — the input to the shard cost model |
| Strategy index histogram | "Is the selector pack degrading?" — the earliest upstream-change signal |
| Peak RSS | "Are we approaching the runner's limit?" |
| Gate verdict and reasons | "Why was this not published?" |

**The strategy index histogram is the highest-value field.** A shift from 100% index-0 to 94% index-0 is the earliest detectable signal of upstream change, and it appears in health records days before extraction actually fails.

## 44.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-160 `infra/health/recorder.mjs` · DEL-161 `schemas/health-record.v1.schema.json` · DEL-162 derived-signal computation · DEL-163 `cli/commands/doctor.mjs` environment checks |
| **Acceptance** | One record per target per run for every outcome; append-only; schema-valid; derived signals computed at read time |
| **Exit** | A two-shard parallel run produces a complete record set with zero losses; `tpre doctor` reports Node, npm, Playwright, browser, engine versions, secret presence, branch checkouts, and connectivity; health series parses under the schema |

## 44.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Disable health writing; the engine still functions, monitoring goes dark. Acceptable for one cycle, not more — every alert in §45 derives from health |
| **Verification** | Reviewer runs two shards concurrently against a temp state repo and confirms every expected record is present |
| **Testing** | Unit: record construction per outcome, derived signals · Integration: concurrent append |
| **Documentation** | The record's field reference; how to answer the seven §Appendix G health questions from the series |
| **Future** | Health series compaction after 12 months (v1.1); a static HTML health dashboard generated into `data` (v2, TRD §81) |

---

# 45. Monitoring System

**Phase PH-20 · Sprint SP-7 · Difficulty D2 · 14 IEH**

| Field | Value |
|---|---|
| **Purpose** | Convert health facts into a small number of actionable alerts, delivered through issues, with a lifecycle that closes itself when the condition clears. |
| **Objectives** | (1) `github-issues` notifier with **fingerprint deduplication**. (2) Open → comment → close lifecycle. (3) Severity map from the error taxonomy. (4) Rate limiting so an incident opens one issue, not forty. (5) `webhook` and `console` notifiers. (6) Maintenance mode suppressing non-critical alerts. |
| **Dependencies** | PH-01 (severity map), PH-20 §44 (health), GitHub API access |
| **Estimated Complexity** | **D2** with one subtle part: the fingerprint scheme |
| **Estimated Time** | 14 IEH |
| **Risks** | An alerting bug touching data — structurally prevented by giving the alert job **no `contents` permission** (TR-CI-130) · alert storms training the maintainer to ignore issues · a notifier failure failing the run (it must never — TRD §7.6) · fingerprints too specific, so a recurring condition opens a new issue each cycle |

## 45.1 The Fingerprint Scheme

`[tpre:<severity>:<condition>:<scope>]` (TRD §69.2). Its granularity determines whether alerting is useful or noise.

| Scope Choice | Consequence |
|---|---|
| Per run | One issue per run — useless, opens constantly |
| Per client per condition | **Correct.** A selector drift affecting all clients opens one issue per client, which is what an operator acts on |
| Per source per condition | Correct for source-scoped conditions (challenge, breaker, rate limit) — one issue, not one per client |
| Per error instance | Alert storm |

| ID | Requirement |
|---|---|
| MON-01 | Fingerprint scope MUST match the error's scope in the taxonomy (`run` / `source` / `target` / `record`). The taxonomy already made this decision; the notifier consumes it rather than re-deciding. |
| MON-02 | The notifier MUST NEVER fail the run (TRD §7.6). An alerting failure is logged and the run's exit code is unaffected. |
| MON-03 | The alert job MUST have **no `contents` permission** (TR-CI-130). This makes "a bug in alerting cannot corrupt a payload" a structural fact. |
| MON-04 | An issue MUST be closed automatically when its condition clears, with a closing comment naming the run that cleared it. An alerting system that only opens is an alerting system that gets muted. |
| MON-05 | `TPRE_MAINTENANCE_MODE=true` MUST suppress non-critical alerts and MUST NOT suppress critical ones. |

## 45.2 The Alert Set Is Deliberately Small

Six `critical` classes only (SAD Appendix B). Everything else is `high` or below and routes to an issue without paging anyone.

| Severity | Delivery | Expectation |
|---|---|---|
| `critical` | Issue + webhook (if configured) | Human looks today |
| `high` | Issue | Human looks this week |
| `warn` | Issue comment on an existing issue, or none | Trend signal |
| `info` | Health record only | Queried, not pushed |

**Manager Note.** The pressure during the soak will be to raise severities ("we should know about that too"). The correct response is to add a *health signal*, not an alert. An alert set that grows past a dozen distinct conditions stops being read, and the six critical classes are the ones that must never be missed.

## 45.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-164 `adapters/notifier/github-issues.mjs` · DEL-165 `webhook.mjs` · DEL-166 `console.mjs` · DEL-167 severity routing · DEL-168 alert lifecycle integration test |
| **Acceptance** | Deduplication by fingerprint; open/comment/close lifecycle; rate limiting; maintenance mode; notifier never fails a run |
| **Exit** | Alert lifecycle integration test green (open → comment → close, deduped); the alert job's permission block contains no `contents`; a simulated storm produces one issue per scope, not one per instance |

## 45.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Switch to the `console` notifier. Alerts appear in job logs only — degraded but non-destructive |
| **Verification** | Reviewer triggers the same condition three times and confirms one issue with two comments; clears the condition and confirms auto-close |
| **Testing** | Integration: lifecycle with an in-memory notifier · Unit: fingerprint construction, severity routing, maintenance suppression |
| **Documentation** | The alert catalogue: condition → severity → runbook; how to mute correctly (maintenance mode, not by editing the severity map) |
| **Future** | Digest issues for `warn`-level trends (v1.1); Slack/webhook templating (v1.1) |

---

# 46. Metrics

**Phase PH-20 · Sprint SP-7 · Difficulty D2 · 10 IEH**

| Field | Value |
|---|---|
| **Purpose** | Define the small set of numbers that describe system health, compute them from the health series, and give each a healthy band and an action threshold. |
| **Objectives** | (1) The `MET-` set computed from health JSONL. (2) Healthy bands and action thresholds per metric. (3) Run manifest as the per-run rollup. (4) Trend queries documented. (5) No separate metrics store. |
| **Dependencies** | §44 |
| **Estimated Complexity** | **D2** |
| **Estimated Time** | 10 IEH |
| **Risks** | Metrics stored as running aggregates rather than derived (HLTH-04) · thresholds chosen without a baseline, so everything alerts in week 1 of the soak · `MET-commit-churn` not implemented, hiding a hash-gating regression (IR-06) |

## 46.1 The Metric Set and Its Bands

From SAD Appendix G, restated with the implementation obligation:

| Metric | Healthy | Act | Computed From | Detects |
|---|---|---|---|---|
| Success rate (30 d) | > 98% | < 95% | Outcome field | General degradation |
| Coverage | > 0.97 | < 0.95 | Coverage field | Partial harvests |
| Gate rejection rate | < 2% | > 10% | Gate verdict | Upstream or engine change |
| Strategy index-0 share | 100% | < 95% | Strategy histogram | **Earliest upstream-change signal** |
| p95 harvest duration | < 150 s | > 240 s | Timings | Performance drift, runner change |
| Payload age p95 | < 8 h | > 24 h | Manifest freshness | **Dormant schedules (RISK-17)** |
| Challenges per 30 d | 0 | ≥ 1 | Error class | Anti-bot posture |
| **`MET-commit-churn`** | Stable | Sudden rise | `data` branch commit count | **Hash-gating regression (IR-06)** |
| Peak RSS | < 700 MB | Approaching runner limit | Health field | Memory leak |

| ID | Requirement |
|---|---|
| MET-01 | Every metric MUST be derivable from the health series and the `data` branch alone. A metric requiring a separate store violates CON-01 and creates a second thing to operate. |
| MET-02 | `MET-commit-churn` MUST be implemented. It is the only detector for a hash-gating regression, whose symptom (50× commit growth) is otherwise invisible until the branch is large. |
| MET-03 | Thresholds MUST be reviewed after the first 30 days of production data and adjusted once, deliberately (§68). Bands chosen before any baseline exists are guesses. |

## 46.2 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-169 metric computation from the health series · DEL-170 `run-manifest.mjs` rollup · DEL-171 `schemas/run-manifest.v1.schema.json` · DEL-172 documented trend queries |
| **Acceptance** | Every metric computable from files; manifest schema-valid; bands documented |
| **Exit** | All nine metrics computed from a synthetic 30-day health series in a test; `MET-commit-churn` proven by a deliberate hash-gating break in a scratch branch |

## 46.3 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Metrics are read-only derivations; there is nothing to roll back |
| **Verification** | Reviewer computes two metrics by hand from a small series and compares |
| **Testing** | Unit: each metric against a synthetic series with known values |
| **Documentation** | The metric card (SAD Appendix G) in `docs/maintenance.md`; the query for each |
| **Future** | Generated trend charts committed to `data` as static SVG (v1.1) — no dependency, no service, and diffs in pull requests |

---

# 47. GitHub Integration

**Phases PH-08, PH-18, PH-20 · Sprints SP-3, SP-6, SP-7 · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Use the platform for exactly three things — state storage, artifact publication, and alerting — through three adapter files, so that leaving the platform is a one-day exercise rather than a rewrite. |
| **Objectives** | (1) Zero platform SDK imports outside three adapter files (NFR-045). (2) Git operations via `infra/git.mjs` only. (3) Least-privilege tokens per job. (4) No untrusted content reaching a shell. (5) Platform portability verified by inspection. |
| **Dependencies** | PH-07 (`infra/git.mjs`), PH-08, PH-18, PH-20 |
| **Estimated Complexity** | **D3**, with one security-critical constraint |
| **Estimated Time** | Counted within PH-08, PH-18, PH-20 |
| **Risks** | **Command injection via `node:child_process` receiving acquired content, issue text, or config free-text** (TR-DEP-001, NFR-030) — the highest-severity implementation risk in this section · platform SDK usage spreading beyond three files, making portability theoretical · a token with broader scope than the job needs |

## 47.1 The Three Integration Points

| Point | File | Platform Feature | Portable To |
|---|---|---|---|
| State | `adapters/state/git-state.mjs` | Git branch checkout | Any filesystem, any object store |
| Publication | `adapters/publisher/git-data.mjs` | Git branch + Pages | Any static host |
| Alerting | `adapters/notifier/github-issues.mjs` | Issues API | Any webhook target |

| ID | Requirement |
|---|---|
| GH-01 | Platform SDK imports MUST NOT appear outside these three files (NFR-045). Asserted by the architecture test. |
| GH-02 | `node:child_process` MUST be used only in `infra/git.mjs` and MUST NEVER receive a value derived from acquired content, issue text, or configuration free-text (TR-DEP-001). Enforced by lint (no interpolation into the exec call) and by review. |
| GH-03 | Untrusted values MUST NOT be interpolated into workflow `run:` blocks; they are passed via `env:` and quoted (TR-CI-152). |
| GH-04 | Every job MUST declare the minimum permission set from the §63.1 matrix. |

## 47.2 Why GH-02 Gets Its Own Review Gate

The system reads and writes issues. Issue titles are attacker-controllable by anyone who can open an issue in a public repository. A workflow or a code path interpolating an issue title into a shell command gives that person execution inside a runner holding a write token. **TRD §63.3 calls this "exactly the shape of workflow where this mistake happens."** Every PR touching `infra/git.mjs` or the notifier gets a second reviewer whose sole job is checking this.

## 47.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-173 architecture assertion for SDK confinement · DEL-174 injection-safety review checklist item · DEL-175 permission matrix implemented across eight workflows |
| **Acceptance** | Three files only; no interpolation of untrusted content anywhere; permissions minimal per job |
| **Exit** | Architecture test green; `security.workflow-lint` green; a manual injection review recorded for `infra/git.mjs` and the notifier |

## 47.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Switch to `filesystem` publisher and `console` notifier; the engine runs locally with no platform dependency at all. This is also the portability proof |
| **Verification** | Reviewer greps for SDK imports (expects three files); reads every `child_process` call site and traces each argument to its origin |
| **Testing** | Architecture: import confinement · Security: `workflow-lint` |
| **Documentation** | The portability note: what changes if the platform changes, file by file |
| **Future** | The v1.1 job split removing the write token from the job that executes third-party code (TRD §96.2) — the highest-value residual mitigation for THREAT-05 |

---

# 48. GitHub Actions

**Phase PH-19 (harvest) + PH-24 (seven others) · Sprints SP-6, SP-8 · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Run the engine unattended, on schedule, with least privilege, in a way that a red badge always means broken code and never means a correct refusal to publish. |
| **Objectives** | (1) Composite setup action — setup logic exactly once. (2) `harvest.yml` with a job-emitted shard matrix. (3) Exit-code classification (5/6/7 are CI successes). (4) Seven further workflows. (5) Explicit `permissions:` on every workflow. (6) All third-party actions SHA-pinned. (7) `fail-fast: false` across the matrix. |
| **Dependencies** | PH-17 (a working local run), PH-18 (publisher), branches, repository variables |
| **Estimated Complexity** | **D3** |
| **Estimated Time** | 30 IEH (PH-19) + 26 IEH (PH-24) |
| **Risks** | **IR-10 — the `data` checkout skipped to save time**, silently disabling four gate rules (rated `Critical`) · **IR-20 — a workflow without an explicit `permissions` block** · setup logic duplicated across workflows, so a Node bump requires eight edits (TR-CI-004) · exit codes 5/6/7 failing the job, training the maintainer to ignore red builds (EDR-030) · `pull_request_target` appearing anywhere |
| **Plan risks** | PR-21 |

## 48.1 Build Order Within PH-19

| # | Step | Verified By |
|---|---|---|
| 1 | Composite `setup-engine` action: Node from `.nvmrc`, npm cache, `npm ci`, Playwright version detection, browser cache with an **exact key**, conditional install, **versions banner** | A cold run and a warm run, timings recorded (TA-03) |
| 2 | `plan` job emitting the shard matrix as an output (EDR-029) | Matrix visible in the run |
| 3 | `harvest` matrix job with `fail-fast: false` (INV-09) | One shard failing does not cancel others |
| 4 | **`data` and `state` checkouts** — both, always (TR-CI-022) | Gate comparison works; **IR-10 mitigation** |
| 5 | Exit-code classification step: 0/4/5/6/7 → success; 1/2/3 → failure | One test dispatch per code |
| 6 | `collect` job assembling manifests and artifacts | Artifact retention per §63.4 |
| 7 | `alert` job with **no `contents` permission** | Permission matrix |
| 8 | Four cron schedules, offset per tier | Schedules visible and active |

| ID | Requirement |
|---|---|
| CI-01 | Setup logic MUST exist exactly once, in the composite action (TR-CI-004). A Node or browser version change must be a one-file edit. |
| CI-02 | The versions banner MUST be printed into the job log (TR-CI-140). "Which browser version produced this payload?" must be answerable from the log alone. |
| CI-03 | The `data` checkout MUST NOT be skipped (TR-CI-022, IR-10). A comment in the workflow MUST state why, because it looks like an optimisation opportunity. |
| CI-04 | Exit codes 5, 6, 7 MUST NOT fail the shard job (EDR-030); they emit an annotation and drive an alert whose severity is independent of job conclusion. |
| CI-05 | Every workflow MUST declare explicit `permissions:` and every third-party action MUST be SHA-pinned (TR-CI-001, TR-CI-002), asserted by `security.workflow-lint`. |
| CI-06 | `pull_request_target` MUST NOT appear in any workflow (TR-CI-003). |

## 48.2 The Eight Workflows

| Workflow | Phase | Trigger | Permissions | Purpose |
|---|---|---|---|---|
| `ci.yml` | PH-00 | PR, push to `main` | `contents: read` | 14 blocking gate groups |
| `harvest.yml` | PH-19 | 4 crons + dispatch | per-job, see matrix | Production pipeline |
| `validate-config.yml` | PH-24 | PR touching config paths | `contents: read`, `pull-requests: write` | Config safety + effect preview |
| `canary.yml` | PH-24 | Every 3 h | `contents: write`, `issues: write` | Drift detection, **never publishes** |
| `pages.yml` | PH-24 | Push to `data` | `pages: write`, `id-token: write`, **no `contents`** | Distribution |
| `keepalive.yml` | PH-24 | Monthly | `contents: write`, `issues: write` | Dormancy prevention **and detection** |
| `release.yml` | PH-24 | `v*` tag | `contents: write` | Full re-verification at the tag |
| `dependency-audit.yml` | PH-24 | Weekly | `contents: read`, `issues: write` | Supply-chain guard |

**Two deliberate permission absences** (TR-CI-130, TR-CI-131): the `alert` job has no `contents`, and `pages.yml` has no `contents`. These make two whole classes of bug structurally impossible rather than merely unlikely.

## 48.3 The Keepalive Distinction

`keepalive.yml` does two different things and only one of them is obvious:

| Action | Prevents / Detects |
|---|---|
| Update a timestamp file on `state` | **Prevents** schedule dormancy from repository inactivity |
| **Query the API for `harvest`'s enabled state** | **Detects** that schedules were disabled |

TR-CI-110 requires both. Producing activity prevents dormancy; asserting state detects it. RISK-17 (dormant schedule) is the failure where every client silently goes stale and nothing alerts — the detection half is what catches it.

## 48.4 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-176 `setup-engine` composite action · DEL-177 `harvest.yml` · DEL-178 seven further workflows · DEL-179 `tests/security/workflow-lint.test.mjs` · DEL-180 exit-code classification step · DEL-181 issue and PR templates |
| **Acceptance** | Setup in one place; matrix emitted by a job; both checkouts present; classification correct; permissions minimal; actions SHA-pinned; `fail-fast: false` |
| **Exit** | A manually dispatched harvest produces a `data` commit; a second identical dispatch produces **zero** commits; `security.workflow-lint` green across all eight; each of the eight workflows has been triggered at least once and observed to pass; `ci.yml` completes in under five minutes |

## 48.5 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Disable the schedule (one toggle). Local `tpre harvest` still works; publication continues manually. This is the correct first response to almost any production incident |
| **Verification** | Reviewer confirms `data` checkout present in every job that publishes; dispatches with a client configured to fail and confirms other shards complete; reads the permission block of all eight workflows against the §63.1 matrix |
| **Testing** | Security: `workflow-lint` (permissions, SHA pinning, no `pull_request_target`, no untrusted interpolation) · Manual: one dispatch per exit code |
| **Documentation** | The workflow catalogue: trigger, permissions, purpose, failure meaning; the emergency levers table |
| **Future** | The v1.1 job split (TRD §96.2); reusable workflows if a second repository appears (v2) |

---

# 49. Deployment Pipeline

**Phase PH-24, PH-25 · Sprint SP-8 · Difficulty D2 · 14 IEH**

| Field | Value |
|---|---|
| **Purpose** | Execute the seventeen-step first-time deployment and establish the staged release sequence that converts an all-clients-at-once adoption into a controlled rollout. |
| **Objectives** | (1) Seventeen first-time deployment steps completed and verified. (2) Pages headers **measured and recorded** before the first client. (3) Offsite clone verified before the first client. (4) Staged release sequence drilled. (5) Adapter migration drill completed. (6) 30-day soak started with tracked criteria. |
| **Dependencies** | All prior phases; external artifacts from §4.4 |
| **Estimated Complexity** | **D2** — no invention, considerable care |
| **Estimated Time** | 14 IEH |
| **Risks** | Steps 7 (headers) and 12 (offsite clone) skipped because they feel like paperwork — **both are TR-blocking prerequisites for onboarding a client** · staged release steps 3–4 skipped under time pressure (TR-CI-170) · the migration drill deferred, leaving RISK-03's contingency untested |

## 49.1 The Two Steps That Block Client Onboarding

| Step | Requirement | Why It Blocks |
|---|---|---|
| **7 — verify actual response headers** | TR-CI-160 | The manifest freshness pattern depends on cache behaviour. Assumed headers are not verified headers, and the difference determines whether consumers see stale payloads for hours |
| **12 — offsite clone** | TR-CI-161 | A system with no offsite copy has no D-5 recovery path. The cost is one hour; the exposure is total repository loss |

**Manager Note.** These two are the "paperwork" steps that a delivery-focused team skips. They are listed in the §65 production checklist as blocking items with named owners, and DG-11 does not pass without evidence for both.

## 49.2 The Three Deployables, Separately

| Deployable | Cadence | Rollback | Verified By |
|---|---|---|---|
| Engine | Tag + adoption at the next scheduled run | Revert commit, ~5 min | Canary + one-client dispatch |
| Configuration | Merge | Revert commit, ~2 min | `validate-config.yml` PR comment showing the *effect* |
| Data | Machine-written | `tpre project` or revert, ~10 min | `scripts/verify-payload.mjs` |

**Keeping these separate is what makes rollback cheap** (TRD §64.1). A bad selector pack is reverted without touching engine code; a bad engine is reverted without touching data; a bad payload is regenerated without acquiring anything.

## 49.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-182 completed 17-step deployment record · DEL-183 `docs/runbooks/pages-headers.md` with measured headers · DEL-184 offsite clone verification record · DEL-185 migration drill record · DEL-186 soak tracking sheet |
| **Acceptance** | All seventeen steps complete with evidence; both blocking steps verified; the adapter migration drill completed in under one hour |
| **Exit** | §63 deployment-readiness checklist complete; the staged release sequence executed once end to end (canary + one client) before the first scheduled run |

## 49.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Per §67, by unit. First-time deployment itself rolls back by disabling schedules and reverting the client config |
| **Verification** | Reviewer independently fetches a payload URL and captures headers, comparing to the recorded file; clones from the offsite mirror and confirms all three branches |
| **Testing** | `scripts/verify-payload.mjs` against the public URL; the migration drill on a scratch client |
| **Documentation** | The deployment record itself; `docs/runbooks/pages-headers.md`; the migration drill procedure |
| **Future** | Custom domain and CDN tuning (post-GA); automated header regression in `pages.yml` (v1.1) |

---

# 50. Website Integration

**Phase PH-23 · Sprint SP-8 · Difficulty D2 · 34 IEH**

| Field | Value |
|---|---|
| **Purpose** | Let any website consume the payload with a few lines of code, zero dependencies, zero third-party requests, and no possibility of injecting markup into the host page. |
| **Objectives** | (1) Reference renderer, < 5 KB minified, **zero dependencies**. (2) Text-only DOM APIs, enforced by test. (3) Five integration recipes. (4) Two worked examples. (5) Accessibility and layout stability. (6) Consumer network assertion (INV-01). (7) Clean empty state when the payload is unavailable. |
| **Dependencies** | PH-06 (payload shape), a real payload to render |
| **Estimated Complexity** | **D2**, with one **D4** constraint: the renderer is the last line of INV-05 defence and executes on sites TradyPerch does not control |
| **Estimated Time** | 34 IEH |
| **Risks** | An HTML-injection DOM API used for convenience (TR-STD-002) · a dependency added to the renderer (DEP-6 — a supply-chain risk multiplied by client count) · bundle exceeding 5 KB · layout shift because containers are not pre-sized · **a recipe that fetches from a third-party origin, violating INV-01** |

## 50.1 The Two Non-Negotiables

| ID | Requirement |
|---|---|
| FE-01 | `frontend/renderer/` MUST have **zero** runtime dependencies (DEP-6, TR-STD-001). It ships to client sites; a dependency there is a supply-chain risk multiplied by client count. Enforced by the dependency-graph test. |
| FE-02 | `frontend/` MUST NOT use any HTML-injection DOM API (TR-STD-002). Enforced by `tests/security/renderer-api.test.mjs`, which scans the source. The normalizer removes markup; the renderer must not reintroduce a way for markup to matter. |

## 50.2 Implementation Order

| # | Step | Test |
|---|---|---|
| 1 | `tp-reviews.mjs` — fetch, parse, render with text-only APIs | `security.renderer-api` scan |
| 2 | `tp-reviews.css` — unopinionated base, CSS custom properties | Visual check |
| 3 | Empty state when the payload is unavailable | **Block the URL; confirm a clean empty state, no visible error** |
| 4 | Pre-sized containers | **CLS = 0** |
| 5 | Accessibility: text equivalent for star ratings; keyboard-operable pagination | Automated + manual |
| 6 | Five recipes: static HTML, React, Next.js App Router, Astro, Vue | Each with a network assertion |
| 7 | Two examples: `examples/static/`, `examples/nextjs/` | Build and render |
| 8 | `SAFETY.md` — why text-only, and what never to do | Review |
| 9 | Size budget | **≤ 5 KB minified**, blocking |

| ID | Requirement |
|---|---|
| FE-03 | **Every recipe MUST carry a network assertion proving no request reaches any third-party origin** (INV-01, TR-CI-180 step 7). This is the property the entire architecture exists to provide, and the consumer side is where it is actually observable. |
| FE-04 | Every recipe MUST document the empty-state behaviour and the CSP note (`connect-src` for the payload origin). |
| FE-05 | The renderer size budget is **blocking** (TR-TEST-100), because it is deterministic. |

## 50.3 Recipe Coverage Decision

| Recipe | Priority | Cuttable (§9.5) |
|---|---|---|
| Static HTML | **P1** | No — the default and the simplest proof |
| React | **P1** | No — the most requested |
| Next.js App Router | P2 | Yes |
| Astro | P2 | Yes |
| Vue | P2 | Yes |
| `schema-org.md` | P2 | Yes (opt-in feature) |

## 50.4 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-187 `frontend/renderer/tp-reviews.mjs` · DEL-188 `tp-reviews.css` · DEL-189 `SAFETY.md` · DEL-190 five recipes · DEL-191 two examples · DEL-192 `tests/security/renderer-api.test.mjs` · DEL-193 `tests/budgets/renderer-size.test.mjs` |
| **Acceptance** | Renders a real payload; zero dependencies; text-only APIs; clean empty state; CLS 0; accessible; under budget |
| **Exit** | `security.renderer-api` green; size budget green at ≤ 5 KB minified; **network assertion green on every shipped recipe**; the empty-state and third-party checks (TR-CI-180 steps 6–7) performed and recorded for the first client |

## 50.5 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | A client can pin a previous renderer version by URL or by copying the file. The payload contract is stable independently of the renderer, so a renderer rollback never affects data |
| **Verification** | Reviewer opens the example page with the network panel and confirms exactly one request, to the payload origin; blocks that request and confirms a clean empty state; tabs through the pagination |
| **Testing** | Security: renderer API scan · Budgets: bundle size · E2E: per-recipe network assertion, empty state, CLS, accessibility |
| **Documentation** | `frontend/README.md` integration decision guide; `SAFETY.md`; per-recipe CSP notes |
| **Future** | Web component wrapper (v1.1); server-side rendering helper for Next.js (v1.1); a themed starter set (v2) |

---

## Part 8 Cross-Cutting Exit Criteria

| # | Criterion | Section | Evidence |
|---|---|---|---|
| 1 | One health record per target per run, for every outcome | §44 | Two-shard concurrent run |
| 2 | Alerts dedupe by fingerprint and close themselves | §45 | Lifecycle integration test |
| 3 | `MET-commit-churn` implemented and proven | §46 | Deliberate hash-gating break |
| 4 | Platform SDK confined to three files | §47 | Architecture test |
| 5 | Eight workflows, all with explicit minimum permissions, all SHA-pinned | §48 | `security.workflow-lint` |
| 6 | Exit codes 5/6/7 do not fail CI | §48 | One dispatch per code |
| 7 | Pages headers measured and recorded; offsite clone verified | §49 | Runbook file; clone test |
| 8 | Renderer under 5 KB with zero dependencies and no injection APIs | §50 | Budget + security tests |
| 9 | Every recipe proves zero third-party requests | §50 | Network assertions |

---

*End of Part 8. Part 9 specifies the extensibility seams that v1.0 builds and the future work it deliberately does not.*
