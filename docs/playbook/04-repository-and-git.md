# Part 4 — Repository and Git Standards

*Sections 6 and 7. The substrate. Every other standard in this handbook is enforced through, or recorded in, the repository. A repository that is inconsistent, unnavigable, or has an untrustworthy history makes every downstream discipline harder — and makes agent contributions markedly worse, because an agent's first act on any project is to infer conventions from what it sees.*

---

# 6. Repository Standards

## 6.1 Purpose

To make every TradyPerch repository navigable by someone — human or agent — who has never seen it, within minutes, and to make the location of any given kind of file predictable without asking.

## 6.2 Objectives

1. Standardise repository naming so that a repository's purpose is evident from its name.
2. Standardise folder hierarchy so that "where does this file go?" has one answer.
3. Give a decision framework for monorepo versus polyrepo, rather than a default that is applied thoughtlessly.
4. Standardise the README so that the first ninety seconds in a repository are productive.
5. Define versioning so that consumers can reason about compatibility.
6. Make convention discoverable, because agents infer conventions from structure far more strongly than from documentation.

## 6.3 Engineering Rationale

### 6.3.1 Structure Is the Highest-Bandwidth Documentation

A newcomer forms a model of a codebase from its directory tree before reading a line of prose. That model determines where they look, what they assume, and where they put new code. This is even more true of agents, which reason strongly from the immediate structural context.

**Consequences:**

- A consistent tree across projects means the model transfers between them.
- A directory whose name states a rule (`domain/`, `adapters/`, `internal/`) enforces that rule better than a paragraph in a document nobody opens.
- A misplaced file teaches the next person — and the next agent — that placement is arbitrary, and the structure decays from there.

### 6.3.2 Why Naming Deserves Rules

Repository names are permanent in practice: they appear in URLs, CI configuration, deployment targets, documentation, and bookmarks. Renaming is possible and always more disruptive than expected. Ten minutes of thought at creation is worth it.

A name should answer: *what is this, and what kind of thing is it?* Nothing else.

### 6.3.3 Monorepo vs Polyrepo Is a Coupling Decision

The debate is usually conducted as a matter of taste. It is not; it is a question about **coupling and release cadence**.

| If… | Then |
|---|---|
| Components must change together and release together | **Monorepo.** Atomic cross-component changes are the whole point |
| Components release independently at different cadences | **Polyrepo.** A shared repository forces coordination that does not otherwise exist |
| Components share substantial code | Monorepo, or a published shared package |
| Components have different access requirements | **Polyrepo.** Access control is per repository |
| The team is small and the components are few | Monorepo — less overhead, less duplication of tooling |
| Components have genuinely different lifecycles or owners | Polyrepo |

**The failure mode of each:** a monorepo that grows until CI takes twenty minutes for a one-line change and nobody can tell what a change affects; a polyrepo set where a single logical change requires five coordinated pull requests and a release dance.

**Default at TradyPerch's current scale: one repository per deployable product**, with a monorepo when a product genuinely has multiple deployables that release together.

### 6.3.4 Versioning Is a Promise

A version number is a compatibility statement to consumers. Semantic versioning is used not because it is fashionable but because it makes that statement machine-readable: a consumer can decide whether an upgrade is safe without reading a changelog.

The discipline that makes it work is honesty about what constitutes a breaking change — which is broader than most teams assume (§6.4.6).

## 6.4 Standards

### 6.4.1 Repository Naming

| ID | Rule |
|---|---|
| **REPO-01** | Names MUST be lowercase kebab-case, ASCII, ≤ 40 characters |
| **REPO-02** | Names MUST describe the thing, not the technology. `tp-invoicing`, not `tp-react-invoicing` |
| **REPO-03** | Product repositories MUST carry the `tp-` prefix |
| **REPO-04** | Names MUST NOT contain a version, a year, a person, or a status word (`new`, `v2`, `final`, `temp`) |
| **REPO-05** | The name MUST be decided at creation and MUST NOT be changed casually |

| Kind | Pattern | Example |
|---|---|---|
| Product | `tp-<product>` | `tp-reviews-engine` |
| Service | `tp-<domain>-service` | `tp-billing-service` |
| Library | `tp-<capability>` | `tp-http-client` |
| CLI | `tp-<name>-cli` | `tp-deploy-cli` |
| Extension | `tp-<name>-extension` | `tp-clipper-extension` |
| Mobile app | `tp-<product>-mobile` | `tp-fieldwork-mobile` |
| Infrastructure | `tp-infra-<scope>` | `tp-infra-core` |
| Internal tool | `tp-tool-<name>` | `tp-tool-onboarding` |
| Documentation | `tp-docs-<scope>` | `tp-docs-engineering` |
| Template | `tp-template-<kind>` | `tp-template-service` |

