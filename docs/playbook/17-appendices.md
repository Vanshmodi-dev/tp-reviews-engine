# Part 17 — Appendices

*Reference material consolidated for lookup. Nothing here is new; it is the same content reorganised for finding rather than for reading.*

---

# Appendix A — The Handbook at a Glance

| Part | Sections | Covers |
|---|---|---|
| Front matter | §0 | Purpose, audience, conformance tiers, section template, notation |
| 1 | §1–§2 | Engineering philosophy; AI coding philosophy |
| 2 | §3–§4 | Prompt engineering; context management |
| 3 | §5 | Planning before coding |
| 4 | §6–§7 | Repository standards; Git standards |
| 5 | §8–§9 | Coding standards; module isolation |
| 6 | §10–§11 | Definition of Done; testing standards |
| 7 | §12–§13 | Debugging; AI error recovery |
| 8 | §14–§15 | Documentation; security |
| 9 | §16–§17 | Performance; observability |
| 10 | §18–§19 | Deployment; AI agent collaboration |
| 11 | §20–§21 | Project lifecycle; decision frameworks |
| 12 | §22–§23 | Risk management; engineering checklists |
| 13 | §24–§25 | Forbidden practices; AI coding workflow |
| 14 | §26 | Prompt library |
| 15 | §27–§28 | Quality gates; engineering KPIs |
| 16 | §29–§30 | Future evolution; **the Engineering Constitution** |
| 17 | — | Appendices |

---

# Appendix B — Conformance Tier Summary

| | **T1 Throwaway** | **T2 Internal Tool** | **T3 Production** | **T4 Critical** |
|---|---|---|---|---|
| **Lives** | < 30 days | Indefinite, internal | Indefinite, external | Indefinite, critical |
| **Planning** | A sentence | 1-page PRD + diagram | Full document set | Full + threat model |
| **Tests** | Optional | Unit | Full pyramid | Full + property + chaos |
| **Coverage gates** | — | — | Per path | Per path + 100% on safety |
| **Review** | Optional | 1 reviewer | 1–2 by supervision level | 2 on hazard modules |
| **Documentation** | README | README + architecture | Full set + runbooks | Full + threat model |
| **Security** | Secrets rules only | + input validation | + review triggers | + mandatory review, threat model |
| **Observability** | — | Basic logging | Logs, metrics, alerts, health | + tracing |
| **Deployment** | Manual acceptable | Automated | Automated + rollback tested | + approval gate |
| **Gates** | G2 (light) | G0–G2 | G0–G6 | G0–G6, all evidence-based |
| **Risk register** | — | Top 3 | Full | Full + threat model |

**Choosing:** §0.3.4's decision tree. When genuinely uncertain, choose higher.

---

# Appendix C — Rule Index by Prefix

| Prefix | Section | Domain | Count |
|---|---|---|---|
| `PHIL-` | §1 | Engineering philosophy | 10 |
| `OWN-` | §1 | Ownership | 5 |
| `AI-` / `AI-N` | §2 | Agent obligations and prohibitions | 22 |
| `SUP-` | §2 | Human supervision | 6 |
| `PRM-` / `PRM-N` | §3 | Prompt structure and prohibitions | 14 |
| `TOK-` | §3 | Token budgeting | 4 |
| `CTX-` | §4 | Context management | 22 |
| `PLAN-` | §5 | Planning documents and process | 34 |
| `REPO-` / `VER-` | §6 | Repository and versioning | 26 |
| `GIT-` | §7 | Git and pull requests | 39 |
| `CODE-` | §8 | Coding standards | 42 |
| `MOD-` | §9 | Module isolation | 30 |
| `DONE-` | §10 | Definition of Done | 10 |
| `TEST-` | §11 | Testing | 32 |
| `DEBUG-` / `LOG-` / `TRACE-` / `RCA-` / `INC-` | §12 | Debugging and incidents | 33 |
| `REC-` | §13 | AI error recovery | 32 |
| `DOC-` | §14 | Documentation | 42 |
| `SEC-` | §15 | Security | 74 |
| `PERF-` | §16 | Performance | 39 |
| `OBS-` | §17 | Observability | 40 |
| `DEP-` | §18 | Deployment | 44 |
| `COL-` | §19 | Agent collaboration | 36 |
| `LIFE-` | §20 | Lifecycle | 22 |
| `DEC-` | §21 | Decisions | 23 |
| `RISK-` / `SR-` | §22 | Risk management | 28 |
| `CHK-` | §23 | Checklist governance | 6 |
| `FORBID-` | §24 | Forbidden practices | 43 |
| `WORK-` | §25 | AI coding workflow | 22 |
| `LIB-` / `TMPL-` | §26 | Prompt library | 20 |
| `GATE-` | §27 | Quality gates | 10 |
| `KPI-` | §28 | Metrics | 9 |
| `EVO-` | §29 | Amendment process | 21 |
| **`CONST-`** | **§30** | **Constitution — no waiver** | **27** |

