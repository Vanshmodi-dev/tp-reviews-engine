# Part 12 — Risk Management and Engineering Checklists

*Sections 22 and 23. Risk management is how a team sees trouble before it arrives. Checklists are how a team acts correctly when it does — and, more often, how it avoids the ordinary mistakes that competent people make when they are busy.*

---

# 22. Risk Management

## 22.1 Purpose

To identify what could go wrong early enough to do something about it, and to convert vague unease into named risks with owners, triggers, and responses.

## 22.2 Objectives

1. Define the risk categories that recur across TradyPerch projects.
2. Establish a scoring model that produces comparable exposures.
3. Establish structural mitigation as the preferred form.
4. Make risks trackable: owned, triggered, and reviewed.
5. Distinguish risks from issues, and both from worries.

## 22.3 Engineering Rationale

### 22.3.1 A Risk Without a Trigger Is a Worry

The difference between a risk register that works and one that is decoration is the **trigger**: the observable event meaning "this is happening now".

| Without a trigger | With a trigger |
|---|---|
| "The third-party API might become unreliable" | "Error rate from provider X exceeds 1% over an hour" |
| Reviewed by re-reading | Detected automatically |
| Response improvised | Response pre-decided |
| Noticed when it is already an incident | Noticed while it is still a risk |

| ID | Rule |
|---|---|
| **RISK-01** | Every risk MUST have an observable trigger |
| **RISK-02** | Every risk MUST have a named owner — a person, never a team |
| **RISK-03** | Every risk MUST have a stated response for when the trigger fires |

### 22.3.2 Structural Beats Procedural

The same principle as §15.3.2, applied generally: a mitigation that depends on someone remembering will fail on the day everyone is busy.

| Procedural | Structural |
|---|---|
| "Review the dependency list quarterly" | Automated audit blocking the build |
| "Be careful with production credentials" | Production access is time-bound and audited |
| "Remember to add the tenant filter" | Queries without a tenant scope do not compile |
| "Test the rollback occasionally" | Rollback is exercised on every release |
| "Do not deploy on Fridays" | The pipeline refuses outside a configured window |

| ID | Rule |
|---|---|
| **RISK-04** | Structural mitigations MUST be preferred. A procedural mitigation MUST state why a structural one is not available |

### 22.3.3 Risk, Issue, Worry

| Term | Definition | Handling |
|---|---|---|
| **Worry** | An unease with no specific mechanism | Articulate it into a risk, or discard it |
| **Risk** | A specific thing that might happen, with a mechanism | Register, score, own, trigger |
| **Issue** | A risk that has occurred | Incident or defect process |

Registers become useless when they fill with worries. If a risk cannot be stated as "X may happen, because Y, and we would see it when Z", it is not yet a risk.

### 22.3.4 The Most Dangerous Risks Are the Ones Nobody Owns

Risks spanning boundaries — between teams, between a system and its dependencies, between engineering and the business — are systematically under-managed because no individual feels responsible.

**Assign every risk to a person, including the awkward ones.** The owner's job is not to prevent it single-handedly; it is to watch the trigger and initiate the response.

## 22.4 Standards

### 22.4.1 Risk Categories

| Category | Examples |
|---|---|
| **Technical** | Chosen approach does not scale; an integration is unreliable; a dependency is abandoned; complexity exceeds the team's capacity |
| **Security** | Credential exposure; injection; access-control gaps; supply-chain compromise; data exposure |
| **Operational** | No rollback; missing observability; single point of failure; unowned system; capacity limits |
| **Delivery** | Underestimation; unavailable dependency; key person absent; scope growth; unresolved decisions blocking work |
| **People** | Bus factor of one; knowledge silo; reviewer capacity below output rate; skill gap |
| **Business** | Requirement changes; the assumption behind the project is wrong; regulatory change; cost exceeds value |
| **AI-specific** | Silent simplification of a safety property; fabricated dependency; review capacity exceeded; specification too vague for reliable generation |

### 22.4.2 Scoring