### 6.4.2 Root Structure

Every TradyPerch repository has a predictable root. Items marked **required** apply at T2+.

| Item | Required | Purpose |
|---|---|---|
| `README.md` | **Yes** | The first ninety seconds |
| `LICENSE` | **Yes** | Legal clarity, even internally |
| `CHANGELOG.md` | T3+ | What changed, per release |
| `CONTRIBUTING.md` | T3+ | How to work here |
| `SECURITY.md` | T3+ | How to report a vulnerability |
| `.gitignore` | **Yes** | Never commit build output, dependencies, or secrets |
| `.gitattributes` | **Yes** | Line endings and binary declarations |
| `.editorconfig` | **Yes** | Editor defaults |
| `.env.example` | If env vars are used | Documented template, no real values |
| `AGENTS.md` or equivalent | **Yes** | Standing context for AI agents (§4.4.6) |
| `docs/` | T2+ | Architecture, decisions, runbooks |
| `src/` | **Yes** | Source. Nothing executable at the root |
| `tests/` | T2+ | Tests, mirroring `src/` |
| `scripts/` | As needed | Maintenance and tooling |
| CI configuration | T2+ | The automated gates |

| ID | Rule |
|---|---|
| **REPO-06** | The repository root MUST NOT contain source files. Everything executable lives under `src/` or `scripts/` |
| **REPO-07** | `.gitattributes` MUST enforce LF line endings for text files |
| **REPO-08** | `.gitignore` MUST exclude dependencies, build output, environment files, and local state — **before the first commit** |
| **REPO-09** | An agent standing-context file MUST exist and MUST be version-controlled and reviewed like code |

**Rationale for REPO-07.** Line endings are not a style question wherever content is hashed, signed, or byte-compared. A CRLF checkout on one developer's machine produces different bytes from everyone else's, which silently breaks content-addressed comparison, inflates diffs, and produces "changed" files that contain no change.

**Rationale for REPO-08.** `.gitignore` must be correct before the first commit, because the first thing a mistake here does is commit a secret or a 200 MB dependency tree — and both are permanent in history.

### 6.4.3 Folder Hierarchy

The internal shape depends on the project type, but three rules are universal:

| ID | Rule |
|---|---|
| **REPO-10** | Organise by **layer or domain**, never by file type. `features/billing/` not `controllers/`, `models/`, `views/` |
| **REPO-11** | Every directory whose contents are governed by a rule MUST contain a README stating that rule in one paragraph |
| **REPO-12** | Nesting SHOULD NOT exceed four levels below `src/` |

**Rationale for REPO-10.** Type-based organisation scatters every feature across the tree, so a single change touches five directories and no directory tells you what the system does. Domain-based organisation co-locates what changes together, which is the property that matters. It also matters more for agents: an agent given `features/billing/` has the whole feature in view; an agent given `controllers/` has a third of five features.

**Rationale for REPO-11.** A rule stated where the work happens is read; the same rule in a handbook is not. This single practice does more to preserve architecture than any amount of documentation elsewhere.

**Reference shapes by project type** — adapt, do not invent from scratch:

| Project Type | Top-level under `src/` |
|---|---|
| Backend service | `api/` (transport), `domain/` (logic, pure), `data/` (persistence), `integrations/` (external), `platform/` (cross-cutting) |
| Web application | `app/` (routes/pages), `features/` (by domain), `components/` (shared UI), `lib/` (utilities), `styles/` |
| CLI | `cli/` (commands, parsing), `core/` (logic, pure), `adapters/` (I/O), `config/` |
| Library | `src/` by capability, one public entry point |
| Mobile app | `screens/`, `features/`, `components/`, `services/`, `store/` |
| Browser extension | `background/`, `content/`, `popup/`, `options/`, `shared/` |
| Automation system | `pipelines/`, `steps/`, `adapters/`, `config/` |
| Desktop app | `main/` (process), `renderer/` (UI), `shared/` (IPC contracts) |

**One invariant across all shapes: business logic is separated from I/O.** Whatever the names, there is a part that can be tested without the network, the filesystem, the clock, or a UI. That separation is the single highest-value structural decision in any codebase (§9).

### 6.4.4 Naming Conventions Within a Repository

| Element | Convention | Rationale |
|---|---|---|
| Directories | `kebab-case` | Case-insensitive filesystems make mixed case a portability hazard |
| Source files | `kebab-case` matching the primary export | Predictable, greppable |
| Test files | `<subject>.<behaviour>.test.<ext>` | Location and name both indicate the subject |
| Configuration files | Tool convention | Do not fight tooling defaults |
| Documentation | `kebab-case.md` | Consistency |
| Environment variables | `SCREAMING_SNAKE_CASE`, project prefix | Namespacing prevents collisions |
| Feature flags | `SCREAMING_SNAKE_CASE`, verb-shaped | `ENABLE_X`, not `X_FLAG` |

