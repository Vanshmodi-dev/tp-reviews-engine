# Part 6 — Definition of Done and Testing Standards

*Sections 10 and 11. "Done" is the most overloaded word in software. This part removes the ambiguity, then specifies the discipline that makes "done" verifiable rather than asserted.*

---

# 10. Definition of Done

## 10.1 Purpose

To make "done" a checkable state rather than an opinion, so that the word means the same thing when said by an engineer, an agent, a lead, and a manager — and so that nothing is reported complete while a foreseeable failure remains unaddressed.

## 10.2 Objectives

1. Define done at three levels: the change, the feature, and the project.
2. Make every criterion objectively checkable by someone other than the author.
3. Scale the criteria to conformance tier without making them optional.
4. Remove the negotiation that happens when "done" is undefined.
5. Give agents a self-verifiable completion standard.

## 10.3 Engineering Rationale

### 10.3.1 The Cost of an Undefined "Done"

| Symptom | Root Cause |
|---|---|
| "It's done, just needs testing" | Testing was not part of done |
| "It's done but not deployed" | Deployment was not part of done |
| Features that are 90% complete for weeks | No definition, so no completion |
| Work re-opened after being closed | The closer and the reporter used different definitions |
| Quality falling as a deadline nears | Done was implicitly redefined and nobody said so |

Every one of these is the same failure: **"done" was a judgement rather than a check.** The remedy is a list, applied identically every time, with no dependence on who is asking.

### 10.3.2 Why Done Includes Verification, Not Just Implementation

Code that has not been verified is not an asset; it is an unmeasured liability. It may work. Nobody knows. The team cannot change it confidently because nothing establishes what it currently does.

**The economic statement:** unverified code has negative value until verified, because it must be verified before it can be safely changed — and by then the author's context is gone, making the verification more expensive than it would have been.

This is why tests are not a separate task, a separate phase, or a follow-up ticket. **They are part of the change**, because their value is highest at the moment the author's understanding is complete.

### 10.3.3 Why Done Includes Deployability

Work sitting on a branch, or merged but undeployed, provides zero value and accrues risk: it diverges from reality, it accumulates merge conflicts, and it becomes part of a larger, riskier release.

At T3+, "done" therefore includes "deployable through the standard pipeline with a rollback path that has been tested". Not necessarily deployed — deployment may be gated by business timing — but *deployable with no remaining work*.

### 10.3.4 Why Agents Need an Explicit Done

An agent will report completion when it has produced code satisfying its interpretation of the task. Without an explicit standard, that interpretation stops at "the code exists and looks right". An explicit eleven-item list turns completion into a self-check the agent can actually perform — and turns the human's review into verification of specific claims rather than a general impression.

## 10.4 Standards

### 10.4.1 Done — One Change (the merge standard)

All eleven conditions. **Ten out of eleven is not done.**

| # | Condition | Verified By | Tier |
|---|---|---|---|
| 1 | The change satisfies the stated requirement | Reviewer against the spec | All |
| 2 | Tests exist and are in the same change | CI | T2+ |
| 3 | Each new test fails against the previous commit | Author, stated in the PR | T2+ |
| 4 | The full local suite passes | CI | T2+ |
| 5 | Lint, format, and type checks are clean | CI | All |
| 6 | Coverage thresholds for touched modules are met | CI | T3+ |
| 7 | Failure paths are handled and tested; nothing fails silently | Reviewer | All |
| 8 | Documentation updated: module header, README, API docs, changelog as applicable | Reviewer | T2+ |
| 9 | No secret, credential, or personal data anywhere in the change | Automated scan + reviewer | All |
| 10 | Reviewed and approved by someone who did not author it | Process | T2+ |
| 11 | The merger understands it well enough to fix it at 3 a.m. | Self-attestation | All |

| ID | Rule |
|---|---|
| **DONE-01** | All applicable conditions MUST hold before merge. There is no partial done |
| **DONE-02** | Condition 11 MUST be answered honestly. "I don't fully understand this" is a valid and valuable review outcome |
| **DONE-03** | A change that cannot meet condition 3 (a test that fails before it) is either untested or testing the wrong thing |

**Rationale for condition 3.** A test that passes against the previous commit does not test the change. This single check catches test laundering (AP-15), tests written against the implementation, and tests that assert something already true.

**Rationale for condition 11.** It converts review from a formality into an act of acceptance. If the answer is no, the correct action is to ask questions, request simplification, or decline — not to approve and hope.

