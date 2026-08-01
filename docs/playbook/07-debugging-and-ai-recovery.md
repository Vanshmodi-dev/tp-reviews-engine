# Part 7 — Debugging and AI Error Recovery

*Sections 12 and 13. Everything before this part is about preventing failure. This part is about what happens when prevention did not work — which it periodically will not, and the difference between teams is entirely in how they respond.*

---

# 12. Debugging Standards

## 12.1 Purpose

To make debugging a systematic procedure with a predictable outcome rather than an exercise in intuition, so that the time to resolve a defect depends on the defect rather than on who is available.

## 12.2 Objectives

1. Establish reproduction as the mandatory first step.
2. Establish that diagnosis precedes repair, always.
3. Define logging and tracing practices that make production defects diagnosable without reproduction.
4. Establish root-cause analysis that reaches the cause rather than the first plausible explanation.
5. Make every defect produce a permanent regression test.
6. Define blameless incident review that produces systemic improvement.

## 12.3 Engineering Rationale

### 12.3.1 The Debugging Failure Mode

The most common debugging failure is not being unable to find the bug. It is **fixing the first thing that looks wrong**, observing that the symptom disappears, and shipping. This fails because:

- the first plausible cause is often a downstream effect, not the cause;
- the symptom disappearing is weak evidence when the reproduction is unreliable;
- the actual cause remains and will produce a different symptom later;
- and the "fix" adds a defensive workaround that obscures the system further.

**The remedy is procedural: reproduce, then diagnose, then fix, then verify — with no step skipped, and diagnosis explicitly separated from repair.** The separation matters because the moment you begin editing code, you stop investigating.

### 12.3.2 Reproduction Is Non-Negotiable

| Without Reproduction | With Reproduction |
|---|---|
| You cannot know the fix worked | The test goes from red to green |
| You cannot bound the blast radius | You know exactly which conditions trigger it |
| You cannot write a regression test | The reproduction *is* the test |
| The fix is a hypothesis shipped to production | The fix is verified before it ships |

**When reproduction is genuinely impossible** — a rare production-only condition — the correct response is to add observability until it becomes reproducible, not to guess. A speculative fix for an unreproduced defect is a change with unknown effect deployed in response to an unknown cause.

### 12.3.3 Why AI Changes Debugging

Agents are excellent at some parts of debugging and dangerous at others.

| Agent Strength | Agent Danger |
|---|---|
| Reading a stack trace and locating the throwing line | Producing a *plausible* explanation with no evidence |
| Enumerating all code paths that could produce a state | Fixing the first candidate and declaring victory |
| Generating a reproduction from a description | Explaining away evidence that does not fit |
| Searching a codebase for every occurrence of a pattern | Confusing correlation with causation |
| Writing the regression test once the cause is known | Adding defensive code that hides the symptom |

**The rule that follows** is the single most useful debugging practice in an AI-assisted team: **separate diagnosis from repair into two sessions with different prompts.** A read-only investigation session produces evidence; a separate session applies the fix. This prevents the agent from "helpfully" fixing what it has not yet understood — and, equally, prevents the human from accepting a narrative because it arrived alongside a working patch.

### 12.3.4 Root Cause Means Actual Cause

"Root cause: the field was null" is not a root cause. It is a description of the symptom one level up. Useful root-cause analysis continues until it reaches something that can be *changed to prevent recurrence*:

| Level | Statement |
|---|---|
| Symptom | The export produced an empty file |
| Mechanism | The writer was closed before the buffer flushed |
| Immediate cause | The early-return path skipped the flush |
| **Root cause** | Resource cleanup was manual rather than structural, so any new early return reintroduces the defect |
| **Systemic cause** | No test covered the early-return path; the code review checklist does not include "does every exit path release resources?" |

The fix at the mechanism level takes ten minutes and works. The fix at the root-cause level takes an hour and prevents the entire class. **Both should happen; only the first usually does.**

## 12.4 Standards

### 12.4.1 The Debugging Procedure

Six steps, in order. **No step may be skipped, and steps 2 and 4 may not be merged.**