| ID | Rule |
|---|---|
| **REPO-13** | A file's name MUST match its primary export |
| **REPO-14** | Test files MUST mirror the structure of what they test |
| **REPO-15** | Environment variables MUST carry a project prefix |

### 6.4.5 README Standard

The README is read more than any other document. It has ninety seconds to be useful.

| # | Section | Answers | Required |
|---|---|---|---|
| 1 | **What this is** — two sentences | "Am I in the right place?" | **Yes** |
| 2 | **Status** — active/maintenance/deprecated, owner | "Should I use this?" | **Yes** |
| 3 | **Quick start** — clone to running | "How do I run it?" | **Yes** |
| 4 | **How it works** — one paragraph + one diagram | "What is the shape?" | T2+ |
| 5 | **Common tasks** — the five things people do | "How do I do the thing?" | T2+ |
| 6 | **Configuration** — or a pointer | "What can I change?" | T2+ |
| 7 | **Testing** — how to run them | "How do I verify?" | T2+ |
| 8 | **Deployment** — or a pointer | "How does it ship?" | T3+ |
| 9 | **Documentation index** | "Where is the detail?" | T2+ |
| 10 | **Getting help** — who to ask | "I'm stuck" | **Yes** |

| ID | Rule |
|---|---|
| **REPO-16** | The quick start MUST work on a clean machine. It MUST be verified at least quarterly |
| **REPO-17** | The README MUST state the current owner |
| **REPO-18** | The README MUST NOT duplicate detail available elsewhere — it links |
| **REPO-19** | A deprecated repository's README MUST say so in the first line, and name the replacement |

**Rationale for REPO-16.** A broken quick start is the most common documentation defect and the most expensive: it fails at the exact moment someone is forming their opinion of the codebase, and it costs them an hour of debugging something that is not their problem.

### 6.4.6 Versioning

| ID | Rule |
|---|---|
| **VER-01** | Semantic versioning: `MAJOR.MINOR.PATCH` |
| **VER-02** | MAJOR for any breaking change to a public contract |
| **VER-03** | MINOR for backward-compatible additions |
| **VER-04** | PATCH for backward-compatible fixes |
| **VER-05** | Pre-1.0 (`0.x`) means the contract is unstable; MINOR may break |
| **VER-06** | Every release MUST have a git tag and a changelog entry |
| **VER-07** | Data and API schemas MUST be versioned independently of the software |

**What counts as breaking — broader than most teams assume:**

| Change | Breaking? |
|---|---|
| Removing or renaming a public function, field, endpoint, or CLI flag | **Yes** |
| Adding a required parameter or field | **Yes** |
| Changing a default value | **Yes** — behaviour changes for existing users |
| Narrowing accepted input | **Yes** |
| Widening returned output | Usually no; **yes** if consumers validate strictly |
| Changing an error code, type, or message that consumers match on | **Yes** |
| Changing observable ordering | **Yes** if anyone depends on it — and someone always does |
| Changing timing or performance characteristics materially | Sometimes; announce it |
| Adding an optional parameter with a safe default | No |
| Fixing a bug that some consumer depends on | **Treat as breaking** and announce |

**Rationale for the last row.** "It was a bug" is a true statement that does not help a consumer whose system stops working. Hyrum's observation applies: with enough users, every observable behaviour of a system is depended upon by somebody. The correct handling is to announce, not to argue.

## 6.5 Real-World Examples

### Example 1 — The Name That Lied

A repository named `tp-api` was created for one service. Three services later, `tp-api` holds one of them, and every new engineer assumes it is the API gateway. Renaming would break deployment configuration in four places, so it stays.

| | |
|---|---|
| Root cause | A name describing a category rather than a thing |
| Rule | REPO-02 |
| Cost | Permanent low-grade confusion, indefinitely |

### Example 2 — Organisation by File Type

A web application organised as `components/`, `hooks/`, `utils/`, `pages/`. Adding one feature touches all four directories. Removing a feature requires finding its pieces in all four, and two of them are shared with another feature — but nobody can tell which parts.

| | |
|---|---|
| Root cause | Type-based organisation |
| Rule | REPO-10 |
| Symptom to watch for | "Where does this file go?" having more than one plausible answer |

### Example 3 — The Quick Start That Never Worked

A README's setup instructions were written during initial development and never re-run. Two dependencies changed names, one step is now unnecessary, and a required environment variable is undocumented. Every new engineer loses an hour.

