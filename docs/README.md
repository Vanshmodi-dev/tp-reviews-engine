# TP Reviews Engine — Documentation

**TradyPerch · Baselined 2026-07-30 · Approved for Implementation**

One standing handbook governs **all** TradyPerch engineering. Three baselined documents govern **this product**.

| Document                                                                  | Scope                         | Answers                                 | Sections | Status                 |
| ------------------------------------------------------------------------- | ----------------------------- | --------------------------------------- | -------- | ---------------------- |
| **[TP AI Development Playbook v1.0](TP-AI-Development-Playbook-v1.0.md)** | **All projects, permanently** | _How do we build software here?_        | 30       | **Active**             |
| **[SAD/TDD v1.0](TP-Reviews-Engine-SAD-v1.0.md)**                         | TP Reviews Engine             | _What is the system, and why?_          | 60       | Approved               |
| **[TRD v1.0](TP-Reviews-Engine-TRD-v1.0.md)**                             | TP Reviews Engine             | _How, exactly, is it built?_            | 100      | Approved               |
| **[IMPL Plan v1.0](TP-Reviews-Engine-IMPL-PLAN-v1.0.md)**                 | TP Reviews Engine             | _In what order, by when, verified how?_ | 70       | Approved for Execution |

**Read the SAD first.** The TRD assumes it and never re-opens an architectural decision. The plan assumes both and never re-opens a specification. The Playbook sits above all three: a project document may be stricter than it, never looser without a recorded waiver.

---

# TP AI Development Playbook v1.0

## What This Is

**The engineering operating system for every TradyPerch software project** — AI agents, web and mobile apps, backend APIs, automation systems, SaaS platforms, CLIs, extensions, desktop apps, internal tools. It is not project-specific and it does not expire with a project.

It exists because TradyPerch builds with a small team and a large share of implementation performed by AI agents. That combination is enormously productive and structurally fragile: an agent implements a badly-specified module exactly as fast as a well-specified one, and the defect looks like working code. The difference is the process around it. This handbook is that process.

**Read it in one file:** [TP-AI-Development-Playbook-v1.0.md](TP-AI-Development-Playbook-v1.0.md) — regenerate with `scripts/build-playbook.sh`.

## Or Read It In Parts