| # | Step | Output | Rule |
|---|---|---|---|
| 1 | **Reproduce** | A reliable reproduction, ideally an automated failing test | DEBUG-01 |
| 2 | **Diagnose** | The mechanism, stated as a causal chain, with evidence | DEBUG-02 |
| 3 | **Assess blast radius** | Every place with the same defect or the same cause | DEBUG-03 |
| 4 | **Fix** | The smallest change addressing the cause | DEBUG-04 |
| 5 | **Verify** | The reproduction now passes; nothing else broke | DEBUG-05 |
| 6 | **Prevent** | A regression test, plus a systemic improvement if warranted | DEBUG-06 |

| ID | Rule |
|---|---|
| **DEBUG-01** | Reproduction MUST precede diagnosis. Where reproduction is impossible, observability MUST be added until it is possible |
| **DEBUG-02** | Diagnosis MUST be separate from repair. **The mechanism MUST be stated before any code is changed** |
| **DEBUG-03** | The blast radius MUST be assessed. A defect found in one place usually exists in others |
| **DEBUG-04** | The fix MUST address the cause, not mask the symptom. Defensive checks that hide the failure are prohibited |
| **DEBUG-05** | Verification MUST include that the reproduction fails before the fix and passes after |
| **DEBUG-06** | Every defect MUST produce a permanent regression test, in the same change as the fix |

**Rationale for DEBUG-02.** Once you begin editing, you stop investigating: attention shifts from "what is happening?" to "does this make the symptom go away?" Those are different questions with different answers. Writing the mechanism down first — even one sentence — forces the investigation to complete.

### 12.4.2 Reproduction Standards

| ID | Rule |
|---|---|
| **DEBUG-07** | A reproduction MUST record: exact inputs, environment, sequence, expected result, actual result, frequency |
| **DEBUG-08** | The reproduction SHOULD be reduced to the smallest case that still fails |
| **DEBUG-09** | An intermittent defect MUST have its frequency quantified before a fix is attempted |
| **DEBUG-10** | Once reproduced, the reproduction MUST become an automated test before the fix is written |

**Rationale for DEBUG-08.** Reduction is diagnosis. Each element removed that does not stop the failure eliminates a hypothesis, and the reduced case is usually so close to the cause that the diagnosis becomes obvious.

**Rationale for DEBUG-09.** "It happens sometimes" and "it happens 3% of the time" lead to different investigations. A quantified frequency also gives an objective test for whether the fix worked, which "it seems better" does not.

### 12.4.3 Logging for Debuggability

Logging exists so that a production failure can be understood **without reproducing it**.

| Level | Use | Volume |
|---|---|---|
| `error` | A failure requiring attention | Rare |
| `warn` | A degraded condition handled automatically | Uncommon |
| `info` | A significant business or lifecycle event | Moderate |
| `debug` | Detailed flow, off in production by default | High |
| `trace` | Everything, for local diagnosis only | Very high |

| ID | Rule |
|---|---|
| **LOG-01** | Logs MUST be structured — machine-parseable fields, not formatted prose |
| **LOG-02** | Every log entry in a request or job MUST carry a correlation identifier |
| **LOG-03** | Every error log MUST include: what was attempted, what failed, the classified error, and the identifiers needed to investigate |
| **LOG-04** | Logs MUST NOT contain secrets, credentials, tokens, or personal data. Redaction MUST be applied at the sink, not per call site |
| **LOG-05** | Log messages MUST NOT be built by interpolating untrusted input into a format string |
| **LOG-06** | Every failure MUST produce exactly one log entry at the point of classification — not one per layer as it propagates |
| **LOG-07** | Log an event once, at the level at which a decision was made |

**Rationale for LOG-04.** Redaction applied per call site fails the moment someone adds a new call site. Applied at the sink, there is exactly one place to get right, and it cannot be bypassed by forgetting.

**Rationale for LOG-06.** Logging an error at every layer as it propagates produces five entries for one failure, of which four are noise. During an incident this makes the log unreadable at exactly the moment it matters. Classify once, log once, propagate the classified error.

### 12.4.4 Tracing and Correlation

| ID | Rule |
|---|---|
| **TRACE-01** | Every externally-triggered operation MUST have a correlation identifier, generated at entry and propagated everywhere |
| **TRACE-02** | The identifier MUST appear in every log line, error response, and outbound request |
| **TRACE-03** | Errors surfaced to users MUST include the identifier so a report can be traced |
| **TRACE-04** | Cross-service calls MUST propagate correlation context (T3+) |
| **TRACE-05** | Long-running jobs MUST log start, completion, and outcome with the same identifier |