| | |
|---|---|
| Root cause | Documentation that is never executed |
| Rule | REPO-16 |
| Fix that works | Have the newest team member follow it verbatim, quarterly, and fix what fails |

### Example 4 — The Undeclared Breaking Change

A library changes a default timeout from 30 s to 5 s in a PATCH release, reasoning that "it's just a default". Four downstream services begin timing out under load. The release notes say "improved timeout handling".

| | |
|---|---|
| Root cause | Default change not recognised as breaking |
| Rule | VER-02, and the breaking-change table |
| Correct handling | MAJOR bump, or MINOR with an explicit announcement and a migration note |

## 6.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Technology in the repository name | The name is wrong after a migration | REPO-02 |
| 2 | Organising by file type | Every change touches every directory | REPO-10 |
| 3 | Deep nesting | Six-level paths; nobody can remember where anything is | REPO-12 |
| 4 | README written once | Confidently wrong instructions | REPO-16, quarterly verification |
| 5 | Committing build output or dependencies | Enormous repository, painful diffs | REPO-08, before the first commit |
| 6 | No `.gitattributes` | Line-ending churn; false diffs | REPO-07 |
| 7 | Treating a default change as non-breaking | Silent downstream failures | The breaking-change table |
| 8 | Monorepo by default without a coupling reason | Slow CI, unclear ownership | §6.3.3's decision table |
| 9 | Polyrepo by default | Five coordinated PRs for one change | §6.3.3 |
| 10 | No standing-context file for agents | Every agent session re-derives conventions, inconsistently | REPO-09 |

## 6.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-36** | **The Junk Drawer** | `utils/`, `helpers/`, `common/`, `misc/` growing without bound | Name by responsibility. If it cannot be named, it does not belong together |
| **AP-37** | **The Ghost Repository** | Nobody knows if it is used; nobody dares delete it | REPO-17 owner; §20's retirement stage |
| **AP-38** | **Structure by Accident** | The tree reflects the order features were added | Periodic structural review; REPO-10 |
| **AP-39** | **The Undocumented Prerequisite** | Setup works only if you already have something installed | REPO-16 on a clean machine |
| **AP-40** | **Version Theatre** | Version numbers incremented without meaning | VER-02; consumers must be able to rely on it |
| **AP-41** | **The Copy-Paste Repository** | A new project created by copying an old one, inheriting its cruft | Templates (`tp-template-*`), maintained deliberately |

## 6.8 Decision Tables

### 6.8.1 New Repository or Existing?

| Question | New Repository | Existing |
|---|---|---|
| Does it deploy independently? | ✅ | — |
| Does it have a different owner? | ✅ | — |
| Does it have different access requirements? | ✅ | — |
| Does it release on a different cadence? | ✅ | — |
| Does it share substantial code with an existing product? | — | ✅ |
| Does it change together with an existing product? | — | ✅ |
| Is it a genuinely separate product? | ✅ | — |
| Are you unsure? | — | ✅ Start inside; splitting later is easier than merging |

### 6.8.2 Where Does This File Go?

| The file… | Goes in |
|---|---|
| Contains business rules with no I/O | The pure/domain layer |
| Talks to a database, network, filesystem, or clock | The adapter/integration layer |
| Handles HTTP, CLI arguments, or UI events | The transport/entry layer |
| Is used by exactly one feature | Inside that feature |
| Is used by three or more features and is domain-agnostic | The shared/platform layer |
| Is used by two features | **Leave it duplicated** until a third appears |
| Configures a tool | The root, per tool convention |
| Is a one-off script | `scripts/`, with a header explaining when to run it |

**The two-user rule is deliberate.** Extracting a shared abstraction from two uses is premature more often than not: the two uses have not yet revealed which parts are genuinely common. The third use is where the real shape becomes visible.

## 6.9 Checklists

### CHK-6.1 · New Repository

- [ ] Name follows REPO-01…REPO-05 and describes the thing, not the technology
- [ ] `.gitignore` and `.gitattributes` are the **first** commit
- [ ] README covers all required sections for the tier
- [ ] Owner is named in the README
- [ ] LICENSE present
- [ ] Standing-context file for agents present
- [ ] Directory structure follows a reference shape for the project type
- [ ] Directory READMEs exist wherever a rule governs contents
- [ ] CI configured and green on the first commit
- [ ] Branch protection enabled before the second commit
- [ ] Secret scanning enabled
- [ ] Conformance tier recorded

### CHK-6.2 · Quarterly Repository Health

- [ ] Quick start executed on a clean machine and works
- [ ] Owner still correct and still here
- [ ] Dependencies audited
- [ ] Dead code and dead directories removed
- [ ] Structure still matches how the system actually works
- [ ] Standing-context file still accurate
- [ ] README's "common tasks" still the common tasks