| File                                                                                         | Sections | Contents                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [playbook/00-front-matter.md](playbook/00-front-matter.md)                                   | §0       | Purpose, audience, **the four conformance tiers**, the standard section block, notation, the handbook on one page                                                                                       |
| [playbook/01-philosophy.md](playbook/01-philosophy.md)                                       | §1–§2    | Engineering values; **AI coding philosophy** — what agents are excellent at, what they are hazardous at, the trust model, the five supervision levels                                                   |
| [playbook/02-prompting-and-context.md](playbook/02-prompting-and-context.md)                 | §3–§4    | The seven-block prompt structure, size and token limits, good vs bad prompts; session rules, handovers, context repair                                                                                  |
| [playbook/03-planning.md](playbook/03-planning.md)                                           | §5       | PRD, architecture, TRD, implementation plan, risk assessment, project Definition of Done                                                                                                                |
| [playbook/04-repository-and-git.md](playbook/04-repository-and-git.md)                       | §6–§7    | Naming, structure, monorepo vs polyrepo, README, versioning; trunk-based Git, commits, PRs, tags, rollback                                                                                              |
| [playbook/05-coding-standards.md](playbook/05-coding-standards.md)                           | §8–§9    | Naming, structural limits, errors, SOLID/DRY/KISS/YAGNI as interpreted here, clean architecture; coupling, cohesion, dependency inversion, plugin rules                                                 |
| [playbook/06-done-and-testing.md](playbook/06-done-and-testing.md)                           | §10–§11  | **Done at three levels, eleven conditions**; the test pyramid, coverage that means something, property/chaos/security/accessibility testing                                                             |
| [playbook/07-debugging-and-ai-recovery.md](playbook/07-debugging-and-ai-recovery.md)         | §12–§13  | Reproduce → diagnose → fix → verify → prevent; **the eight agent failure modes and how to detect each**                                                                                                 |
| [playbook/08-documentation-and-security.md](playbook/08-documentation-and-security.md)       | §14–§15  | Docs written for a named reader at a named moment; secrets, authz, validation, rate limiting, encryption, OWASP, threat modelling                                                                       |
| [playbook/09-performance-and-observability.md](playbook/09-performance-and-observability.md) | §16–§17  | Budgets, caching as a correctness decision; the four signals, symptom-based alerting, health checks                                                                                                     |
| [playbook/10-deployment-and-collaboration.md](playbook/10-deployment-and-collaboration.md)   | §18–§19  | Pipelines, environments, progressive delivery, migrations, rollback; **how multiple agents work without colliding**                                                                                     |
| [playbook/11-lifecycle-and-decisions.md](playbook/11-lifecycle-and-decisions.md)             | §20–§21  | Idea to retirement in nine stages; when to refactor, rewrite, optimise, postpone, adopt                                                                                                                 |
| [playbook/12-risk-and-checklists.md](playbook/12-risk-and-checklists.md)                     | §22–§23  | Risk scoring, **fifteen standing risks**; the twelve moment-based checklists                                                                                                                            |
| [playbook/13-forbidden-and-workflow.md](playbook/13-forbidden-and-workflow.md)               | §24–§25  | **Forty-three forbidden practices**; the nine-step AI coding workflow                                                                                                                                   |
| [playbook/14-prompt-library.md](playbook/14-prompt-library.md)                               | §26      | **Fourteen reusable prompt templates** — implementation, bug investigation, bug fix, refactor, tests, docs, architecture, security, performance, migration, review, dependencies, scaffolding, incident |
| [playbook/15-gates-and-kpis.md](playbook/15-gates-and-kpis.md)                               | §27–§28  | Seven quality gates with evidence requirements; twenty-five KPIs, and what is deliberately not measured                                                                                                 |
| [playbook/16-evolution-and-constitution.md](playbook/16-evolution-and-constitution.md)       | §29–§30  | How the handbook changes; **the twenty-seven constitutional articles that do not**                                                                                                                      |
| [playbook/17-appendices.md](playbook/17-appendices.md)                                       | A–L      | Tier summary, rule index, **183 anti-patterns**, checklist index, template index, gates, KPIs, glossary, onboarding path, quick-reference card                                                          |

## Where To Start, By Role

| You are…                      | Read, in this order                                                                                  | Time   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| **An AI coding agent**        | **§30 (Constitution)** → §2 → §25 (workflow) → §3 → §4 → §24 (forbidden) → the section for your task | 90 min |
| **A new engineer**            | §1 → §30 → §5 → §8 → §10 → §23 → Appendix J                                                          | 4 h    |
| **A lead starting a project** | §5 → §6 → §0.3 (tier) → §20 → §27 → §22                                                              | 3 h    |
| **An engineering manager**    | §1 → §5 → §20 → §21 → §22 → §28                                                                      | 2 h    |
| **Reviewing a pull request**  | CHK-D (§23) → §10 → §24                                                                              | 15 min |
| **In an incident**            | §12 → §13 → §18.7 → §17                                                                              | 20 min |
| **Anyone, in doubt**          | **§30**                                                                                              | 10 min |

## The Five Ideas It Is Built On

1. **The bottleneck moved.** Generating code is cheap; verifying it is not. Everything here is designed to make verification cheaper — small modules, explicit contracts, pure logic, small changes, tests with the code.
2. **Agents fail systematically, not randomly.** Eight named failure modes, each with a detector. Fabrication, silent simplification, spec drift, test fitting, and the rest are checkable by name.
3. **Verification scales with consequence, not with size.** A twenty-line change to a safety mechanism gets more scrutiny than five hundred lines of scaffolding.
4. **Structural beats procedural.** "Be careful" fails at 2 a.m. A control that holds without anyone remembering it does not.
5. **Some code is human-led.** Security boundaries, irreversible operations, safety mechanisms, and deliberate asymmetries are written by people. Agents test them exhaustively — which is where they are genuinely best.

## Stats

|                             |                                       |
| --------------------------- | ------------------------------------- |
| Sections                    | 30, across 17 parts                   |
| Conformance tiers           | 4 (T1 throwaway → T4 critical)        |
| Supervision levels          | 5 (S1 autonomous → S5 human-led)      |
| Named rules                 | ~800 across 33 identifier families    |
| **Constitutional articles** | **27, no waiver**                     |
| Forbidden practices         | 43                                    |
| Named anti-patterns         | **183**                               |
| Checklists                  | 60                                    |
| Prompt templates            | 14                                    |
| Quality gates               | 7                                     |
| KPIs                        | 25 (plus 7 deliberately not measured) |
| Standing risks              | 15                                    |
| Words                       | ~102,000                              |

