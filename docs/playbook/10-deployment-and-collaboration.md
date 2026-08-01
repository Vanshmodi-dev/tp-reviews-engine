# Part 10 — Deployment and AI Agent Collaboration

*Sections 18 and 19. Getting work into production safely, and coordinating the multiple agents and humans producing that work without them colliding.*

---

# 18. Deployment Standards

## 18.1 Purpose

To make deploying software a routine, reversible, automated, boring event — so that shipping is not a decision requiring courage, and so that the correct response to a bad release is a two-minute action rather than a two-hour debate.

## 18.2 Objectives

1. Establish automated, repeatable deployment as the only permitted mechanism.
2. Define environment promotion so that what ships is what was tested.
3. Define progressive delivery strategies and when each applies.
4. Make rollback fast, tested, and unremarkable.
5. Define what must be verified after every deployment.
6. Keep the pipeline fast enough that nobody works around it.

## 18.3 Engineering Rationale

### 18.3.1 Deployment Frequency and Risk Are Inversely Related

The intuition is that deploying less often is safer. The opposite holds, for mechanical reasons:

| Infrequent, Large Releases | Frequent, Small Releases |
|---|---|
| Many changes at once — attribution is hard | One change — attribution is trivial |
| Large blast radius | Small blast radius |
| Rollback undoes weeks of work | Rollback undoes one change |
| Deployment is an event requiring preparation | Deployment is unremarkable |
| The process is rehearsed rarely, so it degrades | The process is exercised constantly, so it works |
| Pressure to ship despite doubts (too much invested) | No sunk cost; delaying is cheap |

**The compounding effect:** infrequent deployment makes each deployment riskier, which makes teams deploy less often, which makes each one riskier still. Breaking the loop requires deploying more often while it feels less safe — which is why automation and rollback must come first.

### 18.3.2 Manual Deployment Is a Defect

Any deployment step performed by a human by hand is a step that will eventually be performed differently, forgotten, or performed in the wrong environment.

| Manual Step | Failure It Enables |
|---|---|
| Copying files | Wrong version; partial copy |
| Running a migration by hand | Run twice; run against production by mistake; skipped |
| Editing configuration on a server | Configuration drift; lost on the next deploy |
| Restarting a service | Forgotten; done in the wrong order |
| Checking that it worked | Not checked when someone is busy |

**Every one of these is automatable, and each automation pays for itself the first time it prevents a mistake.**

### 18.3.3 What Was Tested Must Be What Ships

The artifact deployed to production must be **bit-identical** to the artifact tested. Building separately per environment reintroduces every difference the testing was supposed to eliminate.

| Build Once, Promote | Build Per Environment |
|---|---|
| Production runs what was tested | Production runs something similar |
| Configuration is the only variable | Dependencies, build tools, and timing all vary |
| Promotion is fast | Every promotion is a fresh build with fresh risk |
| Reproducible | "It worked in staging" is unexplainable |

### 18.3.4 Rollback Must Be Faster Than Diagnosis

During an incident there are two options: understand the problem then fix it, or undo the change and understand it afterwards. **The second is almost always correct**, because:

- diagnosis under time pressure produces poor diagnosis;
- users are affected during the entire diagnosis;
- and the change is the most likely cause, so undoing it is the highest-probability fix.

For this to work, rollback must be **faster than thinking**: one command or one click, under two minutes, tested, and requiring no judgement.

**The rule that follows:** if rollback is slow or risky, that is the first thing to fix — before any other reliability work, because it is what makes every other risk survivable.

### 18.3.5 Database Changes Break the Model

Code rolls back cleanly. Data does not. This asymmetry is the single hardest part of deployment and the source of most deployment incidents.

The discipline that resolves it: **every schema change is backward-compatible with the previous code version.** This means:

| Change | Safe Pattern |
|---|---|
| Add a column | Nullable or with a default; deploy; then use it |
| Remove a column | Stop using it; deploy; then remove it in a later release |
| Rename | Add new; write both; migrate; read new; stop writing old; remove old |
| Change a type | Add a new column; migrate; switch; remove |
| Add a constraint | Backfill first; verify; then add |

Each is more steps than the naive version. Each is also revertible at every step, which is the point.

## 18.4 Standards

### 18.4.1 Pipeline Requirements

