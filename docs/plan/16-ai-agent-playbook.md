# Part 16 — AI Coding Agent Playbook

*Audience: AI coding agents (Claude Code, Codex, Gemini CLI, and successors) and the humans supervising them. This part is normative for agent-executed work. An agent that reads only this part and the TRD section named in its task has everything it needs.*

---

## 16.0 Read This First

You are implementing a **baselined** system. The architecture (SAD v1.0) and the technical specification (TRD v1.0) are approved and frozen. Your job is to implement what is specified, in the order this plan specifies, and to stop when something does not fit rather than to invent a resolution.

**The twelve execution rules (§0.5) apply to you without exception.** Three of them are the ones agents break:

| Rule | The specific failure |
|---|---|
| **X-7** | Building a producer of data before the Normalizer exists. The task list prevents this; do not "get ahead" |
| **X-10** | Widening a hard ceiling to make a test pass; adding a retry to an `ERR-BLOCKED-*` path; simplifying the absence asymmetry |
| **ID-07** | Returning `[]` or `null` from an unimplemented unit. **In this system that is indistinguishable from the worst production defect** |

And the ten TRD agent rules (TRD §0.5, A-1…A-10) are binding. A-4 and A-10 in particular.

---

# 16.1 Task Eligibility — What an Agent May Own

| Difficulty | Agent Autonomy | Human Involvement |
|---|---|---|
| **D1 Mechanical** | **Full.** Generate, test, commit, open a PR | Review the diff |
| **D2 Straightforward** | **Full.** Generate, test, commit, open a PR | Review the diff against the TRD section |
| **D3 Substantive** | **Assisted.** Draft the implementation and the tests | Human verifies **line by line** against the TRD section before merge |
| **D4 Hazardous** | **Tests and scaffolding only.** The human writes the implementation | Property tests may be agent-drafted **only if** a human wrote the law statement first |
| **D5 Critical-path apex** | **None for implementation.** Agent may write test fixtures, builders, and documentation | Human-led throughout; two reviewers |

## 16.1.1 The D4/D5 Module List

**These modules are human-led by rule.** An agent may not author their implementation, regardless of instruction:

| Module | Why |
|---|---|
| `core/reconcile/**` | The absence asymmetry (IR-01, PR-22). "Simplifying" it passes every example test |
| `core/normalize/**` | The security boundary for every client website simultaneously (INV-05) |
| `core/gate/**` | The only mechanism between a bad harvest and every client (INV-02) |
| `core/identity/**` | An identity change is irreversible after first publication |
| `infra/logger/redact.mjs` | Its failure mode is irreversible in a public repository |
| `adapters/acquisition/google-dom/challenge-detect.mjs` | INV-07; a retry here is the specific prohibited behaviour |

**An agent may — and should — write the property tests, adversarial corpora, and fixtures for all six.** That is where an agent's recall of a long specification is an advantage and its confident completion is not a hazard.

---

# 16.2 Prompt and Context Budget

## 16.2.1 Maximum Recommended Prompt Size

| Element | Budget | Rationale |
|---|---|---|
| **Task scope per prompt** | **One task ID** (`T-nnn`). Never two | A prompt covering two tasks produces a diff covering two concerns, which is unreviewable (ID-03) |
| **Specification input** | **One TRD section**, plus its referenced tables. Typically 2–6 pages | Feeding the whole TRD dilutes the section that matters and invites cross-contamination between similar rules |
| **Plan input** | The task row + the phase section for that task | ~3 pages |
| **Code input** | The module being written, its direct imports' **contracts** (not bodies), and its test file | Reading transitive implementations is how an agent starts matching an unrelated module's style instead of the spec |
| **Total working context** | **≤ 25% of the model's window**, leaving room for iteration | An agent operating near its limit begins summarising the spec, and a summarised requirement is a changed requirement |
| **Output per PR** | **≤ 400 lines of diff**, excluding fixtures | ID-03 |

## 16.2.2 The Standard Task Prompt Shape

Provide, in this order:

| # | Content |
|---|---|
| 1 | The task row from Part 12–14, verbatim |
| 2 | The phase section from Parts 3–10 that governs it |
| 3 | The **exact** TRD section(s) named in the task's Description |
| 4 | The contract tables of any module being imported |
| 5 | The relevant execution rules (X-*) and any `IR-` risk named in the phase |
| 6 | The test file to satisfy, if the tests already exist (D4 property-first tasks) |