---

# Software Architecture & Technical Design Document (SAD/TDD) v1.0

## What This Is

The complete architecture specification for **TP Reviews Engine** — a reusable, zero-recurring-cost platform that keeps client websites synchronised with their published customer reviews, without paid widgets and without the website ever contacting a review source.

The document covers all 60 mandated sections across 12 files. It is written to be implementation-ready: an engineer or an AI coding agent should be able to build the system from §17–§21 and §39–§41 without further clarification.

---

## Read It In One File

[TP-Reviews-Engine-SAD-v1.0.md](TP-Reviews-Engine-SAD-v1.0.md) — the assembled document (regenerate with `scripts/build-doc.sh`).

## Or Read It In Parts

| File                                                                   | Sections | Contents                                                                                                                                             |
| ---------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [sad/00-front-matter.md](sad/00-front-matter.md)                       | §0       | Document control, glossary, notation, **the ten system invariants**, ADR index, assumptions register                                                 |
| [sad/01-foundations.md](sad/01-foundations.md)                         | §1–8     | Executive summary, vision, problem statement, business/technical/non-technical goals, scope, out of scope                                            |
| [sad/02-requirements.md](sad/02-requirements.md)                       | §9–15    | Use cases, 93 functional requirements, 46 non-functional requirements, system requirements, constraints, risk register, **legal & ethical analysis** |
| [sad/03-architecture.md](sad/03-architecture.md)                       | §16–19   | High-level architecture, every component specified, complete folder structure, technology justification with decision matrices                       |
| [sad/04-engine-and-schema.md](sad/04-engine-and-schema.md)             | §20–21   | The collection engine module by module, **the public JSON contract**                                                                                 |
| [sad/05-operations.md](sad/05-operations.md)                           | §22–28   | CI workflows, error taxonomy, logging, monitoring, retry, recovery, rate limiting                                                                    |
| [sad/06-resilience-and-security.md](sad/06-resilience-and-security.md) | §29–36   | CAPTCHA and anti-bot posture, performance, memory, storage, caching, security architecture, threat model                                             |
| [sad/07-scale-and-config.md](sad/07-scale-and-config.md)               | §37–40   | **Scalability at 100 / 500 / 5,000 clients**, multi-tenancy, configuration system, environment variables                                             |
| [sad/08-quality-and-delivery.md](sad/08-quality-and-delivery.md)       | §41–46   | Testing strategy, deployment, versioning, branching, coding standards, naming conventions                                                            |
| [sad/09-roadmap-and-maintenance.md](sad/09-roadmap-and-maintenance.md) | §47–53   | Roadmap, future integrations, **known limitations**, maintenance guide, upstream-change playbook, disaster recovery, onboarding                      |
| [sad/10-future-platform.md](sad/10-future-platform.md)                 | §54–60   | Future API, dashboard, admin panel, client portal, analytics, AI features, conclusion                                                                |
| [sad/11-appendices.md](sad/11-appendices.md)                           | A–G      | **Build order**, error taxonomy reference, complete config reference, traceability matrix, diagram index, runbook index, quick-reference card        |

---

## Where To Start, By Role

| You are…                         | Read, in this order                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| **Implementing this**            | §0.8 (invariants) → §16 → **Appendix A (build order)** → §17, §18, §20, §21 → §39, §40 → §41 |
| **Reviewing the architecture**   | §1 → §13 → §16 → §17 → §19 → §37 → ADR index (§0.6)                                          |
| **Operating it**                 | §22 → §24–§28 → §42 → §50 → §52 → Appendix G                                                 |
| **Responsible for security**     | §15 → §35 → §36 → §40.5                                                                      |
| **Deciding whether to fund it**  | §1 → §4 → §15 (especially §15.3) → §37 → §49                                                 |
| **Integrating a client website** | §21 → §34.6 → §11 → §49.5                                                                    |
| **New to the team**              | §53 (onboarding) — it is designed as a four-hour path to a green local test run              |

---

## The Five Decisions That Define the System