### 12.4.5 Root-Cause Analysis

| ID | Rule |
|---|---|
| **RCA-01** | Analysis MUST continue past the first plausible explanation, until it reaches something changeable |
| **RCA-02** | The chain MUST be written down: symptom → mechanism → immediate cause → root cause → systemic cause |
| **RCA-03** | Every step MUST be supported by evidence, not inference. Inferences MUST be labelled as such |
| **RCA-04** | The analysis MUST answer: why did our process not prevent this, and why did it not detect it sooner? |
| **RCA-05** | Systemic findings MUST produce a concrete action with an owner, or an explicit decision to accept the risk |

**Rationale for RCA-03.** Under time pressure, a plausible narrative is easy to build and hard to distinguish from an evidenced one — especially when an agent produced it fluently. Labelling inference separately from observation is a two-word discipline that prevents shipping a confident guess.

### 12.4.6 Regression Prevention

| ID | Rule |
|---|---|
| **DEBUG-11** | Every fix MUST include a test that fails before it and passes after |
| **DEBUG-12** | The test MUST be at the lowest level that reproduces the defect |
| **DEBUG-13** | The test MUST reference the incident or issue |
| **DEBUG-14** | If the same defect class occurs twice, a **systemic** control MUST be added — a lint rule, a type, a test pattern, or a checklist item |
| **DEBUG-15** | Regression tests MUST NOT be deleted. They are the accumulated memory of the system |

**Rationale for DEBUG-14.** The second occurrence is the signal. Once is a defect; twice is a process gap, and fixing the instance again without fixing the class guarantees a third.

### 12.4.7 Incident Review

Required for any T3+ production incident, within 48 hours.

| Element | Contents |
|---|---|
| Timeline | Detection, response, mitigation, resolution — with times |
| Impact | Who was affected, how, for how long, and what was lost |
| Detection | How we found out. **If a user told us, that is the primary finding** |
| Mechanism | The technical causal chain |
| Root and systemic causes | Per §12.4.5 |
| What went well | Genuinely — this is not filler; it identifies controls worth keeping |
| What did not | Without naming individuals as causes |
| Actions | Concrete, owned, dated |
| Prevention | What now makes recurrence impossible or detectable |

| ID | Rule |
|---|---|
| **INC-01** | Reviews MUST be blameless. Human error is a **symptom** of a system that permitted it |
| **INC-02** | "Be more careful" MUST NOT be an action item. It is not a control |
| **INC-03** | Every action MUST have an owner and a date |
| **INC-04** | If detection came from a user, improving detection MUST be an action item |
| **INC-05** | Reviews MUST be written down and readable by anyone in the company |

**Rationale for INC-01.** A team that assigns blame gets fewer incident reports, not fewer incidents. Every meaningful improvement comes from information that people only share when sharing is safe.

## 12.5 Real-World Examples

### Example 1 — The Symptom Fix

An endpoint intermittently returns a null field. An engineer adds a null check with a default value. The symptom disappears. Three months later the same null propagates through a different path and corrupts a batch export.

| | |
|---|---|
| Root cause | The write path never populated the field under one condition |
| Rules | DEBUG-02, DEBUG-04 |
| The defensive check made it worse | It hid the condition and delayed discovery by three months |

### Example 2 — Diagnosis Without Evidence

A production error is reported. An agent is asked to fix it. It produces a fluent explanation and a patch. The patch is merged. The error continues, because the explanation was plausible and wrong.

| | |
|---|---|
| Rules | DEBUG-01, DEBUG-02, RCA-03 |
| Correct process | Read-only investigation session first; evidence for each link; fix only after the mechanism is confirmed |

### Example 3 — The Log That Solved It in Four Minutes

A payment reconciliation fails for one customer. Every log line carries a correlation identifier; the error log names the operation, the classified failure, and the record identifiers. The engineer finds the cause without reproducing anything.

| | |
|---|---|
| Rules | LOG-01, LOG-02, LOG-03, TRACE-02 |
| Counterfactual | With unstructured logs and no correlation, the same investigation takes a day and may fail |

### Example 4 — The Second Occurrence

A defect class — an unhandled failure path swallowing an error — occurs for the second time in four months. Instead of fixing only the instance, the team adds a lint rule detecting the pattern and finds nine more instances.