### 10.4.2 Done — One Feature

A feature is a set of changes delivering user-visible value.

| # | Condition | Tier |
|---|---|---|
| 1 | Every change within it meets §10.4.1 | All |
| 2 | Every acceptance criterion in the requirement is demonstrably met | T2+ |
| 3 | The end-to-end path works in an environment resembling production | T3+ |
| 4 | Error and empty states are implemented and verified — not only the happy path | T2+ |
| 5 | Performance is within the stated budget under expected load | T3+ |
| 6 | Security review complete if it touches auth, data, or external input | T3+ / T4 |
| 7 | Observability in place: logs, metrics, and alerts for its failure modes | T3+ |
| 8 | Documentation complete: user-facing and developer-facing | T2+ |
| 9 | A rollback path exists **and has been executed at least once** | T3+ |
| 10 | Feature flags, if used, have a removal date | T2+ |
| 11 | The owner is named | T2+ |

| ID | Rule |
|---|---|
| **DONE-04** | A feature is not done until its **failure** behaviour is verified, not only its success behaviour |
| **DONE-05** | "Rollback exists" MUST mean executed once, not documented |
| **DONE-06** | A feature behind a permanent flag is not done; it is deferred |

**Rationale for DONE-04.** Failure paths are where users experience software as untrustworthy, where data is lost, and where agents are weakest (§2.3.2). They are also where testing effort is lowest by default, because they are less pleasant to think about. Making them a completion criterion is what corrects that bias.

### 10.4.3 Done — One Project

| Dimension | Criteria |
|---|---|
| **Functional** | Every P0 requirement met and demonstrated; P1s met or explicitly deferred with owners |
| **Quality** | All gates green; coverage thresholds met; no known defect above the agreed severity |
| **Performance** | Budgets met under stated load; results recorded |
| **Security** | Review complete; no unresolved high or critical findings; secrets managed correctly |
| **Documentation** | README, architecture, API docs, runbooks, changelog complete and verified |
| **Operational** | Monitoring live, alerts routed to a human, health checks in place, runbooks **drilled** |
| **Deployment** | Deployed through the standard pipeline; rollback tested; environment promotion verified |
| **Handover** | A named owner exists; someone other than the builder has operated it successfully |
| **Retirement** | The retirement condition is written down — how we will know this should be turned off |

| ID | Rule |
|---|---|
| **DONE-07** | The project DoD MUST be written before implementation begins (PLAN-24) |
| **DONE-08** | It MUST NOT be weakened during the project. Scope may be cut; the standard may not |
| **DONE-09** | Runbooks MUST be drilled by someone who did not write them |
| **DONE-10** | The retirement condition MUST be recorded at completion, not invented years later |

**Rationale for DONE-09.** A runbook that has never been executed is a hypothesis. The first execution always finds a missing step, a wrong path, or an assumed permission — and finding that during an incident is the most expensive possible moment.

### 10.4.4 What Done Is Not

| Not Done | Why |
|---|---|
| "The code is written" | Unverified code has negative value |
| "It works on my machine" | Environment-dependent success is not success |
| "Tests will come in a follow-up" | The follow-up is not scheduled and will not be |
| "It's behind a flag so it's safe" | Flags contain risk; they do not remove it |
| "The happy path works" | Users meet the unhappy path |
| "It passed review" | Review is one condition of eleven |
| "The ticket is closed" | Ticket state is a record of a decision, not the decision |
| "It's deployed" | Deployed and unmonitored is deployed and unknown |

## 10.5 Real-World Examples

### Example 1 — The 90% Feature

A feature is reported done. It lacks: empty-state handling, error display, tests for two of five paths, and any log line. It is 90% done for five weeks as each gap is discovered in turn.

| | |
|---|---|
| Root cause | No definition; "done" meant "the main path works" |
| The fix | The eleven conditions, applied at merge, prevent the gap from accumulating |
| The lesson | 90% done for five weeks is 0% done with a misleading report |

### Example 2 — The Untested Rollback

A release is deployed. It fails. The documented rollback references a script that was renamed six months earlier. The outage extends by forty minutes while someone reconstructs the procedure.

| | |
|---|---|
| Rules | DONE-05, DONE-09 |
| Cost of prevention | Ten minutes, once |
| Cost of the omission | Forty minutes of outage, at the worst possible time |