1. **The website never contacts a review source.** All acquisition is offline and scheduled. (§16, ADR-001)
2. **Acquisition is a pluggable adapter, not the product.** Four adapters ship in v1.0, so losing one is a config change. (§17.17, ADR-002/ADR-023)
3. **The private Ledger and the public Payload are different things.** Every payload is regenerable from durable state without touching the network. (§20.11, ADR-006)
4. **Publication is gated on invariants, not on job success.** No failure mode in the system reaches a visitor. (§27.3, ADR-011)
5. **A bot-detection challenge is a stop signal, not a puzzle.** The engine never attempts to defeat anti-automation measures. (§29, ADR-010)

---

## Read This Before Implementing

**§15 (Legal & Ethical Considerations)** is not optional reading. The default v1.0 acquisition method reads publicly rendered Google Maps pages, which is contrary to Google's Terms of Service. The document states that plainly, quantifies the risk, and specifies two fully-built sanctioned alternatives that any client can be migrated to in under an hour.

**§15.3.1 contains the product recommendation:** for any client willing to grant OAuth access to their own Google Business Profile, the Business Profile API adapter is strictly superior on every axis — free, sanctioned, complete, and stable. The DOM adapter exists for clients who will not complete that grant.

---

## Document Conventions

- **MUST / MUST NOT / SHOULD / MAY** are RFC 2119 keywords and are testable assertions. See §0.4.1.
- **INV-nn** are system invariants — the ten properties that must always hold (§0.8).
- **ADR-nnn** are architecture decision records, presented inline with the alternatives that were rejected and why (index at §0.6).
- **FR- / NFR- / RISK- / THREAT- / ERR- / MET-** prefixes are cross-referenced identifiers (§0.4.2).
- Diagrams are Mermaid so they live in version control and diff in pull requests (42 of them; index at Appendix E).

---

## Stats

|                                            |                                        |
| ------------------------------------------ | -------------------------------------- |
| Sections                                   | 60, plus front matter and 7 appendices |
| Functional requirements                    | 93                                     |
| Non-functional requirements                | 46                                     |
| Architecture Decision Records              | 24                                     |
| Use cases                                  | 20                                     |
| Risks (with mitigations and contingencies) | 18                                     |
| Threats (with controls)                    | 17                                     |
| Error classes                              | 50                                     |
| Chaos/failure scenarios                    | 14                                     |
| Property-based invariants                  | 15                                     |
| Mermaid diagrams                           | 42                                     |

---

# Technical Requirements Document (TRD) v1.0

## What This Is

The SAD decided _what the system is_ and _why_. The TRD converts that approved architecture into **detailed technical implementation requirements** — the level at which an engineer or an AI coding agent writes files, functions, tests, workflows, and schemas without asking a clarifying question.

**It does not redesign anything.** Where the two documents conflict on architecture, the SAD wins and the TRD is defective. Where they conflict on implementation detail, the TRD wins, because the SAD deliberately stops above that level.

| The SAD Answers           | The TRD Answers                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| Why a hexagonal pipeline? | Which file holds which stage, its exact input and output records, and the errors it may return        |
| Why selector packs?       | The pack's JSON structure, its load-time validation, and its failure modes                            |
| Why a Publish Gate?       | The evaluation order of G-01…G-12, the arithmetic of each threshold, and the 100%-coverage obligation |
| Why Playwright?           | Launch flags, context options, route interception, six timeout budgets, teardown ordering             |
| Why absence ≠ deletion?   | The streak state machine, the fields it may and may not mutate, and the property test that proves it  |

## Read It In One File

[TP-Reviews-Engine-TRD-v1.0.md](TP-Reviews-Engine-TRD-v1.0.md) — the assembled document (regenerate with `scripts/build-trd.sh`).

## Or Read It In Parts

