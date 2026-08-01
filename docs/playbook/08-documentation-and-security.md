# Part 8 — Documentation and Security

*Sections 14 and 15. Two disciplines whose absence is invisible right up until the moment it is extremely expensive. Documentation debt is paid by every future reader; security debt is paid once, publicly, and cannot be refunded.*

---

# 14. Documentation Standards

## 14.1 Purpose

To ensure that everything a future reader needs is written down, findable, and true — where "future reader" means a new engineer, an AI agent starting cold, an on-call responder at 3 a.m., and the author four months from now.

## 14.2 Objectives

1. Define the documentation set every project maintains, by tier.
2. Establish who each document is for, so it can be written for them.
3. Make documentation a part of the change rather than a follow-up.
4. Establish that wrong documentation is worse than none, and how to prevent it.
5. Make documentation optimally consumable by agents as well as humans.

## 14.3 Engineering Rationale

### 14.3.1 Documentation Is Written For a Specific Person

The most common documentation failure is writing for nobody. Each document has a reader, a moment, and a question:

| Document | Reader | Moment | Question |
|---|---|---|---|
| README | Anyone | First contact | "What is this and how do I run it?" |
| Architecture | Engineer | Before changing something significant | "How does this fit together?" |
| ADR | Engineer | When questioning a past decision | "Why is it like this?" |
| API docs | Consumer | While integrating | "How do I call this?" |
| Developer docs | Contributor | While working | "How do I do X here?" |
| Runbook | On-call | **During an incident, stressed** | "What do I do right now?" |
| Changelog | Consumer | Before upgrading | "What changed and will it break me?" |
| Release notes | User / stakeholder | After a release | "What is new?" |

**Writing for the moment changes the form.** A runbook read at 3 a.m. must be numbered commands, not narrative prose. An ADR read while questioning a decision must lead with the alternatives. Documentation that ignores the moment is documentation that fails at the moment.

### 14.3.2 Wrong Documentation Is Worse Than None

| No Documentation | Wrong Documentation |
|---|---|
| The reader knows they must investigate | The reader trusts and proceeds |
| Cost: time | Cost: time **plus a wrong action** |
| Fails safely | Fails confidently |

Consequence: **deleting stale documentation is a positive act**, not a loss. A document that no longer describes reality should be corrected or removed, never left "in case it is partly useful".

### 14.3.3 Documentation Is Part of the Change

Documentation written later is documentation written from memory, by someone with less context, under less pressure to be right — or, more commonly, not written at all.

Writing it with the change costs minutes, because the author's understanding is complete at exactly that moment. Writing it a month later costs an hour and is less accurate.

### 14.3.4 Agents Read Documentation Differently

| Property | Why It Matters for Agents |
|---|---|
| **Structured** | Tables and lists are parsed reliably; long prose is compressed and loses specifics |
| **Explicit** | An agent cannot infer an unstated convention; a human sometimes can |
| **Located near the code** | An agent working in a directory sees that directory's README, not a wiki |
| **Concrete numbers** | "Fast" tells an agent nothing; "under 200 ms" is implementable |
| **Negative statements** | "This module does not handle retries" prevents an entire class of wrong assumption |
| **Version-controlled** | A document outside the repository does not exist as far as most tooling is concerned |

**The practical consequence:** documentation that is good for agents is also good for humans under time pressure. Optimising for one improves the other.

## 14.4 Standards

### 14.4.1 The Documentation Set

| Document | T1 | T2 | T3 | T4 | Lives |
|---|---|---|---|---|---|
| README | ✅ | ✅ | ✅ | ✅ | Repository root |
| Standing agent context | ✅ | ✅ | ✅ | ✅ | Repository root |
| Architecture overview | — | ✅ | ✅ | ✅ | `docs/` |
| ADRs | — | Significant only | ✅ | ✅ | `docs/decisions/` |
| API documentation | — | If it has an API | ✅ | ✅ | Generated where possible |
| Developer guide | — | — | ✅ | ✅ | `docs/` |
| Runbooks | — | — | ✅ | ✅ | `docs/runbooks/` |
| Changelog | — | ✅ | ✅ | ✅ | Root |
| Release notes | — | — | ✅ | ✅ | Releases |
| Threat model | — | — | — | ✅ | `docs/` |
| Directory READMEs | — | Where a rule applies | ✅ | ✅ | Each directory |

| ID | Rule |
|---|---|
| **DOC-01** | Documentation MUST live in the repository, in version control, reviewed like code |
| **DOC-02** | Documentation MUST be updated in the same change as the behaviour it describes |
| **DOC-03** | Stale documentation MUST be corrected or deleted, never left |
| **DOC-04** | Every document MUST have a named owner |
| **DOC-05** | Documentation MUST NOT duplicate content. One source of truth; everything else links |

