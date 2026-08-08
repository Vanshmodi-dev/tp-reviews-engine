# Selector packs

A pack is a versioned, **immutable** set of extraction strategies for one
source. `selectors/google-maps/v1.json` is a pack; editing it after it has been
merged is a CI failure (SEL-01).

## Why immutable

A pack version appears in every payload's provenance block. "Which selectors
produced this payload" has to be answerable from the payload alone, months
later, during an incident — and it stops being answerable the moment `v1.json`
can mean two different things depending on when you looked.

Editing a merged pack also silently changes the behaviour of every client
pinned to it, with no version bump to review and nothing in a diff of the
profiles to notice. A new version is one file and one pin change; that is the
whole cost of keeping the question answerable.

## Authoring a pack

**Every required field needs at least two strategies of different kinds**
(TR-SEL-010), ordered most stable first, and none may rely on `css` alone
(TR-SEL-011). The loader enforces all of this and refuses the pack otherwise.

The kinds, in preference order:

| Kind                  | Why it ranks here                                                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`                | Accessibility semantics are a user-facing contract. A vendor that changes them breaks screen readers, which is a louder failure for them than for us. |
| `aria-label-pattern`  | Same reasoning, and it often carries the _value_ directly — far more robust than parsing visual stars.                                                |
| `data-attribute`      | Used by the vendor's own tooling, so moderately stable. But it is theirs to rename without notice.                                                    |
| `structural-relative` | Survives class renames; breaks on layout restructuring.                                                                                               |
| `text-pattern`        | Locale-dependent but structure-independent.                                                                                                           |
| `css`                 | Fastest to write, first to break. Last resort only.                                                                                                   |

**Every strategy needs `notes`** (TR-SEL-013) explaining what it targets and why
it is ranked where it is. Six months later nobody remembers why strategy 2
exists, and an undocumented pack cannot be safely edited by anyone who did not
write it — which, on a six-month-old pack, is everybody.

**Insert a new strategy at its correct rank** (TR-SEL-012), never append it. A
pack that tries `css` first records a healthy-looking strategy-0 hit rate while
actually depending on the least reliable option it has.

## The six-step staged rollout

A pack change is a change to how every pinned client reads its source, so it is
staged rather than shipped.

1. **Author** the new version as a new file (`v2.json`). Never edit `v1.json`.
2. **Validate** it: `tpre validate-selectors` runs the loader's rules, which
   fail the pack rather than the harvest.
3. **Replay** it against the fixture corpus. The corpus is what makes a pack
   change reviewable without touching a live source.
4. **Pin one canary client** to the new version in `profiles/`, and only one.
   Pinning lives in a profile, never in a client config or in code
   (TR-SEL-004), so the blast radius of a pin change is visible in one file.
5. **Watch the strategy histogram** for a full cadence interval. A field
   resolving at index 1 where it used to resolve at index 0 means the new pack
   is working on its fallback — which is a reason to re-author, not to roll out.
6. **Widen the pin** profile by profile. A pack that has run clean on a canary
   for a cycle is evidence; a pack that validated is not.

Rolling back is a one-line pin change, which is the point of steps 4 and 6.

## What the strategy histogram tells you

The resolver records **which strategy index won** for every field, and that
number is the most valuable diagnostic extraction produces.

A field that has always resolved at index 0 and starts resolving at index 1 is
telling you the source changed and the pack is now running on its fallback.
Nothing has failed. The payload is correct. But the margin is gone, and the next
change takes the field out entirely.

Without the histogram, that transition is invisible until the day it breaks —
and on that day it presents as a rising quarantine rate and a blocked publish,
three layers away from its cause.

## When every strategy fails

The record is **quarantined**, never published with a null (T-191). A null
rating would produce a schema-valid payload that puts a review on a client's
site with no rating, and nothing downstream would object.

Quarantined records feed the rate that gate rule G-06 watches, which is how a
broken pack becomes a blocked publish rather than a degraded one.
