# Part 2 — Prompting and Context

*Sections 3 and 4. These two disciplines determine whether §2's safety rules are achievable in practice. A perfect verification culture applied to output produced from a bad prompt is expensive rework; a well-formed prompt with managed context removes most of the defects before they exist.*

---

# 3. Prompt Engineering Standards

## 3.1 Purpose

To make the quality of AI-generated code a function of a repeatable process rather than of who happened to write the prompt. A prompt is a specification handed to a very fast implementer with no memory and no stake in the outcome. Vague specifications produce confident, plausible, wrong implementations — and they produce them quickly enough that several land before anyone notices the pattern.

## 3.2 Objectives

1. Define a standard prompt structure that every task prompt follows.
2. Establish size limits for scope, input, and output, with rationale.
3. Define token and context budgeting so that specification detail is never crowded out.
4. Provide templates that make a good prompt the path of least effort.
5. Establish what a prompt must *never* contain.
6. Make the difference between good and bad prompts concrete through side-by-side examples.

## 3.3 Engineering Rationale

### 3.3.1 A Prompt Is a Specification, and It Is Reviewable

The single most useful reframing: **the prompt is the requirements document for that change.** Everything true of a good requirements document is true of a good prompt.

| Requirements Document Property | Prompt Equivalent |
|---|---|
| States the outcome, not the implementation | Say what must be true when done, not how to type it |
| Bounded in scope | One task |
| States acceptance criteria | "This is done when…" |
| States constraints explicitly | Purity, error handling, dependency rules, patterns to follow |
| Names the authority | The spec section, the file, the ticket |
| States what is out of scope | Prevents overreach (AI-N8) |
| Is reviewable by a second person | If a colleague could not implement from it, an agent cannot either |

**The corollary is the most useful heuristic in this section:** *if you cannot write the prompt, you do not yet understand the task.* Time spent making the prompt precise is not overhead; it is the design work, done in the cheapest medium available.

### 3.3.2 Why Structure Beats Eloquence

Agents respond to structure more reliably than to prose. A structured prompt:

- makes omissions visible — an empty "Constraints" heading is obviously wrong, a missing sentence in a paragraph is not;
- survives context compaction better, because headings are anchors;
- is diffable, so a failed prompt can be improved rather than rewritten;
- is reusable as a template;
- and separates the immutable (constraints) from the variable (the task), which is what makes templates possible.

### 3.3.3 Why Size Limits Exist

Three independent reasons, all of which bite at different sizes:

| Reason | Bites At | Mechanism |
|---|---|---|
| **Specification drift** | Long specs in one prompt | Attention over a long context is not uniform; middle rules get dropped (§2.3.2) |
| **Review capacity** | Large diffs | Reviewer attention degrades sharply past a few hundred lines; defect detection falls off a cliff |
| **Blast radius** | Many files | A change touching many modules cannot be reverted cleanly, and its failure is harder to attribute |

Note that these limits are not about model capability. A capable model can hold a large specification. The limits exist because **the human verification step cannot scale with the generation step**, and verification is the binding constraint (§1.3.1).

### 3.3.4 Context Is a Budget, Not a Container

Every token of context competes with every other token. Filling a window with "helpful" background actively degrades output by:

- diluting the specification that actually governs the task;
- introducing patterns from unrelated modules that the agent may imitate;
- increasing the chance of instruction-recency effects dropping an early constraint;
- and raising cost and latency for no benefit.

**The correct mental model is a budget with line items**, not a bucket to fill.

## 3.4 Standards

### 3.4.1 The Standard Prompt Structure

Every task prompt MUST contain these seven blocks, in this order. Blocks may be brief; none may be absent.

| # | Block | Contains | Why It Is Mandatory |
|---|---|---|---|
| 1 | **TASK** | One sentence: the outcome required | Forces scope to one thing |
| 2 | **CONTEXT** | Where this fits: the module, the project, why it is needed | Prevents locally-correct, globally-wrong solutions |
| 3 | **SPECIFICATION** | The authoritative rules, or a precise pointer to them | This is the requirement. Everything else is support |
| 4 | **CONSTRAINTS** | Patterns to follow, patterns forbidden, dependency rules, purity, error handling | Where project-specific rules go; the block agents most need |
| 5 | **ACCEPTANCE** | "This is done when…" — testable statements | Turns opinion into verification |
| 6 | **OUT OF SCOPE** | Explicitly what not to touch | The direct countermeasure to overreach (AI-N8) |
| 7 | **OUTPUT** | What to produce: which files, what tests, what the PR should say | Removes ambiguity about the deliverable |