**Rationale for DOC-05.** Duplicated documentation diverges. Within a month the two copies disagree, and nobody knows which is right. Link instead — even at the cost of a click.

### 14.4.2 README

Per §6.4.5. Additional rules:

| ID | Rule |
|---|---|
| **DOC-06** | The quick start MUST work on a clean machine and MUST be verified quarterly |
| **DOC-07** | The README MUST state the current status and owner |
| **DOC-08** | The README MUST link to, not restate, detailed documentation |

### 14.4.3 Architecture Documentation

| ID | Rule |
|---|---|
| **DOC-09** | One diagram MUST show the whole system on one screen |
| **DOC-10** | Every component MUST state its responsibility **and what it does not do** |
| **DOC-11** | Diagrams MUST be text-based (diagram-as-code) so they version and diff |
| **DOC-12** | The document MUST state the invariants — the properties that must always hold — and what enforces each |
| **DOC-13** | It MUST be updated when the architecture changes, in the same change |

**Rationale for DOC-11.** An image file cannot be reviewed, diffed, or updated by an agent. A text-based diagram is a first-class artifact that changes alongside the code it describes.

### 14.4.4 Architecture Decision Records

| Element | Contents |
|---|---|
| Title | The decision, stated as a decision |
| Status | Proposed / accepted / superseded (with a pointer) |
| Date | — |
| Context | The forces in play at the time |
| Decision | What was chosen |
| **Alternatives rejected** | Each, with the specific reason it lost |
| Consequences | What this makes easy; what it makes hard |
| Revisit condition | What would make us reconsider |

| ID | Rule |
|---|---|
| **DOC-14** | An ADR MUST be written at the time of the decision, not reconstructed later |
| **DOC-15** | Rejected alternatives MUST be recorded with reasons. **This is the primary value of the document** |
| **DOC-16** | ADRs MUST NOT be edited after acceptance. A changed decision is a new ADR superseding the old |
| **DOC-17** | An ADR SHOULD state what would make the team revisit it |

**Rationale for DOC-15.** Six months later, someone proposes the alternative. Without a record, the team re-litigates from scratch, usually without the original context. With one, the conversation takes thirty seconds — or, if circumstances have genuinely changed, becomes a well-informed reversal rather than an argument.

**Rationale for DOC-16.** An immutable record is what makes history trustworthy. Editing an ADR to match current thinking destroys the only artifact that records what was believed at the time, which is exactly what a future reader needs.

### 14.4.5 API Documentation

| ID | Rule |
|---|---|
| **DOC-18** | API documentation MUST be generated from the source of truth where possible |
| **DOC-19** | Every endpoint or public function MUST document: purpose, inputs with constraints, outputs, **every error**, and side effects |
| **DOC-20** | Every error response MUST be documented with its condition and what the caller should do |
| **DOC-21** | Examples MUST be real and MUST be verified to work |
| **DOC-22** | Breaking changes MUST be documented with a migration path before release |
| **DOC-23** | Rate limits, quotas, authentication, and pagination MUST be documented |

**Rationale for DOC-20.** Undocumented error responses are the most common API documentation gap and the most expensive for consumers, who discover them in production. A caller cannot handle a failure they did not know could occur.

### 14.4.6 Runbooks

Written for a stressed reader with no time to interpret.

| ID | Rule |
|---|---|
| **DOC-24** | Runbooks MUST be numbered, imperative steps — commands, not narrative |
| **DOC-25** | Each MUST state: the symptom it addresses, how to confirm the diagnosis, the steps, and how to verify the resolution |
| **DOC-26** | Each MUST state what to do **if the steps do not work** — who to escalate to |
| **DOC-27** | Each MUST be executed at least once by someone who did not write it (DONE-09) |
| **DOC-28** | Runbooks MUST be reviewed after every incident that used one |
| **DOC-29** | Destructive steps MUST be marked and MUST state their reversibility |

**Rationale for DOC-27.** A runbook that has never been executed is a hypothesis. The first execution always finds an assumed permission, a renamed script, or a missing step — and the worst possible time to discover that is during the incident.

### 14.4.7 Changelog and Release Notes

| ID | Rule |
|---|---|
| **DOC-30** | Every release MUST have a changelog entry |
| **DOC-31** | The changelog MUST be organised by version, newest first, grouped as Added / Changed / Fixed / Removed / Security |
| **DOC-32** | Breaking changes MUST be called out explicitly with a migration path |
| **DOC-33** | The changelog is for **consumers**; release notes are for users. They are different documents with different language |
| **DOC-34** | Security fixes MUST be noted, with detail proportional to disclosure policy |

### 14.4.8 Code-Level Documentation

Per §8.4.5. The connection to this section:

| ID | Rule |
|---|---|
| **DOC-35** | Every module header MUST state responsibility and non-responsibility |
| **DOC-36** | Every non-obvious constant MUST state where its value came from |
| **DOC-37** | Deliberate redundancy or asymmetry MUST be explained |
| **DOC-38** | Comments MUST explain why; comments restating code MUST be deleted |

### 14.4.9 Standing Agent Context

The file every agent loads automatically. Its quality determines the baseline quality of every agent session on the project.

| Section | Contents |
|---|---|
| What this project is | Two paragraphs |
| Conformance tier | T1–T4 |
| Architecture in brief | The shape, with a pointer to the full document |
| Directory rules | What may live where |
| **Hazard modules** | The list requiring human-led implementation (§2.4.3) |
| Conventions | Naming, error handling, testing, commits |
| Forbidden patterns | Project-specific additions to §24 |
| Dependency policy | When a dependency may be added, and by whom |
| Where specifications live | Paths |
| How to run tests and checks | Exact commands |

| ID | Rule |
|---|---|
| **DOC-39** | The standing context file MUST exist in every repository (REPO-09) |
| **DOC-40** | It MUST be under two pages |
| **DOC-41** | It MUST list the hazard modules — **the single most important line for agent safety** |
| **DOC-42** | It MUST be reviewed like code and updated when conventions change |

## 14.5 Real-World Examples

### Example 1 — The ADR That Prevented a Rewrite

An engineer proposes replacing the storage approach, arguing it is the obvious choice. The ADR from two years earlier records that this exact option was evaluated and rejected for a reason that still applies. The discussion takes four minutes.

| | |
|---|---|
| Rule | DOC-15 |
| Value | Weeks of work avoided, and the engineer learned something rather than being overruled |

### Example 2 — The Runbook That Failed

A database failover runbook is followed during an incident. Step 4 references a script that was moved during a repository reorganisation eight months earlier. The outage extends by twenty-five minutes.

| | |
|---|---|
| Rules | DOC-27, DOC-28 |
| Cost of prevention | One drill, fifteen minutes |
| Cost of the omission | Twenty-five minutes of outage |

### Example 3 — The Undocumented Error

An API returns a specific error under a rare condition. It is not documented. A consumer's integration treats every non-success as retryable and retries indefinitely, generating load that degrades the service for everyone.

| | |
|---|---|
| Rule | DOC-20 |
| The lesson | An undocumented failure mode becomes the consumer's guess, and their guess is usually "retry" |

### Example 4 — The Standing Context That Worked

A new agent session opens on a project it has never seen. The standing context names the hazard modules, the error-handling convention, and the forbidden patterns. The agent's first change is conformant with no correction.

| | |
|---|---|
| Rules | DOC-39, DOC-41 |
| Maintenance cost | About ten minutes per month |
| Value | Every session, every agent, indefinitely |

## 14.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Documentation written after the fact | Vague, incomplete, or absent | DOC-02 |
| 2 | Stale documentation retained | Confident wrong actions | DOC-03 |
| 3 | Duplicated content | Copies diverge | DOC-05 |
| 4 | Documentation outside the repository | Not found; not updated; invisible to tooling | DOC-01 |
| 5 | Runbooks as narrative | Unusable under stress | DOC-24 |
| 6 | ADRs edited after the fact | History becomes untrustworthy | DOC-16 |
| 7 | Error responses undocumented | Consumers guess | DOC-20 |
| 8 | Image-based diagrams | Cannot diff, cannot update | DOC-11 |
| 9 | No standing agent context | Every session re-derives conventions | DOC-39 |
| 10 | Documenting what instead of why | Restates the code | DOC-38 |

## 14.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-93** | **The Wiki Graveyard** | Documentation in an external wiki, last updated two years ago | DOC-01 |
| **AP-94** | **The Aspirational Doc** | Describes how the system was supposed to work | DOC-02, DOC-03 |
| **AP-95** | **Documentation Theatre** | Written for an audit, read by nobody | Write for a named reader and moment |
| **AP-96** | **The Screenshot Manual** | Instructions as annotated images, stale within a release | Text and commands |
| **AP-97** | **The Missing Why** | Every decision recorded as what, never why | DOC-15 |
| **AP-98** | **Runbook Fiction** | A procedure nobody has executed | DOC-27 |

## 14.8 Decision Tables

### 14.8.1 Does This Need Documenting?

| Question | Document it |
|---|---|
| Would a newcomer ask about it? | ✅ |
| Was a decision made with alternatives? | ✅ ADR |
| Is the behaviour non-obvious from the code? | ✅ Comment or module doc |
| Would someone break it by not knowing? | ✅ |
| Does it fail in a way requiring a procedure? | ✅ Runbook |
| Is it exposed to consumers? | ✅ API docs |
| Does the code state it clearly already? | ❌ |
| Is it a temporary state? | ❌ Use a ticket |