---

# Appendix D — Anti-Pattern Index

| ID | Name | Section |
|---|---|---|
| AP-01 | Hero Engineering | §1 |
| AP-02 | Resume-Driven Development | §1 |
| AP-03 | The Big Rewrite | §1 |
| AP-04 | Quality Theatre | §1 |
| AP-05 | Premature Generalisation | §1 |
| AP-06 | The Knowledge Silo | §1 |
| AP-07 | Deadline Amnesia | §1 |
| AP-08 | The Zombie Feature | §1 |
| AP-09 | Vibe Merging | §2 |
| AP-10 | The Oracle Fallacy | §2 |
| AP-11 | Prompt Roulette | §2 |
| AP-12 | Context Hoarding | §2 |
| AP-13 | Agent Sprawl | §2 |
| AP-14 | The Confident Refactor | §2 |
| AP-15 | Test Laundering | §2 |
| AP-16 | Accountability Diffusion | §2 |
| AP-17 | The Wish | §3 |
| AP-18 | The Kitchen Sink | §3 |
| AP-19 | The Moving Target | §3 |
| AP-20 | Implicit Convention | §3 |
| AP-21 | The Rubber Stamp Prompt | §3 |
| AP-22 | Spec-by-Correction | §3 |
| AP-23 | The Eternal Session | §4 |
| AP-24 | Context Archaeology | §4 |
| AP-25 | Summary Rot | §4 |
| AP-26 | The Verbal Handover | §4 |
| AP-27 | Instruction Sprawl | §4 |
| AP-28 | The Lost Constraint | §4 |
| AP-29 | Plan-Shaped Prose | §5 |
| AP-30 | The Big Design Up Front | §5 |
| AP-31 | The Retro-Spec | §5 |
| AP-32 | Requirements by Ticket | §5 |
| AP-33 | The Immutable Plan | §5 |
| AP-34 | Estimate as Commitment | §5 |
| AP-35 | The Absent Owner | §5 |
| AP-36 | The Junk Drawer | §6 |
| AP-37 | The Ghost Repository | §6 |
| AP-38 | Structure by Accident | §6 |
| AP-39 | The Undocumented Prerequisite | §6 |
| AP-40 | Version Theatre | §6 |
| AP-41 | The Copy-Paste Repository | §6 |
| AP-42 | The Mega Merge | §7 |
| AP-43 | Rubber-Stamp Review | §7 |
| AP-44 | History Rewriting | §7 |
| AP-45 | The Broken Trunk | §7 |
| AP-46 | Revert Aversion | §7 |
| AP-47 | The Zombie Flag | §7 |
| AP-48 | Commit Message Poverty | §7 |
| AP-49 | The God Object | §8 |
| AP-50 | Primitive Obsession | §8 |
| AP-51 | The Parameter Avalanche | §8 |
| AP-52 | Stringly Typed | §8 |
| AP-53 | The Swallowed Exception | §8 |
| AP-54 | Copy-Paste Inheritance | §8 |
| AP-55 | The Utility Junk Drawer | §8 |
| AP-56 | Comment-Driven Confusion | §8 |
| AP-57 | Framework Leakage | §8 |
| AP-58 | The Clever One-Liner | §8 |
| AP-59 | The Distributed Monolith | §9 |
| AP-60 | The Leaky Abstraction | §9 |
| AP-61 | The Shared Kernel | §9 |
| AP-62 | Anaemic Domain | §9 |
| AP-63 | The Framework Prison | §9 |
| AP-64 | The Exemption List | §9 |
| AP-65 | Plugin Theatre | §9 |
| AP-66 | Done-Done | §10 |
| AP-67 | The Follow-Up Ticket | §10 |
| AP-68 | Definition Drift | §10 |
| AP-69 | Checkbox Compliance | §10 |
| AP-70 | The Silent Downgrade | §10 |
| AP-71 | The Mock Cathedral | §11 |
| AP-72 | Assertion-Free Testing | §11 |
| AP-73 | The Snapshot Swamp | §11 |
| AP-74 | Test-After-The-Fact | §11 |
| AP-75 | The Retry Loop | §11 |
| AP-76 | The Sleeping Test | §11 |
| AP-77 | Coverage Gaming | §11 |
| AP-78 | The Disabled Suite | §11 |
| AP-79 | Shotgun Debugging | §12 |
| AP-80 | The Defensive Bandage | §12 |
| AP-81 | Print-Statement Archaeology | §12 |
| AP-82 | The Plausible Story | §12 |
| AP-83 | Heisenbug Avoidance | §12 |
| AP-84 | The Blame Retro | §12 |
| AP-85 | Log Everything | §12 |
| AP-86 | The Unwritten Fix | §12 |
| AP-87 | The Correction Spiral | §13 |
| AP-88 | Blind Acceptance | §13 |
| AP-89 | The Undocumented Assumption | §13 |
| AP-90 | Agent Blame | §13 |
| AP-91 | The Entangled Revert | §13 |
| AP-92 | Lesson Evaporation | §13 |
| AP-93 | The Wiki Graveyard | §14 |
| AP-94 | The Aspirational Doc | §14 |
| AP-95 | Documentation Theatre | §14 |
| AP-96 | The Screenshot Manual | §14 |
| AP-97 | The Missing Why | §14 |
| AP-98 | Runbook Fiction | §14 |
| AP-99 | Security by Obscurity | §15 |
| AP-100 | The Trusted Client | §15 |
| AP-101 | Fail Open | §15 |
| AP-102 | The God Credential | §15 |
| AP-103 | Sanitise and Continue | §15 |
| AP-104 | Security Theatre | §15 |
| AP-105 | The Temporary Bypass | §15 |
| AP-106 | Trust the Agent's Output | §15 |
| AP-107 | The Cache Blanket | §16 |
| AP-108 | Premature Microservices | §16 |
| AP-109 | The Benchmark Fixation | §16 |
| AP-110 | Death by a Thousand Queries | §16 |
| AP-111 | The Infinite Scroll of Doom | §16 |
| AP-112 | Optimising the Wrong Layer | §16 |
| AP-113 | Alert Fatigue | §17 |
| AP-114 | The Dashboard Wall | §17 |
| AP-115 | Log-and-Continue | §17 |
| AP-116 | The Vanity Metric | §17 |
| AP-117 | Health Check Theatre | §17 |
| AP-118 | The Unmonitored Job | §17 |
| AP-119 | Debug in Production | §17 |
| AP-120 | The Deploy Ceremony | §18 |
| AP-121 | Snowflake Environments | §18 |
| AP-122 | The Big Bang Release | §18 |
| AP-123 | Configuration Drift | §18 |
| AP-124 | The Irreversible Migration | §18 |
| AP-125 | Deploy and Walk Away | §18 |
| AP-126 | The Hero Deploy | §18 |
| AP-127 | The Agent Swarm | §19 |
| AP-128 | The Telephone Game | §19 |
| AP-129 | Merge Roulette | §19 |
| AP-130 | The Frankenmerge | §19 |
| AP-131 | Review Debt | §19 |
| AP-132 | The Orphan Slice | §19 |
| AP-133 | Convention Drift | §19 |
| AP-134 | The Permanent Prototype | §20 |
| AP-135 | Launch and Abandon | §20 |
| AP-136 | The Unfunded Mandate | §20 |
| AP-137 | The Orphan System | §20 |
| AP-138 | The Zombie | §20 |
| AP-139 | Partial Decommission | §20 |
| AP-140 | Perpetual Beta | §20 |
| AP-141 | The Second-System Effect | §21 |
| AP-142 | Analysis Paralysis | §21 |
| AP-143 | Reversible Treated as Permanent | §21 |
| AP-144 | Decision by Exhaustion | §21 |
| AP-145 | The Undocumented Reversal | §21 |
| AP-146 | Resume-Driven Adoption | §21 |
| AP-147 | The Perpetual Deferral | §21 |
| AP-148 | The Compliance Register | §22 |
| AP-149 | Risk Theatre | §22 |
| AP-150 | The Known Unknown Shrug | §22 |
| AP-151 | Optimism by Omission | §22 |
| AP-152 | The Orphan Risk | §22 |
| AP-153 | Mitigation by Documentation | §22 |
| AP-154 | The Ceremonial Tick | §23 |
| AP-155 | The Encyclopaedic Checklist | §23 |
| AP-156 | The Stale Checklist | §23 |
| AP-157 | Checklist as Substitute for Understanding | §23 |
| AP-158 | Straight to Code | §25 |
| AP-159 | The Silent Assumption | §25 |
| AP-160 | Test-After Rationalisation | §25 |
| AP-161 | Scope Creep by Helpfulness | §25 |
| AP-162 | The Optimistic Report | §25 |
| AP-163 | Check Adjustment | §25 |
| AP-164 | Template Cargo Cult | §26 |
| AP-165 | The Frankenprompt | §26 |
| AP-166 | The Private Template | §26 |
| AP-167 | Template Rot | §26 |
| AP-168 | The Rubber Gate | §27 |
| AP-169 | Gate Inflation | §27 |
| AP-170 | The Permanent Exception | §27 |
| AP-171 | Sign-Off Theatre | §27 |
| AP-172 | The Ratcheting Down | §27 |
| AP-173 | The Dashboard Nobody Acts On | §28 |
| AP-174 | Goodhart's Trap | §28 |
| AP-175 | Vanity Engineering Metrics | §28 |
| AP-176 | The Individual Scorecard | §28 |
| AP-177 | Metric Proliferation | §28 |
| AP-178 | The Unquestioned Improvement | §28 |
| AP-179 | The Frozen Standard | §29 |
| AP-180 | The Churning Standard | §29 |
| AP-181 | Amendment by Erosion | §29 |
| AP-182 | The Aspirational Handbook | §29 |
| AP-183 | Rule Accretion | §29 |