### 3.4.2 Size Limits

| Dimension | Limit | Hard Ceiling | Rationale |
|---|---|---|---|
| **Tasks per prompt** | **1** | 1 | Non-negotiable. Two tasks produce an unreviewable diff |
| **Specification input** | One document section, or ≤ ~6 pages | 10 pages | Beyond this, drift risk rises sharply |
| **Files provided as context** | ≤ 5, plus the target | 10 | More than this and the agent imitates rather than implements |
| **Total context used** | **≤ 40% of the window** | 60% | Leaves room for iteration, tool output, and the agent's own reasoning |
| **Expected output** | ≤ 400 lines of diff | 600 | Review capacity, not model capacity |
| **Files touched** | ≤ 5 | 10 | Blast radius and revertability |
| **New public interfaces** | ≤ 2 | 3 | More than this is a design task, not an implementation task |
| **Session length** | ≤ 2 hours or one task | See §4 | Recency effects accumulate |

| ID | Rule |
|---|---|
| **PRM-01** | One task per prompt. MUST. |
| **PRM-02** | If the expected output exceeds 400 diff lines, the task MUST be split before starting, not after |
| **PRM-03** | Context usage MUST stay under 60% of the window; above 40% the agent SHOULD flag it |
| **PRM-04** | A prompt MUST cite its authority — a spec section, a ticket, a file. "As discussed" is not an authority |
| **PRM-05** | A prompt MUST state acceptance criteria that are checkable without asking the author |
| **PRM-06** | A prompt MUST state what is out of scope when adjacent code is imperfect |

### 3.4.3 What a Prompt Must Never Contain

| ID | Prohibition | Why |
|---|---|---|
| **PRM-N1** | Real secrets, tokens, keys, credentials, or production connection strings | They may be logged, retained, or echoed. Treat every prompt as potentially recorded |
| **PRM-N2** | Real customer personal data | Use synthetic data. Always |
| **PRM-N3** | "Do whatever you think is best" for anything above S1 | Delegates judgement that cannot be delegated (§2) |
| **PRM-N4** | "Make it production-ready" without defining what that means | Unverifiable, therefore unmergeable (T-D) |
| **PRM-N5** | "Fix all the issues you find" | Unbounded scope; guarantees an unreviewable diff |
| **PRM-N6** | Contradictory constraints | The agent will silently pick one. State the precedence instead |
| **PRM-N7** | An entire codebase pasted as context | AP-12. Provide contracts, not implementations |
| **PRM-N8** | Instructions to bypass a project rule "just this once" | If the rule is wrong, amend it (§29). If it is right, follow it |

### 3.4.4 Token Management

| Line Item | Typical Share | Guidance |
|---|---|---|
| Standing project rules (constraints, conventions) | 10–15% | Keep in a project instructions file, not re-pasted each time |
| Task specification | 20–30% | The largest single item. Never compress this to make room for something else |
| Code context (target + direct contracts) | 15–25% | Contracts and signatures, not full implementations of dependencies |
| Test context | 5–10% | The test file being satisfied, if it exists |
| Working headroom | **≥ 40%** | Iteration, tool output, reasoning. **Do not consume this** |

| ID | Rule |
|---|---|
| **TOK-01** | Standing rules SHOULD live in a project instructions file that the tool loads automatically, not in each prompt |
| **TOK-02** | Dependencies SHOULD be provided as contracts (names, inputs, outputs, errors) rather than full source |
| **TOK-03** | When headroom falls below 40%, the agent SHOULD finish the current step, summarise, and start a fresh session (§4) |
| **TOK-04** | Specification detail MUST NOT be trimmed to fit. Split the task instead |

**Rationale for TOK-04.** Trimming the spec to fit more code context is exactly backwards: it removes the requirement to make room for examples of unrelated requirements.

## 3.5 Prompt Templates

Templates are numbered `TMPL-` and the full library is §26. Two canonical forms are given here because they are the shapes every other template varies.

### TMPL-CORE-1 · Implementation Task

