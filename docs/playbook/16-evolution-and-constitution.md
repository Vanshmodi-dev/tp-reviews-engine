# Part 16 — Evolution and the Constitution

*Sections 29 and 30. How this handbook changes, and the part of it that does not.*

---

# 29. Future Evolution

## 29.1 Purpose

To ensure this handbook stays true — reflecting how TradyPerch actually builds software, not how it built software in 2026 — while remaining stable enough to be a standard rather than a moving target.

## 29.2 Objectives

1. Define how the handbook is amended, by whom, and on what evidence.
2. Establish a review cadence that catches drift without churning.
3. Define versioning so that projects know which edition governs them.
4. Establish waivers as a recorded, expiring exception rather than a silent one.
5. Define which parts are expected to change quickly and which are expected not to change at all.

## 29.3 Engineering Rationale

### 29.3.1 A Standard That Cannot Change Becomes a Standard Nobody Follows

Every rule here was written against a specific context: a small team, heavy AI assistance, particular tools, particular failure modes. All of those will change. A rule that outlives its rationale becomes an obstacle, and obstacles get routed around — quietly, one exception at a time, until the handbook describes nothing.

**The remedy is not flexibility in application. It is a working amendment process**, so that a rule which no longer serves its purpose is *changed* rather than ignored.

### 29.3.2 A Standard That Changes Constantly Is Not a Standard

The opposite failure: a handbook amended every week is one nobody has read the current version of. Its value comes from being stable enough that people can internalise it.

The balance TradyPerch chooses:

| Speed | Sections | Rationale |
|---|---|---|
| **Fast** — quarterly, expected to change | §2, §3, §4, §13, §19, §25, §26 | AI tooling and its failure modes move quickly |
| **Moderate** — semi-annual | §11, §15, §16, §17, §18, §27, §28 | Practice evolves with tooling and scale |
| **Slow** — annual | §5, §6, §7, §8, §9, §10, §12, §14, §20, §21, §22, §23, §24 | Well-established engineering practice |
| **Fixed** — amendment is a significant event | §1, §30 | Values and constitutional rules |

### 29.3.3 Amendments Come From Evidence, Not Opinion

| Valid basis for an amendment | Invalid basis |
|---|---|
| An incident a rule failed to prevent | "I prefer a different convention" |
| A rule violated repeatedly in good faith — a sign it is wrong or unclear | "This is how my last company did it" |
| A rule that has never once caught anything | "A blog post recommended otherwise" |
| A capability change that makes a rule obsolete | "It slows us down" *(without evidence of what it prevents)* |
| A pattern independently adopted by three projects (P-5) | One project's local preference |
| A measured cost that exceeds the measured benefit | Discomfort |

**The "slows us down" row deserves comment.** Most rules here do slow something down — that is what a control does. The valid version of the argument is: *this rule costs X, and the failure it prevents costs less than X, or is prevented more cheaply another way.* That is an amendment proposal. "It's annoying" is not.

### 29.3.4 The Handbook Should Shrink Over Time

Every rule enforced by automation can move from a section's prose into a tool. When a rule is mechanically enforced, its entry becomes a one-line reference rather than a page of explanation.

**The target trajectory:** more rules enforced, fewer rules that must be *remembered*. A handbook that grows every year without shedding anything is accumulating rather than improving.

## 29.4 Standards

### 29.4.1 The Amendment Process

| # | Step | Owner | Output |
|---|---|---|---|
| 1 | **Propose** — state the rule, the evidence, and the proposed change | Anyone | A written proposal |
| 2 | **Assess** — what does the current rule prevent? What would the change cost? | Section owner | Assessment |
| 3 | **Consult** — anyone materially affected | Proposer | Feedback |
| 4 | **Decide** | Section owner; Head of Engineering for constitutional or philosophy changes | Decision |
| 5 | **Amend** — update the handbook, the version, and the changelog | Section owner | Merged change |
| 6 | **Propagate** — update templates, tooling, and standing context files | Section owner | Consistent artifacts |
| 7 | **Announce** | Head of Engineering | Everyone knows |