## 6.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Structure decays as features are added | High | Medium | Directory READMEs; quarterly review; REPO-10 | Medium |
| Secret committed to history | Low | **Critical** | `.gitignore` first; secret scanning; §15 | Low — irreversible if it occurs |
| Quick start rots | High | Medium | Quarterly verification | Low |
| Repository sprawl | Medium | Medium | §6.8.1; ownership; retirement (§20) | Medium |
| Breaking change shipped as PATCH | Medium | High | The breaking-change table; release checklist | Low |
| Agent infers wrong conventions from inconsistent structure | Medium | Medium | Consistency; standing-context file; directory READMEs | Low |

## 6.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Maintained repository templates per project type | v1.1 | Removes the copy-paste anti-pattern (AP-41) |
| Automated structure conformance check | v1.2 | Assert the tree against a declared manifest |
| Repository inventory with owners and status | v1.1 | Prevents ghost repositories |
| Automated quick-start verification in CI | v1.2 | Run the README's steps in a clean container weekly |

---

# 7. Git Standards

## 7.1 Purpose

To keep history readable, changes small and revertible, and the main branch always releasable — so that history is a usable engineering tool rather than a record of how the code came to be.

## 7.2 Objectives

1. Define one branching model that fits every TradyPerch project.
2. Standardise commit messages so history is scannable and machine-parseable.
3. Keep changes small enough to review properly.
4. Define pull request standards that make review effective rather than ceremonial.
5. Define release tagging and rollback so that reverting is routine.
6. Make history an asset for debugging (§12) rather than noise.

## 7.3 Engineering Rationale

### 7.3.1 Why Trunk-Based

Long-lived branches accumulate three costs simultaneously: merge conflict risk grows with time and change volume; the branch diverges from reality so its tests prove less each day; and the eventual merge is large, which is exactly the condition under which review fails.

Trunk-based development — short branches, merged within about two days — trades a small ongoing coordination cost for the elimination of a large, unpredictable one. It also directly serves §1.3.1's central point: small changes are cheap to verify, and verification is the bottleneck.

**The specific interaction with AI-assisted work:** an agent can produce a week's worth of change in an afternoon. Without a merge-frequency rule, that becomes a 3,000-line pull request that nobody can review, which is then approved on trust — AP-09. The 48-hour rule is what prevents generation speed from converting directly into review debt.

### 7.3.2 Why Commit Format Matters

Commit messages are read in exactly three situations, all of them stressful: bisecting a regression, writing release notes, and answering "why is this code like this?" during an incident. A message written for those readers is worth thirty seconds; one written as "fix stuff" costs someone an hour later.

A structured format additionally makes history machine-parseable, which is what allows changelog generation, release automation, and per-area change analysis without anyone maintaining a separate record.

### 7.3.3 Main Is Always Releasable

This is not an aspiration; it is a property that must hold at every commit. Its value is that it removes an entire class of coordination:

- Any commit can be released, so releasing is not an event.
- A revert is always safe, so rollback is not risky.
- A broken build blocks everyone, so it is fixed immediately rather than accumulating.
- Nobody has to ask "is main good right now?"

**The cost is that CI must be fast and reliable.** A slow or flaky pipeline makes this rule unenforceable, which is why §18 treats pipeline speed as a first-class requirement rather than an optimisation.

## 7.4 Standards

### 7.4.1 Branching Model

| Branch | Purpose | Lifetime | Protected |
|---|---|---|---|
| `main` | Always releasable | Permanent | **Yes** |
| `<type>/<id>-<slug>` | One task | **≤ 48 hours** | No |
| `release/<version>` | Only when a release must be stabilised while `main` advances | Days | Yes |
| `hotfix/<id>-<slug>` | Urgent production fix | Hours | No |

| Type prefix | Use |
|---|---|
| `feat/` | New capability |
| `fix/` | Defect repair |
| `refactor/` | Structure only, no behaviour change |
| `test/` | Tests only |
| `docs/` | Documentation only |
| `chore/` | Tooling, dependencies, housekeeping |
| `perf/` | Performance work |

| ID | Rule |
|---|---|
| **GIT-01** | `main` MUST be protected: review required, CI required, no force-push |
| **GIT-02** | Branches MUST be short-lived — merged or closed within 48 hours |
| **GIT-03** | One branch per task. A branch that needs "and" in its description is two branches |
| **GIT-04** | Branches MUST be rebased or updated from `main` before merge |
| **GIT-05** | Long-lived feature branches MUST NOT be used. Incomplete work merges **unreachable** instead (§7.4.6) |
| **GIT-06** | Direct commits to `main` MUST NOT be possible for anyone, including repository owners |