| | |
|---|---|
| Rule | DEBUG-14 |
| Return on the hour spent | Nine latent defects removed, and the class prevented permanently |

## 12.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Fixing before diagnosing | The defect returns in another form | DEBUG-02 |
| 2 | Accepting a plausible explanation | Fluent, wrong narrative | RCA-03 |
| 3 | No reproduction | The fix is a hypothesis | DEBUG-01 |
| 4 | Defensive workarounds | The failure hides and surfaces later | DEBUG-04 |
| 5 | Stopping at the mechanism | The class recurs | RCA-01 |
| 6 | No blast-radius assessment | The same bug in four other places | DEBUG-03 |
| 7 | Logging at every layer | Unreadable logs during incidents | LOG-06 |
| 8 | Unstructured logs | Cannot query; must read | LOG-01 |
| 9 | No correlation identifier | Cannot follow one request | TRACE-01 |
| 10 | No regression test | The bug returns | DEBUG-11 |
| 11 | "Be more careful" as an action | Nothing changes | INC-02 |
| 12 | Blame in incident review | Reporting stops | INC-01 |

## 12.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-79** | **Shotgun Debugging** | Changing several things at once to see what helps | One hypothesis at a time |
| **AP-80** | **The Defensive Bandage** | Null checks and try/catch added until the symptom stops | DEBUG-04 |
| **AP-81** | **Print-Statement Archaeology** | Temporary output added, then removed, learning nothing durable | Structured logging that stays |
| **AP-82** | **The Plausible Story** | An explanation that fits and has no evidence | RCA-03 |
| **AP-83** | **Heisenbug Avoidance** | Declaring an intermittent defect unfixable | DEBUG-09; quantify, then instrument |
| **AP-84** | **The Blame Retro** | Incident review that identifies a person | INC-01 |
| **AP-85** | **Log Everything** | So much output that nothing is findable | Levels; LOG-06 |
| **AP-86** | **The Unwritten Fix** | The defect is fixed; nothing is recorded | DEBUG-11, INC-05 |

## 12.8 Decision Tables

### 12.8.1 Reproduce First?

| Situation | Action |
|---|---|
| Production is degraded now | **Mitigate first** (revert), then reproduce |
| Data is being corrupted now | **Stop the process first**, then reproduce |
| A defect is reported but not urgent | Reproduce before anything else |
| It is intermittent | Quantify the frequency; add observability; then reproduce |
| It cannot be reproduced | Add observability until it can. Do not guess |
| It occurs only in production | Add observability; consider a canary or shadow path |

### 12.8.2 How Deep to Analyse?

| Signal | Depth |
|---|---|
| First occurrence, low impact | Mechanism + regression test |
| Second occurrence of the same class | **Root and systemic causes; add a control** |
| Customer-visible | Full incident review |
| Data loss or corruption | Full review + systemic control, regardless of size |
| Security-relevant | Full review + security process (§15) |
| Near miss caught before production | **Still worth a short review** — it reveals a gap that got lucky |

### 12.8.3 Agent Involvement in Debugging

| Step | Agent Role |
|---|---|
| Reproduce | **Good** — generating a reproduction from a description |
| Diagnose | **Assist only** — read-only session, evidence required for each link |
| Blast radius | **Excellent** — exhaustive search for the same pattern |
| Fix | **Assist** — once the human has confirmed the mechanism |
| Regression test | **Excellent** — mechanical once the cause is known |
| Incident review | **Assist** — timeline assembly; the analysis is human |

## 12.9 Checklists

### CHK-12.1 · Debugging

- [ ] Reproduction is reliable and its frequency is known
- [ ] The reproduction is reduced to its smallest failing form
- [ ] The mechanism is written down **before** any code changed
- [ ] Every link in the chain has evidence; inferences are labelled
- [ ] The blast radius has been searched for
- [ ] The fix addresses the cause, not the symptom
- [ ] A regression test fails before and passes after
- [ ] Nothing else broke
- [ ] If this is the second occurrence, a systemic control has been added

### CHK-12.2 · Production Incident

- [ ] **Mitigate first** — revert or disable; diagnose afterwards
- [ ] Impact assessed and communicated
- [ ] Timeline recorded as it happens, not reconstructed
- [ ] Evidence preserved: logs, artifacts, state
- [ ] Root and systemic causes identified
- [ ] Regression test added
- [ ] Review written within 48 hours
- [ ] Actions owned and dated
- [ ] If a user detected it, detection improvement is an action