### Example 3 — Agent Self-Certification

An agent reports a change complete. The eleven-item check reveals: no test fails against the previous commit (condition 3), and the error path returns an empty list (condition 7). Both are found by the agent's own self-check before a human sees it.

| | |
|---|---|
| Why it worked | The standard was explicit enough to be self-applied |
| The general point | An agent cannot meet a standard it has not been given. Given one, it applies it consistently |

### Example 4 — The Cut That Was Correct

A project is behind. The team cuts three P2 features entirely rather than shipping seven features with reduced testing. The release is smaller and fully verified.

| | |
|---|---|
| Rules | DONE-08, PHIL-09 |
| Why it is correct | Scope is recoverable next iteration; quality debt is not, and it compounds |

## 10.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Done means "code written" | Long tail of discovered gaps | The eleven conditions |
| 2 | Tests deferred | Never written | DONE-01 condition 2 |
| 3 | Happy path only | Users meet unhandled errors | DONE-04 |
| 4 | Documentation deferred | Written months later, wrong | Condition 8 |
| 5 | Rollback documented, never run | Fails when needed | DONE-05 |
| 6 | DoD weakened near a deadline | Quality collapses silently | DONE-08; cut scope instead |
| 7 | Approving without understanding | Nobody can maintain it | Condition 11 |
| 8 | Flags left permanently | Untested combinations accumulate | DONE-06 |
| 9 | Different definitions per person | Constant re-opening | One list, published |
| 10 | No retirement condition | Zombie systems | DONE-10 |

## 10.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-66** | **Done-Done** | Needing to say "done" twice reveals the first one is meaningless | One definition |
| **AP-67** | **The Follow-Up Ticket** | Gaps deferred to tickets that are never prioritised | Not done until done |
| **AP-68** | **Definition Drift** | The standard quietly relaxes as the deadline approaches | DONE-08 |
| **AP-69** | **Checkbox Compliance** | Conditions ticked without execution | Evidence, not ticks (§27) |
| **AP-70** | **The Silent Downgrade** | A criterion dropped without anyone deciding to drop it | Explicit waivers only (§29.4) |

## 10.8 Decision Tables

### 10.8.1 Is This Done?

| Question | If No |
|---|---|
| Does it meet the requirement as written? | Not done |
| Do tests exist, in this change? | Not done |
| Does each test fail against the previous commit? | Not done — the tests test nothing |
| Are the failure paths handled and tested? | Not done |
| Is anything silent on failure? | Not done |
| Is documentation updated? | Not done |
| Would I be comfortable maintaining this? | Not done — ask questions or decline |
| Is there a secret anywhere in the diff? | **Stop.** Not done, and escalate |

### 10.8.2 Can Any Criterion Be Waived?

| Criterion | Waivable | Under What Circumstance |
|---|---|---|
| Requirement met | ❌ | Never — reduce the requirement instead |
| Tests exist | ⚠️ | T1 only |
| Failure paths handled | ❌ | Never |
| No silent failure | ❌ | **Never. Constitutional (§30)** |
| No secrets | ❌ | **Never. Constitutional (§30)** |
| Documentation | ⚠️ | T1; deferred at T2 with a dated owner |
| Independent review | ⚠️ | T1; or a documented emergency with retrospective review within 24 h |
| Coverage threshold | ⚠️ | With a recorded waiver and a remediation date |
| Understanding | ❌ | Never |

## 10.9 Checklists

### CHK-10.1 · Change Done Check

- [ ] Requirement satisfied, and I can point to where
- [ ] Tests included; each fails against the previous commit
- [ ] Full suite green
- [ ] Lint, format, types clean
- [ ] Coverage threshold met for what I touched
- [ ] Every failure path handled; nothing returns empty or null on failure
- [ ] Documentation updated
- [ ] No secrets or personal data
- [ ] Reviewed by someone else
- [ ] I understand this well enough to fix it at 3 a.m.
- [ ] I am willing to own it

### CHK-10.2 · Feature Done Check

- [ ] Every change within it meets CHK-10.1
- [ ] Every acceptance criterion demonstrated
- [ ] End-to-end verified in a production-like environment
- [ ] Error and empty states implemented and verified
- [ ] Performance within budget under expected load
- [ ] Security reviewed if applicable
- [ ] Logs, metrics, and alerts exist for its failure modes
- [ ] User and developer documentation complete
- [ ] **Rollback executed at least once**
- [ ] Flag removal date set, if flagged
- [ ] Owner named