---

# Appendix E — Checklist Index

| ID | Checklist | Section | When |
|---|---|---|---|
| CHK-1.1 | Am I making the right trade? | §1 | Before a non-trivial decision |
| CHK-1.2 | Ownership handover | §1 | Transferring a module |
| CHK-2.1 | Agent self-check before proposing | §2 | Agent, before reporting |
| CHK-2.2 | Human review of agent output | §2 | Reviewing agent work |
| CHK-3.1 | Before sending a task prompt | §3 | Prompting |
| CHK-3.2 | When output is wrong | §3 | After a failed attempt |
| CHK-4.1 | Starting a session on an existing project | §4 | Session start |
| CHK-4.2 | Ending a session mid-task | §4 | Session end |
| CHK-4.3 | Weekly project summary maintenance | §4 | Weekly |
| CHK-5.1 | Before writing any code | §5 | Project start |
| CHK-5.2 | Specification quality review | §5 | Reviewing a spec |
| CHK-5.3 | Planning gate | §5 | End of planning |
| CHK-6.1 | New repository | §6 | Repository creation |
| CHK-6.2 | Quarterly repository health | §6 | Quarterly |
| CHK-7.1 | Before committing | §7 | Every commit |
| CHK-7.2 | Before opening a pull request | §7 | Every PR |
| CHK-7.3 | Before merging | §7 | Every merge |
| CHK-8.1 | Before submitting code | §8 | Every change |
| CHK-8.2 | Reviewing code | §8 | Every review |
| CHK-9.1 | Module design review | §9 | New or changed module |
| CHK-9.2 | Before building an extension point | §9 | Abstraction decisions |
| CHK-10.1 | Change done check | §10 | Every change |
| CHK-10.2 | Feature done check | §10 | Feature completion |
| CHK-10.3 | Project done check | §10 | Project completion |
| CHK-11.1 | Writing tests | §11 | Writing tests |
| CHK-11.2 | Reviewing tests | §11 | Reviewing tests |
| CHK-11.3 | Suite health | §11 | Monthly |
| CHK-12.1 | Debugging | §12 | Any defect |
| CHK-12.2 | Production incident | §12 | Incidents |
| CHK-12.3 | Debuggability review | §12 | Per feature, T3+ |
| CHK-13.1 | Reviewing agent output for characteristic errors | §13 | Agent review |
| CHK-13.2 | Recovering from a failed session | §13 | After failure |
| CHK-13.3 | After an agent error reaches merge | §13 | Post-merge defect |
| CHK-14.1 | Documentation in a change | §14 | Every change |
| CHK-14.2 | Quarterly documentation review | §14 | Quarterly |
| CHK-15.1 | Security review of a change | §15 | Security triggers |
| CHK-15.2 | Pre-release security | §15 | Before release, T3+ |
| CHK-16.1 | Performance review of a change | §16 | Every change |
| CHK-16.2 | Pre-release performance | §16 | Before release, T3+ |
| CHK-17.1 | Observability for a new feature | §17 | Feature completion, T3+ |
| CHK-17.2 | Monthly observability review | §17 | Monthly |
| CHK-18.1 | Before release | §18 | Every release |
| CHK-18.2 | After deployment | §18 | Every deployment |
| CHK-19.1 | Before starting parallel agent work | §19 | Multi-agent work |
| CHK-19.2 | Integrating agent work | §19 | Merging slices |
| CHK-20.1 | Stage transition | §20 | Lifecycle transitions |
| CHK-20.2 | Retirement | §20 | Decommissioning |
| CHK-20.3 | Annual system review | §20 | Annually |
| CHK-21.1 | Before a significant decision | §21 | Major decisions |
| CHK-21.2 | Before proposing a rewrite | §21 | Rewrite proposals |
| CHK-22.1 | Risk assessment at planning | §22 | Project start |
| CHK-22.2 | Risk review | §22 | Per milestone |
| CHK-A…L | The twelve moment-based checklists | §23 | Per moment |
| CHK-24.1 | Forbidden practice scan | §24 | Every review |
| CHK-25.1 | Workflow conformance | §25 | Reviewing agent work |
| CHK-26.1 | Before sending a templated prompt | §26 | Prompting |
| CHK-27.1 | Running a gate | §27 | Every gate |
| CHK-28.1 | Monthly KPI review | §28 | Monthly |
| CHK-29.1 | Proposing an amendment | §29 | Amendments |