| ID | Rule |
|---|---|
| **EVO-01** | An amendment MUST state the evidence prompting it |
| **EVO-02** | An amendment MUST state what the existing rule prevents and how that is otherwise addressed |
| **EVO-03** | An amendment MUST be reviewed like code — proposed, discussed, approved, merged |
| **EVO-04** | Amendments to §1 or §30 MUST be approved by the Head of Engineering and announced explicitly |
| **EVO-05** | Every amendment MUST propagate to templates, tooling, and standing context in the same change |

**Rationale for EVO-02.** The most common bad amendment removes a rule without addressing what it prevented. Requiring the proposer to answer "what happens to the failure this stopped?" catches that, and often converts a removal proposal into a better rule.

### 29.4.2 Review Cadence

| Cadence | Scope | Owner | Trigger for a mid-cycle review |
|---|---|---|---|
| Quarterly | Fast-moving sections (§29.3.2) | Section owners | A significant tooling change |
| Semi-annual | Moderate sections | Section owners | A recurring incident class |
| Annual | Everything, including thresholds and standing risks | Head of Engineering | — |
| Per incident | Any section a rule failed to prevent | Incident reviewer | Always |

| ID | Rule |
|---|---|
| **EVO-06** | Every incident review MUST ask whether a handbook rule failed, was missing, or was ignored — and record which |
| **EVO-07** | A rule ignored repeatedly in good faith MUST be examined. Either it is wrong, or it is unclear, or it is not enforceable |
| **EVO-08** | Rules that have never caught anything MUST be examined for removal or automation |

### 29.4.3 Versioning

| Change | Version |
|---|---|
| A new section, or a change to a constitutional rule | **MAJOR** |
| A new rule, or a materially stricter rule | **MINOR** |
| Clarification, example, typo, or reorganisation | **PATCH** |

| ID | Rule |
|---|---|
| **EVO-09** | The handbook MUST be version-controlled with a changelog |
| **EVO-10** | Projects MUST record which handbook version governed them at inception |
| **EVO-11** | A MAJOR change MUST state how existing projects are affected and by when |
| **EVO-12** | Existing projects adopt a new MAJOR version at their next major release, unless the change is a security matter, which applies immediately |

### 29.4.4 Waivers

| ID | Rule |
|---|---|
| **EVO-13** | A waiver MUST be recorded: which rule, which scope, why, who approved it, and when it expires |
| **EVO-14** | A waiver MUST have an expiry date. **Permanent waivers do not exist** |
| **EVO-15** | Constitutional rules (§30) admit **no waiver** |
| **EVO-16** | Three waivers of the same rule MUST trigger an amendment review — the rule is probably wrong |
| **EVO-17** | Waivers MUST be reviewed at expiry: renewed with a reason, remediated, or the rule amended |

**Waiver record format:**

> **WAIVER-nn**
> **Rule:** the identifier and its text
> **Scope:** which project, which component
> **Reason:** why conformance is not currently achievable
> **Risk accepted:** what could go wrong as a result, and who owns it
> **Remediation:** what would resolve it
> **Approved by / Expires:** name / date

### 29.4.5 Contributing

| ID | Rule |
|---|---|
| **EVO-18** | Anyone may propose an amendment. Seniority is not a prerequisite |
| **EVO-19** | Proposals from people affected by a rule carry particular weight |
| **EVO-20** | §24's forbidden list SHOULD be extended by anyone who has been bitten by something not on it |
| **EVO-21** | Real examples from TradyPerch incidents SHOULD replace hypothetical ones over time |

**Rationale for EVO-21.** Hypothetical examples are placeholders. A handbook whose examples are drawn from real incidents carries institutional memory that no amount of rule-writing can substitute for — and it is markedly more persuasive to the person deciding whether to follow a rule at 6 p.m. on a Friday.

## 29.5 What Should Change First

Ordered by expected value, as of v1.0:

| # | Area | Why |
|---|---|---|
| 1 | **Real incident examples throughout** | Highest persuasive value; replaces hypotheticals |
| 2 | **Mechanising currently-manual rules** | §24.6 lists the gaps; each removes a class of vigilance |
| 3 | **Agent failure-mode data** (§2.3.2, KPI-A2) | The rules were derived from observation; the observation should become measurement |
| 4 | **Per-model capability profiles** | Different agents have different failure profiles |
| 5 | **Threshold recalibration** | All numeric thresholds are starting points |
| 6 | **Template refinement from outcomes** | KPI tracking of which templates produce clean first passes |
| 7 | **Tier boundary refinement** | Whether four tiers is right; whether the boundaries are in the right places |

## 29.6 Real-World Examples

### Example 1 — The Rule That Was Wrong

A rule requires every public function to have full documentation. In practice, engineers write perfunctory documentation for trivial getters to satisfy it, and the noise makes real documentation harder to find. Three teams independently note it. The rule is amended to apply to functions with non-obvious behaviour.

| | |
|---|---|
| Basis | A rule violated repeatedly in good faith (EVO-07) |
| Outcome | A better rule, not a removed one |

### Example 2 — The Amendment That Was Rejected

A proposal to remove the two-reviewer requirement on hazard modules argues that it slows delivery. The assessment asks what the rule prevents: silent modification of safety properties. No alternative control is offered. The proposal is rejected, and the reasoning is recorded so it is not re-argued each quarter.

| | |
|---|---|
| Rule | EVO-02 |
| The value of recording the rejection | The same proposal arrives twice a year; the answer takes thirty seconds |

### Example 3 — The Rule That Became a Tool

A rule prohibiting catch-and-return-empty is enforced only by review for a year. A custom lint rule is written. The handbook entry shrinks from a paragraph of explanation to a one-line reference, and the failure mode stops occurring.

| | |
|---|---|
| Rule | §29.3.4 |
| The trajectory | More enforced, less remembered |

### Example 4 — The Waiver That Expired Correctly

A project waives a coverage threshold on a legacy module with a six-month expiry. At expiry, the module has been substantially rewritten and the waiver is no longer needed. It lapses.

| | |
|---|---|
| Rules | EVO-14, EVO-17 |
| Counterfactual | Without an expiry, the waiver would have become the module's permanent standard |

## 29.7 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Rules ignored rather than amended | The handbook describes nothing real | EVO-07 |
| 2 | Amendment without evidence | Preference dressed as improvement | EVO-01 |
| 3 | Removing a rule without addressing what it prevented | The failure returns | EVO-02 |
| 4 | Amendments not propagated to tooling | Handbook and tools disagree | EVO-05 |
| 5 | Permanent waivers | The exception becomes the standard | EVO-14 |
| 6 | Handbook only grows | Unread; unusable | §29.3.4 |
| 7 | Amendments only from senior people | The people affected are not heard | EVO-18, EVO-19 |
| 8 | No version recorded per project | Nobody knows which edition applies | EVO-10 |

## 29.8 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-179** | **The Frozen Standard** | Unchanged for years while practice moved on | Review cadence |
| **AP-180** | **The Churning Standard** | Amended so often nobody knows the current version | Cadence; MAJOR changes are rare |
| **AP-181** | **Amendment by Erosion** | Rules weakened one exception at a time, never formally | EVO-13, EVO-16 |
| **AP-182** | **The Aspirational Handbook** | Describes practice nobody follows | EVO-06, EVO-07 |
| **AP-183** | **Rule Accretion** | Rules only added, never removed or automated | §29.3.4, EVO-08 |

## 29.9 Checklist

### CHK-29.1 · Proposing an Amendment

- [ ] The specific rule is identified by its identifier
- [ ] The evidence is stated — incident, repeated violation, measurement, or capability change
- [ ] What the current rule prevents is stated
- [ ] How that failure is otherwise addressed is stated
- [ ] The cost of the current rule is stated, with evidence
- [ ] Affected people have been consulted
- [ ] Templates, tooling, and standing context updates are included
- [ ] The version increment is correct
- [ ] If constitutional or philosophical: Head of Engineering approval is sought