**Do not provide:** the whole SAD, the whole TRD, unrelated modules' source, or previous unrelated conversation. Each of those measurably increases the rate at which an agent produces plausible code that satisfies something other than the requirement.

## 16.2.3 Context Management Across a Session

| Rule | Statement |
|---|---|
| **CTX-1** | **One task per session.** Start a new session for the next task, even if the previous one succeeded |
| **CTX-2** | If the session must span tasks, re-read the TRD section at the start of each task. Do not rely on recall from earlier in the session |
| **CTX-3** | When context is summarised or compacted, **re-read the TRD section and the task row before continuing**. A summarised requirement has lost the exact numbers, and the exact numbers are the requirement |
| **CTX-4** | Never carry an assumption from one module into another. `core/validate/` and `core/gate/` both have thresholds; they are different thresholds |
| **CTX-5** | Keep the invariant list (INV-01…INV-10) in context at all times. It is one page and it is the thing you are protecting |
| **CTX-6** | If you cannot hold the task's spec, its test file, and its module in context simultaneously, the task is too large — split it and record the split in the sprint log |

---

# 16.3 Module Isolation Rules

The architecture is hexagonal and the dependency rules are mechanically enforced. **Before writing any import, check it against this table.**

| You are writing in | You MAY import from | You MUST NOT import from |
|---|---|---|
| `core/**` | `core/**` only, plus `node:crypto` | `adapters/`, `infra/`, `app/`, `cli/`, any npm package, any other `node:` built-in |
| `ports/**` | Nothing. These are declarations | Anything |
| `adapters/**` | `ports/`, `core/` (types), `infra/` | **Another adapter** |
| `infra/**` | `ports/`, `node:` built-ins | `core/`, `app/`, `adapters/` — and no domain concept at all |
| `app/**` | `ports/`, `core/`, `infra/` | **Any concrete adapter** |
| `cli/composition.mjs` | Everything | — (this is the only such file) |
| `cli/**` (other) | `app/`, `ports/`, `core/` | Concrete adapters (construct them nowhere but the composition root) |
| `frontend/**` | Nothing at all | Every package, without exception (DEP-6) |

## 16.3.1 The Five Imports an Agent Is Most Likely to Write Wrongly

| Tempting import | Why it is wrong | What to do instead |
|---|---|---|
| A logger inside `core/reconcile/` "just for debugging" | Violates DR-1; makes the core impure | Return the information in the `DecisionLog` the function already produces |
| `Date.now()` as a default for a `now` parameter | Violates DR-2; **voids every property law without failing anything** (IR-02, PR-23) | `now` is a **required** parameter. No default. Ever |
| A helper from the DOM adapter into the Places adapter | Violates DR-3 | Duplicate the small helper, or move it to `core/` if it is genuinely domain logic |
| The Playwright adapter imported into `app/orchestrator.mjs` "to check the browser is available" | Violates DR-4 | The orchestrator receives ports; availability is the composition root's concern |
| `core/reconcile/decide.mjs` imported directly from `app/` | Violates DR-6 | Import from `core/index.mjs` |

## 16.3.2 The `infra/` Test

**If a function's name or body mentions a domain noun — review, listing, client, ledger, payload — it does not belong in `infra/`.** It belongs in `core/`. This is the directory rule broken most often, and it is checkable in one reading.

---

# 16.4 Coding Order Within a Task

Follow this sequence. It is not a preference; it is what makes the work reviewable and what prevents the two most common agent failures (implementing before understanding, and testing what was implemented rather than what was required).