Likelihood and impact on 1–5; exposure is their product.

| Score | Likelihood | Impact |
|---|---|---|
| 1 | Very unlikely | Negligible |
| 2 | Unlikely | Minor, recoverable in hours |
| 3 | Possible | Moderate, recoverable in days |
| 4 | Likely | Major, significant cost or customer impact |
| 5 | Near certain | **Severe, irreversible, or existential** |

| Exposure | Action |
|---|---|
| 1–6 | Accept; note it |
| 8–12 | Mitigate; review at each milestone |
| **15–20** | **Mitigate structurally; review weekly; escalate** |
| **25** | **Do not proceed until reduced** |

| ID | Rule |
|---|---|
| **RISK-05** | Impact 5 MUST be reserved for irreversible or existential outcomes — data loss, security breach, regulatory violation, business failure |
| **RISK-06** | Risks at exposure 15+ MUST be reviewed weekly and MUST have a structural mitigation or a documented reason why not |
| **RISK-07** | Risks MUST be re-scored at each milestone, not merely re-read |

**Rationale for RISK-05.** Impact inflation destroys a register's usefulness. If everything is a 5, prioritisation is impossible. Reserving 5 for genuinely irreversible outcomes keeps the top of the register meaningful.

### 22.4.3 The Register

| Column | Contents |
|---|---|
| ID | Stable |
| Risk | "X may happen because Y" |
| Category | Per §22.4.1 |
| L / I / Exposure | Scores |
| **Trigger** | The observable event |
| Mitigation | What reduces likelihood or impact — structural where possible |
| Contingency | What we do when the trigger fires |
| Owner | A person |
| Status | Open / mitigated / occurred / closed |
| Last reviewed | Date |

| ID | Rule |
|---|---|
| **RISK-08** | The register MUST live in version control with the project |
| **RISK-09** | A risk MUST NOT be closed because it was not mentioned recently. Closure requires a reason |
| **RISK-10** | A risk that occurs MUST be moved to issue handling **and** its register entry updated with what actually happened |

### 22.4.4 The Standing Risks

These recur in nearly every project. Each new project starts by asking whether they apply, rather than rediscovering them.

| ID | Standing Risk | Typical Structural Mitigation |
|---|---|---|
| **SR-01** | A secret reaches the repository | Scanning, push protection, `.gitignore` before first commit |
| **SR-02** | A silent failure hides data loss | Prohibition on empty-on-failure returns; failure-path tests |
| **SR-03** | Rollback does not work when needed | Exercise it every release |
| **SR-04** | An unbounded query fails at customer scale | Enforced limits; query-count tests |
| **SR-05** | A missing timeout cascades into an outage | Every outbound call has a timeout; enforced in review |
| **SR-06** | Object-level authorisation is missing somewhere | Structural authorisation context |
| **SR-07** | Review capacity is exceeded by generation rate | Change size limits; agent count limits |
| **SR-08** | A safety property is silently simplified | Hazard modules; two reviewers; property tests; explanatory comments |
| **SR-09** | The system has one person who understands it | Two reviewers on hazard modules; documentation as an exit criterion |
| **SR-10** | A scheduled job silently stops running | Absence detection, not only failure detection |
| **SR-11** | A dependency becomes unmaintained or compromised | Pinning; audit; minimal dependency count; wrapping |
| **SR-12** | Documentation drifts and misleads | Docs ship with changes; quarterly verification |
| **SR-13** | Test suite becomes slow, then ignored | Duration budgets; pyramid discipline |
| **SR-14** | A system runs with no owner | Inventory with owners; annual review |
| **SR-15** | Production data reaches a lower environment | Anonymised generation as the default path |

| ID | Rule |
|---|---|
| **RISK-11** | Every T3+ project MUST assess all fifteen standing risks at planning and record which apply |

### 22.4.5 Response Strategies

