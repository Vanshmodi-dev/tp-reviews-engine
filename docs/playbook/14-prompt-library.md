# Part 14 — The Prompt Library

*Section 26. Fourteen reusable templates covering the work TradyPerch actually does. Using a template is the default; writing a prompt from scratch is the exception that requires a reason.*

---

# 26. Prompt Library

## 26.1 Purpose

To make a well-formed prompt the path of least effort, so that prompt quality does not depend on who is at the keyboard or how tired they are — and so that improvements discovered by one person propagate to everyone.

## 26.2 Objectives

1. Provide a template for each recurring task type.
2. Encode §3's seven-block structure into every template so it cannot be forgotten.
3. Encode the constraints that agents most often violate, so they are stated every time.
4. Make templates improvable: they are version-controlled, and lessons are folded back in.
5. Reduce the cost of doing it properly to below the cost of improvising.

## 26.3 Engineering Rationale

### 26.3.1 Why a Library Rather Than Guidance

Guidance is applied inconsistently. A template is applied identically. The difference matters because the failure modes §3 exists to prevent — a missing constraints block, no out-of-scope statement, unverifiable acceptance criteria — are *omissions*, and omissions are exactly what a template prevents.

**The economic argument:** writing a good prompt from scratch takes ten to fifteen minutes. Filling a template takes three to five. If the template is not faster, nobody uses it, and the library fails. Every template below is written to be filled in, not read.

### 26.3.2 Templates Encode Institutional Learning

Each constraint in a template exists because something went wrong once. "If you find a bug while refactoring, report it, do not fix it" is in the refactoring template because a refactor once bundled a behaviour change that nobody noticed.

**This makes the library the fastest-moving part of the handbook** (§0.8.2 sets a quarterly review), and it means additions should come from incidents rather than from theory.

### 26.3.3 What Templates Do Not Do

| Templates do not | Because |
|---|---|
| Replace understanding the task | An empty specification block is still an empty specification |
| Make an unclear requirement clear | Garbage in, confident garbage out |
| Remove the need for review | §2's rules are unaffected |
| Substitute for planning at T3+ | A task prompt implements a plan; it does not replace one |

## 26.4 How to Use the Library

| Rule | Statement |
|---|---|
| **LIB-01** | Start from a template. Writing from scratch requires a reason |
| **LIB-02** | Fill every block. An empty block means the task is not ready |
| **LIB-03** | Delete what does not apply — but delete deliberately, not by omission |
| **LIB-04** | Add project-specific constraints from the standing context; do not restate the whole file |
| **LIB-05** | When a template produces a bad outcome, improve the **template**, and say why in the commit |
| **LIB-06** | Templates are version-controlled and reviewed like code |

**Placeholder convention:** `<angle brackets>` are to be replaced. Lines beginning `#` are guidance to the person filling it in and should be deleted before sending.

---

## 26.5 The Templates

### TMPL-IMPL-01 · Feature Implementation

*The most-used template. Covers any task that adds specified behaviour.*

```
TASK
Implement <one specific outcome, one sentence>.

CONTEXT
Project: <name> · Tier: <T1–T4> · Supervision: <S1–S5>
Module: <path>
This module is responsible for <one sentence>.
Upstream: <what calls it>  Downstream: <what it calls>
# If this is a hazard module, STOP — this template does not apply.

SPECIFICATION
Authority: <document> §<n>  (provided below / attached)
Rules governing this task:
  1. <rule, with exact values>
  2. <rule, with exact values>
Boundary behaviour: <what happens exactly at each threshold>
Failure behaviour: <what happens for each failure case>
# Every threshold is a number. "Reasonable" is not a specification.

CONSTRAINTS
- Follow the existing pattern in <exemplar file>; introduce no new pattern
- Error handling: <project mechanism>. Never swallow; never return empty on failure
- Do not add any dependency
- Do not read the clock, randomness, or environment in logic — inject them
- Do not use <any project-specific prohibition that applies here>
- Formatting and style: the formatter and linter are authoritative

ACCEPTANCE
This is done when:
- <testable statement>
- <testable statement>
- Tests exist for: happy path, each failure path, each boundary, empty/degenerate input
- Each new test fails against the current commit
- Full local verification passes

OUT OF SCOPE
- Do not modify <adjacent module>, even though <known issue>
- Do not change <interface / schema / config>
- Do not refactor anything

OUTPUT
- Modify: <files>
- Add: <files>
- Tests: <location>, named <convention>
- Report: what you implemented, what you verified and how, assumptions, uncertainties,
  and anything you noticed but did not change
```