---

# Appendix F — Prompt Template Index

| ID | Template | Use |
|---|---|---|
| TMPL-IMPL-01 | Feature implementation | Build specified behaviour |
| TMPL-BUG-01 | Bug investigation (read-only) | Understand a failure |
| TMPL-BUG-02 | Bug fix | Fix a diagnosed failure |
| TMPL-REFACTOR-01 | Refactoring | Change structure, not behaviour |
| TMPL-TEST-01 | Test writing | Add tests from a specification |
| TMPL-DOC-01 | Documentation | Write or fix documentation |
| TMPL-ARCH-01 | Architecture review | Evaluate a design |
| TMPL-SEC-01 | Security review | Review a security surface |
| TMPL-PERF-01 | Performance work | Investigate and improve performance |
| TMPL-MIG-01 | Migration or upgrade | Version or platform migration |
| TMPL-REVIEW-01 | Code review assistance | Assist a human reviewer |
| TMPL-DEP-01 | Dependency update | Update a dependency |
| TMPL-SCAFFOLD-01 | Scaffolding | Start a project or module |
| TMPL-INCIDENT-01 | Incident assistance | Active incident analysis |

---

# Appendix G — Quality Gate Summary

| Gate | Question | Decider | Blocks |
|---|---|---|---|
| **G0** Start | May we build this? | Engineering Manager | Planning |
| **G1** Design | Is this the right shape? | Architect / Lead | Implementation |
| **G2** Change | May this merge? | Reviewer | Merge |
| **G3** Feature | Is it complete? | Technical Lead | Release inclusion |
| **G4** Release | May this ship? | Release owner (+ approval at T4) | Deployment |
| **G5** Production | Is it healthy? | Deployer / Lead | Stabilisation exit |
| **G6** Continuation | Should we keep it? | Engineering Manager | Continued operation |