| Strategy | Meaning | Use When |
|---|---|---|
| **Avoid** | Change the plan so the risk cannot occur | The risk is severe and the alternative is acceptable |
| **Reduce** | Lower likelihood or impact | Most risks |
| **Transfer** | Move it to a party better placed to carry it | A managed service, insurance, a provider's SLA |
| **Accept** | Decide to carry it, explicitly | Low exposure, or mitigation costs more than the risk |

| ID | Rule |
|---|---|
| **RISK-12** | Acceptance MUST be explicit, recorded, and owned. Silent acceptance is not acceptance |
| **RISK-13** | Transfer MUST be verified — a provider's guarantee is a contractual position, not a technical one |

## 22.5 Real-World Examples

### Example 1 — The Risk With No Trigger

A register lists "the payment provider may have an outage" with mitigation "monitor the provider's status page". Nobody monitors it. During an outage, the team discovers the failure from customer reports twenty minutes in.

| | |
|---|---|
| Rules | RISK-01, RISK-04 |
| Correct form | Trigger: "provider error rate above 2% for five minutes". Mitigation: automated alert plus a degraded-mode path |

### Example 2 — Impact Inflation

A register has fourteen risks, eleven scored impact 5. Prioritisation is impossible, so the register is ignored, and a genuinely severe risk goes unmitigated.

| | |
|---|---|
| Rule | RISK-05 |
| The fix | Re-score with 5 reserved for irreversible outcomes. Two remain at 5, and both get structural mitigation |

### Example 3 — The Unowned Boundary Risk

A risk exists between two teams: neither owns the integration's failure behaviour. Both assume the other handles it. It fails; neither has a runbook.

| | |
|---|---|
| Rules | RISK-02, §22.3.4 |
| The fix | Assign it to one person. Ownership of a shared risk is not shared |

### Example 4 — The Structural Mitigation That Held

A project identifies SR-01 (secret exposure) and mitigates structurally: scanning, push protection, and correct ignore rules before the first commit. Eight months later a developer accidentally stages an environment file. The push is blocked. No incident occurs.

| | |
|---|---|
| Rule | RISK-04 |
| The point | The mitigation worked on a day nobody was thinking about it — which is when mitigations are tested |

## 22.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Risks without triggers | Discovered as incidents | RISK-01 |
| 2 | Team ownership | Nobody watches | RISK-02 |
| 3 | Impact inflation | Register ignored | RISK-05 |
| 4 | Procedural mitigations only | Fails under pressure | RISK-04 |
| 5 | Register written once | Stale within a month | RISK-07 |
| 6 | Worries recorded as risks | Register full of noise | §22.3.3 |
| 7 | Silent acceptance | Nobody knows the risk was accepted | RISK-12 |
| 8 | Risks closed by silence | Real risks disappear | RISK-09 |
| 9 | Ignoring standing risks | Rediscovering the same lessons | RISK-11 |
| 10 | Transfer assumed to be complete | The provider's SLA does not restore your data | RISK-13 |

## 22.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-148** | **The Compliance Register** | Written for a review; never consulted | Triggers; weekly review of high exposure |
| **AP-149** | **Risk Theatre** | Elaborate scoring, no mitigation | RISK-06 |
| **AP-150** | **The Known Unknown Shrug** | "Anything could happen" instead of specific risks | §22.3.3 |
| **AP-151** | **Optimism by Omission** | Uncomfortable risks left off | Standing risks; independent review |
| **AP-152** | **The Orphan Risk** | Spans a boundary; nobody owns it | RISK-02 |
| **AP-153** | **Mitigation by Documentation** | "We wrote it down" treated as mitigation | RISK-04 |

## 22.8 Decision Tables

### 22.8.1 Is This a Risk?

| Question | If No |
|---|---|
| Can I state the mechanism? | It is a worry — articulate or discard |
| Is there an observable trigger? | Define one, or it cannot be managed |
| Has it already happened? | It is an issue, not a risk |
| Would we do something differently if we believed it? | It is not actionable — accept and note |

### 22.8.2 Which Response?