| File                                                                       | Sections | Contents                                                                                                                                         |
| -------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [trd/00-front-matter.md](trd/00-front-matter.md)                           | §0       | Document control, relationship to the SAD, notation, identifier scheme, **EDR index**, how AI coding agents must use it                          |
| [trd/01-overview-and-components.md](trd/01-overview-and-components.md)     | §1–5     | Technical overview, the eleven stages, all 30 components, the module graph, port contracts, record-type data flow                                |
| [trd/02-codebase-layout.md](trd/02-codebase-layout.md)                     | §6–10    | **Complete folder structure, file-by-file responsibilities**, configuration files, environment variables, dependencies                           |
| [trd/03-runtime-and-environments.md](trd/03-runtime-and-environments.md)   | §11–14   | Runtime and resource requirements, why there is no build step, development and production environments                                           |
| [trd/04-acquisition-and-browser.md](trd/04-acquisition-and-browser.md)     | §15–21   | Playwright, browser configuration and lifecycle, navigation and pagination, DOM extraction, review and challenge detection                       |
| [trd/05-processing-and-data.md](trd/05-processing-and-data.md)             | §22–30   | **Duplicate detection and the asymmetry rule**, normalisation, JSON generation and validation, publish, rollback, recovery, retry, timeouts      |
| [trd/06-scheduling-and-git.md](trd/06-scheduling-and-git.md)               | §31–36   | Scheduler, CI requirements, Git operations, branch, commit, and release strategy                                                                 |
| [trd/07-observability.md](trd/07-observability.md)                         | §37–42   | Logging and redaction, the **complete error taxonomy**, the error recovery matrix, exception handling, monitoring, metrics                       |
| [trd/08-performance-and-resources.md](trd/08-performance-and-resources.md) | §43–46   | Performance budgets, memory limits, CPU, storage and history growth                                                                              |
| [trd/09-security-and-validation.md](trd/09-security-and-validation.md)     | §47–54   | Security requirements, secrets, the four validation layers, **the JSON Schema specification**, hash generation, change detection                 |
| [trd/10-concurrency-and-state.md](trd/10-concurrency-and-state.md)         | §55–60   | Caching, why there are no locks, concurrency and rate limiting, race conditions, failure and disaster recovery                                   |
| [trd/11-testing.md](trd/11-testing.md)                                     | §61      | Unit, property, regression, contract, architecture, integration, E2E, chaos, performance, security, and live testing                             |
| [trd/12-delivery.md](trd/12-delivery.md)                                   | §62–66   | CI/CD pipeline, all eight workflows, deployment, **release and rollback checklists**                                                             |
| [trd/13-standards.md](trd/13-standards.md)                                 | §67–69   | Code standards, prohibited patterns, naming and vocabulary discipline, file naming                                                               |
| [trd/14-extensibility.md](trd/14-extensibility.md)                         | §70–75   | Contracts, multi-tenancy, business configuration, feature flags, plugin and **adapter architecture**                                             |
| [trd/15-future-platform.md](trd/15-future-platform.md)                     | §76–91   | Future adapters, AI enrichment, dashboard, admin panel, client portal, REST/GraphQL, webhooks, database, Redis, Docker, Kubernetes, multi-region |
| [trd/16-risks-and-decisions.md](trd/16-risks-and-decisions.md)             | §92–96   | **Implementation risks**, the 40-entry engineering decision register, technical trade-offs, known limitations, future improvements               |
| [trd/17-guides-and-checklist.md](trd/17-guides-and-checklist.md)           | §97–100  | Developer setup, local development, production deployment, **the 100-item final checklist**                                                      |

## Where To Start, By Role

| You are…                           | Read, in this order                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| **An AI coding agent**             | §0.5 (agent rules) → §1 → §6–7 → **SAD Appendix A (build order)** → the section for each phase |
| **Implementing the engine**        | §1–5 → §6–7 → §22–30 → §49–61                                                                  |
| **Building the acquisition layer** | §15–21, then §92.2 (the five risks)                                                            |
| **Operating it**                   | §31–46, §62–66, §97–99                                                                         |
| **Responsible for security**       | §47–54, §92, then SAD §36                                                                      |
| **Writing tests**                  | §61, then §61.15 traceability                                                                  |
| **Integrating a client website**   | §52, §24, §51, §70                                                                             |
| **Inheriting this system**         | §16 (risks) → §93 (decisions) → §94 (trade-offs) → §95 (limitations)                           |

## The Five Things a New Implementer Must Not Get Wrong