```
TASK
Implement <one specific outcome>.

CONTEXT
Project: <name> · Tier: <T1–T4> · Module: <path>
This module is responsible for <one sentence>.
It sits between <upstream> and <downstream>.
Related work already merged: <task ids or PRs, if relevant>

SPECIFICATION
<Either the rules themselves, or:>
Authority: <document> §<n>, which is provided in full below / attached.
The rules that govern this task are:
  1. …
  2. …
Ambiguities you must not resolve yourself: <list, if any known>

CONSTRAINTS
- Follow the existing pattern in <file>; do not introduce a new one
- <purity / immutability / error-handling constraints>
- Errors: use <project error mechanism>. Never swallow, never return empty on failure
- Dependencies: do not add any
- Style: the project's formatter and linter are authoritative; do not hand-format
- <any project-specific rule that applies>

ACCEPTANCE
This is done when:
- <testable statement 1>
- <testable statement 2>
- Tests exist for <the specific behaviours>, and each fails against the current commit
- The full local verification suite passes

OUT OF SCOPE
- Do not refactor <adjacent thing>, even though it needs it
- Do not change <interface / schema / config>
- Do not add logging beyond <what is specified>

OUTPUT
- Modify: <files>
- Add: <files>
- Tests: <location and naming convention>
- Then: report what you changed, what you assumed, and what you were unsure about
```

### TMPL-CORE-2 · Investigation Task (No Code)

```
TASK
Investigate <question>. Do not modify any file.

CONTEXT
<symptom, when it started, what changed, what has been ruled out>

WHAT I NEED
- The mechanism, stated as a causal chain
- The specific file and line where it originates
- Evidence for the conclusion — not a plausible story
- Whether other code paths share the same defect

CONSTRAINTS
- Read only. Propose no fix in this session
- If the evidence is insufficient, say so and state what would settle it
- Distinguish clearly between what you observed and what you inferred

OUTPUT
1. Mechanism
2. Evidence
3. Blast radius
4. Confidence, and what would raise it
```

**The read-only investigation prompt is one of the highest-value patterns in this handbook.** Separating diagnosis from repair prevents the most common debugging failure: fixing the first plausible cause and shipping it (§12).

## 3.6 Real-World Examples: Good vs Bad

### Example 1 — Feature Implementation

❌ **Bad**

> Add pagination to the users endpoint.

Why it fails: no page size, no default, no maximum, no ordering, no cursor-vs-offset decision, no behaviour for an invalid page, no acceptance criteria. The agent will choose all of these. It will choose plausibly. It will be a coin flip whether each choice matches what the API already does elsewhere — and inconsistency across endpoints is a defect that survives for years.

✅ **Good**

> **TASK** Add cursor pagination to the users list endpoint.
> **CONTEXT** Module `api/users`. All other list endpoints in this service already use cursor pagination; follow `api/orders` exactly.
> **SPECIFICATION** Default page size 25, maximum 100. Requests above the maximum are a validation error, not a silent clamp. Cursor is opaque to the client. Ordering is by creation time descending, ties broken by id. An invalid cursor is a 400 with error code `INVALID_CURSOR`.
> **CONSTRAINTS** Reuse the existing pagination helper; do not write a new one. No new dependencies. Follow the existing error-response shape.
> **ACCEPTANCE** Tests cover: default size, explicit size, size above maximum (rejects), invalid cursor, empty result, exactly-one-page result, and stable ordering across pages when a record is inserted mid-iteration.
> **OUT OF SCOPE** Do not change the response schema of individual user objects. Do not add filtering.
> **OUTPUT** Modify the users handler; add tests alongside the existing endpoint tests.

The difference is not length. It is that every decision an implementer would otherwise make silently has been made explicitly by the person accountable for it.

### Example 2 — Bug Fix

❌ **Bad**

> The export is broken, fix it.

✅ **Good**

> **TASK** Fix: CSV export produces an empty file when the result set exceeds 10,000 rows.
> **CONTEXT** Reported in ticket 412. Reproduces reliably at 10,001 rows; works at 9,999. Started after the streaming change in PR 388.
> **SPECIFICATION** Export must stream and must succeed for result sets up to 1,000,000 rows within the existing timeout.
> **CONSTRAINTS** Diagnose before fixing — tell me the mechanism first. Do not change the export format. Do not raise the row limit as a workaround.
> **ACCEPTANCE** A regression test at the boundary (10,000 and 10,001 rows) fails before the fix and passes after. Memory stays bounded.
> **OUT OF SCOPE** The unrelated timezone handling in the same file.

### Example 3 — Refactoring

❌ **Bad**

> Clean up this file, it's messy.

Why it fails: "messy" is not a specification, no boundary is set, no behaviour-preservation constraint is stated, and no verification exists. This prompt reliably produces a large diff mixing genuine improvements with behaviour changes that pass the existing tests because the existing tests were weak.

✅ **Good**