| Situation | Response |
|---|---|
| Severe and an acceptable alternative exists | Avoid |
| Structural mitigation available | Reduce, structurally |
| Only procedural mitigation available | Reduce, and note why structural is unavailable |
| Someone else is genuinely better placed | Transfer, and verify |
| Low exposure; mitigation costs more | Accept, explicitly, with an owner |
| Exposure 25 | **Do not proceed until reduced** |

## 22.9 Checklists

### CHK-22.1 · Risk Assessment at Planning

- [ ] All fifteen standing risks assessed for applicability
- [ ] Project-specific risks identified across all seven categories
- [ ] Each has a mechanism, not just a name
- [ ] Each has an observable trigger
- [ ] Each has a named person as owner
- [ ] Each has a mitigation, structural where possible
- [ ] Each has a contingency for when the trigger fires
- [ ] Scored, with impact 5 reserved for irreversible outcomes
- [ ] Anything at exposure 25 is resolved before proceeding
- [ ] The register is in version control

### CHK-22.2 · Risk Review (per milestone)

- [ ] Every risk re-scored, not just re-read
- [ ] Any trigger fired since the last review?
- [ ] New risks from what has been learned
- [ ] Closed risks have a recorded reason
- [ ] High-exposure risks have progressed toward structural mitigation
- [ ] Owners still correct and still available

## 22.10 Risk Analysis (of Risk Management Itself)

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Register becomes decoration | **High** | Medium | Triggers; weekly high-exposure review | Medium |
| Impact inflation destroys prioritisation | High | Medium | RISK-05 | Low |
| Uncomfortable risks omitted | Medium | High | Standing risks; independent review | Medium |
| Mitigation recorded but not implemented | Medium | High | Milestone review checks implementation, not intent | Medium |
| Effort disproportionate for small projects | Medium | Low | Tier scaling; T2 records only the top three | Low |

## 22.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Standing-risk template per project type | v1.1 | Faster and more complete assessment |
| Automated trigger wiring to alerts | v1.2 | Triggers become monitors rather than intentions |
| Cross-project risk aggregation | v1.2 | Identify systemic risks across the portfolio |

---

# 23. Engineering Checklists

## 23.1 Purpose

To provide the executable checks used at each moment in the engineering cycle — consolidated, ordered, and short enough to actually be run.

## 23.2 Engineering Rationale

### 23.2.1 Why Checklists Work

Checklists do not compensate for incompetence. They compensate for the specific failure mode of competent people: **forgetting a step that they know, under time pressure or familiarity.**

| Property | Effect |
|---|---|
| Explicit | Removes reliance on memory at the worst moment |
| Ordered | Prevents dependency mistakes |
| Short | Gets used. A 40-item checklist is not run |
| Binary | "Done or not" rather than "probably fine" |
| Shared | Everyone performs the same steps, so review is meaningful |

### 23.2.2 The Rules That Keep Checklists Alive

| ID | Rule |
|---|---|
| **CHK-01** | A checklist MUST be short enough to run. Beyond ~12 items, split it by moment |
| **CHK-02** | Each item MUST be binary — checkable, not judged |
| **CHK-03** | An item that is always checked without thought MUST be automated or removed |
| **CHK-04** | An item that would have caught a real incident MUST be added |
| **CHK-05** | Checklists MUST be reviewed quarterly; items with no value in a year are removed |
| **CHK-06** | A checklist MUST be executed, not signed. Signing without executing is worse than not having it (AP-04) |

**Rationale for CHK-03.** An item that never fails is not providing information. Either automate it — so it is enforced without attention — or remove it, so attention goes to items that matter.

## 23.3 The Checklists

### CHK-A · Before Coding

*Run before starting any change above trivial.*

- [ ] I understand what I am building and why
- [ ] The specification exists and is precise enough to implement from
- [ ] I know the acceptance criteria and how they will be verified
- [ ] I know which module this belongs in (§6.8.2)
- [ ] I know whether this is a hazard module (§2.4.3)
- [ ] I know the supervision level required (§2.8.1)
- [ ] The change fits within size limits, or I have split it
- [ ] Nothing I need is blocked or undecided
- [ ] I know how this will be tested
- [ ] If using an agent: the prompt has all seven blocks (§3.4.1)