### CHK-10.3 · Project Done Check

- [ ] All P0 requirements demonstrated
- [ ] All quality gates green
- [ ] Performance budgets met and recorded
- [ ] Security review complete, no unresolved high findings
- [ ] Documentation complete and verified by an outsider
- [ ] Monitoring, alerting, and health checks live
- [ ] **Runbooks drilled by someone who did not write them**
- [ ] Deployed via the standard pipeline; rollback tested
- [ ] Owner named and has operated it
- [ ] Retirement condition recorded

## 10.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| DoD relaxed under deadline | **High** | High | DONE-08; scope is the variable; §30 | Medium |
| Conditions ticked without execution | Medium | High | Evidence-based gates (§27); spot checks | Medium |
| Condition 11 answered dishonestly | Medium | Medium | Culture; asking questions is rewarded, not penalised | Medium |
| DoD too heavy for small work | Medium | Medium | Tier scaling; T1 is genuinely light | Low |
| Rollback documented but never run | High | High | DONE-05 as a hard criterion | Low |

## 10.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Automated DoD checklist in the PR template | v1.1 | Mechanical items auto-checked from CI |
| Automated "does this test fail on the parent commit?" check | v1.2 | High value; mechanises condition 3 |
| Done-criteria telemetry | v1.2 | Which criterion is most often the last to be met |

---

# 11. Testing Standards

## 11.1 Purpose

To establish what must be tested, how, to what standard, and at which level — so that the test suite is a reliable statement about the system's behaviour rather than a collection of assertions that happen to pass.

## 11.2 Objectives

1. Define the test levels and what belongs at each.
2. Establish that tests verify the **requirement**, not the implementation.
3. Set coverage standards that are meaningful rather than performative.
4. Make the suite fast enough that it is actually run.
5. Eliminate flakiness structurally.
6. Define specialised testing — performance, security, accessibility, chaos — and when each is required.
7. Make agent-written tests trustworthy.

## 11.3 Engineering Rationale

### 11.3.1 What Tests Are Actually For

Not "to find bugs" — that is a side effect. Tests exist to:

| Purpose | Consequence If Absent |
|---|---|
| **Enable change** | Nobody dares refactor; the code ossifies |
| **Document behaviour** | The only specification is the code, which cannot state intent |
| **Prevent regression** | Every fixed bug returns eventually |
| **Verify AI output** | Review degrades to "looks right" (AP-09) |
| **Define done** | Completion becomes an opinion |

**The first is the most important.** A codebase without tests is a codebase that can only be added to, never changed — which means it accumulates rather than improves, and every year makes the next year harder.

### 11.3.2 Test the Requirement, Not the Implementation

| Testing the Implementation | Testing the Requirement |
|---|---|
| Asserts internal method calls occurred | Asserts the observable outcome |
| Breaks on every refactor | Survives refactoring |
| Passes when behaviour is wrong but structure is right | Fails when behaviour is wrong |
| Written by reading the code | Written by reading the specification |
| Makes change expensive | Makes change safe |

Implementation-coupled tests are worse than no tests: they impose the cost of maintenance while providing false confidence, and they actively resist the refactoring they were supposed to enable.

**The mechanical check:** *if I rewrote this module completely, keeping its interface and behaviour, would the test still pass?* If no, it tests the implementation.

### 11.3.3 The Test Pyramid, and Why the Shape Matters

| Level | Share | Speed | What It Proves |
|---|---|---|---|
| **Unit** | ~70% | Milliseconds | Individual logic is correct |
| **Integration** | ~20% | Seconds | Components cooperate correctly |
| **End-to-end** | ~10% | Seconds–minutes | The whole path works for a user |

Inverting the pyramid — many E2E tests, few unit tests — produces a suite that is slow, flaky, and imprecise about what broke. The shape is not aesthetic: it follows from the fact that unit tests are fast, deterministic, and pinpoint failures, while E2E tests are none of those but prove something the others cannot.

**Corollary:** the pyramid is achievable only if business logic is separated from I/O (§9). A codebase where logic and infrastructure are entangled *cannot* have a healthy pyramid, because there is nothing that can be unit tested. This is why §9 and §11 are inseparable.

### 11.3.4 Speed Is a Correctness Property

