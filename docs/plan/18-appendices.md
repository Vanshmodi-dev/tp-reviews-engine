# Part 18 — Appendices

*Reference material consolidated for lookup rather than for reading. Nothing here is new specification; it is the same content reorganised.*

---

# Appendix A — Master Schedule at a Glance

| Week | Sprint | Phases | Milestone | Gate | Observable Outcome |
|---|---|---|---|---|---|
| W01 | SP-0 | PH-00 | **MS-0** | DG-01 | CI green on a no-op PR; 19 proof branches |
| W02 | SP-1 | PH-01, PH-02 | — | — | Taxonomy complete; PT-10/PT-11 exist and are red |
| W03 | SP-1 | PH-02, PH-03 | **MS-1** | DG-02 | PT-10, PT-11 green; normalizer ≥ 95% |
| W04 | SP-2 | PH-04, PH-05 | — | — | PT-01, PT-02, PT-07 exist and are red |
| W05 | SP-2 | PH-05, PH-06 | **MS-2** | **DG-03** | **PT-07 green; gate at 100%** |
| W06 | SP-3 | PH-07, PH-08 | **MS-3** | DG-04 | Redaction 100%; state round-trip; PT-15 |
| W07 | SP-3 | PH-09, PH-10 | **MS-4** | DG-05 | `doctor`, `plan`, `validate-config`, `project` |
| W08 | SP-4 | PH-11, PH-12 | — | — | Contract suite exists; CSV adapter passes it |
| W09 | SP-4 | PH-13 | **MS-5** | **DG-06** | **CSV → payload end to end; 20 fixtures** |
| W10 | SP-5 | PH-14 | — | — | Browser + isolation with a failing target |
| W11 | SP-5 | PH-15, PH-16 | — | DG-07 | Stall ⇒ partial ⇒ rejection; DOM adapter |
| W12 | SP-6 | PH-17, PH-18 | **MS-6** | — | Orchestrator; hash-gating; first live contact |
| W13 | SP-6 | PH-19 | **MS-7** | **DG-08** | **Dispatched harvest commits to `data`** |
| W14 | SP-7 | PH-20, PH-21 | — | — | Health, alerts, chaos harness |
| W15 | SP-7 | PH-21, PH-22 | **MS-8** | **DG-09** | **14 chaos scenarios; contract × 4** |
| W16 | SP-8 | PH-23, PH-24, PH-25 | **MS-9** | **DG-10/11** | **Reviews on a real website** |
| +30d | — | soak | — | DG-12 | S1–S8 recorded |

---

# Appendix B — Task Index by Phase

| Phase | Task Range | Count | IEH | Part |
|---|---|---|---|---|
| PH-00 | T-001 … T-046 | 46 | 62 | 12 |
| PH-01 | T-047 … T-060 | 14 | 34 | 12 |
| PH-02 | T-061 … T-072 | 12 | 40 | 12 |
| PH-03 | T-073 … T-086 | 14 | 46 | 12 |
| PH-04 | T-087 … T-096 | 10 | 26 | 12 |
| PH-05 | T-097 … T-111 | 15 | 46 | 12 |
| PH-06 | T-112 … T-126 | 15 | 40 | 12 |
| PH-07 | T-127 … T-142 | 16 | 44 | 13 |
| PH-08 | T-143 … T-153 | 11 | 28 | 13 |
| PH-09 | T-154 … T-165 | 12 | 32 | 13 |
| PH-10 | T-166 … T-177 | 12 | 34 | 13 |
| PH-11 | T-178 … T-186 | 9 | 24 | 13 |
| PH-12 | T-187 … T-196 | 10 | 26 | 13 |
| PH-13 | T-197 … T-209 | 13 | 42 | 13 |
| PH-14 | T-210 … T-220 | 11 | 34 | 13 |
| PH-15 | T-221 … T-232 | 12 | 36 | 13 |
| PH-16 | T-233 … T-245 | 13 | 44 | 13 |
| PH-17 | T-246 … T-257 | 12 | 40 | 13 |
| PH-18 | T-258 … T-268 | 11 | 32 | 14 |
| PH-19 | T-269 … T-279 | 11 | 30 | 14 |
| PH-20 | T-280 … T-290 | 11 | 36 | 14 |
| PH-21 | T-291 … T-303 | 13 | 34 | 14 |
| PH-22 | T-304 … T-314 | 11 | 40 | 14 |
| PH-23 | T-315 … T-325 | 11 | 34 | 14 |
| PH-24 | T-326 … T-334 | 9 | 26 | 14 |
| PH-25 | T-335 … T-342 | 8 | 20 | 14 |
| Hardening | T-981 … T-999 (reserved) | — | 40 | 14 |
| **Total** | | **342** | **970** | |

