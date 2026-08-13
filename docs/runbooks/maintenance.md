# Maintenance guide

**SAD §50 · audience: the one part-time maintainer this engine is built for (CON-05)**

The design goal is that this file is rarely opened. S8 — the soak criterion that
actually matters — is _zero manual interventions in thirty days_. Every entry
below is therefore something that should not happen often; if one of them starts
happening weekly, that is the signal, not the fix.

---

## The five-minute version

| Question                            | Answer                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Something is red. Is it broken?     | Usually not. Exit codes 5, 6 and 7 are **successes** — the engine refusing to publish. See `workflows.md`.   |
| A client's reviews stopped updating | Check `keepalive.yml` → `detect` first. Dormant schedules are the failure this system is most vulnerable to. |
| A client's reviews _disappeared_    | They should not be able to. Read "When reviews vanish" below before touching anything.                       |
| I need to stop everything now       | Actions → Harvest → Disable workflow. Published payloads keep serving.                                       |

**The first response to almost any incident is to disable the harvest
schedule.** It costs nothing — visitors keep seeing the last published payload —
and it buys unlimited time to diagnose. Reach for it before diagnosing.

---

## The monthly rhythm

There is no weekly work. If there were, the product would have failed CON-05.

| When                     | Do                                                                                              | Takes  |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------ |
| Monthly                  | Read the `keepalive` run. Green means schedules are alive.                                      | 1 min  |
| Monthly                  | Skim open issues labelled `canary` and `drift`.                                                 | 5 min  |
| Quarterly                | Re-read one client's payload against their live listing. Spot-check, not audit.                 | 10 min |
| On a dependency advisory | `dependency-audit.yml` opens an issue. Check whether it is `dependencies` or `devDependencies`. | 5 min  |
| Never on a schedule      | Selector packs. They are changed in response to drift, not on a calendar.                       |

---

## When the source changes its markup

This is the failure mode with the highest prior probability (RISK-01), and the
engine is designed to absorb it rather than break.

**What you will see.** The canary opens a `drift` issue. Harvests start exiting
5 or 7. Coverage falls. No client's site changes, because absence is not
deletion — the last good payload keeps serving.

**What to do.**

1. **Do not rush.** The published payloads are fine. This is the state the whole
   architecture exists to make survivable.
2. Look at the selector strategy indices in the run manifest. A field that has
   fallen from strategy 0 to strategy 2 is drifting; a field with no strategy
   matching is broken.
3. Repair the pack in `selectors/`, as a **new version**. Packs are immutable
   (SEL-01) — never edit a published one, because a payload's provenance names
   the pack that produced it and rewriting history makes that a lie.
4. Pin the new version in `profiles/`, which is the only place pinning lives
   (TR-SEL-004). One line, visible blast radius.
5. Dispatch a canary run. Then one client. Then let the schedule resume.

**What not to do.** Do not widen a selector until it matches. A selector that
matches everything extracts the "similar places" cards at the bottom of the
page, and those reviews belong to other businesses.

---

## When reviews vanish

**They should not be able to.** INV-03 says absence is never deletion, the gate
rejects count drops, and tombstoning requires repeated confirmation on _full_
harvests. If reviews have actually disappeared from a client's site, one of
those failed, and that is a defect rather than an operational event.

Before anything else, capture evidence: the payload on `data`, the ledger on
`state`, and the run manifest. Then disable the schedule.

The three ways it could happen, in order of likelihood:

| Cause                                               | How to confirm                                              | Response                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The gate was forced                                 | `--force-publish` in a run's arguments                      | Revert the payload; find out who and why. The force flag is banned in three places for this reason |
| A ledger was rebuilt from a partial harvest         | `state` history shows a ledger replaced rather than updated | Restore the prior ledger; re-run                                                                   |
| Hash gating regressed and republished a bad payload | Commit churn spikes on `data`                               | Revert; check `MET-commit-churn`                                                                   |

---

## Rotating a secret

Per-client OAuth tokens and the API keys live in repository secrets, never in
config (TR-SEC-011).

1. Add the new value as a new secret.
2. Update the client config to name it.
3. Merge. `validate-config.yml` confirms the config resolves.
4. `tpre doctor` confirms the engine can see it.
5. Delete the old secret **after** one successful scheduled run, not before.

A rotation that deletes first produces a harvest failure that looks like an
outage at the source.

---

## Onboarding another client

The full checklist is §65.2 and §65.4. The three that are not paperwork:

1. **The authorisation record must be merged first** (`compliance/authorizations/`).
   V-3 refuses a `google:dom` listing without one, mechanically, and there is no
   workaround by design.
2. **The slug and listing key are immutable.** They are in the ledger path, the
   payload URL, and every identity hash. Choosing badly is a migration.
3. **Offer the Business Profile API adapter and record the answer.** It is the
   sanctioned path, and the record is what makes the choice auditable later.

---

## Migrating a client to an official API

The contingency for RISK-03, drilled as S7. See `docs/runbooks/migration-drill.md`.

It is a configuration change: `adapter` in the client config, plus a refresh
token as a per-client secret. **No code change and no schema change** (INV-10),
and existing reviews reconcile rather than duplicating, because identity is
derived from content rather than from a source-specific id.

The client will lose fields the API does not expose — most visibly owner
replies on the Places path. `explainNull` is what tells a consumer the
difference between "no owner reply" and "this adapter cannot see owner
replies".

---

## Things that look broken and are not

| Symptom                                | Actually                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A run exits 5                          | The gate refused to publish. Read the reason; it is usually a count drop that is correctly being blocked |
| A run exits 7                          | A partial harvest was held. INV-03 working                                                               |
| `data` has no new commit today         | Nothing changed. Hash gating suppressing a no-op is the design (FR-065)                                  |
| Coverage below 1.0                     | Normal. The source's advertised total includes reviews it will not show                                  |
| A review's date is approximate         | Relative dates are pinned once, with a stated precision, and never recomputed (PT-06)                    |
| The canary is noisier than the harvest | It runs eight times more often. Judge it on repetition, not on single runs                               |

---

## What to do when you are stuck

1. Disable the harvest schedule. Nothing degrades while you think.
2. Read the run manifest for the affected target — it names the stage, the
   error code, and the selector strategies that matched.
3. Look up the error code in the taxonomy (`core/model/errors.mjs`). Every code
   carries a class, a retry policy, and a severity.
4. If the code says `ERR-INTERNAL-INVARIANT`, stop and escalate. The engine
   produced a state its own rules forbid, and continuing risks publishing it.