### TMPL-BUG-01 · Bug Investigation (read-only)

*Diagnosis only. No code changes. The single highest-value template in the library.*

```
TASK
Investigate: <symptom>. Do not modify any file.

CONTEXT
Reported: <where, when, by whom>
Reproduces: <reliably / intermittently at ~N% / not yet reproduced>
Environment: <where it occurs>
Started after: <change, if known>
Already ruled out: <what has been checked>

EVIDENCE PROVIDED
<logs, stack traces, inputs, timings — attached or inline>

WHAT I NEED
1. The mechanism, as a causal chain: symptom ← immediate cause ← root cause
2. The specific file and line where it originates
3. Evidence for each link — distinguish clearly what you OBSERVED from what you INFERRED
4. Blast radius: does the same defect or cause exist elsewhere in the codebase?
5. Your confidence, and what evidence would raise it

CONSTRAINTS
- Read only. Change nothing. Propose no fix in this session
- If the evidence is insufficient, say so and state what would settle it
- Do not offer a plausible story in place of evidence
- Do not stop at the first candidate — check whether it fully explains the symptom

OUTPUT
1. Mechanism
2. Evidence, with observation and inference labelled separately
3. Blast radius
4. Confidence and what would raise it
```

### TMPL-BUG-02 · Bug Fix

*Only after TMPL-BUG-01 has produced a confirmed mechanism.*

```
TASK
Fix: <symptom>, whose mechanism is <one sentence, confirmed>.

CONTEXT
Investigation: <link or summary>
Confirmed mechanism: <the causal chain>
Root cause: <what must change to prevent recurrence>
Blast radius: <other affected locations, or "none found">

SPECIFICATION
Correct behaviour: <what should happen instead, precisely>
The fix must address the CAUSE, not mask the symptom.

CONSTRAINTS
- Write the regression test FIRST; confirm it fails
- Smallest change that addresses the cause
- Do not add defensive checks that hide the failure
- Do not refactor surrounding code
- If the blast radius includes other locations, list them — do not fix them here

ACCEPTANCE
- A regression test reproduces the defect and fails before the fix
- The same test passes after the fix
- No other test breaks
- The test references <issue id>

OUT OF SCOPE
- Other instances of the same defect (list them; separate changes)
- Any adjacent improvement

OUTPUT
- The regression test, then the fix
- Report: the mechanism, why this fix addresses the cause, and any other
  locations you found with the same defect
```

### TMPL-REFACTOR-01 · Refactoring

```
TASK
Refactor: <specific structural change> in <file/module>.
Goal: <make X easier / remove duplication of Y / meet limit Z>.
BEHAVIOUR MUST NOT CHANGE.

CONTEXT
Current structure: <what it is>
Why it needs to change: <the change this enables, or the limit it violates>
Test coverage: <adequate / inadequate>
# If coverage is inadequate: STOP. Characterisation tests first, as a separate task.

CONSTRAINTS
- **Pure refactor.** No behaviour change of any kind
- No new files unless stated; no signature changes to <public surface>
- All existing tests must pass **unchanged**
- The diff must contain no new conditional and no changed conditional
- **If you find a bug, STOP and report it. Do not fix it in this change**
- Do not rename anything not named in the task
- Do not "improve" anything beyond the stated goal

ACCEPTANCE
- All existing tests pass, unmodified
- The stated structural goal is met
- Each extracted unit has one responsibility named in its identifier
- No conditional added, removed, or altered

OUT OF SCOPE
Everything not named above.

OUTPUT
- The refactored code
- Report: what moved where, confirmation that no conditional changed,
  and any bug you found and did NOT fix
```