**Reserved blocks for discovered work:** T-901…T-910 (PH-00) · T-911…T-930 (PH-01…PH-06) · T-931…T-960 (PH-07…PH-17) · T-961…T-980 (PH-18…PH-25) · T-981…T-999 (hardening and defect repair).

---

# Appendix C — The Thirty-Two D4/D5 Tasks

Every task requiring two reviewers. **These are 9% of the task count and roughly 40% of the project's risk.**

| Task | Name | D | Phase |
|---|---|---|---|
| T-061 | PT-10 written first | D4 | PH-02 |
| T-062 | PT-11 written first | D4 | PH-02 |
| T-063 | Adversarial corpus | D4 | PH-02 |
| T-064 | Entity decode + markup removal | D4 | PH-02 |
| T-065 | Unicode, control, zero-width, bidi | D4 | PH-02 |
| T-067 | Grapheme-aware length bounding | D4 | PH-02 |
| T-068 | The eight-step pipeline | D4 | PH-02 |
| T-071 | `security.xss-fixture` | D4 | PH-02 |
| T-072 | PT-10/PT-11 green | D4 | PH-02 |
| T-078 | Date pinning + PT-06 | D4 | PH-03 |
| T-081 | Author-key normalisation | D4 | PH-03 |
| T-082 | Identity hash | D4 | PH-03 |
| T-084 | `generated_at` exclusion pair | D4 | PH-03 |
| T-085 | PT-09 | D4 | PH-03 |
| T-086 | PT-08 synthetic | D4 | PH-03 |
| T-092 | Completeness classification | D4 | PH-04 |
| **T-097** | **PT-01 written first** | **D5** | PH-05 |
| **T-098** | **PT-02 written first** | **D5** | PH-05 |
| **T-099** | **PT-07 written first** | **D5** | PH-05 |
| **T-100** | **Decision classification** | **D5** | PH-05 |
| **T-101** | **Streak arithmetic gated on completeness** | **D5** | PH-05 |
| T-102…T-105 | Duplicate detection (4 tasks) | D4 | PH-05 |
| **T-106** | **Removal + PT-03** | **D5** | PH-05 |
| T-107 | Suppression + PT-04 | D4 | PH-05 |
| T-108 | PT-05 | D4 | PH-05 |
| **T-109** | **Reconcile composition** | **D5** | PH-05 |
| T-114…T-115 | Projector + PT-13 | D4 | PH-06 |
| T-122…T-126 | PT-12, gate rules, evaluation, first-publish, force matrix | D4 | PH-06 |
| T-131 | `redact.mjs` at 100% | D4 | PH-07 |
| T-137 | `retry-policy.blocked-never` | D4 | PH-07 |
| T-144…T-145 | Unknown-field preservation, PT-15 | D4 | PH-08 |
| T-179 | Contract suite | D4 | PH-11 |
| T-200…T-201 | Reply detachment, rating cascade | D4 | PH-13 |
| T-208 | Adversarial fixtures | D4 | PH-13 |
| T-217, T-219 | Teardown in `finally`, isolation test | D4 | PH-14 |
| T-230, T-232 | Stop reason, stall integration | D4 | PH-15 |
| T-235, T-237, T-240…T-243 | Identity verification, ambiguity refusal, challenge detection, serialisation | D4 | PH-16 |
| T-253, T-256 | Error envelope, budget semantics | D4 | PH-17 |
| T-259, T-262…T-263, T-266 | Injection safety, hash-gating, publish order | D4 | PH-18 |
| T-279 | First live-source contact | D4 | PH-19 |
| T-292…T-302 | Chaos scenarios (11 tasks) | D4 | PH-21 |
| **T-295** | **CH-04** | **D5** | PH-21 |
| T-308, T-313 | No-fallback assertion, PT-08 real | D4 | PH-22 |
| T-315 | Renderer (text-only APIs) | D4 | PH-23 |

---

# Appendix D — Invariant → Phase → Task → Test Traceability

**The audit trail. If an invariant has no test, it is not enforced.**