> **TASK** Extract the three validation blocks in the order handler into named functions in the same file. Behaviour must not change.
> **CONTEXT** The handler is 240 lines; the validation logic is inline and duplicated across two branches.
> **CONSTRAINTS** **Pure refactor.** No behaviour change of any kind. No new files. No signature changes to the handler. If you find a bug while refactoring, **stop and report it — do not fix it in this change**.
> **ACCEPTANCE** All existing tests pass unchanged. The diff contains no new conditional and no changed conditional. Each extracted function has a single responsibility named in its identifier.
> **OUT OF SCOPE** Everything else in the file.

**The bolded constraint is the important one.** "If you find a bug, report it, do not fix it" preserves the single most valuable property of a refactor: that a reviewer can confirm behaviour is unchanged without re-verifying business logic.

### Example 4 — Testing

❌ **Bad**

> Write tests for the discount calculator.

✅ **Good**

> **TASK** Write unit tests for the discount calculator against the specification below. Do not read the implementation.
> **SPECIFICATION** <the eight discount rules, stated>
> **CONSTRAINTS** Derive every test from the specification, not from the code. Use the existing test builders. One logical assertion per test. Full-sentence test names describing behaviour. Include boundary cases at every stated threshold.
> **ACCEPTANCE** Every rule has at least one test that would fail if the rule were removed. Boundary values are tested exactly at, one below, and one above each threshold.
> **OUTPUT** Tests only. If a rule is ambiguous, list it rather than guessing.

**"Do not read the implementation" is the entire point.** It is the countermeasure for test laundering (AP-15) and it is unavailable in any other engineering context.

### Example 5 — Architecture Review

❌ **Bad**

> Is this a good design?

✅ **Good**

> **TASK** Review the proposed design below against the criteria listed. Do not propose a rewrite.
> **CONTEXT** <design summary, constraints, expected scale, team size>
> **CRITERIA** (1) Where does this fail at 10× current load? (2) Which component's failure has the largest blast radius? (3) What is the hardest thing to change later? (4) Which decisions are reversible and which are not? (5) What would a reviewer with a bias toward simplicity delete?
> **CONSTRAINTS** Assume the technology choices are fixed. Assume the team is three engineers. Judge against the stated constraints, not against best practice in the abstract.
> **OUTPUT** One paragraph per criterion. End with the single change you would make if you could make only one.

## 3.7 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Prompting before understanding | Multiple attempts, each subtly wrong | Write the acceptance criteria first. If you cannot, you are still designing |
| 2 | Bundling tasks | Large diff, mixed concerns | PRM-01 |
| 3 | Omitting constraints | Correct logic, wrong patterns, new dependency | The CONSTRAINTS block is not optional |
| 4 | Omitting out-of-scope | Unrequested refactoring bundled in | State what not to touch when adjacent code is imperfect |
| 5 | Pasting whole files as context | Diluted spec, imitated patterns | Contracts, not implementations (TOK-02) |
| 6 | Re-prompting without diagnosing | Prompt roulette (AP-11) | After two failures, fix the *prompt*, not the attempt |
| 7 | Specifying implementation instead of outcome | Fragile output; you did the work anyway | Say what must be true, not what to type |
| 8 | Unverifiable acceptance | "Handles edge cases properly" | Name the edge cases |
| 9 | Letting standing rules drift into prompts | Inconsistency across sessions | TOK-01: project instructions file |
| 10 | Asking for code when you needed a decision | An implementation of the wrong approach | Use the investigation or review template first |

## 3.8 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-17** | **The Wish** | "Build me a dashboard" — a product brief handed over as a task | §5 first. A task prompt implements a plan; it does not replace one |
| **AP-18** | **The Kitchen Sink** | Every file, every doc, every past message pasted in | TOK-02, PRM-N7 |
| **AP-19** | **The Moving Target** | Requirements changed mid-session, incrementally, by conversation | Stop. Re-specify. Start a fresh session (§4.4) |
| **AP-20** | **Implicit Convention** | Assuming the agent knows the house style | Constraints block; project instructions file |
| **AP-21** | **The Rubber Stamp Prompt** | "Looks good, ship it" as the review step | §2's review checklist |
| **AP-22** | **Spec-by-Correction** | The specification emerges from correcting successive wrong outputs | Expensive and incomplete. Write it up front |

## 3.9 Decision Tables

### 3.9.1 How Much Specification Detail?

| Task Type | Detail Required |
|---|---|
| Formatting, renaming, mechanical transform | Minimal — the transformation rule |
| Extending an established pattern | Point at the exemplar; state the differences |
| New business logic | **Complete rules**, every branch, every boundary |
| Integration with an external system | Complete: contract, auth, error responses, retry semantics, rate limits |
| Anything with money, time, or identity | **Exhaustive**, including what must *not* happen |
| Bug fix | Reproduction, expected behaviour, and the constraint to diagnose before fixing |
| Test writing | The specification only — **never** the implementation |

