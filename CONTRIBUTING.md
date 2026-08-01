# Contributing

## Before You Write Anything

This repository is governed by four baselined documents, indexed in
[`docs/README.md`](docs/README.md). They are not background reading; they are
the specification.

| If you are about to…               | Read first                                                        |
| ---------------------------------- | ----------------------------------------------------------------- |
| Implement anything at all          | TRD §0.5 (how to use the TRD), §1, §6–§7                          |
| Touch `src/core/`                  | TRD §67.4, plus the section for that module                       |
| Touch acquisition                  | TRD §15–§21, then §92.2 (the five risks)                          |
| Write tests                        | TRD §61                                                           |
| Change a workflow                  | TRD §62, §47                                                      |
| Change the published payload shape | **Stop.** That is the public contract (TRD §52); it needs an ADR. |

**Nothing in those documents may be redesigned, simplified, or deferred in a
pull request.** If the specification is wrong or incomplete, that is a defect
against the TRD (raise an EDR) or the SAD (raise an ADR) — not something to
solve locally. A change to _what_ is built is never a plan change.

## Setup

```sh
nvm use          # matches .nvmrc — the only place the Node version is written
npm ci           # from the committed lockfile; never `npm install` in CI
npm run verify   # lint + format:check + typecheck + test
```

`npm test` requires no network access. Tests under `tests/live/` are opt-in and
excluded from the default runner; run them with `npm run test:live`.

## Code Standards — TRD §67, §68, §69

These are enforced mechanically by ESLint, Prettier, the type checker, and CI.
They are **not** enforced by review comments, and a reviewer should never have
to mention one.

**TRD §67 — Code standards**

| Rule                  | Limit                                        |
| --------------------- | -------------------------------------------- |
| Cyclomatic complexity | ≤ 10                                         |
| Function length       | ≤ 60 lines                                   |
| File length           | ≤ 400 lines                                  |
| Parameters            | ≤ 4                                          |
| Nesting depth         | ≤ 3                                          |
| Default exports       | None                                         |
| Module system         | ESM only, `.mjs`, `node:`-prefixed built-ins |
| Encoding              | UTF-8 without BOM, LF, final newline         |

**TRD §68 — Prohibited patterns**

Empty `catch` blocks · `console.*` outside `infra/logger/` and `cli/` ·
`process.exit()` outside `cli/` · commented-out code · bare `TODO` comments ·
unexplained magic numbers.

**TRD §69 — Naming and vocabulary discipline**

One name per concept, repository-wide. A "review" is never also an "entry", a
"record", or an "item". The vocabulary is defined by the model in
`src/core/model/` and by the glossary in SAD §0.

### The four rules that are load-bearing

These are the ones where a plausible-looking change causes silent, expensive
damage. Each is guarded by a test that will fail; please do not make the test
prove it.

1. **Absence is not deletion** (TRD §22.5). Treating a partial harvest's
   absences as deletions is the only defect that can silently wipe a paying
   client's reviews.
2. **Normalisation removes markup; it does not escape it** (TRD §23.3). This is
   the security boundary for every client website simultaneously.
3. **`core/` is pure** (TRD §67.4). No I/O, no clock, no randomness, no
   environment, no `node:` import other than `node:crypto`. A single
   `Date.now()` default parameter voids fifteen property laws without failing
   anything.
4. **A challenge is terminal** (TRD §21.8). No retry, ever — not even one "to
   see if it clears".

## Tests

- **Tests are written in the same change as the code they test.** A task is not
  two tasks, and "tests to follow" never follows.
- **Every incident becomes a permanent test in the same pull request that fixes
  it** (TRD §61.14). This is non-negotiable and is the question the pull request
  template asks.
- Property laws under `tests/property/` and the Publish Gate's 100%-coverage
  obligation are not negotiable under schedule pressure.

## Pull Requests

- One task per pull request. The branch name carries the task id, which is what
  makes progress tracking automatic.