| Suite Duration | Consequence |
|---|---|
| < 10 seconds | Run constantly, during development |
| < 2 minutes | Run before every commit |
| < 10 minutes | Run in CI; not locally |
| > 10 minutes | **Not run. Worked around. Eventually disabled** |

A slow suite stops preventing defects, and the transition is gradual and unremarked. Speed is therefore not a convenience; it is what makes the suite exist in practice rather than in principle.

### 11.3.5 Flakiness Destroys Everything

A test that fails intermittently trains people to re-run rather than investigate. Once that habit forms, **every** failure is treated as noise, including the real ones. A single tolerated flaky test degrades the entire suite's value.

Flakiness has four causes, all structural and all fixable:

| Cause | Fix |
|---|---|
| Real time | Inject a clock (MOD-20) |
| Real randomness | Inject a seeded generator |
| Shared state between tests | No shared mutable state; construct per test |
| Real network or timing dependence | Local doubles; no `sleep`-based synchronisation |

### 11.3.6 Why Agent-Written Tests Need Extra Care

Agents write excellent tests when given a specification and no implementation. They write dangerous tests when given the implementation, because they describe what it does rather than what it should do — and the resulting suite passes against a wrong implementation forever (AP-15).

**Two rules follow, and they are the highest-value testing rules in this handbook:**

1. When an agent writes tests, provide the **specification**, not the implementation.
2. Every new test must fail against the previous commit.

## 11.4 Standards

### 11.4.1 Test Levels

| Level | Tests | Doubles | Speed | Required From |
|---|---|---|---|---|
| **Unit** | One module in isolation | All I/O | < 10 ms each | T2 |
| **Integration** | Modules together, real adapters against local doubles | External services only | < 1 s each | T3 |
| **Contract** | Every implementation of an interface against one shared suite | — | < 1 s each | T3 (where ≥ 2 implementations) |
| **End-to-end** | A complete user path | Nothing internal | < 30 s each | T3 |
| **Property** | Invariants over generated inputs | All I/O | Varies | T3 for domain logic; **T4 mandatory** |
| **Regression** | A reproduction of a real past defect | As needed | Varies | **All tiers, always** |
| **Performance** | Behaviour under load | Realistic | Minutes | T3 |
| **Security** | Attack behaviour | Realistic | Varies | T3, **T4 mandatory** |
| **Accessibility** | Assistive-technology usability | Real UI | Seconds | T3 with a UI |
| **Chaos** | Injected failures | Injected | Seconds | **T4 mandatory** |

### 11.4.2 Universal Test Rules

| ID | Rule |
|---|---|
| **TEST-01** | Tests MUST ship in the same change as the code they test |
| **TEST-02** | Every new test MUST fail against the previous commit |
| **TEST-03** | Tests MUST be deterministic. Time, randomness, and environment MUST be injected |
| **TEST-04** | Tests MUST NOT share mutable state. Each constructs its own data |
| **TEST-05** | Test names MUST be full sentences describing behaviour, not method names |
| **TEST-06** | One logical assertion per test |
| **TEST-07** | Test data MUST be built through builders, not inline literals scattered across the suite |
| **TEST-08** | The default suite MUST NOT require network access |
| **TEST-09** | Tests requiring network or credentials MUST be in a separate, opt-in suite that never blocks a pull request |
| **TEST-10** | A flaky test MUST be fixed or deleted within 48 hours. It MUST NOT be retried or ignored |
| **TEST-11** | Tests MUST test observable behaviour, not internal structure |
| **TEST-12** | Every fixed defect MUST gain a regression test in the same change as the fix |

**Rationale for TEST-09.** A network-dependent test in the blocking path trains engineers to re-run CI until it passes, which destroys the value of every other test in the suite. The failure mode is not the flaky test itself; it is the habit it creates.

**Rationale for TEST-07.** When a schema changes, a suite built on inline literals requires editing 200 tests; one built on builders requires editing one builder. This determines whether the suite is maintained or abandoned.

### 11.4.3 Coverage

| Code Category | Minimum | Rationale |
|---|---|---|
| Business logic / domain | **90%** | The most valuable, most stable, easiest-to-test code |
| **Safety mechanisms** (validation, auth, gates, sanitisation, limits) | **100%** | Their entire purpose is to fail correctly |
| **Secret handling and redaction** | **100%** | Failure is irreversible |
| Adapters | 70% | Structural coverage; behaviour tested at integration level |
| Transport / UI glue | 50% | Low logic density |
| Generated code | Excluded | — |
| Overall | 70% | A floor, not a goal |