### 7.4.2 Commit Messages

Conventional Commits. Format:

```
<type>(<scope>): <subject>

<body — why, not what>

<footer — references, breaking changes>
```

| Element | Rule |
|---|---|
| Type | One of: `feat` `fix` `refactor` `test` `docs` `chore` `perf` `build` `ci` `revert` |
| Scope | The module or area, matching the directory structure |
| Subject | Imperative mood, ≤ 72 characters, no trailing period |
| Body | Required for anything non-trivial: **why**, what was considered, what was verified |
| Footer | Issue references; `BREAKING CHANGE:` where applicable |

| ID | Rule |
|---|---|
| **GIT-07** | Commit messages MUST follow the format. Enforced by a hook and by CI |
| **GIT-08** | The subject MUST describe the change, not the activity. ❌ "updates" ✅ "reject page sizes above the maximum" |
| **GIT-09** | A commit that fixes a defect MUST reference the issue and state the mechanism in the body |
| **GIT-10** | `BREAKING CHANGE:` MUST appear in the footer for any breaking change |
| **GIT-11** | Refactoring MUST be a separate commit from behaviour change |
| **GIT-12** | Every commit MUST leave the build green |

**Rationale for GIT-11.** A diff containing both a restructure and a behaviour change is effectively unreviewable: the reviewer cannot distinguish moved code from changed code, so the behaviour change is reviewed by accident or not at all. Separating them costs one extra commit and makes both reviewable in a fraction of the time.

### 7.4.3 Change Size

| Dimension | Target | Hard limit |
|---|---|---|
| Diff lines (excluding generated files and fixtures) | ≤ 400 | 600 |
| Files touched | ≤ 5 | 10 |
| Modules touched | 1 | 2 |
| Time from branch to merge | ≤ 24 h | 48 h |

| ID | Rule |
|---|---|
| **GIT-13** | A change exceeding the hard limits MUST be split, unless it is mechanical (a rename, a generated update) and labelled as such |
| **GIT-14** | A reviewer who cannot review a change properly MUST reject it as **too large**, not approve it provisionally |

**Rationale.** Defect detection in review falls off sharply with diff size — reviewers skim rather than read once a change exceeds a few hundred lines, and they do so without noticing. GIT-14 makes rejecting a large change a positive act rather than an admission of inadequacy.

### 7.4.4 Merge Strategy

| ID | Rule |
|---|---|
| **GIT-15** | **Squash merge** into `main`. One commit per pull request |
| **GIT-16** | The squash commit message MUST follow the commit format |
| **GIT-17** | History on `main` MUST be linear |
| **GIT-18** | Merge commits MUST NOT be used on `main` |
| **GIT-19** | `main` MUST NOT be force-pushed, ever |

**Rationale for squash merging.** It makes `main` a sequence of complete, individually revertible changes. Bisecting works because every commit builds. Reverting works because a revert undoes a whole feature, not a fragment of one. The intermediate "wip" and "fix typo" commits have no value once the work is complete, and preserving them makes history harder to read for no benefit.

### 7.4.5 Pull Requests

| Element | Requirement |
|---|---|
| Title | Conventional Commit format — it becomes the squash commit |
| Description | What changed, why, how verified |
| Specification link | Which requirement, ticket, or plan entry this implements |
| Test evidence | What was added; how a reviewer can run it |
| Risk note | What could go wrong; what to watch after deploy |
| Rollback note | How to undo it (T3+) |
| Screenshots | For any user-visible change |
| **Regression question** | For a fix: "which test would have caught this?" — with the answer |

| ID | Rule |
|---|---|
| **GIT-20** | Every change MUST go through a pull request. No exceptions, including for repository owners |
| **GIT-21** | Every pull request MUST have at least one approving review from someone who did not author it |
| **GIT-22** | S4/S5 changes (§2.3.5) MUST have two approvals, one from someone uninvolved |
| **GIT-23** | All required checks MUST pass before merge. Overriding a failing check requires a recorded reason and a second approver |
| **GIT-24** | A fix MUST include a test that fails before it and passes after |
| **GIT-25** | The author MUST NOT merge a change nobody has reviewed, including their own trivial ones |

### 7.4.6 Merging Incomplete Work

Trunk-based development requires a way to merge work that is not yet finished. There is exactly one acceptable way:

| ID | Rule |
|---|---|
| **GIT-26** | Incomplete work MAY merge only if it is **unreachable**: not exported, not registered, not routed to, not referenced by any entry point |
| **GIT-27** | Unreachable code MUST still pass all checks, including lint, types, and its own tests |
| **GIT-28** | Feature flags MAY gate incomplete user-visible work, and MUST be removed within one release of the feature being complete |
| **GIT-29** | An unimplemented function MUST fail loudly if called. It MUST NOT return an empty, null, or plausible default value |