| ID | Rule |
|---|---|
| **DEP-01** | Deployment MUST be fully automated. Manual steps are prohibited (T2+) |
| **DEP-02** | The pipeline MUST be defined as code, version-controlled, and reviewed |
| **DEP-03** | The artifact MUST be built **once** and promoted unchanged through environments |
| **DEP-04** | Every deployment MUST be traceable to a commit |
| **DEP-05** | The pipeline MUST fail closed — any failed check stops the deployment |
| **DEP-06** | Pipeline duration MUST be under 10 minutes for the verification path |
| **DEP-07** | Deployment MUST be idempotent — running it twice produces the same state |
| **DEP-08** | Credentials MUST be scoped to the minimum needed per stage |

**Rationale for DEP-06.** A slow pipeline gets bypassed. Engineers batch changes to avoid waiting, which produces exactly the large releases §18.3.1 warns against. Pipeline speed is therefore a safety property, not a convenience.

### 18.4.2 The Verification Pipeline

Runs on every change, before merge.

| Stage | Blocking | Typical |
|---|---|---|
| Install from lockfile | ✅ | < 60 s |
| Lint and format check | ✅ | < 30 s |
| Type check | ✅ | < 60 s |
| Unit and property tests | ✅ | < 2 min |
| Integration tests | ✅ | < 3 min |
| Architecture and boundary rules | ✅ | < 30 s |
| Security tests | ✅ | < 30 s |
| Coverage thresholds | ✅ | included |
| Secret scan | ✅ | < 30 s |
| Dependency audit | ✅ high severity | < 60 s |
| Build artifact | ✅ | varies |
| Size budgets | ✅ | < 30 s |

| ID | Rule |
|---|---|
| **DEP-09** | Every stage MUST be blocking. A non-blocking gate is a report, and reports are not read |
| **DEP-10** | The pipeline MUST require no network access beyond dependency installation |
| **DEP-11** | Flaky pipeline stages MUST be fixed within 48 hours or removed |

### 18.4.3 Environments

| Environment | Purpose | Data | Access |
|---|---|---|---|
| **Local** | Development | Synthetic | Developer |
| **Preview** (optional) | Per-change review | Synthetic | Team |
| **Staging** | Pre-production verification | Synthetic or anonymised | Team |
| **Production** | Real users | Real | Restricted, audited |

| ID | Rule |
|---|---|
| **DEP-12** | Environments MUST differ only in configuration and scale, never in code |
| **DEP-13** | Production personal data MUST NOT exist in any lower environment (SEC-63) |
| **DEP-14** | Staging MUST resemble production in topology, even at smaller scale |
| **DEP-15** | Promotion MUST be automated and MUST NOT rebuild |
| **DEP-16** | Production access MUST be restricted, audited, and time-bound |
| **DEP-17** | Configuration MUST be validated at startup in every environment (SEC-11) |

### 18.4.4 Deployment Strategies

| Strategy | How | Use When | Cost |
|---|---|---|---|
| **Recreate** | Stop, replace, start | T1/T2, downtime acceptable | Downtime |
| **Rolling** | Replace instances gradually | Default for stateless services | Two versions run concurrently |
| **Blue-green** | Two environments; switch traffic | Fast rollback required; state is simple | Double infrastructure briefly |
| **Canary** | Route a small share to the new version | High risk, high volume, T4 | Complexity; needs good metrics |
| **Feature flag** | Deploy dark; enable separately | Decoupling deploy from release | Flag debt (GIT-28) |

| ID | Rule |
|---|---|
| **DEP-18** | The strategy MUST be chosen deliberately and recorded, not inherited by accident |
| **DEP-19** | Rolling and canary deployments MUST tolerate two versions running simultaneously — **including the database schema** |
| **DEP-20** | Canary deployment MUST have automated metric comparison and automated rollback on regression |
| **DEP-21** | Blue-green switching MUST be reversible within one minute |
| **DEP-22** | Feature flags MUST have an owner and a removal date |

**Rationale for DEP-19.** During any gradual deployment, both versions serve traffic against the same data. If the new version's schema expectations are incompatible with the old version's, half of production is broken for the duration. This is the most common gradual-deployment incident and it is entirely preventable by §18.3.5's discipline.

### 18.4.5 Database Migrations