---

# Appendix H — KPI Summary

| ID | Metric | Healthy | Type |
|---|---|---|---|
| KPI-D1 | Deployment frequency | Daily (T3) | Lagging |
| KPI-D2 | Lead time to production | < 1 day | Lagging |
| KPI-D3 | Change failure rate | < 10% | Lagging |
| KPI-D4 | Recovery time | < 1 hour | Lagging |
| KPI-Q1 | Escaped defect rate | Trending down | Lagging |
| KPI-Q2 | Defect recurrence | **0** | Lagging |
| KPI-Q3 | Build success rate | > 95% | Lagging |
| KPI-Q4 | Flaky test count | **0** | Leading |
| KPI-Q5 | Test suite duration | Within budget | Leading |
| KPI-Q6 | Coverage on critical paths | At threshold | Leading |
| KPI-P1 | Change size (median) | < 200 lines | **Leading** |
| KPI-P2 | Review latency | < 4 hours | **Leading** |
| KPI-P3 | Branch age at merge | < 24 hours | **Leading** |
| KPI-P4 | Review depth | > 50% substantive | Leading |
| KPI-P5 | Documentation currency | > 90% | Leading |
| KPI-O1 | Alert actionability | > 80% | Leading |
| KPI-O2 | Detected by monitoring | > 90% | Lagging |
| KPI-O3 | Runbook currency | 100% | Leading |
| KPI-O4 | Dependency age | < 3 months | Leading |
| KPI-O5 | Unpatched high advisories | **0** | Leading |
| KPI-A1 | Agent change acceptance | > 70% | Leading |
| KPI-A2 | Agent defect-mode distribution | Flat or falling | Leading |
| KPI-A3 | Corrections per agent task | < 2 | Leading |
| KPI-A4 | Specification-gap rate | **10–25%** (two-sided) | Leading |