**Rationale for GIT-29.** This is the most important rule in §7 and it connects directly to §24's prohibition on silent failure. A stub returning an empty collection is indistinguishable from a working implementation that legitimately found nothing — so if it is wired up by accident, it produces a silent, plausible, wrong result. A stub that throws is discovered in the first test run.

### 7.4.7 Tags and Releases

| ID | Rule |
|---|---|
| **GIT-30** | Releases MUST be tagged `v<MAJOR>.<MINOR>.<PATCH>` |
| **GIT-31** | Tags MUST be created from `main`, or from a `release/` branch cut from `main` |
| **GIT-32** | Every tag MUST have a changelog entry |
| **GIT-33** | Tags MUST NOT be moved or deleted once pushed |
| **GIT-34** | The release pipeline MUST re-run the full verification suite at the tag, not trust the last run on `main` |

**Rationale for GIT-34.** The tag may not point at the commit that was last verified — a merge may have landed between the verification and the tag. Re-running takes minutes and removes an entire class of "but CI was green" incident.

### 7.4.8 Rollback

| ID | Rule |
|---|---|
| **GIT-35** | Rollback MUST be by `revert`, never by force-push or history rewriting |
| **GIT-36** | A revert MUST be a normal pull request with normal checks |
| **GIT-37** | Reverting is **not** a failure and MUST NOT require justification beyond the symptom |
| **GIT-38** | After a revert, a regression test MUST be added before the change is re-attempted |
| **GIT-39** | The rollback path MUST be identified **before** release, not during the incident |

**Rationale for GIT-37.** Teams that treat reverting as an admission of failure delay it, debug in production, and extend the outage. Making revert-first the normal, unremarkable response is worth more than any amount of pre-release caution.

## 7.5 Real-World Examples

### Example 1 — The Three-Week Branch

A feature branch runs for three weeks. At merge time there are 68 conflicting files. Resolution takes two days, introduces two defects, and one of them is a silently reverted bug fix from `main`.

| | |
|---|---|
| Root cause | Long-lived branch |
| Rules | GIT-02, GIT-05 |
| Correct approach | Merge unreachable increments daily; flag the user-visible switch |

### Example 2 — The Unreviewable Pull Request

An agent generates a complete feature: 2,400 lines across 23 files. The reviewer spends forty minutes, approves it, and later cannot answer a question about how one part works.

| | |
|---|---|
| Root cause | Generation speed converted directly into review debt |
| Rules | GIT-13, GIT-14, and §3's prompt size limits |
| Correct response | Reject as too large. Not a judgement on the author — a statement about reviewability |

### Example 3 — The Stub That Shipped

An incomplete integration is merged behind a flag. The stub returns an empty list "for now". A configuration change enables the flag in staging; the feature appears to work and shows no data. Two weeks pass before anyone realises it was never implemented.

| | |
|---|---|
| Root cause | A stub returning a plausible value |
| Rule | GIT-29 |
| Correct behaviour | The stub throws. It is discovered in the first test run |

### Example 4 — History That Paid Off

A regression appears in production. `git bisect` identifies the commit in eleven minutes because every commit on `main` builds and passes tests. The commit message explains why the change was made and what was verified. The fix takes twenty minutes.

| | |
|---|---|
| Why it worked | GIT-12 (every commit green), GIT-15 (squash merge), GIT-07 (informative messages) |
| Counterfactual | With merge commits and broken intermediate states, bisect is unusable and the same investigation takes a day |

## 7.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Long-lived branches | Painful merges, lost fixes | GIT-02 |
| 2 | Enormous pull requests | Rubber-stamp approval | GIT-13, GIT-14 |
| 3 | "fix stuff" commit messages | History useless during an incident | GIT-07, GIT-08 |
| 4 | Mixing refactor and behaviour change | Behaviour change reviewed by accident | GIT-11 |
| 5 | Merging with a failing check | Broken `main` blocking everyone | GIT-23 |
| 6 | Force-pushing a shared branch | Lost work, broken clones | GIT-19 |
| 7 | Debugging forward instead of reverting | Extended outage | GIT-37 |
| 8 | Stubs returning plausible values | Silent wrong behaviour | GIT-29 |
| 9 | Tagging from an unverified commit | "But CI was green" | GIT-34 |
| 10 | Self-merging without review | Unreviewed code in production | GIT-25 |

