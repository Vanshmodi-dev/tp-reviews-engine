## What and why

<!-- What changed, and the reason. The diff shows the what; the reason is the part that has to be written down. -->

**Task:** T-
**Governing section:** TRD §

## Which test would have caught this?

<!--
X-9, and the single most important line in this template.

If this is a bug fix: name the test added in THIS pull request that fails on the
old behaviour and passes on the new one. Every incident becomes a permanent test
in the same change that fixes it - not the next one.

If this is new work: name the test that proves it, and say what it would catch
if someone broke it in six months.

"Manually verified" is not an answer to this question.
-->

## Verification

<!-- What you actually ran, and what it said. Not what you expect it to say. -->

- [ ] `npm run verify` passes locally
- [ ] Tests are in this change, not a follow-up (X-5)
- [ ] Commit messages follow the convention and carry a `Refs:` footer

## Load-bearing rules

Tick only what this change touches, and say how you checked.

- [ ] **Absence is not deletion** — nothing here treats a partial or capped harvest as evidence of removal (TRD §22.5, PT-07)
- [ ] **Normalisation removes markup** — nothing here escapes markup instead of removing it, and nothing reaches a payload unnormalised (TRD §23.3)
- [ ] **`core/` stays pure** — no clock, randomness, environment, I/O, or `node:` import other than `node:crypto` (DR-1, DR-2)
- [ ] **A challenge is terminal** — no retry path was added to any `ERR-BLOCKED-*` class (INV-07, X-10)
- [ ] **No hard ceiling widened** — `max_reviews`, budgets, and delay floors are unchanged (X-10)
- [ ] None of the above

## Scope

- [ ] This implements what the documents specify, and nothing they do not
- [ ] No architectural decision was re-opened, softened, or "improved"
- [ ] No production dependency added (or: a DEP-1 justification is merged and linked)
- [ ] The public payload contract in `schemas/` is unchanged (or: an ADR is linked)

<!--
If any of those four is unticked, the fix is an ADR or an EDR, not this pull
request. A change to WHAT is built is never a plan change.
-->

## Rollback

<!-- How this is undone if it turns out to be wrong. Name it now; identifying it during an incident is the slowest possible moment (X-12). -->