| ID | Rule |
|---|---|
| **DEP-23** | Migrations MUST be backward-compatible with the currently deployed code |
| **DEP-24** | Migrations MUST run as a separate, explicit step — never implicitly at application startup |
| **DEP-25** | Migrations MUST be forward-only. Rollback is achieved by a new migration, not by reversing one |
| **DEP-26** | Destructive migrations MUST be split across releases: stop using, deploy, then remove |
| **DEP-27** | Long-running migrations MUST NOT hold locks that block production traffic |
| **DEP-28** | Every migration MUST be tested against a production-sized dataset before release |
| **DEP-29** | Backfills MUST be batched, resumable, and rate-limited |

**Rationale for DEP-24.** Migration at startup means several instances may race to migrate simultaneously, a failed migration prevents the service from starting at all, and rollback of the code does not roll back the schema. Separating it makes each outcome independently observable and recoverable.

**Rationale for DEP-25.** Down-migrations are written rarely, tested almost never, and executed under maximum stress. They routinely fail or lose data. A forward migration that reverses the effect is written with the same care as any other change.

### 18.4.6 Rollback

| ID | Rule |
|---|---|
| **DEP-30** | Rollback MUST be automated and MUST complete in under two minutes |
| **DEP-31** | Rollback MUST be tested — executed at least once per release cycle, in production or a production-equivalent |
| **DEP-32** | The rollback path MUST be identified **before** release (GIT-39) |
| **DEP-33** | Rollback MUST NOT require a rebuild |
| **DEP-34** | Rolling back MUST be the default response to a production regression |
| **DEP-35** | Anything not rollbackable MUST be identified during planning and treated as a T4-level risk |

**Rationale for DEP-35.** Irreversible actions — data deletion, external notifications, payment capture, published artifacts consumed by third parties — deserve explicit design attention precisely because the standard safety net does not apply. Knowing which actions those are, before shipping, is what allows compensating controls.

### 18.4.7 Release Process

| # | Step | Automated |
|---|---|---|
| 1 | All checks green on the commit | ✅ |
| 2 | Changelog entry present | ✅ verified |
| 3 | Version tagged | ✅ |
| 4 | **Full verification re-run at the tag** | ✅ |
| 5 | Artifact built once | ✅ |
| 6 | Promoted to staging | ✅ |
| 7 | Staging verification | ✅ + human check |
| 8 | Promoted to production | ✅ (approval gated at T4) |
| 9 | Post-deployment verification | ✅ |
| 10 | Monitoring watched for a defined window | Human |

| ID | Rule |
|---|---|
| **DEP-36** | The full suite MUST be re-run at the tag, not trusted from the last main run (GIT-34) |
| **DEP-37** | Post-deployment verification MUST be automated and MUST run on every deployment |
| **DEP-38** | Deployments MUST NOT occur when the team cannot respond — not late on a Friday, not before an absence |
| **DEP-39** | T4 production promotion MUST require explicit human approval |

### 18.4.8 Post-Deployment Verification

| ID | Rule |
|---|---|
| **DEP-40** | Every deployment MUST be followed by automated verification that the service is serving correctly |
| **DEP-41** | Verification MUST check a real user path, not only a health endpoint |
| **DEP-42** | Error rate and latency MUST be compared against the pre-deployment baseline |
| **DEP-43** | A verification failure MUST trigger automatic rollback (T3+) |
| **DEP-44** | The watch window MUST be defined per project and MUST be observed before the deployer disengages |

**Rationale for DEP-41.** A health endpoint returning 200 tells you the process is running. It does not tell you that authentication works, that the database is reachable, or that the main feature functions. A synthetic transaction through a real path does.

## 18.5 Real-World Examples

### Example 1 — The Friday Deploy

A release ships at 17:40 on a Friday. A defect surfaces at 19:00. The engineer who deployed is unavailable, the rollback is undocumented, and the on-call responder has no context. Resolution takes until Saturday afternoon.

| | |
|---|---|
| Rules | DEP-32, DEP-38 |
| Cost | An outage that could have been two minutes lasted eighteen hours |
| The general lesson | Deployment timing is a reliability control, not a scheduling preference |

### Example 2 — The Incompatible Migration

A rolling deployment renames a column. Old instances query the old name and fail. Half of production returns errors for the eleven minutes of the rollout, and rolling back does not help because the schema has already changed.