### 3.9.2 Split or Not?

| Signal | Action |
|---|---|
| Expected diff > 400 lines | **Split** |
| More than 5 files touched | **Split** |
| The task sentence needs "and" | **Split** |
| Two distinct acceptance criteria that could ship separately | **Split** |
| Two independent specification sections | **Split** |
| A refactor plus a behaviour change | **Always split** |
| Interface change plus implementations | Split: interface first, merged, then implementations |

### 3.9.3 Which Template?

| Need | Template | §26 Reference |
|---|---|---|
| Build something specified | TMPL-CORE-1 | TMPL-IMPL-01 |
| Understand a failure | TMPL-CORE-2 | TMPL-BUG-01 |
| Fix a diagnosed failure | — | TMPL-BUG-02 |
| Change structure, not behaviour | — | TMPL-REFACTOR-01 |
| Add tests | — | TMPL-TEST-01 |
| Write or update docs | — | TMPL-DOC-01 |
| Evaluate a design | — | TMPL-ARCH-01 |
| Security review | — | TMPL-SEC-01 |
| Performance work | — | TMPL-PERF-01 |
| Migrate or upgrade | — | TMPL-MIG-01 |

## 3.10 Checklists

### CHK-3.1 · Before Sending a Task Prompt

- [ ] Exactly one task
- [ ] All seven blocks present
- [ ] The specification is attached or precisely cited — not "as we discussed"
- [ ] Acceptance criteria are checkable by someone else
- [ ] Constraints name the patterns to follow and the dependency rule
- [ ] Out-of-scope names the adjacent things not to touch
- [ ] Expected output is under 400 diff lines and 5 files
- [ ] No secrets, no real personal data
- [ ] Context is under 40% of the window
- [ ] I could hand this prompt to a competent stranger and get the right thing

### CHK-3.2 · When Output Is Wrong

- [ ] Which block of my prompt failed to prevent this? (Almost always CONSTRAINTS or SPECIFICATION)
- [ ] Was the specification actually complete, or did I assume?
- [ ] Was the task too large?
- [ ] Was there a contradiction the agent silently resolved?
- [ ] Fix the **prompt**, not the output — then start a fresh session (§4.4)
- [ ] If the same failure occurs twice, add it to the project instructions file
- [ ] If it occurs across projects, propose a handbook amendment (§29)

## 3.11 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Under-specified prompt yields plausible wrong code | High | High | Seven-block structure; acceptance criteria; §2's verification | Medium |
| Over-long prompt causes rule drift | Medium | High | Size limits; one task per prompt | Low |
| Secrets or personal data entered into a prompt | Low | **Critical** | PRM-N1/N2; synthetic data; training | Low — but irreversible if it occurs |
| Templates followed mechanically without thought | Medium | Medium | Templates carry rationale; review catches empty blocks | Medium |
| Prompt quality varies by author | High | Medium | Templates; project instructions file; §26 library | Low |
| Standards outpaced by tooling changes | High | Low | Quarterly review of §3 (§0.8.2) | Low |

## 3.12 Future Improvements

| Item | When | Note |
|---|---|---|
| Prompt linting in the tool chain | v1.1 | Detect missing blocks before sending |
| Measured prompt-defect correlation | v1.2 | Which missing block correlates with which defect class |
| Per-project instruction file template | v1.1 | Standardise what belongs in it vs in a prompt |
| Shared prompt history for recurring tasks | v1.1 | Prompts that produced good results become templates |

---

# 4. Context Management

## 4.1 Purpose

To govern what an agent knows at any moment, so that the governing specification is present, competing information is absent, and nothing important is silently lost when a session grows long or is compacted.

Context failures are insidious because the output remains fluent. An agent that has lost the third constraint does not say so; it produces confident code that satisfies constraints one, two, and four.

## 4.2 Objectives

1. Define when to start a new session and when to continue an existing one.
2. Define how to transfer context between sessions without loss.
3. Define what a project summary must contain to be usable as a cold start.
4. Establish practices that prevent silent context loss.
5. Define what belongs in persistent project instructions versus per-task prompts.
6. Establish recovery when context has already degraded.

## 4.3 Engineering Rationale

### 4.3.1 The Three Kinds of Context

| Kind | Lifetime | Where It Belongs | Failure If Lost |
|---|---|---|---|
| **Standing** — house rules, conventions, architecture, forbidden patterns | Permanent | A project instructions file the tool loads automatically | Every output violates conventions |
| **Project** — current architecture, module map, decisions, in-flight work | Weeks–months | Project documents (§5) and a maintained state summary | The agent re-derives decisions and contradicts earlier ones |
| **Task** — this specification, this file, this test | Minutes–hours | The prompt (§3) | This change is wrong |