### 14.8.2 Where Does This Go?

| Content | Location |
|---|---|
| How to run it | README |
| Why the architecture is this shape | Architecture doc |
| Why this specific decision | ADR |
| How to call this endpoint | API docs |
| How to add a feature here | Developer guide |
| What to do when it breaks | Runbook |
| What changed in v2.3 | Changelog |
| Why this function looks redundant | **Code comment** |
| What agents must know | Standing context file |
| What may live in this directory | That directory's README |

## 14.9 Checklists

### CHK-14.1 · Documentation in a Change

- [ ] Module headers updated if responsibilities changed
- [ ] API docs updated if the interface changed
- [ ] Changelog entry added if consumer-visible
- [ ] ADR written if a significant decision was made
- [ ] Runbook added or updated if a new failure mode exists
- [ ] README updated if setup or usage changed
- [ ] Standing agent context updated if a convention changed
- [ ] Any documentation made stale by this change is corrected or deleted

### CHK-14.2 · Quarterly Documentation Review

- [ ] Quick start executed on a clean machine
- [ ] Architecture diagram matches reality
- [ ] Runbooks drilled at least once each since the last review
- [ ] API examples still work
- [ ] Owners still correct
- [ ] Standing context still accurate
- [ ] Stale documents deleted

## 14.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Documentation goes stale | **High** | High | DOC-02; quarterly review; delete on sight | Medium |
| Runbook fails during an incident | Medium | High | DOC-27 drills | Low |
| Knowledge lost when someone leaves | Medium | High | ADRs; standing context; ownership handover | Medium |
| Documentation written but not read | High | Medium | Write for a reader and a moment; locate near the code | Medium |
| Undocumented error responses | Medium | Medium | DOC-20 | Low |
| Agent operates without conventions | Medium | Medium | DOC-39 | Low |

## 14.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Automated staleness detection | v1.2 | Flag docs unchanged while their code changed |
| Executable documentation | v1.2 | Verify README commands in CI |
| Standing-context template | v1.1 | Lower the cost of DOC-39 to near zero |
| ADR tooling | v1.1 | Numbering, indexing, supersession links |

---

# 15. Security Standards

## 15.1 Purpose

To ensure TradyPerch software does not leak credentials, does not expose data to people who should not see it, and does not become a route into systems it touches — and to make those properties structural rather than dependent on vigilance.

## 15.2 Objectives

1. Make secret handling structurally safe.
2. Establish authentication and authorisation as designed properties, not added ones.
3. Establish input validation and output encoding as boundary disciplines.
4. Define rate limiting, encryption, and dependency management standards.
5. Establish threat modelling as a planning activity for T4.
6. Make security review a defined process with defined triggers.

## 15.3 Engineering Rationale

### 15.3.1 Security Failures Are Not Recoverable Like Other Failures

| Failure Type | Recovery |
|---|---|
| Performance regression | Optimise; the past is unaffected |
| Data corruption | Restore from backup |
| Outage | Restore service |
| **Leaked credential** | **Rotate — but assume everything it accessed is compromised** |
| **Leaked personal data** | **Cannot be un-leaked.** Notification, regulatory exposure, permanent |
| **Compromised system** | Rebuild, and assume everything it touched is compromised |

The bottom three rows have no undo. This asymmetry is why security controls are structural (they hold when everyone is tired) and why some of them appear in the Constitution (§30) with no waiver path.

### 15.3.2 Structural Over Procedural, Always

| Procedural (degrades) | Structural (holds) |
|---|---|
| "Don't commit secrets" | Pre-commit scanning + push protection + `.gitignore` |
| "Validate input" | Types that cannot represent invalid input |
| "Check permissions" | Authorisation enforced at a single choke point |
| "Don't log personal data" | Redaction at the log sink |
| "Use parameterised queries" | A data layer that cannot express string concatenation |
| "Review dependencies" | Automated audit blocking on high severity |

**Every security rule in this section should be read as: what is the structural version of this?** A control that depends on remembering will eventually be forgotten by someone at 2 a.m. under deadline pressure — which is precisely the moment an attacker's automated scanner is still running.

### 15.3.3 The Boundary Principle

Untrusted data is data from outside the system's trust boundary: user input, API requests, uploaded files, third-party responses, database contents written by earlier untrusted input, and **anything an AI agent generated from untrusted content**.

The rule: **validate at the boundary, encode at the point of use, and trust nothing in between.**

| Stage | Action |
|---|---|
| Entry | Validate shape, type, range, and length. Reject, do not sanitise-and-continue |
| Storage | Store the validated value; never store raw untrusted input where it will be trusted later |
| Use | Encode for the context of use — a query, a shell, a page, a log, a filename |
| Output | Encode again for the output context. Encoding is per-context, not global |

### 15.3.4 Least Privilege Is a Design Activity