### TMPL-TEST-01 · Test Writing

*Note the constraint that defines this template: do not read the implementation.*

```
TASK
Write <unit / integration / property> tests for <subject>, against the specification below.
**Do not read the implementation.**

SPECIFICATION
<the rules, in full, with exact values>
# The specification is the ONLY input. If it is incomplete, that is the finding.

CONSTRAINTS
- Derive every test from the specification. Do not open the implementation file
- Use the existing test builders in <path>
- Inject clock and randomness; no real time, no real randomness
- One logical assertion per test
- Full-sentence names describing behaviour
- No shared mutable state between tests
- No network access

ACCEPTANCE
- Every rule has at least one test that would fail if that rule were removed
- Boundary values tested exactly at, one below, and one above each threshold
- Every failure path covered
- Empty, single-element, and maximum-size cases covered
- Each test fails against the current commit

OUTPUT
- Tests only. No implementation changes
- Report: any rule that was ambiguous or unimplementable as written — list these
  rather than guessing
```

### TMPL-DOC-01 · Documentation

```
TASK
Write/update <document type> for <subject>.

CONTEXT
Reader: <who>
Moment: <when they read it — first contact / during a change / during an incident>
Question they need answered: <one sentence>
Existing documentation: <what exists, what is wrong with it>

CONSTRAINTS
- Write for the stated reader at the stated moment
- Tables and lists over prose; optimise for scanning, not reading
- Explain WHY for decisions; the code says what
- State what the thing does NOT do
- Every example must be real and verified to work
- Do not duplicate content that exists elsewhere — link to it
- Concrete numbers, not adjectives

ACCEPTANCE
- The stated reader could answer their question from this alone
- Every command and example has been verified
- Nothing is duplicated from another document
- Stale content in the existing document is corrected or deleted

OUTPUT
- The document
- Report: anything you found that was already wrong, and whether you corrected it
```

### TMPL-ARCH-01 · Architecture Review

```
TASK
Review the design below against the criteria listed. Do not propose a rewrite.

DESIGN
<summary, or link, plus the key diagrams and decisions>

CONTEXT
Constraints: <team size, timeline, budget, operational capacity>
Quality attributes, ranked: <e.g. reliability > simplicity > cost > latency>
Expected scale: <now, and in 12 months>
Fixed decisions: <technology or approach that is not up for debate>

CRITERIA
1. Where does this fail at 10× current scale?
2. Which component's failure has the largest blast radius?
3. What is the hardest thing to change later?
4. Which decisions are reversible, and which are effectively permanent?
5. What would a reviewer biased toward simplicity delete?
6. What operational burden does this create, and who carries it?
7. Which stated quality attribute is this design weakest on?

CONSTRAINTS
- Judge against the stated constraints and ranked attributes, not best practice in the abstract
- Assume the fixed decisions are fixed
- Do not propose replacing the approach; propose improving it
- Distinguish "this will fail" from "this is not how I would do it"

OUTPUT
- One paragraph per criterion
- End with: the single change you would make if you could make only one, and why
```

### TMPL-SEC-01 · Security Review

```
TASK
Security review of <change / component / feature>.

CONTEXT
What it does: <summary>
Trust boundaries: <where untrusted data enters>
Data handled: <types; note any personal or sensitive data>
Who can reach it: <authenticated / public / internal>
Tier: <T1–T4>

REVIEW AGAINST
1. Secrets: any credential, token, or key in code, config, logs, or tests?
2. Authentication: how is identity established? Can it be bypassed?
3. Authorisation: is it checked at OBJECT level, not only route level? Does it default to deny?
4. Input: is all external input validated at the boundary? Rejected rather than sanitised?
5. Injection: query construction, shell execution, path building, log format strings
6. Output: is untrusted content encoded for its context at the point of use?
7. Failure: does anything fail OPEN? Any fallback that reduces security?
8. Data exposure: can this return data the caller should not see? Cache keys scoped?
9. Rate limiting: are expensive or sensitive operations limited?
10. Dependencies: anything new? Install scripts? Known advisories?
11. Logging: can a secret or personal data reach a log?

CONSTRAINTS
- Assume the attacker knows the design
- Assume any client-side control is bypassed
- Report findings by severity with the specific attack path
- Distinguish confirmed issues from things worth checking

OUTPUT
- Findings: severity, location, attack path, recommended control
- Explicit statement of what you checked and found clean
- Anything you could not assess and why
```