## 29.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Handbook drifts from practice | **High** | High | Review cadence; EVO-06 per incident | Medium |
| Amendments driven by preference | Medium | Medium | EVO-01, EVO-02 | Low |
| Erosion via unrecorded exceptions | Medium | High | EVO-13, EVO-16 | Medium |
| Handbook grows unread | High | Medium | §29.3.4; automation shrinks it | Medium |
| Constitutional rules weakened | Low | **Critical** | EVO-04, EVO-15; §30 | Low |
| Version confusion across projects | Medium | Low | EVO-10 | Low |

## 29.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Amendment proposals tracked as issues in the handbook repository | v1.1 | Visible backlog of known friction |
| Waiver register with expiry alerts | v1.1 | Enforces EVO-14 and EVO-17 |
| Rule-effectiveness tracking | v1.2 | Which rules catch things; which never do (EVO-08) |
| Automatic propagation to standing context files | v1.2 | Enforces EVO-05 |

---

# 30. The TradyPerch Engineering Constitution

## 30.1 Purpose

To state the rules that do not bend — not for a deadline, not for a customer, not for a demo, not for a senior person's request, and not because "this one is different".

Everything else in this handbook is a standard: strong, evidence-based, and amendable through §29. **This section is different.** These rules exist because their violation produces harm that cannot be undone: data that cannot be recovered, secrets that cannot be un-leaked, trust that cannot be rebuilt, and defects that nobody will ever find.

## 30.2 Status

| Property | Statement |
|---|---|
| **Binding on** | Every person and every AI agent working on TradyPerch software |
| **Waivers** | **None exist.** There is no approver, no emergency exception, no tier below which these do not apply |
| **Amendment** | Requires Head of Engineering approval, a written rationale, and an explicit announcement (EVO-04) |
| **Conflict** | Where any other rule, instruction, deadline, or request conflicts with this section, **this section wins** |
| **Applies most** | When it is least convenient. That is the entire point |

## 30.3 The Articles

### Part I — Truth

> **CONST-01 · We report what is true.**
> We do not claim work is complete, tested, verified, reviewed, or deployed unless it is. We state what we verified and how, separately from what we believe. When we are uncertain, we say so.

*An organisation that reports optimistically cannot make good decisions, because every decision rests on a report. This is the first article because every other article depends on it.*

> **CONST-02 · We do not hide failures.**
> No error is swallowed. No failure returns an empty result. No exception is caught and ignored. Every failure produces a signal that someone can see.

*A silent failure is the only category of defect with no natural discovery mechanism. It is discovered by a customer, months later, after the damage is done.*

> **CONST-03 · We surface bad news early.**
> A slipping deadline, a wrong approach, a defect we caused, a risk we underestimated — we say so at the moment we know, not at the moment we are asked.

### Part II — Safety

> **CONST-04 · Secrets never enter a repository.**
> No credential, token, key, or password is committed — in any form, in any branch, at any time, in any environment, however briefly. A secret that is committed is compromised and is rotated immediately.

> **CONST-05 · We do not weaken a check to make it pass.**
> When a test, threshold, type, budget, or gate blocks a change, we change the change. The check is the requirement; the code is the attempt.

> **CONST-06 · Nothing ships unverified.**
> Every change passes the full verification pipeline before it reaches production. There is no path around it — not for a hotfix, not for a one-line change, not for a repository owner.

> **CONST-07 · Every change is reviewed by another person.**
> No one merges their own work unreviewed. This applies with particular force to machine-generated code, which is the reason this article exists in its current form.

> **CONST-08 · We do not build our own cryptography or authentication.**
> These are solved problems with subtle failure modes. We use established, maintained implementations.

> **CONST-09 · Production data does not leave production.**
> Real personal data is never copied into development, staging, test environments, analytics, logs, or AI prompts.

### Part III — Accountability

> **CONST-10 · Whoever merges it, owns it.**
> Not the author. Not the agent. Not the tool. The person who merges a change is accountable for it working, and for fixing it when it does not. "The AI wrote it" is never an explanation.