Every component should have exactly the access it needs and no more. This is a design decision, not a configuration one, and it is cheapest at design time.

The test: *if this component were fully compromised, what could the attacker reach?* If the answer is "everything", the design is wrong regardless of how well the component is written.

## 15.4 Standards

### 15.4.1 Secrets

| ID | Rule |
|---|---|
| **SEC-01** | Secrets MUST NOT be committed to a repository, in any form, in any branch, at any time. **Constitutional (§30)** |
| **SEC-02** | Secrets MUST be provided by environment or a secret manager, never in configuration files |
| **SEC-03** | `.gitignore` MUST exclude environment files **before the first commit** |
| **SEC-04** | Secret scanning and push protection MUST be enabled on every repository |
| **SEC-05** | A committed secret MUST be treated as compromised and rotated immediately, even in a private repository, even if removed within seconds |
| **SEC-06** | Secrets MUST NOT be passed as command-line arguments — they appear in process listings |
| **SEC-07** | Secrets MUST NOT appear in logs, error messages, stack traces, or diagnostics. Redaction MUST be at the sink |
| **SEC-08** | Secrets MUST NOT be entered into an AI prompt (PRM-N1) |
| **SEC-09** | Each secret MUST have the narrowest scope and shortest lifetime practical |
| **SEC-10** | Secret rotation MUST be possible without a code change, and MUST have been performed at least once |

**Rationale for SEC-05.** Repository history is copied, cached, mirrored, and indexed. "I removed it immediately" is not a defence: automated scanners monitoring public repositories operate in seconds, and internal copies persist indefinitely. Rotation is the only response.

**Rationale for SEC-10.** A rotation procedure that has never been executed is a hypothesis, and it will be tested for the first time during an incident — when the credential is already compromised and time matters.

### 15.4.2 Environment Variables and Configuration

| ID | Rule |
|---|---|
| **SEC-11** | Configuration MUST be validated at startup. Missing or invalid values MUST fail fast and loudly |
| **SEC-12** | An unknown or misspelled configuration key MUST be an error, not silently ignored |
| **SEC-13** | Configuration MUST be documented in a committed example file containing no real values |
| **SEC-14** | Configuration MUST NOT be logged in full; secret values render as a placeholder |
| **SEC-15** | Defaults MUST be the **safe** option. Insecure behaviour MUST be opt-in and explicit |
| **SEC-16** | A missing secret MUST NOT cause a fallback to a less secure path |

**Rationale for SEC-12.** A misspelled key that is silently ignored means the operator believes a setting took effect when it did not. When the setting is a security control, the system is running in an unintended configuration and nobody knows.

**Rationale for SEC-16.** This exists because of a specific and plausible incident shape: a credential expires overnight, the authenticated path fails, and a "helpful" fallback silently downgrades to an unauthenticated or less-restricted path. A trivial operational event becomes a security incident. Fail closed.

### 15.4.3 Authentication

| ID | Rule |
|---|---|
| **SEC-17** | Authentication MUST use a well-established library or provider. **Hand-rolled authentication is prohibited** |
| **SEC-18** | Passwords, where stored, MUST use a current password-hashing function with appropriate cost |
| **SEC-19** | Session tokens MUST be cryptographically random, expiring, and revocable |
| **SEC-20** | Authentication failures MUST NOT reveal which factor was wrong |
| **SEC-21** | Authentication endpoints MUST be rate-limited and MUST have lockout or backoff |
| **SEC-22** | Multi-factor authentication MUST be supported for administrative access (T4) |
| **SEC-23** | Credentials MUST be transmitted only over encrypted transport |

### 15.4.4 Authorisation

| ID | Rule |
|---|---|
| **SEC-24** | Authorisation MUST be checked at a **single choke point** per surface, not scattered across handlers |
| **SEC-25** | Authorisation MUST default to **deny** |
| **SEC-26** | Every request MUST be authorised — including internal service calls (T4) |
| **SEC-27** | Object-level authorisation MUST be checked, not only route-level. "Can this user access **this** record?" |
| **SEC-28** | Authorisation MUST NOT depend on client-supplied claims about identity or role |
| **SEC-29** | Privileged operations MUST be logged with actor, action, target, and outcome |
| **SEC-30** | Multi-tenant systems MUST enforce tenant isolation at the data-access layer, structurally |

**Rationale for SEC-27.** Broken object-level authorisation is one of the most common and most damaging web vulnerabilities: the route check passes, and the handler fetches whichever record the identifier names. It is invisible in review unless specifically looked for, and it is trivially exploitable by changing a number.

**Rationale for SEC-30.** Tenant isolation enforced by remembering to add a filter clause will eventually be forgotten in one query. Enforced at the data-access layer — where a query without a tenant scope is impossible to express — it holds permanently.

### 15.4.5 Input Validation

