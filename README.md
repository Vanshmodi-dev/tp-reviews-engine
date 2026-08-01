# Machine-generated. Do not edit.

This is the `data` branch of TP Reviews Engine. It is the root of the static
site that client websites read, and every file on it is written by the engine.

**Nothing here is hand-edited.** A manual change is overwritten without warning
on the next successful harvest, and until then it is a published claim about a
business's reviews that no ledger supports.

This branch is an orphan: it shares no history with `main`, deliberately, so
that source and published artifacts can never be confused for one another and
so that the site root is not sixty megabytes of documentation.

## Layout

```
index.json                          global manifest
clients/<client-slug>/index.json    client manifest
clients/<client-slug>/<listing-key>/
    reviews.json                    full payload
    latest.json                     top-N payload
    stats.json                      aggregates only
    schema-org.json                 structured data, opt-in
    index.json                      listing manifest - the freshness pointer
```

## If something here looks wrong

Do not fix it here. Open an incident on `main`; the payload is regenerable from
the ledger with `tpre project`, without touching the network. Editing this
branch hides the defect instead of fixing it.

Publication is gated on invariants rather than on job success, so a payload
that is *stale* is expected during an incident, and a payload that is *wrong*
is a gate failure worth reporting.