| ID | Rule |
|---|---|
| **TEST-13** | Coverage thresholds MUST be **per path**, never a single global number |
| **TEST-14** | Thresholds MUST block merge |
| **TEST-15** | Thresholds MUST NOT be lowered to make a change pass |
| **TEST-16** | Coverage is a floor. **A module at 95% with weak assertions is worse than one at 80% with strong ones** |

**Rationale for TEST-13.** A single global threshold lets the critical modules degrade while the average is carried by trivially covered constants and configuration files. Per-path thresholds make the important number visible.

### 11.4.4 What Must Always Be Tested

| Category | Examples |
|---|---|
| **Every failure path** | Errors, timeouts, invalid input, missing dependencies, permission denial |
| **Every boundary** | Exactly at, one below, one above each threshold |
| **Empty and degenerate cases** | Empty list, null, zero, single element, maximum size |
| **Every branch of business logic** | Each rule, independently |
| **Safety mechanisms** | Both that they reject when they should **and** that they do not reject spuriously |
| **Idempotence** | Where an operation may be retried |
| **Ordering** | Where order is significant |
| **Concurrency** | Where operations may interleave |
| **Every fixed defect** | Permanently |

| ID | Rule |
|---|---|
| **TEST-17** | Every safety mechanism MUST have both a rejects-correctly test and a does-not-reject-spuriously test |
| **TEST-18** | Every threshold MUST have boundary tests at the exact value |
| **TEST-19** | Failure paths MUST be tested at least as thoroughly as success paths |

**Rationale for TEST-17.** A validator that rejects everything passes every rejection test. Only the second test — that valid input is accepted — proves it is a validator rather than a wall.

### 11.4.5 Property-Based Testing

| ID | Rule |
|---|---|
| **TEST-20** | Domain invariants SHOULD be expressed as properties over generated inputs (T3), and MUST be (T4) |
| **TEST-21** | Each property MUST run at least 1,000 generated cases |
| **TEST-22** | A failing property MUST report a minimal counterexample |
| **TEST-23** | Properties MUST be written **before or with** the implementation for hazard modules, never after |
| **TEST-24** | Each property MUST name the invariant it protects, in a comment |

**Rationale for TEST-20.** Example-based tests check the cases someone thought of. Properties check thousands nobody thought of, and they express intent at a higher level: "output never contains markup, for any input" is a stronger and clearer statement than fifty examples.

**Rationale for TEST-23.** A property written after the implementation tends to encode the implementation's behaviour, including its bugs. Written first, it is a specification the implementation must satisfy.

### 11.4.6 Specialised Testing

| Type | Purpose | When Required | Notes |
|---|---|---|---|
| **Performance** | Verify budgets under load | T3+ | **Deterministic budgets block; wall-clock timings monitor only** |
| **Load** | Behaviour at expected and peak volume | T3+ with scale requirements | Find the knee, not just the target |
| **Stress** | Behaviour beyond capacity | T4 | Must degrade, not collapse |
| **Chaos** | Injected failures | T4 | Each scenario asserts a named safety property |
| **Security** | Attack resistance | T3+, T4 mandatory | §15 |
| **Accessibility** | Usability with assistive technology | T3+ with a UI | Automated + manual |
| **Regression** | Past defects stay fixed | All | Grows forever |
| **Contract** | Interface implementations conform | T3+ | One suite, every implementation |

| ID | Rule |
|---|---|
| **TEST-25** | Deterministic budgets (size, CPU, allocation count) MUST block merge. Wall-clock timings MUST NOT |
| **TEST-26** | Chaos scenarios MUST assert a **specific** safety property. "Did not crash" is not an assertion |
| **TEST-27** | A chaos test MUST fail when its protection is removed — this MUST be verified once, deliberately |
| **TEST-28** | Accessibility MUST include manual keyboard and screen-reader verification, not only automated checks |

**Rationale for TEST-25.** A wall-clock performance gate on shared CI infrastructure is flaky by construction, and a flaky gate trains people to re-run — destroying every other gate's credibility (§11.3.5). Deterministic measures are gateable; timings are trendable.

**Rationale for TEST-27.** This is the only way to know a test tests anything. Remove the protection; the test must fail. If it still passes, the test is measuring something else, and its green status is misleading.

### 11.4.7 Agent-Written Tests