| | |
|---|---|
| Rules | DEP-19, DEP-23, DEP-26 |
| Correct approach | Add the new column, write both, migrate, read new, stop writing old, drop old — four releases, each individually safe |

### Example 3 — Rollback That Was Never Tested

A rollback procedure exists in documentation. During an incident it fails because the previous artifact was garbage-collected by a retention policy nobody knew about.

| | |
|---|---|
| Rules | DEP-31, DEP-33 |
| The general lesson | An untested recovery path is a hypothesis, and it is tested for the first time at the worst possible moment |

### Example 4 — Deployment That Became Boring

A team moves from weekly manual releases to automated per-change deployment with automated verification and one-click rollback. Deployment frequency rises roughly tenfold. Incidents per deployment fall sharply, and mean time to recovery falls from hours to minutes.

| | |
|---|---|
| Why it worked | Small changes, fast rollback, exercised process |
| The counter-intuitive part | More deployments produced fewer problems, exactly as §18.3.1 predicts |

## 18.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Manual deployment steps | Inconsistent, forgotten, wrong environment | DEP-01 |
| 2 | Rebuilding per environment | "It worked in staging" | DEP-03 |
| 3 | Migrations at application startup | Race conditions; service will not start | DEP-24 |
| 4 | Non-backward-compatible schema changes | Broken during rollout | DEP-23 |
| 5 | Untested rollback | Fails when needed | DEP-31 |
| 6 | Deploying before an absence | Nobody available to respond | DEP-38 |
| 7 | Health check as the only verification | Broken feature, healthy service | DEP-41 |
| 8 | Slow pipeline | Batching, large releases | DEP-06 |
| 9 | Down-migrations relied upon | They fail or lose data | DEP-25 |
| 10 | Feature flags left permanently | Untested combinations accumulate | DEP-22 |

## 18.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-120** | **The Deploy Ceremony** | Deployment requires a meeting, a checklist, and courage | Automate until it is boring |
| **AP-121** | **Snowflake Environments** | Production differs from staging in ways nobody documented | DEP-12; infrastructure as code |
| **AP-122** | **The Big Bang Release** | Months of change deployed at once | Continuous small deployment |
| **AP-123** | **Configuration Drift** | Servers hand-edited over time | Immutable infrastructure |
| **AP-124** | **The Irreversible Migration** | A schema change that cannot be undone, discovered afterwards | DEP-26, DEP-35 |
| **AP-125** | **Deploy and Walk Away** | No verification, no watch window | DEP-40, DEP-44 |
| **AP-126** | **The Hero Deploy** | One person who knows how to deploy | Automate; anyone can deploy |

## 18.8 Decision Tables

### 18.8.1 Which Deployment Strategy?

| Question | Strategy |
|---|---|
| T1/T2, downtime acceptable? | Recreate |
| Stateless service, gradual is fine? | Rolling |
| Need instant rollback and state is simple? | Blue-green |
| High risk, high volume, good metrics available? | Canary |
| Want to separate deploying from releasing? | Feature flag (plus one of the above) |
| Cannot tolerate two versions concurrently? | **Fix that first** — it constrains everything |

### 18.8.2 Is This Change Safe to Deploy Gradually?

| Question | If No |
|---|---|
| Can old and new code run simultaneously? | Not safe — split the change |
| Is the schema backward-compatible? | Not safe — split into compatible steps |
| Can old code read data written by new code? | Not safe |
| Can new code read data written by old code? | Not safe |
| Are external contracts unchanged, or additive? | Coordinate with consumers first |
| Is any effect irreversible? | Treat as T4; add compensating controls |

### 18.8.3 Rollback or Fix Forward?

| Situation | Action |
|---|---|
| Users affected now | **Roll back** |
| Cause unknown, recent deployment suspected | **Roll back** |
| Outside working hours | **Roll back** |
| Cause understood, fix is trivial and verified | Fix forward |
| Rollback would break something (already-migrated data) | Fix forward, carefully, two people |
| Non-urgent defect, no user impact | Normal cycle |

## 18.9 Checklists

### CHK-18.1 · Before Release

- [ ] All checks green at the commit being released
- [ ] Changelog entry present; breaking changes explicit
- [ ] Version tagged; full suite re-run at the tag
- [ ] Migrations backward-compatible and tested at production scale
- [ ] **Rollback path identified and previously tested**
- [ ] Nothing irreversible, or compensating controls in place
- [ ] Feature flags have owners and removal dates
- [ ] Consumers notified of breaking changes
- [ ] Deployment window appropriate — team available
- [ ] Post-deployment verification is in place and will run