- Keep the diff reviewable. Verification cost, not diff size, is the thing being
  managed.
- Fill in the template honestly — especially "which test would have caught
  this?"
- `main` is always releasable. Every merge passes the full CI gate set; a red
  `main` blocks everyone.
- A pull request touching `src/core/`, `schemas/`, `selectors/`, or
  `compliance/` requires review from the code owners.

## Dependencies

The production dependency target is **two**. Adding one requires a written
DEP-1 justification merged first (TRD §10.1), and no dependency may be added for
functionality achievable in under ~100 readable lines. `frontend/renderer/` has
zero dependencies and that is non-negotiable — it ships to client websites.

## Reporting a Security Issue

Do not open a public issue. See [SECURITY.md](SECURITY.md).

## Commits

Conventional Commits, enforced by the `commit-msg` hook and re-checked in CI on
the pull request title, because `main` squash-merges and the title becomes the
commit. `release.yml` reads these to build the release notes, so the format is
load-bearing rather than decorative.

```
<type>(<scope>): <subject>

<body>

<footer>
```

| Element  | Rule                                                                     |
| -------- | ------------------------------------------------------------------------ |
| Type     | `feat` `fix` `test` `refactor` `chore` `docs` `ci` `perf` `build`        |
| Scope    | The module path fragment: `core/reconcile`, `adapters/browser`, `ci`     |
| Subject  | Imperative, ≤ 72 characters, no trailing period                          |
| Body     | Required for D3 and above. States the TRD section and what was verified. |
| Footer   | `Refs:` with `TR-`, `EDR-`, `INV-`, `PT-`, `CH-` identifiers             |
| Breaking | `!` after the scope, plus a `BREAKING CHANGE:` footer                    |

```
fix(core/reconcile): stop treating a capped harvest as a removal signal

A harvest that stopped at max_reviews is not evidence of absence. Removal
confirmations are now only incremented when completeness is `full`.

Verified: PT-07 fails on the previous behaviour and passes on this one.

Refs: TR-REC-041, PT-07, INV-04
```

**Write the body for anything non-trivial.** The subject says what changed; the
body is the only place the _reason_ survives, and in six months the reason is
the part anyone actually needs.

## Branches

| Purpose                                           | Pattern              | Example                              |
| ------------------------------------------------- | -------------------- | ------------------------------------ |
| Task                                              | `t/<task-id>-<slug>` | `t/147-identity-hash`                |
| Phase (rare; a coordinated interface change only) | `ph/<phase>-<slug>`  | `ph/07-ports`                        |
| Fix                                               | `fix/<issue>-<slug>` | `fix/212-rating-cascade`             |
| Chore                                             | `chore/<slug>`       | `chore/bump-playwright`              |
| Machine-owned                                     | `data`, `state`      | Never created by a human after setup |

The task id in the branch name is what makes progress tracking automatic: a
merged branch maps a commit to a task without anyone updating a spreadsheet.

`main` squash-merges and keeps linear history. `data` and `state` are orphan
branches written only by the engine — never branch from them, never merge into
them, never rebase them.

## Git Hooks

```sh
npm run hooks:install   # idempotent; run it once after cloning
```

| Hook         | Budget  | Runs                                   |
| ------------ | ------- | -------------------------------------- |
| `pre-commit` | < 3 s   | Prettier and ESLint, staged files only |
| `commit-msg` | < 0.2 s | Conventional Commit format             |
| `pre-push`   | < 45 s  | `typecheck` plus the fast suites       |

**The budget is the design constraint, not a target.** A hook slower than its
budget gets bypassed with `--no-verify`, and that bypass disables _every_ hook
including `commit-msg`. If a hook starts exceeding its budget, that is a defect
in the hook.

`--no-verify` is not forbidden — there are legitimate uses — but it is not
silent either. Report it at stand-up (HOOK-02).

Hooks are an accelerator, never an authority. CI re-runs everything they run, so
a contributor without hooks installed is still blocked by the same gates
(HOOK-04).