| # | Step | Output |
|---|---|---|
| 1 | **Read** the TRD section named in the task. Read the tables, not the prose summary | — |
| 2 | **Restate** the contract: inputs, outputs, errors, purity, idempotence. If the TRD has a contract table, copy it into your working notes | The contract |
| 3 | **List the error classes** this unit may produce. If one is not in `core/model/errors.mjs`, **stop and ask** — do not invent a class | Error set |
| 4 | **Write the module header**: what it does, and **what it explicitly does not do** (TRD §67.5) | Header |
| 5 | **Write the tests.** For D4 property-first tasks, the tests already exist and are red — satisfy them | Test file |
| 6 | **Write the implementation**, smallest thing that satisfies the tests and the contract | Module |
| 7 | **Run the full local gate**: `npm run lint && npm run typecheck && npm test` | Green |
| 8 | **Check the diff against the contract** from step 2. Anything in the diff not in the contract is scope creep | Reviewed diff |
| 9 | **Commit** with the Conventional Commit format and the `Refs:` footer naming TRD sections and invariants | Commit |
| 10 | **Open the PR** with the description fields required by the template | PR |

## 16.4.1 What to Do When the Spec Does Not Cover Your Case

**Stop.** Do not choose the reasonable-looking option.

| Situation | Action |
|---|---|
| The TRD does not specify a behaviour you need | Raise it. The interim position is in TRD §0.9 (`OIQ-`) if one exists; otherwise it is a specification gap and needs an EDR (§10.5) |
| A requirement and an existing test disagree | **Stop. Do not amend the test to match the code** (TRD A-8, ID-10). Escalate |
| A requirement seems wrong or redundant | It is probably load-bearing. `core/reconcile/` in particular looks redundant and is not (TRD A-4). Read PT-07 and CH-04 first, then escalate if still unconvinced |
| A hard ceiling blocks your test | **Never widen it** (A-3). The ceiling is a compile-time constant; your test is wrong |
| An illustrative JSON document in the TRD implies a rule | **Do not infer behaviour from illustrative JSON** (A-9). It shows shape. The rules are in the tables |

---

# 16.5 Testing After Every Module

| Rule | Statement |
|---|---|
| **AT-1** | Every task's PR contains the code **and** its tests. There is no "tests later" task and none will be scheduled (X-5) |
| **AT-2** | Run the **full default suite** before every commit, not just the tests you wrote. It takes under three minutes by design |
| **AT-3** | A new test must **fail against the previous commit**. If it passes without your change, it is testing something else |
| **AT-4** | Use `fixed-clock` and `seeded-random` in every test (TR-TEST-032). A test that reads the system clock will eventually fail at 02:00 for no reason |
| **AT-5** | Construct test data through builders in `tests/helpers/`, never inline literals (TR-TEST-033) |
| **AT-6** | Test names are full sentences describing behaviour: *"retains last known good when coverage is below threshold"* |
| **AT-7** | For any module with a coverage threshold (§21.2), verify the threshold is met before opening the PR |
| **AT-8** | For chaos and property tests, **name the invariant in a comment** (TR-TEST-042) |

## 16.5.1 The Test-Quality Check an Agent Should Run on Itself

Before opening a PR, answer these four questions in the PR description:

| # | Question |
|---|---|
| 1 | Which requirement does each test assert? Name the `TR-` or `PT-` identifier |
| 2 | Would this test fail if the implementation were replaced by a plausible wrong one? Describe that wrong implementation |
| 3 | Does any test assert an implementation detail rather than a behaviour? Remove it |
| 4 | If this is a bug fix: which test would have caught the bug? It must be in this PR |

**Question 2 is the one that matters.** An agent is very good at producing tests that pass against the code just written and prove nothing about the requirement.

---

# 16.6 Commit and Review Frequency

## 16.6.1 Commit Frequency

| Rule | Statement |
|---|---|
| **CF-1** | **One commit per completed, green task.** Not per file, not per hour |
| **CF-2** | Within a task, intermediate commits are allowed on your branch and are squashed on merge |
| **CF-3** | Never commit a red state to a shared branch. `main` is always releasable (X-3) |
| **CF-4** | Commit message: Conventional Commits, module scope, and a `Refs:` footer with `TR-`/`EDR-`/`INV-`/`PT-` identifiers |
| **CF-5** | For D3+ changes, the commit body states which TRD section was implemented and what was verified |

## 16.6.2 Review Frequency

| Change class | Reviewers | Turnaround |
|---|---|---|
| D1 documentation-only | Self-merge permitted | — |
| D1–D2 code | 1 reviewer | ≤ 24 h |
| D3 | 1 reviewer, **line-by-line against the TRD section** | ≤ 24 h |
| **D4–D5** | **2 reviewers**, one of whom wrote no part of the module | ≤ 48 h |
| Any PR touching `core/reconcile/`, `core/normalize/`, `core/gate/`, `core/identity/`, `redact.mjs`, `challenge-detect.mjs` | **2 reviewers, one being the Architect** | ≤ 48 h |
| Any PR adding a dependency | Reviewer + DEP-1 justification merged first | ≤ 48 h |