## 7.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-42** | **The Mega Merge** | A branch so large it becomes a project of its own | GIT-02 |
| **AP-43** | **Rubber-Stamp Review** | Approval without reading, because the diff is too large or the author is trusted | GIT-14, §23.3 |
| **AP-44** | **History Rewriting** | Force-pushing shared branches to make history "clean" | GIT-19; readable ≠ rewritten |
| **AP-45** | **The Broken Trunk** | `main` fails for hours and everyone works around it | GIT-12; fixing `main` is the top priority for everyone |
| **AP-46** | **Revert Aversion** | Debugging in production to avoid the embarrassment of reverting | GIT-37 |
| **AP-47** | **The Zombie Flag** | A feature flag that outlives its feature by years | GIT-28 |
| **AP-48** | **Commit Message Poverty** | History that records activity rather than intent | GIT-08 |

## 7.8 Decision Tables

### 7.8.1 Split This Change?

| Signal | Action |
|---|---|
| Over 400 diff lines | Split |
| Over 5 files | Split |
| Touches more than one module | Split |
| The description needs "and" | Split |
| Refactor plus behaviour change | **Always split** |
| Interface change plus its implementations | Split: interface first, merged, then implementations |
| Mechanical rename across many files | Do not split — label as mechanical and review the pattern, not every line |

### 7.8.2 Revert or Fix Forward?

| Situation | Action |
|---|---|
| Production is degraded and the cause is a recent change | **Revert** |
| The cause is unclear but a recent change is suspected | **Revert** — diagnose afterwards |
| The fix is understood, verified, and under ten lines | Fix forward, with review |
| The revert would itself break something (data migration) | Fix forward, carefully, with two people |
| It is outside business hours | **Revert.** Always |
| It is a non-urgent defect in a non-critical path | Fix forward in the normal cycle |

### 7.8.3 Hotfix Process

| Step | Requirement |
|---|---|
| 1 | Branch from `main` (or the release tag) |
| 2 | Smallest change that resolves the symptom |
| 3 | Test that reproduces the failure |
| 4 | Expedited review — **still two people** for anything in a hazard module |
| 5 | Merge, tag PATCH, deploy |
| 6 | **Post-incident review within 48 hours** (§12) |
| 7 | Follow-up work scheduled if the hotfix was a stopgap |

**Step 4 is where discipline is usually lost.** Expedited means faster, not unreviewed. The changes made under time pressure are exactly the ones most likely to be wrong.

## 7.9 Checklists

### CHK-7.1 · Before Committing

- [ ] The change does one thing
- [ ] Build, lint, types, and tests pass locally
- [ ] Commit message follows the format and explains **why**
- [ ] No secrets, credentials, or personal data
- [ ] No debugging output or commented-out code
- [ ] Refactoring is separate from behaviour change
- [ ] Any new file is in the right place per §6.8.2

### CHK-7.2 · Before Opening a Pull Request

- [ ] Rebased on current `main`
- [ ] Within size limits, or the reason it is not is stated
- [ ] Description covers what, why, and how verified
- [ ] Specification or ticket linked
- [ ] Tests included; a fix's test fails before and passes after
- [ ] Rollback noted (T3+)
- [ ] Screenshots for user-visible changes
- [ ] The right reviewers are requested for the supervision level

### CHK-7.3 · Before Merging

- [ ] All checks green
- [ ] Required approvals present, including the second one for S4/S5
- [ ] All review comments resolved, not merely marked resolved
- [ ] Squash commit message is correct
- [ ] No unrelated changes crept in
- [ ] The merger is willing to own this change

## 7.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Large changes merged without real review | **High** | High | GIT-13, GIT-14, §3 size limits | Medium |
| `main` broken and blocking the team | Medium | High | GIT-12, GIT-23, fast CI | Low |
| Secret committed | Low | **Critical** | Pre-commit scanning, push protection, `.gitignore` | Low — irreversible |
| History unusable for debugging | Medium | Medium | GIT-07, GIT-15, GIT-12 | Low |
| Revert avoided during an incident | Medium | High | GIT-37; make it routine; practise it | Medium — cultural |
| Feature flags accumulate | High | Medium | GIT-28; flag inventory reviewed each release | Medium |
| Hotfix process bypasses review | Medium | High | §7.8.3 step 4; two reviewers for hazard modules | Medium |

## 7.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Automated change-size warnings on PR open | v1.1 | Prompt the split before review begins |
| Automated stale-branch reporting | v1.1 | Enforce GIT-02 without nagging |
| Feature flag inventory with age | v1.2 | Enforce GIT-28 |
| Commit-message quality sampling | v1.2 | Measure whether bodies explain why |
| Automated detection of refactor-plus-behaviour commits | v1.2 | Hard but valuable; GIT-11 is often violated unintentionally |

---

*End of Part 4. Part 5 covers coding standards and module isolation — how the code inside these repositories is written and separated.*