> **CONST-11 · We do not approve what we do not understand.**
> If you cannot explain how a change works, you cannot approve it. Ask questions, request that it be split, or decline. Declining is a legitimate and valuable outcome.

> **CONST-12 · Every system has a named human owner.**
> Not a team. A person. A system without an owner is assigned one or retired.

> **CONST-13 · Incidents are blameless and systemic.**
> Human error is a symptom of a system that permitted it. We fix the system. We do not identify people as causes, because a team that assigns blame gets fewer reports, not fewer incidents.

### Part IV — Craft

> **CONST-14 · We plan before we build.**
> Above the throwaway tier, no implementation begins without a written statement of what is being built and why. An agent will implement a bad plan flawlessly; the plan is the only place that failure can be caught.

> **CONST-15 · Tests ship with the code they test.**
> Not in a follow-up. Not in a later sprint. In the same change. A test written later is a test written from memory, by someone with less context, or not at all.

> **CONST-16 · We do not simplify what we do not understand.**
> Code that looks redundant may be deliberately asymmetric. Before removing a branch, a check, or a condition, we find out why it exists. If we cannot find out, we leave it and ask.

> **CONST-17 · Every module states what it does and what it does not do.**
> The second half is the part that prevents misuse, scope creep, and the silent assumption.

> **CONST-18 · We build the simplest thing that meets the requirement.**
> Not the most flexible, the most general, or the most impressive. Complexity requires justification; simplicity does not.

> **CONST-19 · Every irreversible action is designed deliberately.**
> Deletions, payments, external notifications, published artifacts, migrations. We identify them before shipping and we design their controls on purpose.

### Part V — Under Pressure

> **CONST-20 · We cut scope, never quality.**
> When a deadline is at risk, fewer things are delivered fully. Testing, security, error handling, observability, and review are not the variables. Scope is.

> **CONST-21 · The Definition of Done does not move.**
> It is written before the work begins and it is the same on the last day as on the first.

> **CONST-22 · These rules apply most when they are least convenient.**
> Every article in this section was written for a specific moment: late, tired, under pressure, with someone waiting. That moment is not an exception to these rules. It is the reason they exist.

### Part VI — Working With AI

> **CONST-23 · AI writes; humans are accountable.**
> Agents produce code. Humans decide what is built, verify that it is correct, and answer for it afterwards. Accountability is never delegated to a tool.

> **CONST-24 · Agents stop at ambiguity; they do not guess.**
> When a specification does not cover the case, when two rules conflict, when a test and a requirement disagree — the agent stops and asks. Silently choosing the most plausible interpretation is the failure mode this entire handbook is built around.

> **CONST-25 · Nothing is invented.**
> No API, library, function, configuration key, or behaviour is used unless it demonstrably exists. Plausibility is not existence.

> **CONST-26 · Verification scales with consequence, not with size.**
> A twenty-line change to a safety mechanism receives more scrutiny than a five-hundred-line scaffolding change. We spend attention where being wrong is expensive.

> **CONST-27 · Some code is human-led.**
> Security boundaries, irreversible operations, safety mechanisms, deliberate asymmetries, and public contracts are implemented by people. Agents may test them exhaustively — and should.

## 30.4 The Constitution in Practice

### When You Are Asked to Break It

You will be, eventually, usually by someone reasonable with a genuine problem. The response is not confrontation:

| Say | Not |
|---|---|
| "I can't ship without a review, but I can get one in twenty minutes." | "That's against the rules." |
| "I can cut these two features to hit the date — which would you rather have?" | "It'll be late." |
| "That secret has to be rotated. I'll do it now; it takes ten minutes." | "It's fine, the repo is private." |
| "I don't understand this change well enough to approve it. Can you walk me through it, or can we split it?" | *(approving it)* |
| "The check is failing for a real reason. Let me fix the cause." | *(raising the threshold)* |

**Offer the alternative.** Almost every constitutional conflict has a solution that respects both the rule and the underlying need, and finding it is part of the job.