## 16.6.3 Branch Discipline

| Rule | Statement |
|---|---|
| **BD-1** | One branch per task: `t/<task-id>-<slug>` |
| **BD-2** | Merge within 48 hours (24 hours in SP-5). A stale branch is escalated at stand-up |
| **BD-3** | Rebase on `main` before opening the PR |
| **BD-4** | Incomplete work may merge **only if unreachable** — not exported from a package index, not registered in the composition root, not referenced by a command (FD-04) |
| **BD-5** | An unimplemented unit returns `Result.err(ERR-INTERNAL-INVARIANT)`. **It never returns `[]`, `null`, or a plausible default** (ID-07) |

---

# 16.7 Refactoring Rules

| Rule | Statement |
|---|---|
| **RF-1** | **Refactoring and behaviour change are separate commits** (ID-09). A diff mixing both is unreviewable and the behaviour change hides in the noise |
| **RF-2** | A refactor PR must be **behaviour-preserving and test-preserving**. If a test changed, it was not a refactor |
| **RF-3** | **Do not refactor a D4 or D5 module.** Not for readability, not for consistency, not for "simplification". If it genuinely needs restructuring, that is a human-led task with two reviewers |
| **RF-4** | Do not "clean up" code you are passing through. Touch only what your task requires |
| **RF-5** | Do not unify two similar-looking code paths without reading why they differ. In `core/reconcile/` the near-duplication **is the requirement** (TRD A-4) |
| **RF-6** | Do not introduce an abstraction with one user. Two users is the earliest an abstraction is justified, and this codebase is small enough that three is often better |
| **RF-7** | Do not change a public contract (payload shape, exit codes, error class names, config keys) as part of a refactor. Those are versioned contracts |

## 16.7.1 The Refactors That Have Broken This Class of System

| Refactor | What it broke |
|---|---|
| "Simplify the three completeness branches into one" | INV-03. The client's reviews are deleted on the next partial harvest |
| "Extract `now = Date.now()` as a default for convenience" | DR-2. Fifteen property laws stop testing anything, silently |
| "Make the gate short-circuit for performance" | An operator sees one rejection reason per harvest cycle instead of all of them |
| "Escape the markup instead of removing it — safer" | INV-05. The payload becomes markup source on every client site |
| "Reuse the browser context between targets for speed" | INV-09. State leaks between clients |
| "Return `[]` when extraction finds nothing, it's cleaner" | The catch-and-return-empty pattern TRD §67.3 prohibits by name |

---

# 16.8 Regression Prevention

| Rule | Statement |
|---|---|
| **RP-1** | **Every defect you find or fix gets a permanent test in the same PR** (X-9) |
| **RP-2** | Never delete or skip a failing test to make CI green. A failing test is information |
| **RP-3** | Never regenerate a golden fixture's `expected.json` to match new output unless the change in output is the **intended** change, and say so explicitly in the PR |
| **RP-4** | Never lower a coverage threshold |
| **RP-5** | Never widen a hard ceiling |
| **RP-6** | Never add a retry to an `ERR-BLOCKED-*` path |
| **RP-7** | If you change a threshold, add boundary tests at the new value |
| **RP-8** | If you change identity or hashing, extend PT-08/PT-09 and flag it as a **breaking migration** |
| **RP-9** | If you touch a selector pack, create `v<n+1>.json` — never edit the merged file — and add a fixture |
| **RP-10** | Run the architecture suite before every PR. It catches the import mistakes listed in §16.3.1 in five seconds |

## 16.8.1 The Self-Check Before Every PR

Answer all ten. If any answer is uncertain, do not open the PR.