**Most context problems are a category error:** standing context re-pasted every session (wasteful, inconsistent), or project context left in a chat thread (lost the moment the session ends).

### 4.3.2 Why Sessions Degrade

| Mechanism | Effect | Onset |
|---|---|---|
| **Recency weighting** | Later instructions dominate earlier ones | After ~10 exchanges |
| **Accumulated wrong turns** | Abandoned approaches remain in context and get referenced | After any correction cycle |
| **Compaction** | Summarisation drops the exact numbers, which *are* the requirement | At the window limit |
| **Topic drift** | The session covers three tasks; constraints from task one bleed into task three | Whenever PRM-01 is violated |
| **Correction accumulation** | Each correction is a new instruction, and the original spec recedes | After ~3 corrections |

**The practical consequence:** a session that has needed three corrections is producing worse output than a fresh session with a better prompt, and continuing to correct it is usually slower than restarting.

### 4.3.3 The Cost Asymmetry of Restarting

Engineers resist restarting because the session "knows things". The arithmetic says otherwise:

| | Continue a degraded session | Start fresh with an improved prompt |
|---|---|---|
| Setup cost | 0 | 5–10 minutes |
| Probability of correct output | Falling with each correction | High |
| Risk of an early constraint being dropped | **High** | Low |
| Reviewer cost | Higher — must check everything again | Normal |
| What you keep | Confused context | The **lesson**, encoded in the prompt |

**Restarting is not throwing work away. It is converting a failed attempt into a better specification** — which is the only durable output of a failed attempt anyway.

## 4.4 Standards

### 4.4.1 When to Start a New Session

| ID | Rule |
|---|---|
| **CTX-01** | Start a new session for each task. MUST for T3+; SHOULD for all |
| **CTX-02** | Start a new session after **three** corrections on the same task. The prompt is the problem |
| **CTX-03** | Start a new session when switching modules or subsystems |
| **CTX-04** | Start a new session after any compaction, unless the task is nearly complete |
| **CTX-05** | Start a new session when the approach changes fundamentally — the abandoned approach is still in context |
| **CTX-06** | Start a new session when context usage exceeds 60% mid-task |
| **CTX-07** | Start a new session after a break longer than a working day |

### 4.4.2 When to Continue an Existing Session

| Situation | Continue? | Note |
|---|---|---|
| Iterating on the same task, ≤ 3 corrections | ✅ Yes | The context is still an asset |
| Adding tests to code just written in this session | ✅ Yes | Directly relevant context |
| Fixing a review comment on this session's work | ✅ Yes | If small |
| A closely related follow-up in the same module | ⚠️ Only if the first task is fully merged | Otherwise two unmerged changes share a context |
| A new task in the same module | ❌ No | CTX-01 |
| Same project, different module | ❌ No | CTX-03 |
| After compaction | ❌ No | CTX-04 |
| "It already understands the codebase" | ❌ **No** | This is the reasoning that causes the failure |

### 4.4.3 Context Transfer Between Sessions

When a task genuinely spans sessions, transfer MUST be explicit and written. A handover MUST contain:

| # | Element | Why |
|---|---|---|
| 1 | **Task statement** — restated, not referenced | The next session cannot follow a reference to a lost message |
| 2 | **Specification pointer** — document and section | The authority |
| 3 | **What is done** — with file paths | Prevents redoing merged work |
| 4 | **What remains** — as concrete steps | The plan |
| 5 | **Decisions made and why** | Prevents contradicting them |
| 6 | **Approaches tried and rejected, with reasons** | Prevents re-trying them — the most commonly omitted item |
| 7 | **Open questions** | Prevents silently resolving them |
| 8 | **Current state** — branch, tests passing/failing, uncommitted work | Where to resume |

| ID | Rule |
|---|---|
| **CTX-08** | A handover MUST be written to a file, not left in a chat. Chats are not durable |
| **CTX-09** | Item 6 (rejected approaches) MUST be included. Omitting it causes the next session to repeat the loop |
| **CTX-10** | The handover MUST be produced **before** the session ends, not reconstructed afterwards |

### 4.4.4 Project Summaries

Every T2+ project MUST maintain a project state summary — a single document that lets a cold session become useful in one read.