### CHK-12.3 · Debuggability Review (per feature, T3+)

- [ ] Every failure path produces a classified, logged signal
- [ ] Logs carry a correlation identifier
- [ ] Error logs contain enough to investigate without reproduction
- [ ] No secret or personal data can reach a log
- [ ] Failures are logged once, at the point of classification
- [ ] A production failure here could be understood from artifacts alone

## 12.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Symptom fixed, cause remains | **High** | High | DEBUG-02, DEBUG-04 | Medium |
| Plausible but wrong diagnosis accepted | Medium | High | RCA-03; separate investigation session | Medium |
| Insufficient logging for production diagnosis | Medium | High | CHK-12.3 as a feature gate | Low |
| Secret leaked via logs | Low | **Critical** | LOG-04 sink-level redaction | Low |
| Incident review becomes ceremony | Medium | Medium | INC-03 owned actions; follow-up tracked | Medium |
| Blame culture suppresses reporting | Medium | High | INC-01; leadership modelling | Medium |
| Regression tests deleted during cleanup | Low | High | DEBUG-15 | Low |

## 12.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Standard incident review template | v1.1 | Lowers the cost of doing it properly |
| Defect-class taxonomy with frequencies | v1.2 | Drives DEBUG-14 decisions with data |
| Automated blast-radius search tooling | v1.2 | Pattern search across all repositories |
| Correlation propagation library | v1.1 | Makes TRACE-01 free |

---

# 13. AI Error Recovery

## 13.1 Purpose

To define what to do when an AI agent produces something wrong — how to detect it, how to correct it, how to recover the context that led to it, and how to prevent the same failure from recurring.

Agent errors have distinctive shapes. Recognising them by name makes them fast to detect and fast to correct.

## 13.2 Objectives

1. Define detection techniques for each characteristic agent failure mode.
2. Establish what to do when an agent's assumptions turn out to be wrong.
3. Define when to correct, when to restart, and when to take over.
4. Define rollback procedures specific to agent-produced work.
5. Define context repair when a session has degraded.
6. Convert every agent error into a durable improvement.

## 13.3 Engineering Rationale

### 13.3.1 Agent Errors Are Systematic, Not Random

Because they follow from mechanism (§2.3.2), they are predictable and therefore checkable by name:

| Failure | Detection Signal |
|---|---|
| Fabrication | An identifier that does not exist anywhere in the codebase or its dependencies |
| Wrong-but-idiomatic default | Code matching a common pattern that violates a project rule |
| Specification drift | A rule from the middle of a long spec is absent |
| Silent simplification | A diff that *reduces* branching in a module with deliberate asymmetry |
| Local reasoning | A helper duplicated because the existing one was not in context |
| Test fitting | Tests that pass against the previous commit |
| Recency loss | An early constraint violated after a long exchange |
| Overreach | Files touched that the task did not name |

**Each of these has a mechanical or near-mechanical detector**, which is why §13.4.1 is a checklist rather than an instinct.

### 13.3.2 The Cost of Late Detection

| Detected At | Cost |
|---|---|
| Agent self-check | Minutes |
| Automated checks | Minutes |
| Review | ~30 minutes |
| After merge | Hours + a revert |
| In production | Hours + incident + trust |
| **Never (silent)** | **Unbounded** |

The rightmost column is the reason agent output receives verification proportional to consequence rather than to size (§2.3.3).

### 13.3.3 Correct, Restart, or Take Over

The most common process error in AI-assisted work is correcting repeatedly when restarting or taking over would be faster.

| Situation | Action | Why |
|---|---|---|
| One small misunderstanding | **Correct** | Cheapest |
| Two corrections, converging | **Correct once more** | Still converging |
| Three corrections | **Restart** with an improved prompt | The prompt is the problem (§4.4.1) |
| The approach is fundamentally wrong | **Restart** — the wrong approach is now in context | Correction cannot remove it |
| The agent has fabricated something twice | **Restart** with the real API in context | It will keep fabricating |
| It is a hazard module | **Take over** | It should not have been agent-led (§2.4.3) |
| The task turns out to require judgement | **Take over** | Judgement is not delegable |
| The spec is incomplete | **Stop.** Fix the spec first | Neither correcting nor restarting helps |