### CHK-B · Before Committing

- [ ] The change does one thing
- [ ] Build, lint, format, types clean
- [ ] Tests pass locally
- [ ] New tests fail against the previous commit
- [ ] No secrets, credentials, or personal data
- [ ] No debug output, no commented-out code, no untracked `TODO`
- [ ] Refactoring is separate from behaviour change
- [ ] Commit message follows the format and explains **why**
- [ ] Files are in the right place

### CHK-C · Before Opening a Pull Request

- [ ] Rebased on the current trunk
- [ ] Within size limits, or the reason is stated
- [ ] Description: what, why, how verified
- [ ] Specification or ticket linked
- [ ] Test evidence included
- [ ] For a fix: the answer to "which test would have caught this?"
- [ ] Rollback noted (T3+)
- [ ] Screenshots for user-visible change
- [ ] Correct reviewers requested for the supervision level
- [ ] Documentation updated in this change

### CHK-D · Before Merging (the reviewer's checklist)

- [ ] I have the specification and have compared it to the diff
- [ ] I constructed adversarial inputs **before** reading the implementation, and checked them
- [ ] Every failure path is handled; nothing is silent; nothing returns empty on failure
- [ ] No test weakened, skipped, or deleted
- [ ] No unfamiliar API used that I have not verified exists
- [ ] No branch or condition removed without explanation
- [ ] No unrequested change bundled in
- [ ] Names tell the truth
- [ ] Domain logic contains no I/O, clock, randomness, or environment
- [ ] All checks green; required approvals present
- [ ] **I understand this well enough to fix it at 3 a.m., and I am willing to own it**

### CHK-E · Before Release

- [ ] All checks green at the exact commit being released
- [ ] Changelog updated; breaking changes explicit with a migration path
- [ ] Version tagged; full suite re-run at the tag
- [ ] Migrations backward-compatible and tested at production scale
- [ ] **Rollback path identified and previously tested**
- [ ] Nothing irreversible, or compensating controls are in place
- [ ] Security review complete if any trigger applies (§15.4.12)
- [ ] Performance verified against budgets
- [ ] Consumers notified of breaking changes
- [ ] Deployment window appropriate — the team is available
- [ ] Post-deployment verification is in place

### CHK-F · Before Deployment

- [ ] The artifact is the one that was tested — not rebuilt
- [ ] Target environment confirmed
- [ ] Configuration validated for that environment
- [ ] Migration step planned and sequenced
- [ ] Rollback command known and ready
- [ ] Monitoring dashboard open
- [ ] The person deploying will be available for the watch window
- [ ] Someone else knows a deployment is happening

### CHK-G · After Deployment

- [ ] Automated verification passed
- [ ] A real user path exercised successfully
- [ ] Error rate compared to the pre-deployment baseline
- [ ] Latency compared to baseline
- [ ] No new alert categories firing
- [ ] Logs show expected startup and no unexpected errors
- [ ] Watch window observed
- [ ] Anything anomalous → **roll back first**, investigate after
- [ ] Deployment recorded

### CHK-H · Before Starting a Project

- [ ] Problem stated with evidence; someone else agrees with it
- [ ] Conformance tier chosen and recorded
- [ ] Requirements exist and every one is testable
- [ ] Non-goals written
- [ ] At least two approaches considered; rejections recorded
- [ ] Architecture fits in one diagram
- [ ] Hazard modules identified
- [ ] Build order puts safety mechanisms first
- [ ] Standing risks assessed; project risks owned and triggered
- [ ] Project Definition of Done written
- [ ] Repository initialised per §6, with agent standing context

### CHK-I · Incident Response