| Invariant | Built In | Task(s) | Enforcing Test | Green By |
|---|---|---|---|---|
| **INV-01** website never contacts a source | PH-23 | T-323, T-324 | Consumer network assertion per recipe | W16 |
| **INV-02** failure never degrades the payload | PH-06, PH-21 | T-123…T-126, T-292…T-296 | CH-01, CH-04, CH-05, CH-06; full gate suite | W15 |
| **INV-03** absence ≠ deletion | PH-05, PH-21 | **T-099, T-101, T-295** | **PT-07, CH-04** | W05 / W15 |
| **INV-04** reconcile idempotent | PH-05, PH-21 | T-097, T-109, T-300 | PT-01, CH-12 | W05 / W15 |
| **INV-05** output safe as text | PH-02, PH-21 | T-061, T-068, T-071, T-302 | PT-10, CH-14, `security.xss-fixture` | W03 / W15 |
| **INV-06** full provenance | PH-06, PH-20 | T-117, T-283 | Schema validation; manifest test | W05 / W14 |
| **INV-07** challenge is terminal | PH-07, PH-16, PH-21 | T-137, T-240, T-241, T-294 | CH-03, `retry-policy.blocked-never` | W06 / W15 |
| **INV-08** no secret in any artifact | PH-07 | T-131 | `security.redaction` | W06 |
| **INV-09** client isolation | PH-14, PH-19 | T-217…T-219, T-273 | `security.isolation`; `fail-fast: false` | W10 / W13 |
| **INV-10** adapter switch by config only | PH-03, PH-22 | T-082, T-086, T-313, T-314 | PT-08; migration drill | W03 / W15 |

---

# Appendix E — Property Law → Task → Green-By Week

| Law | Statement | Written In | Green By |
|---|---|---|---|
| PT-01 | Reconcile idempotence | T-097 | W05 |
| PT-02 | Reconcile commutativity | T-098 | W05 |
| PT-03 | Tombstone monotonicity | T-106 | W05 |
| PT-04 | Suppression durability | T-107 | W05 |
| PT-05 | First-seen preservation | T-108 | W05 |
| PT-06 | Date-pin preservation | T-078 | W03 |
| **PT-07** | **Absence asymmetry** | **T-099** | **W05** |
| PT-08 | Cross-adapter identity | T-086 → T-186 → T-313 | W03 → W09 → **W15** |
| PT-09 | Hash stability | T-085 | W03 |
| **PT-10** | **Normalisation output safety** | **T-061** | **W03** |
| PT-11 | Normalisation idempotence | T-062 | W03 |
| PT-12 | Projection determinism | T-122 | W05 |
| PT-13 | Sort totality | T-115 | W05 |
| PT-14 | Gate monotone safety | T-126 | W05 |
| PT-15 | Ledger round-trip | T-145 | W06 |

**Twelve of fifteen are green by week 5.** That concentration is the plan's central bet: the correctness argument is settled before any code that touches a live source exists.

---

# Appendix F — Chaos Scenario → Task → Protection Asserted

| ID | Task | Protection Asserted |
|---|---|---|
| CH-01 | T-292 | Retry policy; LKG retained |
| CH-02 | T-293 | Budget zeroing; breaker opening |
| CH-03 | T-294 | **Zero retries on a challenge** |
| **CH-04** | **T-295** | **Partial classification + streak suppression + gate rejection (three separately)** |
| CH-05 | T-296 | Structure detection fails loudly |
| CH-06 | T-296 | Empty-payload rejection |
| CH-07 | T-297 | Selector fallback engages |
| CH-08 | T-297 | Quarantine threshold → gate rejection |
| CH-09 | T-298 | Browser lifecycle; context closed |
| CH-10 | T-299 | State integrity; LKG retained |
| CH-11 | T-300 | Rebase-retry succeeds |
| CH-12 | T-300 | Byte-identical reproduction next run |
| CH-13 | T-301 | `deferred`, not `failed` |
| CH-14 | T-302 | Markup stripped, payload is plain text |

---

# Appendix G — Deliverable Index