| ID | Rule |
|---|---|
| **TEST-29** | When an agent writes tests, it MUST be given the **specification**, not the implementation |
| **TEST-30** | Agent-written tests MUST be reviewed with **more** scrutiny than agent-written implementations |
| **TEST-31** | A change that removes, skips, weakens, or narrows a test MUST be flagged and explicitly justified |
| **TEST-32** | An agent MUST NOT regenerate a golden/snapshot expectation to make a test pass unless the output change was the intended change, stated explicitly |

**Rationale for TEST-30.** A weak implementation fails visibly. A weakened test silently removes a guard forever, and nothing ever reports it. The asymmetry justifies the extra attention.

## 11.5 Real-World Examples

### Example 1 — The Implementation-Coupled Suite

A service has 340 tests asserting that specific internal methods were called with specific arguments. A refactor that changes no behaviour breaks 180 of them. The team spends three days updating tests, then avoids refactoring for two years.

| | |
|---|---|
| Rule | TEST-11 |
| The check that would have prevented it | "If I rewrote this keeping its interface, would the test still pass?" |
| Cost | Two years of accumulated structural debt because change was too expensive |

### Example 2 — The Flaky Test That Cost a Release

One test fails roughly one run in eight. The team re-runs. Six months later a genuine regression fails a different test; it is re-run three times, passes once by chance, and ships.

| | |
|---|---|
| Rule | TEST-10 |
| Root cause | Tolerating intermittent failure trains people to disbelieve failures |
| Correct action | Fix or delete within 48 hours. Deleting is better than tolerating |

### Example 3 — Coverage Without Meaning

A module reports 96% coverage. Investigation shows most tests call functions and assert that they do not throw. A defect ships in a fully "covered" branch.

| | |
|---|---|
| Rule | TEST-16 |
| The lesson | Coverage measures execution, not verification |
| Better signal | Would this test fail if the behaviour were wrong? |

### Example 4 — The Property That Found What Examples Missed

A text-sanitising module has 40 example tests, all passing. A property — "output never contains markup, for any generated input" — fails on the 700th case with a nested-encoding input nobody had considered.

| | |
|---|---|
| Rule | TEST-20 |
| Why it worked | The property expressed the requirement; the examples expressed someone's imagination |

### Example 5 — The Test That Failed Correctly

A chaos scenario asserts that a partial data load never causes deletions. A reviewer removes the protecting condition; the test fails. The protection and the test are both confirmed real.

| | |
|---|---|
| Rule | TEST-27 |
| Cost | Two minutes |
| Value | The difference between a test and a green checkmark |

## 11.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Testing implementation details | Refactors break tests | TEST-11 |
| 2 | Tests written after code, from the code | Tests pass against wrong behaviour | TEST-02, TEST-29 |
| 3 | Tolerating flaky tests | Real failures ignored | TEST-10 |
| 4 | Coverage as a goal | High coverage, low assurance | TEST-16 |
| 5 | Only happy paths | Failure behaviour unknown | TEST-19 |
| 6 | Real time or randomness in tests | Intermittent failures | TEST-03 |
| 7 | Inverted pyramid | Slow, flaky, imprecise | §11.3.3 |
| 8 | Network in the default suite | Slow and unreliable | TEST-08, TEST-09 |
| 9 | Shared fixtures mutated between tests | Order-dependent failures | TEST-04 |
| 10 | Snapshot regenerated to pass | The test now asserts the bug | TEST-32 |
| 11 | No boundary tests | Off-by-one ships | TEST-18 |
| 12 | Safety mechanism tested only for rejection | A wall that rejects everything passes | TEST-17 |

## 11.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-71** | **The Mock Cathedral** | Tests so mock-heavy they verify only the mocks | Test real logic; mock only at I/O boundaries |
| **AP-72** | **Assertion-Free Testing** | Tests that call code and assert nothing meaningful | TEST-16; review test quality |
| **AP-73** | **The Snapshot Swamp** | Hundreds of snapshots regenerated on every change | Snapshots for stable output only; assert meaning elsewhere |
| **AP-74** | **Test-After-The-Fact** | Tests written to satisfy a coverage gate | TEST-02 |
| **AP-75** | **The Retry Loop** | CI configured to retry failing tests automatically | TEST-10; retries hide real failures |
| **AP-76** | **The Sleeping Test** | Synchronisation by waiting a fixed duration | Deterministic synchronisation; injected clock |
| **AP-77** | **Coverage Gaming** | Tests written to touch lines, not verify behaviour | TEST-16; per-path thresholds |
| **AP-78** | **The Disabled Suite** | An entire suite skipped "temporarily" | Delete or fix; a skipped suite is a lie about safety |