### 13.3.4 Context Repair Is Usually Restarting

When a session has degraded, "repairing" it in place rarely works: the wrong information is still present and still influences output. The reliable repair is:

1. Extract what was learned (decisions, rejected approaches, discovered facts) to a file.
2. Start a fresh session.
3. Provide the extracted knowledge as context.

This converts a degraded session into an improved specification, which is the only durable output a failed attempt produces.

## 13.4 Standards

### 13.4.1 Detection

| ID | Rule |
|---|---|
| **REC-01** | Every unfamiliar API, library, function, or configuration key in agent output MUST be verified to exist |
| **REC-02** | Any diff that reduces branching, removes a condition, or merges similar blocks MUST be examined for silent simplification |
| **REC-03** | Every new test MUST be verified to fail against the previous commit |
| **REC-04** | Any file touched that the task did not name MUST be questioned |
| **REC-05** | For a long specification, every rule MUST be traced to its implementation — a checklist, not an impression |
| **REC-06** | Any change to a test, threshold, type, or limit MUST be explicitly justified |

**Detection checklist by failure mode:**

| Failure | Check |
|---|---|
| Fabrication | Search the codebase and dependency documentation for every unfamiliar identifier |
| Wrong default | Is there a project rule about this pattern? Time, randomness, error handling, defaults |
| Spec drift | Rule-by-rule traceability against the specification |
| Silent simplification | Does the diff remove branching? In which module? Why did that branching exist? |
| Local reasoning | Does this duplicate something that already exists? |
| Test fitting | Does each test fail on the parent commit? |
| Recency loss | Are the constraints stated at the start still satisfied? |
| Overreach | Do the files touched match the task? |

### 13.4.2 When Assumptions Are Wrong

| ID | Rule |
|---|---|
| **REC-07** | An agent MUST list its assumptions when reporting a change |
| **REC-08** | An unlisted assumption discovered later MUST be treated as a process failure and added to the prompt template |
| **REC-09** | When an assumption is wrong, the **specification** MUST be corrected, not only the code |
| **REC-10** | The same wrong assumption occurring twice MUST become an explicit rule in the project's standing context |

**Rationale for REC-09.** Fixing only the code leaves the specification ambiguous, so the next implementer — human or agent — makes the same assumption. The specification is the durable artifact.

### 13.4.3 Correction Rules

| ID | Rule |
|---|---|
| **REC-11** | A correction MUST state what is wrong and why, not only what to do instead |
| **REC-12** | After three corrections on one task, the session MUST be restarted with an improved prompt |
| **REC-13** | A correction MUST NOT introduce a new requirement. That is a new task |
| **REC-14** | Where a correction reveals a missing constraint, that constraint MUST be added to the project's standing context |

**Rationale for REC-11.** "No, do it this way" produces compliance without understanding, and the same error recurs in the next task. "That returns an empty list on failure, which makes the failure silent — see the error-handling rule" produces a correction that generalises.

### 13.4.4 Refactoring Agent-Produced Code

| ID | Rule |
|---|---|
| **REC-15** | Agent-produced code MUST meet the same standards as human-produced code. There is no separate bar |
| **REC-16** | Where it is over-engineered, it MUST be simplified before merge, not after |
| **REC-17** | Where it duplicates something existing, the duplicate MUST be removed before merge |
| **REC-18** | Refactoring for style alone MUST NOT be bundled with a behaviour change |
| **REC-19** | A hazard module MUST NOT be refactored by an agent |

**Human Note on REC-16.** Agent output frequently arrives with more structure than the problem needs — extra abstraction layers, options that are never used, defensive handling for conditions that cannot occur. This is easier to remove before merge than after, and removing it is a legitimate and expected part of review rather than a criticism.

### 13.4.5 Rollback

| ID | Rule |
|---|---|
| **REC-20** | Agent-produced changes MUST be revertible independently — one task, one change, one commit |
| **REC-21** | On discovering a defect in agent-produced code in production, **revert first**, diagnose after |
| **REC-22** | Reverting agent work is routine and MUST NOT require justification beyond the symptom |
| **REC-23** | After a revert, the **prompt** must be corrected before the work is re-attempted |
| **REC-24** | Where several agent changes are entangled, the entanglement is the defect — the process violated §3.4's limits |