| Range | Deliverables | Phase |
|---|---|---|
| DEL-01 … DEL-12 | Repository, branches, tree, READMEs | PH-00 |
| DEL-13 … DEL-19 | Dependencies, environment, onboarding | PH-00 |
| DEL-20 … DEL-30 | Node, types, lint, format | PH-00 |
| DEL-31 … DEL-43 | Test framework, helpers, hooks, env | PH-00 |
| DEL-44 … DEL-51 | Configuration system | PH-09, PH-10 |
| DEL-52 … DEL-56 | Logging | PH-07 |
| DEL-57 … DEL-61 | Error handling | PH-01, PH-07, PH-17 |
| DEL-62 … DEL-66 | Retry, breaker, limiter | PH-07 |
| DEL-67 … DEL-73 | Scheduler and orchestration | PH-17 |
| DEL-74 … DEL-82 | Browser and session management | PH-14 |
| DEL-83 … DEL-87 | Fixture server and navigator | PH-15 |
| DEL-88 … DEL-94 | Selector packs and detection | PH-12, PH-16 |
| DEL-95 … DEL-100 | Parser, dates, fixtures | PH-03, PH-13 |
| DEL-101 … DEL-108 | Normalizer | PH-02 |
| DEL-109 … DEL-114 | Hashing and identity | PH-01, PH-03 |
| DEL-115 … DEL-119 | Validation | PH-04 |
| DEL-120 … DEL-131 | Duplicates, reconciliation, ledger, state | PH-05, PH-08 |
| DEL-132 … DEL-138 | Projection | PH-06 |
| DEL-139 … DEL-145 | Schemas and the gate | PH-06 |
| DEL-146 … DEL-150 | Publication | PH-18 |
| DEL-151 … DEL-159 | Rollback and recovery | PH-10, PH-20 |
| DEL-160 … DEL-172 | Health, monitoring, metrics | PH-20 |
| DEL-173 … DEL-181 | GitHub integration and Actions | PH-19, PH-24 |
| DEL-182 … DEL-186 | Deployment | PH-24, PH-25 |
| DEL-187 … DEL-193 | Frontend | PH-23 |
| DEL-194 … DEL-204 | Extensibility seams | PH-07, PH-11, PH-22 |
| DEL-205 … DEL-211 | Testing infrastructure and chaos | PH-00, PH-21 |

---

# Appendix H — Decision Gate Index

| Gate | Week | Chair | Hard Stop | Decides |
|---|---|---|---|---|
| DG-01 | W01 | DevOps | No | Toolchain proven; cut list published; OPQ-01/04 answered |
| DG-02 | W03 | Architect | No | Text provably safe; PA-01/PA-04 holding |
| DG-03 | W05 | Architect | **Yes** | **Kernel correct; first re-baseline** |
| DG-04 | W06 | Backend Lead | No | State durable; redaction proven |
| DG-05 | W07 | Backend Lead | No | Engine operable by a human |
| DG-06 | W09 | Architect + EM | **Yes** | **Adapter interface right; second re-baseline** |
| DG-07 | W11 | Backend Lead + Security | No | Real acquisition works with isolation intact |
| DG-08 | W13 | DevOps + Security | **Yes** | **May run unattended with a write token** |
| DG-09 | W15 | QA + Architect | **Yes** | **Every failure mode proven safe** |
| DG-10 | W16 | EM | **Yes** | Release candidate accepted |
| DG-11 | W16 | EM | **Yes** | Production go-live |
| DG-12 | +30d | EM + Architect | No | Soak accepted; V2 prioritised |

---

# Appendix I — Plan Risk Index

| ID | Risk | Exp | Owner |
|---|---|---|---|
| **PR-22** | Absence asymmetry simplified | **20** | Architect |
| **PR-23** | Purity leak via default `Date.now()` | **16** | Backend |
| PR-04 | QA architect cut | 15 | EM |
| PR-05 | Exit criteria erode under deadline | 15 | Architect |
| PR-08 | Normalizer misses an input class | 15 | Backend |
| PR-16 | Stop reason inferred not emitted | 15 | Backend |
| PR-20 | Gate short-circuits or mis-handles first publish | 15 | Architect |
| PR-02 | Second engineer late or absent | 12 | EM |
| PR-09 | Upstream markup change during build | 12 | Backend |
| PR-10 | Fixture corpus late | 12 | QA |
| PR-15 | Context leak on failure paths | 12 | Backend |
| PR-19 | Parser defects (dates, replies, ratings) | 12 | Backend |
| PR-24 | Authorisation record unobtainable | 12 | EM |
| PR-26 | Agent output violates a rule undetected | 12 | AI Lead |
| PR-27 | Bus factor 1 on the kernel | 12 | EM |
| PR-01 | Lead engineer unavailable | 10 | EM |
| PR-12 | Secret logged before redaction | 10 | Security |
| PR-13 | Hashing wrong after first publish | 10 | Architect |
| PR-18 | Retry added to a challenge path | 10 | Architect |
| PR-21 | `data` checkout skipped | 10 | DevOps |
| PR-11, PR-14, PR-17, PR-25, PR-28 | Config, Playwright confinement, pack quality, scope creep, suite bloat | 9 | Various |
| PR-03, PR-06 | DevOps absent, security review skipped | 8 | EM / Security |
| PR-07 | Agents unavailable | 6 | AI Lead |