| Section | Contents | Update Cadence |
|---|---|---|
| What this project is | Two paragraphs, plain language | On scope change |
| Conformance tier and why | T1–T4 (§0.3.3) | At inception |
| Architecture in one diagram | The component map | On architectural change |
| Module map | Path → responsibility → owner | On any new module |
| **Hazard modules** | The S5 list (§2.4.3) | On any change |
| Key decisions | ADR index with one-line summaries | On each ADR |
| Conventions specific to this project | What differs from the handbook, and why | On change |
| Current state | What works, what is in progress, what is known broken | **Weekly** |
| Known sharp edges | The things that surprise newcomers | Continuously |
| Where the specifications live | Document paths | On change |

| ID | Rule |
|---|---|
| **CTX-11** | The project summary MUST be current within one week for active projects |
| **CTX-12** | The summary MUST fit in roughly 10% of a typical context window. If it does not, it is a document, not a summary |
| **CTX-13** | An agent starting cold on a project MUST read the summary first |
| **CTX-14** | The summary MUST list the hazard modules. This is the single most important line for agent safety |

### 4.4.5 Preventing Context Loss

| ID | Practice | Prevents |
|---|---|---|
| **CTX-15** | Persist decisions to files as they are made — never leave them only in a session | Total loss at session end |
| **CTX-16** | Re-state critical constraints in each prompt even if they are in standing context | Recency displacement |
| **CTX-17** | After compaction, **re-read the specification before continuing** | Summarised requirements have lost their numbers |
| **CTX-18** | Commit working intermediate states on the task branch | Loss of work when a session fails |
| **CTX-19** | Write the handover before you need it — at natural boundaries, not at the end | Reconstruction cost and omission |
| **CTX-20** | Keep an explicit list of open questions in a file, not in the conversation | Silent resolution of ambiguity |

**Agent Note on CTX-17.** After compaction you may feel you still understand the task. What has typically been lost is precision: the exact threshold, the exact ordering, the exact error class. Those are the requirement. Re-read.

### 4.4.6 Standing vs Task Context

| Belongs in Standing (project instructions file) | Belongs in the Prompt |
|---|---|
| Language, runtime, and framework conventions | This task's specification |
| Directory structure and what may live where | This task's acceptance criteria |
| Error-handling mechanism | This task's out-of-scope list |
| Testing conventions and locations | The specific files to modify |
| Forbidden patterns (§24) | Task-specific constraints |
| Commit and PR format | The exemplar file to follow |
| Hazard module list | — |
| Dependency policy | — |

| ID | Rule |
|---|---|
| **CTX-21** | Standing context MUST live in a file the tool loads automatically, MUST be version-controlled, and MUST be reviewed like code |
| **CTX-22** | Standing context SHOULD be under two pages. Beyond that it is not read reliably — by anyone |

## 4.5 Real-World Examples

### Example 1 — The Long Session

An engineer spends four hours in one session implementing three related features. The first is excellent. The second is good. The third violates a convention stated at the start, imports a dependency that was forbidden in message two, and duplicates a helper written in the first hour.

| | |
|---|---|
| Mechanism | Recency weighting and topic drift |
| The tell | Quality degrading across a session is *always* a context problem, never a model problem |
| Correct process | Three sessions, three prompts, three PRs (CTX-01) |

### Example 2 — Compaction Loss

A session implementing a rules engine is compacted at the 80% mark. Afterwards the agent continues confidently. Two of eleven rules are now implemented with wrong thresholds — the summary preserved "validates against thresholds" and lost the numbers.

| | |
|---|---|
| Mechanism | Summarisation loses precision |
| What would have caught it | CTX-17 (re-read after compaction); CTX-04 (restart); tests derived from the spec |
| The general lesson | **Numbers are the requirement. Prose about numbers is not** |

### Example 3 — The Undocumented Handover

An engineer finishes for the day mid-task, intending to continue tomorrow. The next day, in a new session, the agent re-tries an approach that was already rejected — because the rejection existed only in yesterday's conversation. Two hours lost.

| | |
|---|---|
| Mechanism | No handover; rejected approaches not recorded |
| Rule | CTX-08, CTX-09, CTX-19 |

### Example 4 — Effective Cold Start

A new agent session opens on a nine-month-old project. It reads the project summary (module map, hazard modules, conventions, current state, sharp edges), then the task's specification section. It produces a correct change in one pass.

| | |
|---|---|
| Why it worked | Project context was in a file, not a conversation |
| Cost of maintaining that file | ~15 minutes per week |
| Value | Every cold start, for every agent and every new engineer, indefinitely |