### CHK-18.2 · After Deployment

- [ ] Automated verification passed
- [ ] A real user path exercised successfully
- [ ] Error rate compared to the pre-deployment baseline
- [ ] Latency compared to baseline
- [ ] No new alert categories firing
- [ ] Logs show expected startup and no unexpected errors
- [ ] Watch window observed before disengaging
- [ ] If anything is anomalous: **roll back first**, investigate after

## 18.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Bad release reaching users | Medium | High | Staged deployment; post-deploy verification; fast rollback | Low |
| Rollback fails when needed | Medium | **High** | DEP-31 regular testing | Low |
| Migration breaks a gradual rollout | Medium | High | DEP-19, DEP-23; compatibility discipline | Medium |
| Slow pipeline causing batching | High | Medium | DEP-06 | Medium |
| Manual step performed wrongly | Medium | High | DEP-01 | Low |
| Deployment when nobody can respond | Medium | High | DEP-38 | Low |
| Irreversible action shipped unnoticed | Low | **Critical** | DEP-35 during planning | Medium |

## 18.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Shared pipeline templates per project type | v1.1 | Consistency; less per-project setup |
| Automated rollback on verification failure | v1.1 | Removes human latency from the recovery path |
| Migration compatibility linting | v1.2 | Detect non-backward-compatible schema changes automatically |
| Deployment metrics as KPIs | v1.1 | §28: frequency, lead time, change failure rate, recovery time |

---

# 19. AI Agent Collaboration

## 19.1 Purpose

To define how multiple AI agents — and agents alongside humans — work on the same codebase without colliding, duplicating, contradicting each other, or producing work that cannot be integrated.

## 19.2 Objectives

1. Define how work is divided between agents so that conflicts are structurally unlikely.
2. Establish module ownership as the coordination mechanism.
3. Define delegation: what to assign, at what granularity, with what context.
4. Define conflict detection and resolution.
5. Define how shared understanding stays synchronised when no participant has persistent memory.
6. Define the human's role as integrator and accountable party.

## 19.3 Engineering Rationale

### 19.3.1 Agents Do Not Coordinate Themselves

Human engineers coordinate implicitly: they overhear conversations, notice each other's branches, ask "are you touching that file?", and remember yesterday's decision. **Agents do none of this.** Each session begins with no knowledge of what any other session is doing.

Consequences:

| Human Team | Agent Team |
|---|---|
| Notices a colleague working nearby | No awareness of other sessions |
| Remembers last week's decision | No memory across sessions |
| Asks before changing a shared interface | Changes it and proceeds |
| Develops shared conventions organically | Infers conventions from whatever is in context |
| Escalates ambiguity | Resolves ambiguity silently |

**Therefore coordination must be explicit and structural.** The mechanisms below exist to make collisions impossible rather than to detect them afterwards.

### 19.3.2 Partition by Module, Not by Layer

The natural instinct is to give one agent the backend and another the frontend, or one the tests and another the implementation. This produces maximum coupling: every change requires both, and neither can complete independently.

**Partition vertically by module or feature.** Each agent owns a slice that can be completed, tested, and merged independently. The interfaces between slices are agreed first, by a human, and frozen for the duration.

| Bad Partition | Good Partition |
|---|---|
| Agent A: all backend; Agent B: all frontend | Agent A: billing feature end to end; Agent B: notifications end to end |
| Agent A: code; Agent B: tests | Agent A: module X with its tests; Agent B: module Y with its tests |
| Agent A: interface; Agent B: implementation, concurrently | Interface agreed and merged **first**, then implementations in parallel |

### 19.3.3 The Interface Freeze

The highest-value coordination practice: **when two agents must work against a shared interface, that interface is defined, reviewed, and merged before either begins.**

| Without a freeze | With a freeze |
|---|---|
| Each agent invents its side of the contract | Both implement an agreed contract |
| Integration reveals a mismatch | Integration is mechanical |
| One agent's assumptions win by merge order | Neither's assumptions matter |
| Rework is proportional to work done | Rework is near zero |

The freeze costs one small change merged first. It removes the entire class of integration failure that dominates multi-agent work.