| ID | Rule |
|---|---|
| **SEC-31** | All external input MUST be validated at the boundary: type, shape, range, length, format |
| **SEC-32** | Validation MUST be **allowlist**-based where the valid set is enumerable |
| **SEC-33** | Invalid input MUST be **rejected**, not sanitised and processed |
| **SEC-34** | Size and depth limits MUST be enforced on every input, including nested structures |
| **SEC-35** | File uploads MUST validate type by content, not extension, and MUST enforce size limits |
| **SEC-36** | Database access MUST use parameterisation. String-concatenated queries are prohibited |
| **SEC-37** | Shell execution SHOULD be avoided; where necessary, arguments MUST NOT be built from untrusted input |
| **SEC-38** | Paths built from input MUST be resolved and confirmed to remain within the intended directory |
| **SEC-39** | Output MUST be encoded for its context at the point of use |
| **SEC-40** | Untrusted content rendered in a UI MUST be treated as text, never as markup |

**Rationale for SEC-33.** Sanitising and continuing means guessing what the sender meant. That guess is where injection vulnerabilities live: the sanitiser removes what it knows about, the guess passes through what it does not, and the result is trusted downstream. Rejection is unambiguous.

### 15.4.6 Rate Limiting and Abuse

| ID | Rule |
|---|---|
| **SEC-41** | Public endpoints MUST be rate-limited |
| **SEC-42** | Expensive operations MUST be limited independently of general traffic |
| **SEC-43** | Limits MUST be per-identity where identity exists, not only per-address |
| **SEC-44** | Exceeding a limit MUST return a clear response with retry guidance |
| **SEC-45** | Limits MUST fail **closed** — an unavailable limiter denies rather than allows |
| **SEC-46** | Outbound calls to third parties MUST be limited and MUST have circuit breaking (T3+) |

### 15.4.7 Encryption

| ID | Rule |
|---|---|
| **SEC-47** | All network transport MUST be encrypted. Plaintext transport is prohibited |
| **SEC-48** | Personal and sensitive data MUST be encrypted at rest (T4) |
| **SEC-49** | Cryptographic primitives MUST come from a vetted library. **Implementing cryptography is prohibited** |
| **SEC-50** | Keys MUST be managed by a key management system or the platform's secret store, never in code |
| **SEC-51** | Deprecated algorithms and protocol versions MUST NOT be used |
| **SEC-52** | Randomness for security purposes MUST come from a cryptographically secure source |

### 15.4.8 Dependencies and Supply Chain

| ID | Rule |
|---|---|
| **SEC-53** | Dependencies MUST be pinned by lockfile; CI installs from it exactly |
| **SEC-54** | Automated vulnerability audit MUST run on every build and MUST block on high severity |
| **SEC-55** | Dependencies with install scripts, native compilation, or deep transitive trees require security review |
| **SEC-56** | Dependency updates MUST arrive by pull request with a green build |
| **SEC-57** | Code that ships to an environment TradyPerch does not control MUST have zero or minimal dependencies |
| **SEC-58** | The dependency set MUST be reviewed quarterly and unused dependencies removed |

**Rationale for SEC-57.** A dependency in code executing on a customer's environment is a supply-chain risk multiplied by every customer, and TradyPerch cannot patch it on their behalf.

### 15.4.9 Data Protection

| ID | Rule |
|---|---|
| **SEC-59** | Personal data MUST be identified and inventoried at design time |
| **SEC-60** | Collect the minimum necessary; retain for the minimum necessary period |
| **SEC-61** | Personal data MUST NOT appear in logs, error messages, analytics, or AI prompts |
| **SEC-62** | Deletion requests MUST be supported and MUST actually delete, including from backups per policy |
| **SEC-63** | Test and development environments MUST NOT contain production personal data |
| **SEC-64** | Data exports MUST be authorised, logged, and rate-limited |

**Rationale for SEC-63.** Copying production data to a development environment is one of the most common and most serious data exposures, because development environments have weaker access control, more people, and looser monitoring — and the copy is usually forgotten.

### 15.4.10 The OWASP Baseline

Every T3+ project reviews against the current OWASP Top Ten. The categories are stable enough to design against even as their numbering changes:

| Category | Primary Control |
|---|---|
| Broken access control | SEC-24…SEC-30 — single choke point, object-level checks, deny by default |
| Cryptographic failures | SEC-47…SEC-52 — vetted libraries, encrypted transport and storage |
| Injection | SEC-31…SEC-40 — validate at boundary, parameterise, encode at use |
| Insecure design | Threat modelling (§15.4.11); least privilege |
| Security misconfiguration | SEC-11…SEC-16 — validated configuration, safe defaults, fail closed |
| Vulnerable components | SEC-53…SEC-58 — pinning, audit, review |
| Authentication failures | SEC-17…SEC-23 — established libraries, rate limits, revocable sessions |
| Integrity failures | Lockfiles, signed artifacts, verified deployment |
| Logging and monitoring failures | §17, plus SEC-29 |
| Server-side request forgery | Allowlist outbound destinations; never fetch a URL supplied by a user without validation |