---

# Appendix J — Diagram Index

| Part | Diagram | Type |
|---|---|---|
| 0.2.1 | Three-document relationship | flowchart |
| 3.1 | Six strategic blocks | flowchart |
| 4.1 | Module-level dependency graph | flowchart |
| 4.5 | External dependency graph | flowchart |
| 5.2.1 | The two non-negotiable orderings | flowchart |
| 6.3 | Milestone timeline | gantt |
| 6.5 | Milestone dependency and slack | flowchart |
| 9.3 | Capability delivery sequence | flowchart |
| 11 (§13.1) | Branch creation order | flowchart |
| 28.1 | Scheduler purity split | flowchart |
| 30.1 | Browser lifecycle | stateDiagram |
| 62 (Part 11) | Gate sequence | flowchart |
| 15.3.2 | Plan risk exposure | quadrantChart |
| 15.5.1 | Critical path | flowchart |

---

# Appendix K — Quick Reference Card

*The one page to pin above a desk during the build.*

## The Five Orderings That Cannot Change

1. **Normalizer before any producer of data** (X-7, INV-05)
2. **Gate before publisher** (EP-08, INV-02)
3. **CSV adapter before any browser code** (X-8)
4. **Property laws before D4/D5 implementations** (ID-13)
5. **Ledger shape fixed before reconciliation** (hard edge)

## The Three Things That Are Never Done

1. Simplify the absence asymmetry
2. Add a retry to an `ERR-BLOCKED-*` path
3. Widen a hard ceiling

## Coverage Thresholds That Have No Waiver

| Module | Threshold |
|---|---|
| `core/gate/**` | **100%** |
| `infra/logger/redact.mjs` | **100%** |
| `core/normalize/`, `dates/`, `identity/`, `validate/`, `reconcile/`, `project/` | ≥ 95% |
| `src/core/**` | ≥ 90% |

## The Hard-Stop Gates

`DG-03` (W05, kernel correct) · `DG-06` (W09, interface right) · `DG-08` (W13, unattended) · `DG-09` (W15, provably safe) · `DG-10`/`DG-11` (W16, ship)

## Budgets

| Thing | Budget |
|---|---|
| Default test suite | < 3 min, offline |
| `ci.yml` | < 5 min |
| `pre-commit` hook | < 3 s |
| `pre-push` hook | < 45 s |
| PR diff | ≤ ~400 lines |
| Branch age | ≤ 48 h (24 h in SP-5) |
| Renderer bundle | ≤ 5 KB minified |
| Pure pipeline, 1,000 reviews | ≤ 2 s CPU |

## When a Task Overruns

| Overrun | Action |
|---|---|
| < 50% | Absorb from reserve; log it |
| ≥ 50% | Escalate at the next stand-up (X-11) |
| ≥ 100% | Escalate at the next decision gate; consider descoping a **later** milestone |

## When Something Does Not Fit

**Stop.** Do not choose the reasonable-looking option.

| Situation | Action |
|---|---|
| Spec gap | Raise an EDR against the TRD |
| Architecture problem | Raise an ADR against the SAD |
| Sequencing or staffing problem | Raise a PCR against this plan |
| Requirement vs test disagree | **Stop.** Escalate. Never amend the test |

## The Cut List, In Order

`replay` → `export` → Places API adapter → three optional recipes → dependency-audit workflow → multi-location example → pretty logger. **Total recoverable: 58 IEH.**

**Below the line and never cut:** any chaos scenario, any property law, gate or redaction coverage, the CSV adapter, fixture corpus completeness, staged release steps 6–7, offsite clone, Pages header verification.

## When In Doubt

**Build the thing whose failure is invisible before the thing whose failure is obvious.**

---

# Appendix L — Document Change Log

| Version | Date | Change |
|---|---|---|
| v1.0 | 2026-07-31 | Baselined for execution. 70 mandated sections across 18 parts; 26 phases; 342 tasks; 9 milestones; 8 sprints; 12 decision gates; 28 plan risks; 14 quality gates. |

---

*End of the TP Reviews Engine Implementation Plan v1.0.*