1. **Absence is not deletion** (§22.5). Treating a partial harvest's absences as deletions is the only defect that can silently wipe a paying client's reviews. Guarded by PT-07 and CH-04.
2. **Normalisation removes markup; it does not escape it** (§23.3). This is the security boundary for every client website simultaneously.
3. **`core/` is pure** (§67.4). A single `Date.now()` default parameter voids fifteen property laws without failing anything.
4. **A challenge is terminal** (§21.8). No retry, ever — not even one "to see if it clears".
5. **The `data` checkout is not optional** (§32.2.2). Without it the Publish Gate cannot compare change, and its four most valuable rules silently stop working.

## Document Conventions

- **MUST / MUST NOT / SHOULD / MAY** are RFC 2119 keywords and are testable assertions.
- **`TR-<AREA>-<nnn>`** are normative technical requirements (559 of them).
- **`EDR-nnn`** are Engineering Decision Records — implementation decisions subordinate to the SAD's ADRs, each with alternatives, trade-off, and scalability (40 of them; index at §0.6).
- **`IF-`** are interface contracts; **`ALG-`** are normative step-numbered algorithms.
- All SAD identifiers (`INV-`, `ADR-`, `FR-`, `ERR-`, `MET-`, `G-`, `PT-`, `CH-`, `DR-`, `V-`) keep exactly their SAD meanings and are never redefined.
- **Agent Note** blocks flag plausible-but-wrong implementations that an AI coding agent is statistically likely to produce.

## Stats

|                                |                        |
| ------------------------------ | ---------------------- |
| Sections                       | 100, plus front matter |
| Technical requirements (`TR-`) | 559                    |
| Engineering Decision Records   | 40                     |
| Implementation risks           | 25                     |
| Technical trade-offs           | 20                     |
| Known limitations              | 36                     |
| Tables                         | 729                    |
| Mermaid diagrams               | 34                     |
| Final checklist items          | 100 (10 non-waivable)  |
| Words                          | ~103,000               |

---

# Implementation Plan (IMPL) v1.0

## What This Is

The SAD decided _what the system is_. The TRD decided _how it is built_. The plan decides **in what order it is built, by whom, on what dates, verified how, and abandoned how if it goes wrong.**

It contains no application code and redesigns nothing. It expands SAD Appendix A's twenty-six-phase build order into 342 assignable tasks, attaches them to nine milestones and eight sprints, and gates every one of them.

**Read it in one file:** [TP-Reviews-Engine-IMPL-PLAN-v1.0.md](TP-Reviews-Engine-IMPL-PLAN-v1.0.md) — regenerate with `scripts/build-plan.sh`.

## Or Read It In Parts