| # | Question |
|---|---|
| 1 | Does this preserve all ten invariants? Especially INV-02, INV-03, INV-05 |
| 2 | Does every import obey §16.3's table? |
| 3 | Is there any `Date.now()`, `Math.random()`, `process.env`, `fs`, or `fetch` in `core/`? |
| 4 | Is every new error class in the taxonomy, with a retry policy and a severity? |
| 5 | Is every new timing, threshold, or limit a config key with a named default? |
| 6 | Is there any `catch` that returns an empty collection? |
| 7 | Is there any conditional keyed on a client slug, source, or adapter identity? |
| 8 | Could untrusted content reach a shell command, a log format string, a workflow expression, or a client DOM? |
| 9 | Does the module header say what the module does **and does not** do? |
| 10 | Would the change be diagnosable from artifacts alone if it failed in production? |

---

# 16.9 Multi-Agent Coordination

When more than one agent works concurrently:

| Rule | Statement |
|---|---|
| **MA-1** | Agents work on **different phases or different work packages**, never the same module |
| **MA-2** | Interface files (`ports/**`) are changed by **one** agent at a time, and the change lands before dependents start |
| **MA-3** | An agent that needs an interface change **stops and requests it** rather than changing it and notifying |
| **MA-4** | Shared files — `package.json`, `eslint.config.mjs`, `core/model/errors.mjs`, `cli/composition.mjs` — are edited by one agent at a time, and those edits are their own small PRs |
| **MA-5** | Each agent rebases on `main` before opening a PR; a conflict in a shared file is resolved by re-running the task, not by hand-merging |
| **MA-6** | The composition root is touched last in any phase, once, by whoever wires the phase's output |

---

# 16.10 The Agent Task Template

Copy this into the working notes at the start of every task.

```
TASK:        T-nnn — <name>
PHASE:       PH-nn (<milestone>, <sprint>)
DIFFICULTY:  D<n>   → autonomy per §16.1
TRD SECTION: §<n>   ← read this, in full, before writing anything
INVARIANTS:  INV-<nn>, ...
RISKS NAMED: IR-<nn>, PR-<nn>

CONTRACT (restate from the TRD, do not paraphrase):
  Inputs:
  Output:
  Errors:      (must all exist in core/model/errors.mjs)
  Purity:      pure | impure
  Idempotent:  yes | no

IMPORTS PLANNED:   (check each against §16.3's table)

TESTS TO WRITE:
  - <name>: asserts <TR-/PT- id>
  - each must fail against the previous commit

DEFINITION OF DONE (§2.3):
  [ ] Code satisfies the named TRD section
  [ ] Tests in the same PR, failing against the previous commit
  [ ] lint + typecheck + format: zero errors
  [ ] Full default suite green, under 3 minutes
  [ ] Coverage threshold met for the touched module
  [ ] Module header states what it does AND does not do
  [ ] New error classes in taxonomy + retry table + severity map
  [ ] PR names the TRD section(s) and invariant(s)

SELF-CHECK (§16.8.1): all ten questions answered
```

---

# 16.11 Phase-by-Phase Agent Guidance