### 19.3.4 The Human Is the Integrator

In a multi-agent setup, the human's role shifts from writing code to:

| Role | Activity |
|---|---|
| **Decomposer** | Splitting work into independent, well-specified slices |
| **Interface designer** | Defining and freezing contracts before parallel work |
| **Integrator** | Merging in the right order; resolving semantic conflicts |
| **Verifier** | Confirming each slice against its specification |
| **Accountable owner** | Owning what is merged (OWN-2) |

**This is the highest-leverage work available**, and it is not delegable, because it requires holding the whole system in mind — which is precisely what no agent session does.

## 19.4 Standards

### 19.4.1 Work Partitioning

| ID | Rule |
|---|---|
| **COL-01** | Concurrent agents MUST work on disjoint file sets |
| **COL-02** | Partitioning MUST be by module or feature, never by layer |
| **COL-03** | Each slice MUST be independently completable, testable, and mergeable |
| **COL-04** | Shared files — configuration, dependency manifests, composition roots, shared type definitions — MUST be modified by one agent at a time, in small dedicated changes |
| **COL-05** | Where two slices need a shared interface, the interface MUST be merged **before** either slice begins |
| **COL-06** | Hazard modules (§2.4.3) MUST NOT be worked on concurrently by anyone |

### 19.4.2 Module Ownership

| ID | Rule |
|---|---|
| **COL-07** | Every module MUST have one accountable human owner (OWN-1) |
| **COL-08** | During a work period, each module MUST have at most one active agent |
| **COL-09** | Active assignments MUST be visible to the team — a file, a board, a channel |
| **COL-10** | An agent needing to change a module it does not hold MUST **stop and request it**, not change it |
| **COL-11** | Ownership handover MUST be explicit and MUST include the current state |

### 19.4.3 Task Delegation

| ID | Rule |
|---|---|
| **COL-12** | Each delegated task MUST have a written specification (§3.4.1) |
| **COL-13** | Task granularity MUST respect §3.4.2's size limits |
| **COL-14** | Dependencies between tasks MUST be stated; a task MUST NOT start before its dependencies merge |
| **COL-15** | Supervision level MUST be assigned per task (§2.3.5), not per agent |
| **COL-16** | Tasks MUST be assigned to one agent. Two agents on one task produces divergence, not redundancy |

**Delegation suitability:**

| Task Shape | Delegate | Keep Human |
|---|---|---|
| Well-specified implementation with tests | ✅ | — |
| Exhaustive test generation from a specification | ✅ **ideal** | — |
| Mechanical refactor with test coverage | ✅ | — |
| Documentation from a diff | ✅ | — |
| Boilerplate, scaffolding, configuration | ✅ | — |
| Interface design | — | ✅ |
| Architectural decisions | — | ✅ |
| Hazard module implementation | — | ✅ |
| Ambiguity resolution | — | ✅ |
| Integration and merge ordering | — | ✅ |
| Deciding what to build | — | ✅ |

### 19.4.4 Conflict Detection and Resolution

Three kinds of conflict, in ascending order of cost:

| Kind | Detection | Resolution |
|---|---|---|
| **Textual** | Version control | Mechanical; usually trivial |
| **Semantic** | Tests, review | Two changes that both merge cleanly and are jointly wrong |
| **Architectural** | Review, boundary checks | Two agents solving the same problem differently |

| ID | Rule |
|---|---|
| **COL-17** | Textual conflicts in a shared file mean COL-04 was violated. Fix the process, not just the file |
| **COL-18** | Semantic conflicts MUST be resolved by re-running the affected task against the merged state — **never by hand-merging two agents' output** |
| **COL-19** | Architectural conflicts MUST be resolved by a human decision recorded as an ADR, then the losing implementation MUST be redone, not adapted |
| **COL-20** | After any conflict, the **standing context** MUST be updated so the ambiguity does not recur |
| **COL-21** | Merge order MUST be decided by the human integrator, not by whoever finishes first |

**Rationale for COL-18.** Hand-merging two agents' implementations produces code neither agent's reasoning supports and no human fully understands — the worst possible artifact. Re-running one task against the merged state produces a coherent result.

**Rationale for COL-19.** Adapting a losing implementation to match the winning approach yields a hybrid with the structure of one and the assumptions of the other. Redoing it is faster and produces something coherent.