### TMPL-PERF-01 · Performance Work

```
TASK
Investigate and improve performance of <specific operation>.

CONTEXT
Current measurement: <p50 / p95 / p99, under what load, measured how>
Budget: <the stated target>
When it degrades: <conditions>
Recent changes: <anything that might correlate>

CONSTRAINTS
- MEASURE FIRST. Identify where the time actually goes before changing anything
- Report the measurement before proposing a change
- Prefer the simplest fix: index, batch, limit, remove work — before caching or restructuring
- Do not introduce a cache without stating: staleness tolerance, invalidation, cold-cache behaviour
- Any cache key for scoped data must include the scope
- Verify the improvement by re-measuring
- Do not optimise anything not identified by the measurement

ACCEPTANCE
- The bottleneck is identified with evidence
- The change measurably improves the stated budget
- No behaviour change
- No new correctness risk introduced
- Before and after numbers are recorded in the change

OUTPUT
1. Where the time goes (measured)
2. Proposed change and why it is the simplest sufficient one
3. The change
4. Re-measurement
```

### TMPL-MIG-01 · Migration or Upgrade

```
TASK
Migrate <from> to <to>.

CONTEXT
Current state: <version, usage, scope>
Target state: <version, what changes>
Why: <the driver>
Consumers affected: <who, and how they are notified>

CONSTRAINTS
- Every step must be independently deployable and reversible
- Old and new must coexist during the transition
- No behaviour change beyond the migration itself
- Schema changes must be backward-compatible with currently deployed code
- No feature additions bundled in
- State the rollback for each step before performing it

ACCEPTANCE
- Each step passes the full suite independently
- Behaviour parity demonstrated, not assumed
- The rollback path for each step is stated and tested
- Consumers notified before any breaking step

OUTPUT
- The step-by-step plan first, for approval, BEFORE any change
- Then implement one step per change
- Report per step: what changed, how parity was verified, how to roll back
```

### TMPL-REVIEW-01 · Code Review Assistance

*An agent assisting a human reviewer — it does not replace the human.*

```
TASK
Review the change below. You are assisting a human reviewer, not replacing them.

CHANGE
<diff or PR link>

SPECIFICATION
<what this change is supposed to do>

REVIEW FOR
1. Does it do what the specification says? Trace each rule to its implementation
2. Any failure path unhandled, or handled silently?
3. Any test weakened, skipped, or deleted?
4. Any identifier used that does not exist?
5. Any branch or condition removed? Why did it exist?
6. Any change outside the stated scope?
7. Any secret, credential, or personal data?
8. Any clock, randomness, environment, or global state read from logic?
9. Any unbounded query, loop, retry, or wait?
10. Any prohibited pattern from the project's forbidden list?

CONSTRAINTS
- Report findings; do not fix anything
- Distinguish "this is wrong" from "I would have done it differently"
- Cite the specification or rule for each finding
- If you cannot verify something, say so rather than assuming it is fine

OUTPUT
- Findings by severity, each citing a rule or specification line
- What you checked and found clean
- What you could not assess
```

### TMPL-DEP-01 · Dependency Update