### 13.4.6 Context Repair

| ID | Rule |
|---|---|
| **REC-25** | A degraded session MUST be replaced, not repaired in place |
| **REC-26** | Before ending a degraded session, what was learned MUST be extracted to a file: decisions, rejected approaches with reasons, discovered facts, open questions |
| **REC-27** | The fresh session MUST receive the extracted knowledge plus the improved prompt |
| **REC-28** | If the same task fails in two fresh sessions, the **specification** is the problem — stop and fix it |

**Rationale for REC-28.** Two independent failures with a clean context is strong evidence that the task, not the agent, is at fault. Continuing to re-attempt is the most expensive possible response.

### 13.4.7 Turning Errors into Improvements

| ID | Rule |
|---|---|
| **REC-29** | Every agent error caught in review SHOULD be recorded with its failure mode |
| **REC-30** | A failure mode occurring twice on one project MUST produce a standing-context rule |
| **REC-31** | A failure mode occurring across projects SHOULD be proposed as a handbook amendment (§29) |
| **REC-32** | Where a failure mode can be detected mechanically, a check MUST be added — that is always cheaper than vigilance |

## 13.5 Real-World Examples

### Example 1 — The Fabricated Method

An agent uses a method on a third-party client that does not exist. It type-checks because the client's type definitions are permissive. Discovered at runtime in staging.

| | |
|---|---|
| Failure mode | Fabrication |
| Detection that would have caught it | REC-01 — verify unfamiliar identifiers against the library's documentation |
| Systemic fix | An integration test exercising the real client for every external call site |

### Example 2 — The Three-Correction Spiral

An engineer corrects an agent five times on one task. Each correction fixes one thing and breaks another. Ninety minutes elapse. A colleague restarts with a rewritten prompt; the correct output arrives in twelve minutes.

| | |
|---|---|
| Failure mode | Accumulated correction; recency loss |
| Rule | REC-12 |
| The lesson | The corrections were treating symptoms of an under-specified prompt |

### Example 3 — The Silent Simplification Caught in Review

A diff removes two conditions from a data-merge module, reducing three branches to one. Tests pass. The reviewer notices the branch reduction, asks why the branches existed, and finds a comment explaining a deliberate asymmetry.

| | |
|---|---|
| Failure mode | Silent simplification |
| Rules | REC-02, and CODE-25 (the comment that saved it) |
| What made the catch possible | The comment. Without it, the reviewer would have had no reason to question a simplification |

### Example 4 — The Assumption That Became a Rule

An agent assumes an identifier is globally unique. It is unique per tenant. Caught in review. The team corrects the code, corrects the specification, **and** adds a line to the project's standing context: "identifiers are unique per tenant, never globally".

| | |
|---|---|
| Rules | REC-09, REC-10 |
| Why the third step matters | Without it, the next agent session makes the same assumption |

## 13.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Correcting instead of restarting | Compounding confusion | REC-12 |
| 2 | Correcting the code, not the spec | The same error recurs | REC-09 |
| 3 | Accepting fabricated APIs | Runtime failure | REC-01 |
| 4 | Not questioning branch reduction | Silent behaviour change | REC-02 |
| 5 | Bundling style refactors with fixes | Unreviewable diff | REC-18 |
| 6 | Debugging forward instead of reverting | Extended incident | REC-21 |
| 7 | Repairing a degraded session in place | Same errors persist | REC-25 |
| 8 | Not recording failure modes | The team never learns | REC-29 |
| 9 | Vague corrections | Compliance without understanding | REC-11 |
| 10 | Letting an agent refactor a hazard module | The highest-risk operation available | REC-19 |

## 13.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-87** | **The Correction Spiral** | Twelve corrections on one task | REC-12 |
| **AP-88** | **Blind Acceptance** | Merging because it compiles and tests pass | §2's review rules |
| **AP-89** | **The Undocumented Assumption** | An assumption never surfaced, discovered in production | REC-07 |
| **AP-90** | **Agent Blame** | Treating an agent error as the agent's fault rather than a process signal | §2.3.7 |
| **AP-91** | **The Entangled Revert** | Cannot revert one agent change without reverting four | REC-20, REC-24 |
| **AP-92** | **Lesson Evaporation** | The same error caught repeatedly, never recorded | REC-29, REC-30 |