| File                                                                               | Sections    | Contents                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [plan/00-front-matter.md](plan/00-front-matter.md)                                 | §0          | Document control, precedence, identifier scheme, difficulty and estimation model, **the twelve execution rules**, the phase index, team model, change control                                |
| [plan/01-philosophy-and-strategy.md](plan/01-philosophy-and-strategy.md)           | §1–§5       | Implementation philosophy, twelve engineering principles, build strategy with a decision matrix, **the dependency graph**, and a why-not-earlier/why-not-later justification for every phase |
| [plan/02-milestones-sprints-releases.md](plan/02-milestones-sprints-releases.md)   | §6–§10      | Nine milestones with one-command demos, eight sprints, release strategy, feature delivery, **sixteen incremental development rules**                                                         |
| [plan/03-repository-and-environment.md](plan/03-repository-and-environment.md)     | §11–§23     | All of PH-00: repository, Git, branches, folders, dependencies, Node, types, lint, format, tests, hooks, environment variables                                                               |
| [plan/04-foundation-systems.md](plan/04-foundation-systems.md)                     | §24–§28     | Configuration, logging, error handling, retry, scheduler                                                                                                                                     |
| [plan/05-acquisition.md](plan/05-acquisition.md)                                   | §29–§33     | Playwright, browser management, navigation, review detection, parser                                                                                                                         |
| [plan/06-processing-and-data.md](plan/06-processing-and-data.md)                   | §34–§38     | Validation, duplicates, hashing, **the Normalizer**, **the Ledger**                                                                                                                          |
| [plan/07-publication-and-recovery.md](plan/07-publication-and-recovery.md)         | §39–§43     | JSON builder, **the Publish Gate**, publication, rollback, recovery                                                                                                                          |
| [plan/08-observability-and-delivery.md](plan/08-observability-and-delivery.md)     | §44–§50     | Health, monitoring, metrics, GitHub, Actions, deployment, website integration                                                                                                                |
| [plan/09-extensibility-preparation.md](plan/09-extensibility-preparation.md)       | §51–§53     | The seams v1.0 builds — and the future work it deliberately does not                                                                                                                         |
| [plan/10-testing-implementation.md](plan/10-testing-implementation.md)             | §54–§62     | Unit, integration, E2E, performance, load, failure simulation, regression, **chaos**                                                                                                         |
| [plan/11-checklists-and-v2.md](plan/11-checklists-and-v2.md)                       | §63–§70     | Deployment readiness, release candidate, production, post-deployment, rollback, maintenance, upgrade, **the V2 register**                                                                    |
| [plan/12-tasks-foundation-and-kernel.md](plan/12-tasks-foundation-and-kernel.md)   | T-001…T-126 | PH-00 … PH-06                                                                                                                                                                                |
| [plan/13-tasks-spine-and-acquisition.md](plan/13-tasks-spine-and-acquisition.md)   | T-127…T-257 | PH-07 … PH-17                                                                                                                                                                                |
| [plan/14-tasks-publication-and-launch.md](plan/14-tasks-publication-and-launch.md) | T-258…T-342 | PH-18 … PH-25 + hardening                                                                                                                                                                    |
| [plan/15-engineering-management.md](plan/15-engineering-management.md)             | —           | Sprint planning, sixteen weekly milestones, **28-risk register**, dependency matrix, **critical path**, twelve decision gates, progress tracking                                             |
| [plan/16-ai-agent-playbook.md](plan/16-ai-agent-playbook.md)                       | —           | **How AI coding agents implement this project**: prompt budget, module isolation, coding order, commit and review frequency, refactoring rules, regression prevention, context management    |
| [plan/17-quality-gates.md](plan/17-quality-gates.md)                               | —           | Build, review, testing, performance, documentation, and release criteria; the per-phase gate matrix                                                                                          |
| [plan/18-appendices.md](plan/18-appendices.md)                                     | A–L         | Master schedule, task index, the 32 D4/D5 tasks, invariant traceability, property-law and chaos indexes, risk index, **quick-reference card**                                                |

## Where To Start, By Role

| You are…                     | Read, in this order                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **An AI coding agent**       | §0.5 (execution rules) → **Part 16 (agent playbook)** → §5 (order justification) → your task's phase section → your task row |
| **Implementing this**        | §1–§5 → §11–§23 once → the phase you are on → Part 17                                                                        |
| **Running the project**      | §6–§10 → Part 15 → the decision gate index (Appendix H)                                                                      |
| **Responsible for quality**  | §54–§62 → Part 17 → Appendices D, E, F                                                                                       |
| **Shipping it**              | §63–§67 → Appendix A                                                                                                         |
| **Inheriting it mid-flight** | §0.9 (change control) → Part 15 progress tracking → the current milestone's exit criteria                                    |

## The Five Decisions That Define the Plan

1. **Build the things whose failure is invisible before the things whose failure is obvious.** The first line of browser code is written in week 10 of 16.
2. **The Normalizer precedes every producer of data, and the Publish Gate precedes the publisher by seven phases.** These are the plan's only two orderings of conscience.
3. **The CSV adapter is built before any browser work**, because an interface validated against one implementation is a rename, not an interface.
4. **Property laws are written as failing tests before the D4/D5 modules they govern.** Twelve of fifteen are green by week 5.
5. **AI agents compress the mechanical two-thirds of this project and compress the hazardous third not at all.** Six named modules are human-led by rule.

## Stats

|                  |                                    |
| ---------------- | ---------------------------------- |
| Sections         | 70, across 18 parts                |
| Phases           | 26 (SAD Appendix A, expanded)      |
| Tasks            | 342, each with 11 specified fields |
| Milestones       | 9, each with a one-command demo    |
| Sprints          | 8, over 16 weeks                   |
| Decision gates   | 12 (5 hard stops)                  |
| Quality gates    | 14 named, 6 criteria classes       |
| Plan risks       | 28, scored and owned               |
| Deliverables     | 211 (`DEL-`)                       |
| Planned effort   | ≈ 970 ideal engineer-hours         |
| Critical path    | 654 IEH across 18 phases           |
| Mermaid diagrams | 14                                 |
| Words            | ~99,000                            |