```
TASK
Update <dependency> from <current> to <target>.

CONTEXT
Reason: <security advisory / feature needed / routine>
Usage: <where and how it is used in this codebase>
Breaking changes upstream: <from the changelog>

CONSTRAINTS
- Read the upstream changelog for every version between current and target
- Report breaking changes BEFORE making the update
- Do not bundle unrelated changes
- Do not update other dependencies in the same change
- Lockfile must be updated and committed

ACCEPTANCE
- Full suite passes
- Dependency audit clean
- Every upstream breaking change is either not applicable or explicitly handled
- Behaviour unchanged, or changes are documented

OUTPUT
- Report upstream breaking changes first
- Then the update
- Report: what changed upstream, what we had to adapt, what to watch after deploy
```

### TMPL-SCAFFOLD-01 · Project or Module Scaffolding

```
TASK
Create the initial structure for <project / module>.

CONTEXT
Type: <backend service / web app / CLI / library / extension / …>
Tier: <T1–T4>
Purpose: <one sentence>

SPECIFICATION
Structure: follow the reference shape for this project type
Required root files: <per the repository standard for this tier>
Standing agent context file: required, listing conventions and hazard modules

CONSTRAINTS
- No business logic — structure only
- No dependencies beyond those explicitly listed
- Every directory governed by a rule gets a README stating that rule
- Configuration validated at startup; no hardcoded environment values
- `.gitignore` and `.gitattributes` are the FIRST commit

ACCEPTANCE
- Structure matches the reference shape
- Lint, format, and type check run clean on the empty tree
- A trivial test runs and passes
- CI configured and green
- Standing context file present

OUTPUT
- The structure, with directory READMEs
- Report: what you created and what a developer must do next
```

### TMPL-INCIDENT-01 · Incident Assistance

```
TASK
Assist with an active incident. Analysis only — propose, do not act.

SITUATION
Symptom: <what users experience>
Started: <time>
Scope: <who is affected, how many>
Recent changes: <deployments, config changes, dependency changes in the last 24h>
Current state: <what has been tried>

EVIDENCE
<logs, metrics, alerts, timeline>

WHAT I NEED
1. Most likely cause, with the evidence supporting it
2. Alternative hypotheses, with what would distinguish them
3. The fastest mitigation — usually a revert. Is it safe here?
4. What to check next, in order of information gained per minute
5. Anything that would make this worse

CONSTRAINTS
- Mitigation first. Diagnosis can follow
- Do not change anything. Propose; a human acts
- Say clearly what is observed and what is speculation
- If a revert is available and safe, say so first
- Do not offer a confident narrative without evidence

OUTPUT
1. Recommended immediate action
2. Most likely cause and its evidence
3. Alternatives and how to distinguish them
4. Next checks, ordered
```

---

## 26.6 Template Selection

| Need | Template |
|---|---|
| Build specified behaviour | TMPL-IMPL-01 |
| Understand a failure | TMPL-BUG-01 |
| Fix a diagnosed failure | TMPL-BUG-02 |
| Change structure, not behaviour | TMPL-REFACTOR-01 |
| Add tests | TMPL-TEST-01 |
| Write or fix documentation | TMPL-DOC-01 |
| Evaluate a design | TMPL-ARCH-01 |
| Security review | TMPL-SEC-01 |
| Performance work | TMPL-PERF-01 |
| Version or platform migration | TMPL-MIG-01 |
| Assist a code review | TMPL-REVIEW-01 |
| Update a dependency | TMPL-DEP-01 |
| Start a project or module | TMPL-SCAFFOLD-01 |
| Active incident | TMPL-INCIDENT-01 |

## 26.7 Real-World Examples

### Example 1 — The Template That Caught the Gap

An engineer fills TMPL-IMPL-01 for a pricing rule. At the "boundary behaviour" line they realise nobody has decided what happens exactly at the threshold. They ask before prompting. The answer changes the implementation.

| | |
|---|---|
| The value | The template surfaced a specification gap before any code existed |
| The general point | A template's blank fields are a checklist for the *specification*, not just the prompt |

### Example 2 — Read-Only Investigation

A production defect is investigated with TMPL-BUG-01. The agent reports that the most obvious candidate does not fully explain the symptom and identifies a second contributing factor. A fix targeting only the first would have left the defect partially present.