## 13.8 Decision Tables

### 13.8.1 Correct, Restart, or Take Over?

| Signal | Action |
|---|---|
| First correction, small misunderstanding | Correct |
| Second correction, converging | Correct |
| Third correction | **Restart** |
| Fabrication occurred twice | **Restart** with real API documentation in context |
| The approach is wrong at its root | **Restart** |
| A hazard module is involved | **Take over** |
| Judgement is required | **Take over** |
| Two fresh sessions both failed | **Stop.** Fix the specification |
| The specification is ambiguous | **Stop.** Fix the specification |

### 13.8.2 Revert or Fix Forward (agent-produced code)?

| Situation | Action |
|---|---|
| In production, causing user impact | **Revert** |
| In production, no user impact, cause understood | Fix forward with review |
| In staging | Fix forward |
| Merged, not deployed, defect is large | Revert |
| Merged, not deployed, defect is one line and understood | Fix forward |
| Entangled with other changes | Revert the whole set; then re-do properly in separate changes |

### 13.8.3 Which Failure Mode Is This?

| Observation | Likely Mode | First Check |
|---|---|---|
| Runtime error on an unknown method | Fabrication | Does the identifier exist? |
| Behaviour differs from the spec in one detail | Spec drift | Rule-by-rule traceability |
| Fewer branches than before | Silent simplification | Why did those branches exist? |
| A duplicate helper | Local reasoning | Search for existing equivalents |
| Tests pass on the parent commit | Test fitting | Rewrite tests from the spec |
| An early constraint violated | Recency loss | Restart with the constraint restated |
| Extra files changed | Overreach | Remove; re-scope |
| Non-deterministic test failures | Injected time or randomness missing | Check for direct clock/random access |

## 13.9 Checklists

### CHK-13.1 · Reviewing Agent Output for Characteristic Errors

- [ ] Every unfamiliar identifier verified to exist
- [ ] No branch, condition, or check removed without explanation
- [ ] Every new test fails on the parent commit
- [ ] No file touched outside the task's scope
- [ ] Every rule in the specification traced to its implementation
- [ ] No test, threshold, type, or limit weakened
- [ ] No time, randomness, or environment read directly in logic
- [ ] Assumptions listed and each one checked
- [ ] Nothing returns empty or null on failure

### CHK-13.2 · Recovering From a Failed Session

- [ ] Decisions extracted to a file
- [ ] **Rejected approaches recorded with reasons**
- [ ] Discovered facts recorded
- [ ] Open questions recorded
- [ ] The prompt improved — the specific gap identified
- [ ] Fresh session started with the extracted knowledge
- [ ] If this is the second fresh-session failure: **stop and fix the specification**

### CHK-13.3 · After an Agent Error Reaches Merge

- [ ] Reverted or fixed, per §13.8.2
- [ ] Failure mode identified by name
- [ ] Specification corrected, not only the code
- [ ] Standing context updated if it will recur
- [ ] A mechanical check added if one is possible
- [ ] Regression test added
- [ ] If it occurred across projects, a handbook amendment proposed

## 13.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Silent simplification reaches production | Medium | **Critical** | REC-02, CODE-25 comments, hazard modules, property tests | **Medium** |
| Fabricated API reaches production | Medium | High | REC-01; integration tests on external calls | Low |
| Correction spiral wastes time | High | Low | REC-12 | Low |
| Lessons not captured | High | Medium | REC-29, REC-30 | Medium |
| Entangled changes prevent clean revert | Medium | High | REC-20; size limits | Low |
| Specification stays ambiguous after a correction | High | Medium | REC-09 | Medium |
| Over-correction discourages agent use | Low | Medium | Failure modes are named and bounded, not general distrust | Low |

## 13.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Automated "fails on parent commit" check | v1.2 | Detects test fitting mechanically |
| Branch-reduction detector in diffs | v1.2 | Flags candidate silent simplifications for review |
| Identifier-existence verification tooling | v1.1 | Detects fabrication before review |
| Failure-mode telemetry | v1.2 | Which modes actually occur, at what rate, per model |
| Standing-context linting | v1.2 | Detect rules that contradict each other as they accumulate |

---

*End of Part 7. Part 8 covers documentation and security — the two disciplines whose absence is invisible until it is very expensive.*