---

# Appendix I — Glossary

| Term | Meaning |
|---|---|
| **Agent** | An AI coding tool performing implementation work |
| **Anti-pattern** | A named failure shape, so it can be recognised before it costs |
| **Blast radius** | What is affected when something fails |
| **Characterisation test** | A test capturing existing behaviour before changing it |
| **Conformance tier** | T1–T4; determines which controls apply |
| **Domain layer** | Business logic with no I/O, clock, randomness, or environment |
| **Escaped defect** | A defect reaching production |
| **Fail closed** | On error, deny or stop, rather than allow or continue |
| **Gate** | A checkpoint that blocks progression until criteria are met with evidence |
| **Hazard module** | Code whose failure is silent, irreversible, or a security boundary. Human-led |
| **Integrator** | The human accountable for merging multi-agent work coherently |
| **Interface freeze** | Agreeing and merging a contract before parallel work begins |
| **Invariant** | A property that must always hold, with a mechanism enforcing it |
| **Lagging indicator** | A metric describing what already happened |
| **Leading indicator** | A metric predicting what is about to happen |
| **Purity** | A function whose entire behaviour is determined by its parameters |
| **Runbook** | Numbered, imperative steps for handling a specific failure |
| **Silent failure** | A failure producing no signal — the worst class of defect |
| **Standing context** | The version-controlled file every agent session loads |
| **Structural mitigation** | A control that holds without anyone remembering it |
| **Supervision level** | S1–S5; how much human involvement an agent task requires |
| **Trunk-based development** | Short-lived branches merged to a single main line within ~48 hours |
| **Waiver** | A recorded, expiring exception to a non-constitutional rule |