| Phase | Agent Suitability | Specific Guidance |
|---|---|---|
| PH-00 | **Excellent** (D1–D2, 46 tasks) | The highest-value agent phase. Configs, templates, workflows, helpers. Do the 19 proof branches too — they are mechanical and they are the phase's evidence |
| PH-01 | **Good** (D2) | The taxonomy is a transcription task from SAD Appendix B. Transcribe **exactly**; do not "improve" a class name |
| PH-02 | **Tests only** (D4) | Write the adversarial corpus — this is where an agent excels. Do not write the eight-step pipeline |
| PH-03 | **Assisted** (D3) | The phrase table is data and is agent-tractable. The singular forms are the hazard; enumerate them per locale explicitly |
| PH-04 | **Assisted** (D3) | Watch TR-STD-080: `coverage` is a number, `completeness` is an enum. Never interchange them |
| PH-05 | **None for implementation** (D5) | Write PT-01, PT-02, PT-07 generators if asked, from a human-written law statement. **Do not touch the implementation** |
| PH-06 | **Tests only** (D4) | Write the per-rule test matrix — 12 rules × 2 tests each is exactly the kind of exhaustive work an agent does well |
| PH-07 | **Good, except `redact.mjs`** | The retry policy table is transcription; the enumerating test is mechanical. Redaction is human-led |
| PH-08 | **Assisted** (D3) | Unknown-field preservation is the subtle part; test it explicitly |
| PH-09 | **Assisted** (D3) | The precedence matrix is ten mechanical tests. **The array-replace rule is the one you will get wrong** — arrays replace, they do not merge |
| PH-10 | **Excellent** (D2) | One command per task; highly parallel |
| PH-11 | **Assisted** (D3) | Write the contract suite carefully — it must contain **no** source-specific assumption, because three more adapters will run it |
| PH-12 | **Assisted** (D3) | The pack schema is mechanical. The `notes` field on every strategy is mandatory and is not optional prose |
| PH-13 | **Good** (D3) | Reply detachment comes **first**. The rating integer post-check is mandatory. Do not fabricate absent fields |
| PH-14 | **Assisted** (D3) | Exactly one file imports `playwright`. Check with a grep before you finish |
| PH-15 | **Assisted** (D3) | The stop reason is emitted at the point of stopping, never inferred downstream |
| PH-16 | **Assisted, except challenge detection** | `challenge-detect.mjs` is human-led. Everything else in the adapter is D3 |
| PH-17 | **Assisted** (D3) | Registry and shard planner are **pure**. No I/O, no clock. `deferred` is not `failed` |
| PH-18 | **Assisted** (D3) | Hash-gating compares **bytes**. Publish order is payload-then-state. No force flags |
| PH-19 | **Excellent** (D2–D3) | Workflow YAML is highly agent-tractable. Never omit the `data` checkout; never omit `permissions:` |
| PH-20 | **Excellent** (D2) | Health records are append-only. Never read-modify-write the series |
| PH-21 | **Tests only, human-reviewed** (D4) | Write the injections; a human reviews every assertion for specificity. "Did not crash" is not an assertion |
| PH-22 | **Good** (D3) | **No fallback to the DOM adapter when a secret is missing.** Fail closed, exit 2 |
| PH-23 | **Good** (D2) | Zero dependencies. No HTML-injection DOM APIs. Every recipe carries a network assertion |
| PH-24 | **Excellent** (D2) | Five workflows, highly parallel, all mechanical |
| PH-25 | **Limited** | Human-executed: authorisation, client relationship, live verification |

---

# 16.12 What an Agent Must Never Do on This Project

Consolidated, in order of consequence.

| # | Never |
|---|---|
| 1 | **Simplify the absence asymmetry in `core/reconcile/`** |
| 2 | **Add a retry — of any kind, for any reason — to an `ERR-BLOCKED-*` path** |
| 3 | **Add `Date.now()`, `Math.random()`, `process.env`, `fs`, or `fetch` to `core/`**, including as a default parameter |
| 4 | **Return an empty collection from a `catch`** |
| 5 | **Escape markup instead of removing it** |
| 6 | **Widen a hard ceiling** |
| 7 | **Lower a coverage threshold or skip a failing test** |
| 8 | **Edit a merged selector pack** instead of creating the next version |
| 9 | **Fall back to the DOM adapter when an API secret is missing** |
| 10 | **Add a production dependency** without a merged DEP-1 justification |
| 11 | **Implement anything from TRD §76–§91** |
| 12 | **Amend a test to match the code** when the two disagree |
| 13 | **Use an HTML-injection DOM API in `frontend/`** |
| 14 | **Interpolate untrusted content** into a shell command, a log format string, or a workflow expression |
| 15 | **Skip the `data` checkout** in a publishing workflow |

---

## Part 16 Summary

| Question | Answer |
|---|---|
| Maximum prompt size | One task, one TRD section, ≤ 25% of the context window; output ≤ 400 diff lines |
| Module isolation | The §16.3 import table; check every import against it before writing |
| Coding order | Read spec → restate contract → list errors → header → tests → implementation → gate → self-check → commit |
| Testing | Same PR, always; must fail against the previous commit; fixed clock, seeded random |
| Commit frequency | One per completed green task |
| Review frequency | 1 reviewer for D1–D3; **2 for D4–D5**, one being the Architect for the six named modules |
| Refactoring | Separate commits; never in a D4/D5 module; never unify near-duplication without reading why it exists |
| Regression prevention | Every defect gets a permanent test; never delete, skip, or regenerate to pass |
| Context management | One task per session; re-read the spec after any compaction; keep the ten invariants in context |

---

*End of Part 16. Part 17 defines the quality gates that every phase must satisfy.*