### 15.4.11 Threat Modelling (T4)

| ID | Rule |
|---|---|
| **SEC-65** | T4 projects MUST produce a threat model during planning |
| **SEC-66** | It MUST identify trust boundaries, assets, actors, and attack paths |
| **SEC-67** | Each threat MUST have a control, and each control MUST have a verification |
| **SEC-68** | It MUST be revisited when the architecture changes |
| **SEC-69** | Accepted residual risks MUST be recorded explicitly with an owner |

### 15.4.12 Security Review Triggers

Review is required — not merely recommended — when a change:

| Trigger |
|---|
| Touches authentication or authorisation |
| Handles secrets, tokens, or keys |
| Processes untrusted input in a new way |
| Adds an external integration |
| Changes data access patterns or tenancy boundaries |
| Adds a dependency with install scripts or native code |
| Changes deployment permissions or infrastructure access |
| Exposes a new public endpoint |
| Handles personal data in a new way |
| Is a T4 change of any kind |

### 15.4.13 AI-Specific Security Rules

| ID | Rule |
|---|---|
| **SEC-70** | Secrets and personal data MUST NOT be entered into any AI tool |
| **SEC-71** | Agent-generated code touching security surfaces MUST receive S4/S5 supervision (§2.3.5) |
| **SEC-72** | Content generated by an AI from untrusted input MUST be treated as untrusted |
| **SEC-73** | Where an agent has tool access, the tools' permissions MUST be scoped to the task |
| **SEC-74** | Agent-authored code MUST NOT be exempt from any security control |

**Rationale for SEC-72.** If an agent summarises user-submitted content, the summary is derived from untrusted input and may carry injected instructions or hostile markup. Treating agent output as trusted because it came from your own system is the same category error as trusting a database row that originated as user input.

## 15.5 Real-World Examples

### Example 1 — The Committed Key

An API key is committed and removed nine minutes later. It is not rotated, on the reasoning that the repository is private and exposure was brief. Six weeks later the key is used from an unfamiliar address.

| | |
|---|---|
| Rule | SEC-05 |
| Root cause | Believing removal is remediation |
| Correct action | Rotate immediately, always, without discussion |

### Example 2 — Object-Level Authorisation Missing

An endpoint checks that the caller is authenticated and has the "customer" role. It then fetches the record named in the path parameter. Any customer can read any other customer's record by changing the number.

| | |
|---|---|
| Rule | SEC-27 |
| Why review missed it | The route check looked correct, and it was — at the route level |
| Structural fix | Data access requires an authorisation context; a query without one does not compile |

### Example 3 — The Insecure Fallback

An integration authenticates with a token. The token expires. The client falls back to an unauthenticated public endpoint "so the feature keeps working". Data that should have been scoped to one account is fetched globally for three weeks.

| | |
|---|---|
| Rule | SEC-16 |
| Root cause | A fallback that degrades security rather than failing |
| Correct behaviour | Fail closed, alert, and let the feature be unavailable |

### Example 4 — Production Data in Development

A production database snapshot is restored into a development environment for debugging. The environment has no access control and is reachable internally. It remains for eleven months.

| | |
|---|---|
| Rule | SEC-63 |
| Structural fix | Anonymised data generation as the standard path, so the shortcut is never needed |

## 15.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Secret committed, then removed | Compromised credential still valid | SEC-05 |
| 2 | Route-level authorisation only | Any user reaches any record | SEC-27 |
| 3 | Sanitising instead of rejecting | Injection through the gaps | SEC-33 |
| 4 | Insecure fallback on auth failure | Silent privilege escalation | SEC-16 |
| 5 | Scattered authorisation checks | One handler missing it | SEC-24 |
| 6 | Personal data in logs | Exposure through observability | SEC-61, LOG-04 |
| 7 | Production data in development | Wide exposure | SEC-63 |
| 8 | Hand-rolled cryptography or authentication | Subtle, exploitable flaws | SEC-17, SEC-49 |
| 9 | Rate limiter fails open | Abuse during degradation | SEC-45 |
| 10 | Client-supplied role claims trusted | Trivial privilege escalation | SEC-28 |
| 11 | Secrets in AI prompts | Exposure to a third party | SEC-70 |
| 12 | Unknown config key silently ignored | Security control not actually enabled | SEC-12 |