---

# Appendix J — Onboarding Path

**A new engineer's first week.**

| Day | Activity | Outcome |
|---|---|---|
| 1 | Read §30 (Constitution), §1 (Philosophy), §0.3 (Tiers) | Understands what is non-negotiable and why |
| 1 | Read the project's standing context and state summary | Understands the current project |
| 2 | Read §5 (Planning), §10 (Definition of Done), §23 (Checklists) | Knows what "done" means and how work flows |
| 2 | Run the quick start; make a trivial change through the full process | Has experienced the pipeline end to end |
| 3 | Read §8 (Coding), §9 (Modules), §11 (Testing) | Knows how code is written and verified here |
| 3 | Review someone else's pull request using CHK-D | Has practised the review discipline |
| 4 | Read §2, §3, §4 (AI philosophy, prompting, context), §25 (workflow) | Can work effectively with agents |
| 4 | Complete one small task using TMPL-IMPL-01 end to end | Has produced conformant work |
| 5 | Read §12 (Debugging), §15 (Security), §24 (Forbidden) | Knows the hazards |
| 5 | Shadow an incident review or drill a runbook | Has seen the operational side |

**A new agent's first session:** §30 → §2 → §25 → §3 → §4 → §24 → the standing context → the task.

---

# Appendix K — Quick Reference Card

*One page. Pin it.*

## The Five Questions Before Any Change

1. What requirement does this serve?
2. How will I know it works?
3. What happens when it fails?
4. Who owns it afterwards?
5. How do I undo it?

## The Four Things That Are Never Done

- Commit a secret
- Hide a failure
- Weaken a check to make it pass
- Ship unverified or unreviewed

## Sizes and Budgets

| Thing | Limit |
|---|---|
| Prompt scope | 1 task |
| Context used | ≤ 40% of window |
| Change size | ≤ 400 diff lines, ≤ 5 files |
| Branch age | ≤ 48 hours |
| Function | ≤ 40 lines, complexity ≤ 8 |
| File | ≤ 300 lines |
| Test suite | < 3 minutes |
| CI pipeline | < 10 minutes |
| Rollback | < 2 minutes |
| Agents per reviewer | 2–3 |

## Supervision by Consequence

| Touches | Level |
|---|---|
| Auth, payments, personal data, secrets | **S5 human-led** |
| Anything irreversible | **S5** |
| Safety mechanisms, public contracts | **S5** |
| Data changes, concurrency, ordering | S4, two reviewers |
| Integrations, business rules | S3, line-by-line |
| Ordinary feature work | S2 |
| Docs, formatting, scaffolding | S1 |

## When to Stop and Ask

The spec does not cover it · Two rules conflict · A test and a requirement disagree · A new dependency is needed · The change is growing past limits · It is a hazard module · You are about to guess

## When Something Breaks

**Mitigate first — revert.** Then reproduce, then diagnose, then fix, then add the regression test. Never fix before you can state the mechanism.

## When Under Pressure

Cut **scope**. Never cut tests, security, error handling, observability, or review. The Definition of Done does not move.

## The One-Sentence Version

**Build the simplest thing that meets the requirement, verify it, own it, and never hide a failure.**

---

# Appendix L — Document Change Log

| Version | Date | Change |
|---|---|---|
| v1.0 | 2026-07-31 | Initial baseline. Thirty sections across seventeen parts; four conformance tiers; twenty-seven constitutional articles; 183 named anti-patterns; fourteen prompt templates; seven quality gates; twenty-five KPIs. |

---

*End of the TP AI Development Playbook v1.0.*