- [ ] **Mitigate first** — revert or disable
- [ ] Impact assessed and communicated
- [ ] Timeline recorded as it happens
- [ ] Evidence preserved before anything is cleaned up
- [ ] Root and systemic causes identified after mitigation
- [ ] Regression test added
- [ ] Review written within 48 hours, blamelessly
- [ ] Actions owned and dated
- [ ] If a user detected it, improving detection is an action

### CHK-J · AI Agent Session Start

- [ ] Read the standing context file
- [ ] Read the project state summary
- [ ] Noted the hazard modules
- [ ] Read the specification for this task
- [ ] Confirmed this session covers exactly one task
- [ ] Confirmed the supervision level
- [ ] Confirmed which files are in scope and which are not

### CHK-K · AI Agent Before Reporting Complete

- [ ] I implemented exactly the task — nothing more
- [ ] Every API and identifier I used exists
- [ ] No test, type, or threshold weakened
- [ ] No error swallowed; nothing returns empty on failure
- [ ] Tests included; each fails against the previous commit
- [ ] Full local verification ran and passed
- [ ] No secrets anywhere
- [ ] Assumptions listed
- [ ] Uncertainties listed
- [ ] Within size limits
- [ ] The report states what I verified, not what I believe

### CHK-L · Quarterly Maintenance

- [ ] Quick start executed on a clean machine
- [ ] Dependencies audited and updated
- [ ] Runbooks drilled
- [ ] Documentation verified accurate
- [ ] Alerts reviewed: any that fired without requiring action?
- [ ] Test suite duration within budget; zero flaky tests
- [ ] Unused code, flags, and dependencies removed
- [ ] Owner confirmed
- [ ] Risks re-scored

## 23.4 Checklist Selection

| Moment | Checklist |
|---|---|
| Starting a project | CHK-H |
| Starting a change | CHK-A |
| Starting an agent session | CHK-J |
| Agent finishing a task | CHK-K |
| Committing | CHK-B |
| Opening a PR | CHK-C |
| Reviewing a PR | CHK-D |
| Releasing | CHK-E |
| Deploying | CHK-F |
| After deploying | CHK-G |
| Something broke | CHK-I |
| Quarterly | CHK-L |

## 23.5 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Checklists too long | Not run | CHK-01 |
| 2 | Ticked without executing | False confidence | CHK-06 |
| 3 | Items that always pass | Attention wasted | CHK-03 |
| 4 | Never updated after incidents | The same failure recurs | CHK-04 |
| 5 | Judgement items | "Probably fine" | CHK-02 |
| 6 | Checklists in a place nobody looks | Not used | Keep them in the repository and in templates |
| 7 | Skipped under pressure | Exactly when they matter | §30 |

## 23.6 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-154** | **The Ceremonial Tick** | Boxes checked without action | CHK-06; evidence-based gates (§27) |
| **AP-155** | **The Encyclopaedic Checklist** | Sixty items covering every eventuality | CHK-01 |
| **AP-156** | **The Stale Checklist** | Items referring to systems that no longer exist | CHK-05 |
| **AP-157** | **Checklist as Substitute for Understanding** | Following steps without knowing why | Each item traces to a rule with a rationale |

## 23.7 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Checklists ticked, not executed | **High** | High | CHK-06; evidence at gates; spot checks | Medium |
| Checklists grow until unusable | High | Medium | CHK-01, CHK-05 | Low |
| Skipped under deadline | High | High | §30; leadership modelling | Medium |
| False confidence from a passed checklist | Medium | Medium | Checklists complement judgement; CHK-D's final item | Medium |

## 23.8 Future Improvements

| Item | When | Note |
|---|---|---|
| Checklists embedded in PR and issue templates | v1.1 | Put them where the work happens |
| Automated items removed from human checklists | Continuous | CHK-03 applied every quarter |
| Per-project checklist extensions | v1.1 | Project-specific items without editing the handbook |
| Incident-driven checklist updates tracked | v1.2 | Verify CHK-04 is actually happening |

---

*End of Part 12. Part 13 states what is forbidden, and the workflow AI agents follow.*