## 11.8 Decision Tables

### 11.8.1 Which Test Level?

| What you are verifying | Level |
|---|---|
| A calculation or rule | Unit |
| A decision with several branches | Unit |
| Two modules cooperating | Integration |
| An adapter against a real local dependency | Integration |
| A complete user journey | E2E |
| Every implementation of an interface behaves alike | Contract |
| An invariant over all inputs | Property |
| A past defect | Regression, at the lowest level that reproduces it |
| Behaviour under failure | Chaos |
| Behaviour under load | Performance / load |

### 11.8.2 Is This Test Worth Writing?

| Signal | Write it |
|---|---|
| It verifies a requirement | ✅ |
| It would fail if the behaviour were wrong | ✅ |
| It covers a boundary or failure path | ✅ |
| It reproduces a real defect | ✅ **always** |
| It asserts an internal call occurred | ❌ Rewrite it |
| It restates the implementation | ❌ |
| It exists to raise coverage | ❌ |
| It would break on any refactor | ❌ Rewrite it |

### 11.8.3 Test Double Selection

| Situation | Use |
|---|---|
| An external network service | A local double or recorded responses |
| A database | A real one, locally, for integration; a double for unit |
| The clock | An injected fixed clock, **always** |
| Randomness | An injected seeded generator, **always** |
| The filesystem | A temporary directory |
| A third-party SDK | A double at your own wrapper's boundary |
| Another module you own | **The real one.** Mocking your own modules produces AP-71 |

## 11.9 Checklists

### CHK-11.1 · Writing Tests

- [ ] Derived from the specification, not from the implementation
- [ ] Each fails against the previous commit
- [ ] Full-sentence names describing behaviour
- [ ] One logical assertion each
- [ ] No shared mutable state
- [ ] Time and randomness injected
- [ ] Boundary values tested exactly
- [ ] Failure paths covered
- [ ] Empty and degenerate cases covered
- [ ] Data built through builders
- [ ] No network in the default suite

### CHK-11.2 · Reviewing Tests

- [ ] Would these fail if the behaviour were wrong?
- [ ] Do they test behaviour or structure?
- [ ] Has any existing test been weakened, skipped, or deleted? Why?
- [ ] Are the failure paths covered?
- [ ] Any real time, randomness, or network?
- [ ] Are snapshots regenerated, and was that intended?
- [ ] Is the safety mechanism tested in **both** directions?
- [ ] Could I understand the requirement from these tests alone?

### CHK-11.3 · Suite Health (monthly)

- [ ] Duration within budget and trending flat
- [ ] Zero flaky tests; zero retries configured
- [ ] Zero skipped tests, or each has an owner and a date
- [ ] Coverage thresholds met per path
- [ ] Pyramid shape roughly maintained
- [ ] Regression tests exist for every incident since the last review
- [ ] At least one chaos test verified by protection removal

## 11.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Tests coupled to implementation | **High** | High | TEST-11; the rewrite check | Medium |
| Agent tests describe the implementation | **High** | High | TEST-29, TEST-02 | Medium |
| Flakiness tolerated | High | High | TEST-10; 48-hour rule | Medium |
| Coverage gamed | Medium | Medium | TEST-16; test-quality review | Medium |
| Suite grows too slow | High | High | Duration budgets; pyramid discipline | Medium |
| Failure paths untested | High | High | TEST-19; review focus | Medium |
| Safety mechanism tested one-way only | Medium | High | TEST-17 | Low |
| Test weakened silently in a large diff | Medium | High | TEST-31; small changes; SUP-6 | Medium |

## 11.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Automated "fails on parent commit" verification | v1.2 | Mechanises TEST-02, the highest-value unmechanised rule |
| Automated detection of weakened tests in a diff | v1.1 | Assertion-count and coverage deltas |
| Mutation testing for hazard modules | v1.2 | The natural successor once 100% coverage exists |
| Suite duration tracked as a KPI | v1.1 | §28 |
| Shared test-builder library | v1.2 | Lowers the cost of TEST-07 |

---

*End of Part 6. Part 7 covers what happens when things go wrong: debugging discipline and AI error recovery.*
