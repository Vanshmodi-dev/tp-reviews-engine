# Machine-owned. Hand-edit only per TRD §60.

This is the `state` branch of TP Reviews Engine. It holds the engine's durable
internal state and is **never published** to anyone.

It is an orphan branch: no shared history with `main`, no shared history with
`data`.

## What is here

```
ledger/<client-slug>/<listing-key>.json   the durable record of every review
health/<client-slug>.jsonl                append-only health series
cache/identity/<client>/<listing>.json    resolved listing identity
cache/budget/<source>/<yyyy-mm-dd>.json   rate-limit accounting
breaker/<source-access>.json              circuit breaker state
runs/<yyyy-mm>/<run-id>.json              per-run manifests
```

## The ledger is the only durable copy

Every published payload is regenerable from it with `tpre project`, without
touching the network. That is what makes a bad projection release, a schema
addition, a display-config change, and payload corruption all recoverable
rather than incidents.

The reverse is not true. Nothing regenerates a ledger. A review that is dropped
from here because a partial harvest was mistaken for a deletion is gone, and
the only evidence it existed is a tombstone that was never written.

## Do not hand-edit this branch

Not to fix a value, not to remove a review, not to unstick a run. Editing here
desynchronises the ledger from the tombstones and streak counters that make the
absence-is-not-deletion rule work, and the damage appears weeks later as
reviews quietly vanishing from a client's site.

There is exactly one exception: a documented recovery procedure in TRD §60,
performed knowingly.

**Erasure requests are not handled here.** Suppressions live in
`compliance/denylist.json` on `main`, precisely so that rebuilding this branch
from scratch cannot resurrect a review a data subject asked to have removed.

## This branch is readable by anyone

The repository is public. Nothing on this branch is *served*, and no consumer
contract references it, but it is not private. It contains no secret, and it
must never be made to contain one.