## 15.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-99** | **Security by Obscurity** | Relying on an endpoint being unknown | Assume it is known |
| **AP-100** | **The Trusted Client** | Enforcing rules in the client only | Server-side enforcement, always |
| **AP-101** | **Fail Open** | On error, allowing the operation | SEC-25, SEC-45 |
| **AP-102** | **The God Credential** | One key with access to everything | SEC-09 |
| **AP-103** | **Sanitise and Continue** | Cleaning input rather than rejecting it | SEC-33 |
| **AP-104** | **Security Theatre** | Controls that look protective and are not | Threat model against real attack paths |
| **AP-105** | **The Temporary Bypass** | Auth disabled for debugging, left disabled | Never in shared environments; automated detection |
| **AP-106** | **Trust the Agent's Output** | Treating AI-generated content as trusted | SEC-72 |

## 15.8 Decision Tables

### 15.8.1 Does This Need Security Review?

| Question | Review |
|---|---|
| Does it touch authentication or authorisation? | ✅ |
| Does it handle secrets or keys? | ✅ |
| Does it process untrusted input in a new way? | ✅ |
| Does it add an external integration? | ✅ |
| Does it change who can access what? | ✅ |
| Does it handle personal data? | ✅ |
| Does it add a dependency with install scripts? | ✅ |
| Is it T4? | ✅ **always** |
| Is it a UI change with no data-access change? | ❌ |

### 15.8.2 Where Does This Control Belong?

| Control | Location |
|---|---|
| Input shape validation | Boundary, at entry |
| Business-rule validation | Domain layer |
| Authorisation | Single choke point per surface |
| Rate limiting | Edge, before expensive work |
| Output encoding | Point of use, per context |
| Secret loading | Startup, once, into a sealed structure |
| Redaction | Log sink |
| Tenant scoping | Data-access layer, structurally |
| Audit logging | Where the decision is made |

### 15.8.3 Handling a Suspected Exposure

| Step | Action |
|---|---|
| 1 | **Rotate immediately.** Do not investigate first |
| 2 | Assess what the credential could reach |
| 3 | Check access logs for use during the exposure window |
| 4 | Preserve evidence |
| 5 | Notify per policy — legal and customer obligations may apply |
| 6 | Root-cause analysis (§12) |
| 7 | Add the structural control that would have prevented it |

## 15.9 Checklists

### CHK-15.1 · Security Review of a Change

- [ ] No secret, key, or credential anywhere in the diff, including tests and fixtures
- [ ] All external input validated at the boundary; invalid input **rejected**
- [ ] Output encoded for its context at the point of use
- [ ] Authorisation checked at the object level, not only the route
- [ ] Authorisation defaults to deny
- [ ] No client-supplied claim about identity or role is trusted
- [ ] Database access parameterised
- [ ] No untrusted input reaches a shell, path, or log format string
- [ ] Errors reveal nothing about internals
- [ ] Personal data absent from logs and error messages
- [ ] Rate limits present on new public surfaces
- [ ] New dependencies reviewed
- [ ] Failure paths fail **closed**

### CHK-15.2 · Pre-Release Security (T3+)

- [ ] Dependency audit clean of high severity
- [ ] Secret scan clean across all branches and history
- [ ] Authentication and authorisation tested, including negative cases
- [ ] Rate limits verified under load
- [ ] Transport encryption verified end to end
- [ ] Security headers configured (web)
- [ ] Least privilege verified for every service account and token
- [ ] Threat model current (T4)
- [ ] Rotation procedure executed at least once
- [ ] Incident response contact and procedure documented

## 15.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Secret committed | Medium | **Critical** | SEC-01…SEC-05, scanning, push protection | Low — but irreversible |
| Broken object-level authorisation | **Medium** | **Critical** | SEC-27; structural authorisation context | Medium |
| Injection through sanitise-and-continue | Medium | High | SEC-33, SEC-36, SEC-39 | Low |
| Insecure fallback on auth failure | Low | **Critical** | SEC-16 | Low |
| Personal data in logs | Medium | High | SEC-61, sink-level redaction | Low |
| Vulnerable dependency | High | Medium | SEC-53…SEC-56, blocking audit | Medium |
| Production data in a lower environment | Medium | High | SEC-63; anonymised generation as the default path | Medium |
| Agent-generated code bypasses a control | Low | High | SEC-71, SEC-74 | Low |
| Security review skipped under deadline | Medium | **Critical** | §15.4.12 triggers; release checklist | Medium |

## 15.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Automated authorisation-coverage checking | v1.2 | Detect endpoints lacking object-level checks |
| Anonymised test-data generation service | v1.1 | Removes the incentive behind SEC-63 violations |
| Structural tenant-scoping library | v1.2 | Makes SEC-30 impossible to forget |
| Automated secret rotation | v1.2 | Makes SEC-10 routine |
| Security-review request tooling | v1.1 | Triggers a review automatically from changed paths |

---

*End of Part 8. Part 9 covers performance and observability — making systems fast enough and knowable in production.*