### 19.4.5 Context Synchronisation

Since no agent shares memory with another, shared understanding must live in files.

| ID | Rule |
|---|---|
| **COL-22** | Shared understanding MUST live in version-controlled files, never in a session |
| **COL-23** | The standing context file MUST be updated when a convention is established or changed |
| **COL-24** | Decisions made during agent work MUST be persisted immediately, not at the end |
| **COL-25** | The project state summary MUST be current within one week (CTX-11) |
| **COL-26** | An agent starting work MUST read the standing context and the state summary first |
| **COL-27** | An interface change MUST be announced by merging it before dependents begin |

### 19.4.6 Integration Discipline

| ID | Rule |
|---|---|
| **COL-28** | Each agent's work MUST merge to the trunk within 48 hours (GIT-02) |
| **COL-29** | The integrator MUST verify each slice against its specification before merging |
| **COL-30** | Slices MUST be merged in dependency order |
| **COL-31** | After each merge, the full suite MUST pass before the next merge begins |
| **COL-32** | A slice that cannot integrate MUST be reverted and re-specified, not patched into place |

**Rationale for COL-31.** Merging several agent outputs in rapid succession without verifying between them makes attribution impossible when something breaks. Serialising the merges costs minutes and preserves the ability to identify which slice caused a failure.

### 19.4.7 Human Oversight

| ID | Rule |
|---|---|
| **COL-33** | Every agent-produced change MUST be reviewed and merged by a named human (SUP-1) |
| **COL-34** | One human MUST be accountable for integration across a multi-agent effort |
| **COL-35** | The number of concurrent agents MUST NOT exceed what the available humans can review — typically **two to three per reviewer** |
| **COL-36** | Where agent output exceeds review capacity, the correct response is **fewer agents**, not faster review |

**Rationale for COL-35/36.** The binding constraint is verification, not generation (§1.3.1). Adding a fourth agent to a team with one reviewer does not increase throughput; it increases the queue and the temptation to approve without reading (AP-09). Throughput is set by review capacity, and the only ways to raise it are more reviewers or smaller changes.

## 19.5 Real-World Examples

### Example 1 — The Duplicate Utility

Two agents work on adjacent features. Both need date formatting. Neither sees the other's work. Two implementations are merged, with slightly different edge-case behaviour. Six months later a defect appears in one and not the other.

| | |
|---|---|
| Rules | COL-22, COL-26 |
| Root cause | No shared context; neither could see the other's work |
| Fix | Standing context lists shared utilities; the integrator checks for duplication at merge |

### Example 2 — The Contract Mismatch

Two agents implement two sides of an integration concurrently. One assumes a field is optional; the other assumes it is required. Both slices pass their own tests. Integration fails, and the fix requires changing both.

| | |
|---|---|
| Rule | COL-05 |
| Cost | A day of rework |
| The prevention | One small change defining the contract, merged first. Ten minutes |

### Example 3 — The Hand-Merged Hybrid

Two agents produce overlapping changes to the same module. The integrator merges them by hand, taking parts of each. The result passes tests and is understood by nobody. Two defects surface within a month.

| | |
|---|---|
| Rule | COL-18 |
| Correct action | Take one, discard the other, re-run the discarded task against the merged state |

### Example 4 — Effective Parallelism

Four features are specified. Interfaces between them are defined and merged first. Three agents work on disjoint modules with clear specifications. One human integrates in dependency order, verifying each slice and running the full suite between merges. All four merge within two days with no conflicts.

| | |
|---|---|
| Why it worked | COL-01, COL-05, COL-30, COL-31 |
| The human's contribution | Decomposition and interface design — the work no agent could do |

## 19.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Partitioning by layer | Everything depends on everything | COL-02 |
| 2 | Parallel work on an undefined interface | Integration mismatch | COL-05 |
| 3 | Two agents in one module | Conflicts, duplication | COL-08 |
| 4 | Hand-merging agent outputs | Incoherent code nobody understands | COL-18 |
| 5 | No shared context file | Conventions diverge | COL-22 |
| 6 | Merging several slices without verifying between | Cannot attribute failures | COL-31 |
| 7 | More agents than reviewers | Review queue; rubber stamping | COL-35 |
| 8 | Assuming agents know about each other | Duplicated and contradictory work | §19.3.1 |
| 9 | Letting merge order be decided by completion order | Dependency violations | COL-21 |
| 10 | Adapting a losing implementation | Hybrid with mixed assumptions | COL-19 |