## 4.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Treating the session as project memory | Knowledge vanishes when the session ends | CTX-15: persist to files |
| 2 | Continuing because "it understands the codebase" | Quality degrades; conventions drift | CTX-01 |
| 3 | Correcting five times instead of restarting once | Compounding confusion | CTX-02 |
| 4 | Continuing after compaction without re-reading | Precision silently lost | CTX-04, CTX-17 |
| 5 | Handover written from memory next morning | Rejected approaches omitted | CTX-19 |
| 6 | Project summary written once, never updated | Confidently wrong context — worse than none | CTX-11 |
| 7 | Standing rules pasted into every prompt | Inconsistency, wasted budget | CTX-21 |
| 8 | Standing context grown to fifteen pages | Nobody reads it, including the agent | CTX-22 |
| 9 | Open questions resolved in conversation, not recorded | The decision is lost | CTX-20 |
| 10 | Multiple agents sharing one session | Interleaved, contradictory context | §19 |

## 4.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-23** | **The Eternal Session** | One session for a whole project | CTX-01 |
| **AP-24** | **Context Archaeology** | Scrolling back through a long chat to find a decision | CTX-15 |
| **AP-25** | **Summary Rot** | A project summary that describes the system as it was | CTX-11; weekly update |
| **AP-26** | **The Verbal Handover** | Context transferred by conversation between people | CTX-08 |
| **AP-27** | **Instruction Sprawl** | Standing context grown until nobody reads it | CTX-22 |
| **AP-28** | **The Lost Constraint** | An early rule silently dropped mid-session | CTX-16; restart |

## 4.8 Decision Tables

### 4.8.1 New Session or Continue?

| Signal | Decision |
|---|---|
| New task | **New** |
| Different module | **New** |
| Third correction on the same task | **New** |
| Context compacted | **New** |
| Approach changed fundamentally | **New** |
| Context above 60% | **New** |
| More than a day since the last message | **New** |
| Small iteration on the current task | Continue |
| Adding tests to code just written | Continue |
| Addressing a review comment on this work | Continue |

### 4.8.2 Where Does This Information Live?

| Information | Location | Lifetime |
|---|---|---|
| "We use X pattern for Y" | Project instructions file | Permanent |
| "This module must stay pure" | Project instructions + restated in the prompt | Permanent |
| "We rejected approach Z because…" | ADR | Permanent |
| "The current sprint is doing A" | Project summary, current state | Weeks |
| "This task requires B" | Prompt | Minutes |
| "I tried C and it failed because D" | Handover file, then discarded | Hours |
| "This threshold is 0.92" | **Specification document** | Permanent |
| "The build is broken on main" | Team channel | Hours |

## 4.9 Checklists

### CHK-4.1 · Starting a Session on an Existing Project

- [ ] Read the project summary
- [ ] Note the hazard modules
- [ ] Read the specification section for this task
- [ ] Confirm which conventions differ from the handbook
- [ ] Confirm the branch and current state
- [ ] Confirm the task is the only task for this session

### CHK-4.2 · Ending a Session Mid-Task

- [ ] Handover file written, containing all eight elements (§4.4.3)
- [ ] **Rejected approaches recorded with reasons**
- [ ] Open questions recorded in a file
- [ ] Work-in-progress committed to the task branch
- [ ] Decisions made are persisted to the right documents, not just the handover
- [ ] Test state noted: what passes, what fails, what is not yet written

### CHK-4.3 · Weekly Project Summary Maintenance

- [ ] Current state reflects reality as of today
- [ ] New modules added to the module map with owners
- [ ] Hazard module list still correct
- [ ] New ADRs indexed
- [ ] Newly discovered sharp edges recorded
- [ ] Still under the size limit (CTX-12)

## 4.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Silent constraint loss mid-session | **High** | High | CTX-01, CTX-16, restart discipline | Medium |
| Precision lost at compaction | High | High | CTX-04, CTX-17 | Low |
| Project summary rots and misleads | Medium | High | CTX-11, weekly checklist | Medium |
| Handover omits rejected approaches | High | Medium | CTX-09 as an explicit element | Low |
| Standing context grows unread | Medium | Medium | CTX-22 size limit; reviewed like code | Low |
| Engineers resist restarting sessions | High | Medium | §4.3.3's arithmetic; make it normal, not a failure | Medium |

## 4.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Automated project summary staleness warning | v1.1 | Flag when the summary predates the last N commits |
| Handover template as a repository file | v1.1 | Reduce the cost of CTX-08 to near zero |
| Context usage telemetry | v1.2 | Correlate degradation with measured usage rather than intuition |
| Standing-context linting | v1.2 | Detect contradictions between the instructions file and the handbook |

---

*End of Part 2. Part 3 covers what must exist before any of this begins: the planning documents.*
