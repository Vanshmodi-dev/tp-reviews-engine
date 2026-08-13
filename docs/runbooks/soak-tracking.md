# The 30-day soak — S1–S8 tracking sheet

**T-342 · §66.4 · Owner: EM · Started: `<YYYY-MM-DD, on the day T-341 completes>`**

Initialised, not started. The soak begins when the first client's schedules are
enabled and firing (T-341); until then every cell below reads `not started`,
which is a different thing from `passing`.

**S8 is the real acceptance criterion for the product.** The system is built
for one part-time maintainer (CON-05). A system that needs weekly attention has
not met its design goal even if every other row is green.

---

## The eight criteria

| #   | Criterion                                                | Target       | Owner    | How it is measured                                                                                   | Source                 |
| --- | -------------------------------------------------------- | ------------ | -------- | ---------------------------------------------------------------------------------------------------- | ---------------------- |
| S1  | Success rate over 30 days                                | > 98%        | DevOps   | `MET-success-rate` over all health records in the window. Deferred runs are not failures             | `state:health/**`      |
| S2  | Bot challenges                                           | 0            | DevOps   | Count of health records with `ERR-CHALLENGE-*`. Any non-zero is an incident, not a metric            | `state:health/**`      |
| S3  | Incidents reaching a client website                      | 0            | EM       | Any occasion a visitor saw a broken, empty-in-error, or stale-beyond-tolerance widget                | Incident log           |
| S4  | Coverage sustained                                       | > 0.97       | DevOps   | `stats.coverage` in each published payload, p50 over the window                                      | `data:**/reviews.json` |
| S5  | Gate rejections                                          | < 2% of runs | DevOps   | Runs exiting 5 ÷ total runs                                                                          | Run manifests          |
| S6  | Commit churn within the modelled range                   | Yes          | DevOps   | `MET-commit-churn`. A sudden rise means hash-gating regressed (IR-06)                                | `data` commit log      |
| S7  | Adapter migration drill repeated successfully            | < 1 hour     | Engineer | Timed drill: `google:dom` → `google:business-profile-api` on a scratch client, per SAD §15.7.1       | Drill record           |
| S8  | Manual interventions required to keep the system running | 0            | EM       | Every occasion a human had to act for the system to keep working. Log it even if it took two minutes | This sheet, §3         |

## Recording

| #   | Week 1 | Week 2 | Week 3 | Week 4 | Verdict     |
| --- | ------ | ------ | ------ | ------ | ----------- |
| S1  |        |        |        |        | not started |
| S2  |        |        |        |        | not started |
| S3  |        |        |        |        | not started |
| S4  |        |        |        |        | not started |
| S5  |        |        |        |        | not started |
| S6  |        |        |        |        | not started |
| S7  |        |        |        |        | not started |
| S8  |        |        |        |        | not started |

---

## §66 verification schedule

The soak is the 30-day row of a longer schedule. Each checkpoint has its own
table in §66; this is the calendar.

| When                       | §66 section | Checks | Owner  |
| -------------------------- | ----------- | ------ | ------ |
| After the first full cycle | §66.1       | 1–4    | DevOps |
| +24 hours                  | §66.2       | 5–9    | DevOps |
| +7 days                    | §66.3       | 10–15  | DevOps |
| +30 days                   | §66.4       | S1–S8  | EM     |

**§66.1 check 4 is the one to read carefully:** commit count on `data` must
_equal_ the number of clients whose content changed. A higher count means
hash-gating regressed (IR-06), and hash-gating is what keeps the repository
from growing without bound.

## 3. Manual intervention log (S8)

Every entry here is a failure of S8, however small and however quickly
resolved. The purpose is not blame — it is that "the system ran itself for
thirty days" is either true or it is not, and an unlogged two-minute fix is how
it stops being true without anyone noticing.

| Date | What happened | What the human had to do | Why the system could not | Fix landed |
| ---- | ------------- | ------------------------ | ------------------------ | ---------- |
|      |               |                          |                          |            |

## 4. Exit

The soak passes when all eight rows read `pass` at day 30 and the intervention
log is empty. A soak that passes S1–S7 with three entries in §3 has **not**
passed — record it as failed and state why, rather than rounding it up.