| | |
|---|---|
| Why it worked | "Do not stop at the first candidate" and "distinguish observed from inferred" |
| Counterfactual | A combined investigate-and-fix prompt would have produced a patch for the first candidate |

### Example 3 — The Refactor Constraint That Paid Off

TMPL-REFACTOR-01's "if you find a bug, report it, do not fix it" triggers. The agent reports an off-by-one in an adjacent branch. It is fixed in a separate change with its own regression test, and both changes remain reviewable.

| | |
|---|---|
| The value | The refactor stayed verifiable as behaviour-preserving |
| Without the constraint | A refactor diff containing a silent behaviour change |

### Example 4 — Tests Without the Implementation

TMPL-TEST-01 is used with the implementation deliberately withheld. Two of eleven specified rules turn out to be ambiguous, and the agent lists them rather than guessing. Both ambiguities were also present in the implementation, which had silently resolved them differently.

| | |
|---|---|
| Rule | The "do not read the implementation" constraint |
| The finding | The tests found a defect the implementation had encoded as behaviour |

## 26.8 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Template blocks left empty | The omission the block existed to prevent | LIB-02 |
| 2 | Specification block filled with a link and nothing else | The agent works from a summary | Attach the content |
| 3 | Adjectives instead of numbers in the specification | Plausible wrong thresholds | Concrete values |
| 4 | Out-of-scope block skipped | Bundled unrequested changes | Always state what not to touch |
| 5 | Combining investigation and fix | A patch for the first plausible cause | TMPL-BUG-01 then TMPL-BUG-02 |
| 6 | Giving the implementation to the test template | Tests describe the code | Withhold it |
| 7 | Templates copied into a chat and then edited ad hoc | Drift; lessons not captured | LIB-05, LIB-06 |
| 8 | Using TMPL-IMPL-01 for a hazard module | Highest-risk change under the lowest supervision | Check the standing context first |

## 26.9 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-164** | **Template Cargo Cult** | Blocks filled with placeholder text to satisfy the form | LIB-02; review the prompt as you would a spec |
| **AP-165** | **The Frankenprompt** | Three templates merged into one enormous request | One task, one template |
| **AP-166** | **The Private Template** | An improved template kept in one person's notes | LIB-06 |
| **AP-167** | **Template Rot** | Templates unchanged after repeated failures | LIB-05; quarterly review |

## 26.10 Checklist

### CHK-26.1 · Before Sending a Templated Prompt

- [ ] Correct template for the task type
- [ ] Every block filled or deliberately deleted
- [ ] The specification is content, not a reference to content
- [ ] Every threshold is a number with stated boundary behaviour
- [ ] Every failure case has stated behaviour
- [ ] Constraints include the project-specific rules that apply here
- [ ] Out-of-scope names the adjacent things not to touch
- [ ] Acceptance criteria are checkable by someone else
- [ ] Expected output within size limits
- [ ] No secrets, no real personal data
- [ ] Not a hazard module — or supervision is S5 and this is tests only

## 26.11 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Templates filled mechanically without thought | Medium | Medium | LIB-02; review the prompt like a spec | Medium |
| Templates drift from practice | Medium | Medium | LIB-05, LIB-06; quarterly review | Low |
| Wrong template for the task | Low | Medium | §26.6 selection table | Low |
| Library grows unwieldy | Medium | Low | Fourteen is near the practical limit; consolidate before adding | Low |
| Templates give false confidence | Medium | Medium | Templates do not replace review (§26.3.3) | Medium |

## 26.12 Future Improvements

| Item | When | Note |
|---|---|---|
| Templates as editor snippets and CLI scaffolds | v1.1 | Reduce filling cost further |
| Per-project template extensions | v1.1 | Project constraints pre-filled from the standing context |
| Prompt linting for empty or placeholder blocks | v1.2 | Enforces LIB-02 |
| Outcome tracking per template | v1.2 | Which templates correlate with clean first-pass results |

---

*End of Part 14. Part 15 defines the gates that work must pass, and the metrics by which engineering is measured.*