## 19.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-127** | **The Agent Swarm** | Many agents on one codebase with no partitioning | COL-01, COL-35 |
| **AP-128** | **The Telephone Game** | Context passed agent to agent through summaries, degrading each time | COL-22; files, not chains |
| **AP-129** | **Merge Roulette** | Whoever merges first defines the contract | COL-05 |
| **AP-130** | **The Frankenmerge** | Two agents' outputs hand-stitched together | COL-18 |
| **AP-131** | **Review Debt** | Agent output accumulating faster than review | COL-36 |
| **AP-132** | **The Orphan Slice** | A slice nobody can integrate, left on a branch | COL-28, COL-32 |
| **AP-133** | **Convention Drift** | Each agent establishing its own patterns | COL-23 |

## 19.8 Decision Tables

### 19.8.1 Can These Tasks Run in Parallel?

| Question | If No |
|---|---|
| Are the file sets disjoint? | Serialise |
| Is the shared interface already merged? | Merge it first |
| Can each be tested independently? | Serialise |
| Can each be merged independently? | Serialise |
| Is either a hazard module? | Serialise, human-led |
| Is review capacity available for both? | Serialise |

### 19.8.2 Who Does This Work?

| Task | Assign To |
|---|---|
| Decompose a feature into slices | **Human** |
| Define the interface between slices | **Human** |
| Implement a specified slice | Agent |
| Write tests from a specification | Agent |
| Decide merge order | **Human** |
| Resolve a semantic conflict | **Human** decides; agent re-runs |
| Update the standing context | **Human** (agent may draft) |
| Verify a slice against its specification | **Human** |
| Refactor a hazard module | **Human** |
| Generate documentation from a diff | Agent |

### 19.8.3 How Many Concurrent Agents?

| Reviewers Available | Maximum Concurrent Agents | Note |
|---|---|---|
| 1 | 2–3 | Assuming changes stay within size limits |
| 2 | 4–6 | Requires clean partitioning |
| 3+ | Scale proportionally | Interface design becomes the new bottleneck |

**In every case, the limit is set by verification capacity.** If work is queuing for review, adding agents makes it worse.

## 19.9 Checklists

### CHK-19.1 · Before Starting Parallel Agent Work

- [ ] Work is partitioned by module or feature, not by layer
- [ ] File sets are disjoint
- [ ] Shared interfaces are defined, reviewed, and **merged**
- [ ] Each slice has a written specification
- [ ] Each slice is independently testable and mergeable
- [ ] Dependencies between slices are stated
- [ ] Merge order is decided
- [ ] Supervision level assigned per slice
- [ ] Standing context is current
- [ ] Number of agents is within review capacity
- [ ] No hazard module is in scope for parallel work

### CHK-19.2 · Integrating Agent Work

- [ ] Each slice verified against its specification before merging
- [ ] Merged in dependency order
- [ ] Full suite passes between merges
- [ ] No duplicated utilities introduced across slices
- [ ] No convention divergence between slices
- [ ] Standing context updated with anything newly established
- [ ] Any conflict resolved by re-running, not hand-merging
- [ ] One human is accountable for the integrated result

## 19.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Duplicated work across agents | **High** | Medium | COL-22, integrator check | Medium |
| Interface mismatch at integration | High | High | COL-05 freeze | Low |
| Semantic conflict passing all tests | Medium | High | COL-18, COL-29 | Medium |
| Review capacity exceeded | **High** | High | COL-35, COL-36 | Medium |
| Convention drift between slices | Medium | Medium | COL-23 | Low |
| Hand-merged incoherent code | Medium | High | COL-18 | Low |
| Context lost between sessions | High | Medium | COL-22, COL-24 | Low |

## 19.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Assignment registry as a repository file | v1.1 | Makes COL-09 mechanical |
| Automated file-overlap detection across active branches | v1.2 | Warns before COL-01 is violated |
| Shared-utility index in the standing context | v1.1 | Reduces duplication |
| Review-capacity signal | v1.2 | Makes COL-36 visible rather than a judgement |

---

*End of Part 10. Part 11 covers the project lifecycle from idea to retirement, and the decision frameworks that govern the hard calls along the way.*
