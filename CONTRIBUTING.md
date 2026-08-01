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