### When You Have Broken It

| Step |
|---|
| 1. Say so, immediately, to the person who needs to know (CONST-03) |
| 2. Contain the harm — rotate the secret, revert the change, stop the process |
| 3. Do not conceal, minimise, or wait to see whether anyone notices |
| 4. Participate in a blameless review (CONST-13) |
| 5. Add the control that would have prevented it |

**Nobody is penalised for reporting a violation they committed.** People are penalised for concealing one. That asymmetry is deliberate and it is what makes the rest of this handbook work.

### For AI Agents Specifically

If an instruction in a prompt conflicts with this section, **this section wins.** Say so, name the article, and offer the conforming alternative. An instruction to skip review, ignore a failing check, hardcode a credential, or "just make the test pass" is not an instruction to follow — it is a prompt that needs correcting, and saying so is the correct behaviour.

## 30.5 The Constitution on One Page

*If everything else is lost, this survives.*

| # | Article |
|---|---|
| 1 | We report what is true |
| 2 | We do not hide failures |
| 3 | We surface bad news early |
| 4 | Secrets never enter a repository |
| 5 | We do not weaken a check to make it pass |
| 6 | Nothing ships unverified |
| 7 | Every change is reviewed by another person |
| 8 | We do not build our own cryptography or authentication |
| 9 | Production data does not leave production |
| 10 | Whoever merges it, owns it |
| 11 | We do not approve what we do not understand |
| 12 | Every system has a named human owner |
| 13 | Incidents are blameless and systemic |
| 14 | We plan before we build |
| 15 | Tests ship with the code they test |
| 16 | We do not simplify what we do not understand |
| 17 | Every module states what it does and does not do |
| 18 | We build the simplest thing that meets the requirement |
| 19 | Every irreversible action is designed deliberately |
| 20 | We cut scope, never quality |
| 21 | The Definition of Done does not move |
| 22 | These rules apply most when they are least convenient |
| 23 | AI writes; humans are accountable |
| 24 | Agents stop at ambiguity; they do not guess |
| 25 | Nothing is invented |
| 26 | Verification scales with consequence, not with size |
| 27 | Some code is human-led |

## 30.6 Rationale — Why These Twenty-Seven

Each article corresponds to a failure that is either irreversible, undetectable, or corrosive to the organisation's ability to function.

| Failure Class | Articles | Why It Qualifies |
|---|---|---|
| **Irreversible** | 4, 8, 9, 19 | Leaked secrets, broken cryptography, exposed personal data, and undone-able actions cannot be recovered by any amount of subsequent effort |
| **Undetectable** | 2, 5, 15, 16, 24, 25 | Silent failures, disabled checks, absent tests, removed safety branches, silent assumptions, and fabricated APIs share one property: nothing reports them |
| **Corrosive** | 1, 3, 10, 11, 12, 13, 23 | Untrue reports, concealed problems, diffused accountability, and blame destroy the information flow every other control depends on |
| **Compounding** | 6, 7, 14, 17, 18, 21, 26, 27 | Unverified code, unreviewed changes, unplanned work, and misallocated scrutiny compound: each makes the next one more likely and harder to fix |
| **Situational** | 20, 22 | These exist because the others are hardest to follow at precisely the moment they matter most |

**None of these is about being careful.** Care is not a control; it fails under load. Each article is a structural commitment that holds when nobody is thinking about it — which is when systems actually get damaged.

## 30.7 Closing

This handbook is long. Most of it is guidance: patterns, rationale, decision frameworks, and accumulated experience about how software is built well. Guidance can be argued with, improved, and occasionally set aside with good reason. That is what §29 is for.

**Section 30 is not guidance.** It is the shortest possible statement of what TradyPerch will not do, regardless of who is asking, how urgent it is, or how good the reason sounds at the time.

Everything else here exists to make following it easy. When following it is hard — and there will be days when it is — the articles still apply. That is the only property that makes them worth writing down.

---

*End of Part 16. Part 17 contains the appendices.*
