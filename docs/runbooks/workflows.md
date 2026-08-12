# The workflow catalogue

**§48 · eight workflows · what each one is for, and what a red badge means**

This is the file to open at 2 a.m. It answers three questions in order: what
runs, what it is allowed to do, and what a failure actually means — because in
this engine a failure very often means _the safety mechanism worked_.

---

## The eight

| Workflow               | Trigger                  | Permissions                                                      | Purpose                               |
| ---------------------- | ------------------------ | ---------------------------------------------------------------- | ------------------------------------- |
| `ci.yml`               | PR, push to `main`       | `contents: read`                                                 | The blocking gate groups              |
| `harvest.yml`          | 4 crons + dispatch       | per-job                                                          | The production pipeline               |
| `validate-config.yml`  | PR touching config paths | `contents: read`, `pull-requests: write`                         | Config safety **and effect preview**  |
| `canary.yml`           | every 3 h                | `contents: write`, `issues: write`                               | Drift detection — **never publishes** |
| `pages.yml`            | push to `data`           | build `contents: read`; deploy `pages: write`, `id-token: write` | Distribution                          |
| `keepalive.yml`        | monthly                  | `contents: write`, `issues: write`, `actions: read`              | Dormancy prevention **and detection** |
| `release.yml`          | `v*` tag                 | `contents: read`, then `contents: write`                         | Full re-verification at the tag       |
| `dependency-audit.yml` | weekly + dependency PRs  | `contents: read`, `issues: write`                                | Supply-chain guard                    |

### The two deliberate permission absences

Both make a class of bug structurally impossible rather than merely unlikely.
Neither is an oversight; both are asserted by `security.workflow-lint`.

| Job                     | Absence       | What it prevents                                                                             |
| ----------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `harvest.yml` → `alert` | no `contents` | An incident reporter cannot, mid-incident, modify the repository                             |
| `pages.yml` → `deploy`  | no `contents` | The job that publishes to the public internet cannot rewrite the data branch it is deploying |

---

## What a red badge means

**Exit codes 5, 6 and 7 are successes.** They mean the engine correctly refused
to publish. If a shard job ever fails on one of these, fix the workflow, not the
engine — a red badge that means "working as designed" trains the maintainer to
ignore red badges, and then the real one is missed (EDR-030).

| Code    | Meaning                            | Job conclusion | Action                                                          |
| ------- | ---------------------------------- | -------------- | --------------------------------------------------------------- |
| 0       | Published                          | success        | none                                                            |
| 4       | Nothing due                        | success        | none                                                            |
| 5       | Gate refused to publish            | success        | Read the gate reason. Usually a count drop or coverage collapse |
| 6       | Source unavailable                 | success        | Check the canary. Often transient                               |
| 7       | Partial harvest held               | success        | INV-03 working. Investigate if it repeats                       |
| 1, 2, 3 | Broken code, bad usage, bad config | **failure**    | A genuine defect                                                |

`2` specifically means a **usage error** — an unknown CLI flag. If you see it,
a workflow is calling the CLI with a flag it does not define; the
`workflow-lint` suite now asserts every invocation against the real command
table, so this should be caught before merge.

---

## Failure meanings, per workflow

| Workflow red              | Almost always means                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `ci.yml`                  | A genuine defect. This is the only workflow where red has no other reading            |
| `harvest.yml` — plan job  | Config or CLI mismatch, not a source problem                                          |
| `harvest.yml` — shard job | Exit 1/2/3 only; 5/6/7 do not fail                                                    |
| `canary.yml`              | Until C-08 lands: `ERR-PIPELINE-INCOMPLETE`, a known gap. After: a real source change |
| `pages.yml`               | Pages configuration, not data. The payloads are unaffected                            |
| `keepalive.yml` — detect  | **RISK-17.** Schedules are disabled and every client is silently going stale          |
| `release.yml`             | The merge commit differs from what CI saw, or the tag disagrees with `ENGINE_VERSION` |
| `dependency-audit.yml`    | A high/critical advisory, or `dependencies` grew beyond one                           |

---

## Emergency levers

In the order to reach for them. Every one of these is reversible.

| #   | Lever                    | How                                      | Effect                                      | Reverses in |
| --- | ------------------------ | ---------------------------------------- | ------------------------------------------- | ----------- |
| 1   | **Stop harvesting**      | Actions → Harvest → Disable workflow     | No acquisition. Published data stays served | seconds     |
| 2   | **Stop one client**      | Set the client's `enabled: false`, merge | That client only                            | ~2 min      |
| 3   | **Roll back data**       | Revert the `data` commit                 | Sites serve the previous payload            | ~10 min     |
| 4   | **Roll back the engine** | Revert and re-tag                        | Next run uses the previous version          | ~5 min      |
| 5   | **Roll back config**     | Revert the config commit                 | Schedule and targets restored               | ~2 min      |
| 6   | **Stop distribution**    | Actions → Pages → Disable workflow       | Sites keep the last deployed payload        | seconds     |

**Lever 1 is the correct first response to almost any production incident.**
It costs nothing: published payloads keep serving, the visitor-facing side is
untouched, and it buys unlimited time to diagnose. Reach for it before
diagnosing, not after.

The three deployables — engine, configuration, data — roll back
**independently** (§49.2). That independence is what makes each of these cheap:
a bad selector pack is reverted without touching engine code, a bad engine
without touching data, a bad payload without re-acquiring anything.

---

## If schedules stopped

The symptom is _nothing_: no failures, no alerts, reviews quietly frozen on a
date nobody noticed. This is RISK-17 and it is the failure mode this engine is
most vulnerable to, because its healthy state and its dead state look identical
from the outside.

1. `keepalive.yml` → `detect` asserts monthly that `harvest.yml` is `active`,
   and opens a `dormancy` issue if not.
2. If it has been disabled: Actions → Harvest → Enable workflow, then dispatch
   one run manually and confirm it completes.
3. Check `state:keepalive.txt` — its timestamp is the last time anything
   demonstrably ran.

GitHub disables scheduled workflows after 60 days of repository inactivity.
`keepalive.yml` runs monthly, which is deliberately twice the margin: one missed
run must not be able to spend the whole cushion.
