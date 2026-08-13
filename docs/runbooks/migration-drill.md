# Adapter migration drill (S7)

**SAD §15.7.1 · RISK-03's contingency · target: under one hour**

> A contingency that has never been executed is not a contingency.

Migrating a client from `google:dom` to an official API adapter is the designed
response if DOM access becomes untenable — through enforcement, or through
technical change we cannot repair. ADR-023 made both API adapters v1.0
deliverables rather than roadmap items for exactly this reason.

---

## What was drilled, and what was not

**Drilled (2026-08-13, SP-8):** the step the whole migration rests on — that the
same review harvested by a different adapter reconciles to the **same ledger
record** rather than orphaning the corpus.

Executed against the real normalisation stage, with the same two reviews shaped
as each adapter presents them (the DOM path carries a relative-date field, the
API path an absolute `date`):

```
dom identities: e9e5200a51d7 e8f1cc81d0c9
api identities: e9e5200a51d7 e8f1cc81d0c9
IDENTITIES STABLE ACROSS ADAPTERS: true
content hashes stable: true
dates pinned identically: true
```

This is now a permanent test — `tests/property/cross-adapter-identity.test.mjs`
— because a drill that ran once is evidence and a test is a guarantee.

**Not drilled:** the live half. Steps 1, 2 and 4 below need a real client, a
real OAuth consent, and a real comparison against a populated ledger. They are
blocked on the same external dependency as the rest of PH-25 and should be run
end to end with the first client, timed, before the soak starts.

---

## Why step 5 is the subtle one

If review identity were derived from a source-specific id — Google's own review
id, say — switching adapters would produce a completely new set of identities.
The reconciler would see every existing review as absent and every incoming
review as new.

The visible result on a client's site: every review disappears, then reappears,
with every `first_seen_at` reset to today. The invisible result: the originals
sit in the ledger accruing `missing_streak` until they tombstone.

Because identity is `listing + author key + content` (ADR-007), none of that
happens. The same review reconciles to the same record, `first_seen_at` is
preserved, and the payload does not change at all.

---

## The procedure

| Step | Action                                                                          | Time             |
| ---- | ------------------------------------------------------------------------------- | ---------------- |
| 1    | Confirm the client will grant access; send the OAuth consent link               | client-dependent |
| 2    | Store the refresh token as a per-client secret — **never in config**            | 5 min            |
| 3    | Change `adapter` in the client config; set capability expectations              | 2 min            |
| 4    | Dry-run harvest; compare against the current ledger. Expect coverage ≥ existing | 10 min           |
| 5    | Reconcile — automatic, and the reason this works at all                         | —                |
| 6    | Merge; run; verify payload count and rating unchanged or improved               | 10 min           |
| 7    | Record the migration in the client's change log                                 | 2 min            |

**Step 2 is the one to get right.** A refresh token in a config file is a
long-lived credential in the resolution trace, and the trace goes into
diagnostics bundles.

---

## What the client loses

The API adapters see less than the page does. This is a real cost and the
client should be told before, not after.

| Capability           | `google:dom` | Business Profile API | Places API                  |
| -------------------- | ------------ | -------------------- | --------------------------- |
| Owner replies        | yes          | yes                  | **no**                      |
| Full pagination      | yes          | yes                  | **no — five reviews, ever** |
| Likes / photo counts | yes          | no                   | no                          |
| Author badges        | yes          | no                   | no                          |

The Places path is a **degraded but legal** option, not an equivalent one. It
reports `cap_reached` and never `target_reached`, precisely so that five reviews
against a ledger of 118 is never read as "the other 113 were removed".

`explainNull` is what lets a consumer distinguish "this review has no owner
reply" from "this adapter cannot see owner replies". Without it, a migration
looks like every client suddenly stopped receiving replies.

---

## Rollback

Change `adapter` back and merge. Nothing else. The ledger is unchanged
throughout — that is the point of the identity property — so there is no data
to restore and no re-harvest to run.
