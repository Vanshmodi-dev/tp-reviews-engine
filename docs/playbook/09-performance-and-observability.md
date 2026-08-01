# Part 9 — Performance and Observability

*Sections 16 and 17. Performance is about being fast enough on purpose rather than by accident. Observability is about knowing what the system is doing without reproducing it. Both are disciplines that are cheap when designed in and expensive when retrofitted.*

---

# 16. Performance Standards

## 16.1 Purpose

To make performance a stated requirement with measured verification, so that systems are fast enough deliberately — and so that engineering effort spent on speed is spent where it changes a user's experience rather than where it is interesting.

## 16.2 Objectives

1. Establish that performance work requires a measured problem and a stated budget.
2. Define the standard optimisation techniques and when each applies.
3. Prevent the two opposite failures: premature optimisation and negligent slowness.
4. Establish performance budgets as testable requirements.
5. Define what is gated in CI and what is monitored.

## 16.3 Engineering Rationale

### 16.3.1 The Two Opposite Failures

| Premature Optimisation | Negligent Slowness |
|---|---|
| Complexity added for unmeasured gain | No budget, so no failure is ever detected |
| Caching that introduces staleness bugs | Every release a little slower than the last |
| Unreadable code defended as "fast" | Users leave without reporting anything |
| Effort spent where it does not matter | Effort never spent at all |

Both come from the same root cause: **no stated budget and no measurement.** With a budget, optimisation has a stopping condition and neglect has a detector.

### 16.3.2 Measure, Then Optimise — With No Exceptions

Intuition about performance is unreliable in a way intuition about correctness is not. The bottleneck is routinely somewhere nobody predicted: a serialisation step, a lock, an unindexed lookup, a per-item network call in a loop, a logging call in a hot path.

| ID | Rule |
|---|---|
| **PERF-01** | Optimisation MUST begin with a measurement identifying where time or resources actually go |
| **PERF-02** | The measurement MUST be repeated after the change, and the improvement recorded |
| **PERF-03** | An optimisation that does not measurably improve the stated budget MUST be reverted |

**PERF-03 is the rule that keeps codebases readable.** Complexity added for a theoretical gain is complexity permanently paid for and never earned back.

### 16.3.3 Budgets Make Performance Testable

An unbudgeted system cannot fail a performance test, so it never does. A budget converts a vague quality into an acceptance criterion.

| Budget Type | Example Shape | Gateable? |
|---|---|---|
| Deterministic size | Bundle bytes, payload bytes, allocation count | ✅ **Blocks** |
| Deterministic work | Query count per request, CPU for a fixed input | ✅ **Blocks** |
| Wall-clock latency | p95 response time | ❌ Monitor only |
| Throughput | Requests per second at a given resource level | ❌ Monitor only |
| Resource ceiling | Memory, connections | ⚠️ Blocks at a generous limit |

**The split matters.** Deterministic measures are stable on shared CI infrastructure and can gate a merge. Wall-clock measures on shared runners vary enough that a gate on them becomes flaky — and a flaky gate trains people to re-run, which destroys the credibility of every other gate (§11.3.5).

### 16.3.4 Where Time Actually Goes

In most systems TradyPerch builds, in rough order of frequency:

| Cause | Typical Symptom |
|---|---|
| **N+1 access patterns** | Latency scaling linearly with result-set size |
| **Missing indexes** | A query fast in development, slow with real data |
| **Serial work that could be concurrent** | Sum of latencies rather than maximum |
| **Over-fetching** | Retrieving whole records to use one field |
| **Unbounded result sets** | Fine until a customer has 50,000 of something |
| **Payload size** | Slow on mobile networks; invisible on a developer's machine |
| **Synchronous work in a request** | The user waits for something they do not need |
| **Cold starts and connection setup** | Latency spikes after idle periods |

**The first two account for most real performance problems.** Before considering caching or architectural change, check for them — they are cheap to find and cheap to fix.

### 16.3.5 Caching Is a Correctness Decision

Caching is the most commonly reached-for optimisation and the one with the highest hidden cost: it introduces a second source of truth, and every second source of truth eventually disagrees with the first.

| Question to answer before caching |
|---|
| What is the maximum staleness a user can tolerate? |
| How is the cache invalidated, and what happens if invalidation fails? |
| What happens on a cold cache — is behaviour identical, only slower? |
| Can two callers see different values simultaneously, and does that matter? |
| Is the cached data personal or permission-scoped? (If so, cache keys must include the scope) |

| ID | Rule |
|---|---|
| **PERF-04** | A cache MUST NOT be correctness-critical. A cold cache MUST produce identical results, only slower |
| **PERF-05** | Every cache MUST have an explicit expiry and a documented invalidation strategy |
| **PERF-06** | Permission-scoped data MUST include the scope in the cache key |
| **PERF-07** | Caching MUST NOT be introduced without a measured problem (PERF-01) |

**Rationale for PERF-06.** Cache keys omitting the permission scope are a recurring source of serious data exposure: user A's request populates the cache, user B's request hits it. It is a one-line mistake with a headline-shaped consequence.

## 16.4 Standards

### 16.4.1 Budgets

| ID | Rule |
|---|---|
| **PERF-08** | T3+ projects MUST state performance budgets during planning |
| **PERF-09** | Budgets MUST be expressed as percentiles (p50, p95, p99) with the load at which they apply, never as averages |
| **PERF-10** | Deterministic budgets MUST block merge; wall-clock budgets MUST be monitored, not gated |
| **PERF-11** | Every budget MUST have an owner and an action threshold |
| **PERF-12** | A budget breach MUST be treated as a defect, not a backlog item |

**Rationale for PERF-09.** Averages hide the experience of the users who are having a bad time. A 200 ms average with a 4-second p99 means one request in a hundred is unusable, and those requests are not randomly distributed — they concentrate on the largest accounts, which are usually the most important ones.

Typical starting budgets, to be adjusted per project:

| Surface | p95 Target |
|---|---|
| Interactive API request | < 300 ms |
| Page interactive (web) | < 2.5 s on a mid-range device and network |
| Background job per item | Stated per job |
| CLI command startup | < 200 ms |
| Test suite (default) | < 3 minutes |
| CI pipeline | < 10 minutes |

### 16.4.2 Data Access

| ID | Rule |
|---|---|
| **PERF-13** | N+1 access patterns MUST be eliminated. Fetch in batches |
| **PERF-14** | Every query filtering or sorting on a column MUST have a supporting index |
| **PERF-15** | Queries MUST select only the fields needed |
| **PERF-16** | Result sets MUST be bounded — pagination or an explicit limit. **Unbounded queries are prohibited** |
| **PERF-17** | Query count per request SHOULD be asserted in tests for critical paths |
| **PERF-18** | Long-running or heavy queries MUST NOT run in an interactive request path |
| **PERF-19** | Migrations that lock large tables MUST be planned and executed as operational changes |

**Rationale for PERF-16.** An unbounded query works in development, works in staging, works for two years, and then a customer imports 200,000 records and the endpoint takes the service down. The limit costs nothing and removes the entire class.

**Rationale for PERF-17.** Query-count assertions are the most effective regression guard against N+1 patterns, because they are deterministic, fast, and fail loudly when someone adds an innocent-looking relation access inside a loop.

### 16.4.3 Application and API

| ID | Rule |
|---|---|
| **PERF-20** | Work not needed for the response MUST be moved out of the request path |
| **PERF-21** | Independent operations SHOULD execute concurrently |
| **PERF-22** | Responses MUST be paginated where result size is unbounded |
| **PERF-23** | Responses SHOULD support field selection where payload size is significant |
| **PERF-24** | Compression MUST be enabled for text responses |
| **PERF-25** | Every outbound call MUST have a timeout. **No unbounded waits** |
| **PERF-26** | Retries MUST be bounded, backed off, and jittered |
| **PERF-27** | Bulk operations MUST be available where clients would otherwise loop |

**Rationale for PERF-25.** An unbounded wait converts a slow dependency into an outage: request handlers accumulate, resources exhaust, and the failure spreads to unrelated functionality. Every network call, without exception, has a timeout.

### 16.4.4 Frontend and Rendering

| ID | Rule |
|---|---|
| **PERF-28** | Bundle size MUST have a budget that blocks merge |
| **PERF-29** | Code MUST be split so the initial load contains only what the first view needs |
| **PERF-30** | Images MUST be sized, compressed, and lazily loaded below the fold |
| **PERF-31** | Layout stability MUST be preserved — containers sized before content arrives |
| **PERF-32** | Long lists MUST be virtualised or paginated |
| **PERF-33** | Expensive work MUST NOT run on every render |
| **PERF-34** | Performance MUST be verified on a mid-range device and constrained network, not a developer machine |

**Rationale for PERF-34.** A developer's machine on office broadband is the least representative testing environment available. Most performance defects that reach users are invisible on it by construction.

### 16.4.5 Memory and Resources

| ID | Rule |
|---|---|
| **PERF-35** | Memory use MUST be bounded and MUST NOT grow with input size where streaming is possible |
| **PERF-36** | Large inputs MUST be streamed, not loaded whole |
| **PERF-37** | Resources MUST be released deterministically, on every path including failures |
| **PERF-38** | Connection and worker pools MUST be sized deliberately and documented |
| **PERF-39** | Memory trend MUST be monitored in long-running processes (T3+) |

**Rationale for PERF-37.** Resource leaks on failure paths are the most common leak, because failure paths are the least tested. A leak that only occurs on error is invisible until the day errors become common — which is the worst possible day for it to appear.

## 16.5 Real-World Examples

### Example 1 — The N+1 That Scaled Wrong

A list endpoint returns 20 records with an associated entity each. It performs 21 queries. It is fast in development with 20 records total. With a customer holding 40,000 records and a page size of 200, the endpoint times out.

| | |
|---|---|
| Rules | PERF-13, PERF-17 |
| Detection that would have caught it | A test asserting query count ≤ 3 for the endpoint |
| Cost of the fix | Twenty minutes; the cost of not having it was a customer-visible outage |

### Example 2 — The Cache That Leaked Data

A response cache is keyed by URL. The endpoint returns data scoped to the authenticated user. Two users request the same URL; the second receives the first's data.

| | |
|---|---|
| Rule | PERF-06 |
| Severity | Data exposure — a security incident, not a performance one |
| The general lesson | Caching decisions are correctness and security decisions wearing a performance costume |

### Example 3 — The Optimisation That Was Not Needed

An engineer spends two days optimising a report generator from 4 s to 400 ms. The report is generated twice a week by one internal user, who leaves it open in a tab.

| | |
|---|---|
| Rules | PERF-01, PERF-03 |
| Cost | Two days, plus permanent added complexity |
| What should have happened | Measure the user impact, record that 4 s is acceptable, and move on |

### Example 4 — The Missing Timeout

A third-party API becomes slow but not unavailable. Requests hold connections indefinitely. Within four minutes the connection pool is exhausted and every endpoint — including those not using that API — fails.

| | |
|---|---|
| Rule | PERF-25 |
| Root cause | One unbounded wait |
| The general lesson | The blast radius of a missing timeout is the whole service, not the one feature |

## 16.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Optimising without measuring | Complexity, no improvement | PERF-01 |
| 2 | Averages instead of percentiles | "It's fast" while some users suffer | PERF-09 |
| 3 | N+1 patterns | Latency scaling with result size | PERF-13, PERF-17 |
| 4 | Unbounded queries | Works until a customer grows | PERF-16 |
| 5 | Missing timeouts | One slow dependency takes down everything | PERF-25 |
| 6 | Caching to hide a slow query | Two problems instead of one | PERF-07 |
| 7 | Cache keys missing permission scope | Data exposure | PERF-06 |
| 8 | Testing on a developer machine | Users experience something different | PERF-34 |
| 9 | Resources leaked on failure paths | Degradation under error conditions | PERF-37 |
| 10 | Wall-clock performance gates in CI | Flaky gate, ignored failures | PERF-10 |

## 16.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-107** | **The Cache Blanket** | Caching applied broadly to avoid diagnosing slowness | PERF-07 |
| **AP-108** | **Premature Microservices** | Splitting for "scalability" without a measured limit | §21's decision framework |
| **AP-109** | **The Benchmark Fixation** | Optimising a synthetic benchmark that does not reflect usage | Measure real paths |
| **AP-110** | **Death by a Thousand Queries** | Each addition is small; the aggregate is fatal | PERF-17 query budgets |
| **AP-111** | **The Infinite Scroll of Doom** | Loading everything because pagination "feels clunky" | PERF-32 |
| **AP-112** | **Optimising the Wrong Layer** | Micro-optimising code while an unindexed query dominates | PERF-01 |

## 16.8 Decision Tables

### 16.8.1 Should I Optimise This?

| Question | If No |
|---|---|
| Is there a stated budget it violates? | Do not optimise |
| Have I measured where the time goes? | Measure first |
| Does it affect a user-visible path? | Probably do not optimise |
| Is the simpler fix (index, batch, limit) available? | Do that first |
| Will the optimisation add a second source of truth? | Weigh very carefully |
| Can I verify the improvement? | Do not proceed |

### 16.8.2 Which Technique?

| Symptom | First Try |
|---|---|
| Latency scales with result count | Batch the access (PERF-13) |
| One query dominates | Add or fix an index |
| Many small round trips | Batch or bulk endpoint |
| Large response payloads | Field selection, pagination, compression |
| Repeated identical computation | Memoise within the request, before caching across requests |
| Repeated identical fetch across requests | Cache — with §16.3.5's questions answered |
| Slow because of work the user does not need | Move it out of the request path |
| Slow at startup | Lazy initialisation; connection pre-warming |
| Memory grows with input | Stream |

### 16.8.3 Gate or Monitor?

| Measure | Gate | Monitor |
|---|---|---|
| Bundle size | ✅ | — |
| Payload size for a fixed input | ✅ | — |
| Query count per request | ✅ | — |
| CPU for a fixed input | ✅ | — |
| Allocation count | ✅ | — |
| p95 latency | — | ✅ |
| Throughput | — | ✅ |
| Memory in production | — | ✅ |
| Cold start | — | ✅ |

## 16.9 Checklists

### CHK-16.1 · Performance Review of a Change

- [ ] No N+1 access pattern introduced
- [ ] Every new query has a supporting index
- [ ] Every result set is bounded
- [ ] Every outbound call has a timeout
- [ ] Retries are bounded, backed off, and jittered
- [ ] Nothing unnecessary was added to the request path
- [ ] Resources are released on every path, including failures
- [ ] No cache added without a measured problem
- [ ] Any cache key includes the permission scope
- [ ] Deterministic budgets still met

### CHK-16.2 · Pre-Release Performance (T3+)

- [ ] Budgets stated and measured under expected load
- [ ] Percentiles recorded, not averages
- [ ] Behaviour verified at peak load, not only typical
- [ ] Verified on a representative device and network
- [ ] Memory stable over a sustained run
- [ ] Degradation under overload is graceful, not collapse
- [ ] Results recorded as a baseline for the next release

## 16.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Gradual degradation unnoticed | **High** | Medium | Budgets; monitored trends | Medium |
| N+1 reaching production | High | High | PERF-17 query-count tests | Low |
| Unbounded query with a large customer | Medium | High | PERF-16 | Low |
| Missing timeout causing a cascade | Medium | **High** | PERF-25; enforced by review | Medium |
| Cache introducing staleness or exposure | Medium | High | PERF-04…PERF-07 | Medium |
| Premature optimisation adding complexity | Medium | Medium | PERF-01, PERF-03 | Low |
| Flaky performance gates ignored | Medium | Medium | PERF-10 gate/monitor split | Low |

## 16.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Query-count assertion helper | v1.1 | Makes PERF-17 near-free |
| Automated bundle-size reporting on PRs | v1.1 | Visible before merge |
| Performance baselines recorded per release | v1.2 | Trend visibility across versions |
| Standard load-testing harness | v1.2 | Removes the setup cost that causes load testing to be skipped |

---

# 17. Observability

## 17.1 Purpose

To make production systems knowable — so that "what is it doing right now?", "why did that fail?", and "is it getting worse?" are answerable from artifacts, without reproducing anything and without guessing.

## 17.2 Objectives

1. Define what must be logged, measured, and monitored.
2. Establish alerting that produces action rather than noise.
3. Define health checks that mean something.
4. Make observability a delivery requirement rather than a follow-up.
5. Establish that a system nobody can see into is not finished.

## 17.3 Engineering Rationale

### 17.3.1 The Three Questions

Observability exists to answer three questions, and each needs a different instrument:

| Question | Instrument | Shape |
|---|---|---|
| **Is it healthy?** | Metrics + health checks | Aggregate, continuous, cheap |
| **What happened to this one request?** | Logs + traces | Specific, detailed, correlated |
| **Is it getting worse?** | Metric trends | Historical, comparative |

A system with only logs cannot answer the first or third cheaply. A system with only metrics cannot answer the second at all. Both are required at T3+.

### 17.3.2 Observability Is a Feature, Not a Follow-Up

Retrofitting observability means adding instrumentation to code whose failure modes are already unknown, which means guessing what to instrument. Designing it in means each failure path is instrumented by the person who created it, at the moment they understand it.

**The delivery consequence:** "logs, metrics, and alerts exist for its failure modes" is a Definition-of-Done criterion (§10.4.2), not a subsequent task. A feature without observability is a feature nobody can operate.

### 17.3.3 Alerting Discipline Determines Whether Alerting Works

| Alert Property | Consequence If Violated |
|---|---|
| **Actionable** | An alert with no action becomes noise and trains people to ignore all alerts |
| **Urgent** | A non-urgent alert at 3 a.m. destroys trust in the entire system |
| **Attributable** | An alert that does not say what is wrong wastes the responder's first ten minutes |
| **Rare** | More than a few pages per week produces fatigue, and fatigue produces missed incidents |

**The single most important rule in §17:** an alert that fires and requires no action must be deleted or downgraded, immediately. The cost of a noisy alert is not the interruption; it is the credibility it removes from every other alert.

### 17.3.4 Symptom-Based Alerting

Alert on **what users experience**, not on what causes it.

| Cause-Based (avoid) | Symptom-Based (prefer) |
|---|---|
| CPU above 80% | Latency p95 above budget |
| A queue has 1,000 items | Items older than the processing SLA |
| A host is unhealthy | Error rate above threshold |
| Memory at 85% | Requests failing |

Cause-based alerts fire when nothing is wrong (high CPU with acceptable latency is fine) and fail to fire when something is (a healthy-looking system returning wrong data). Symptom-based alerts map directly onto whether a human should be woken.

## 17.4 Standards

### 17.4.1 Logging

Per §12.4.3, with these delivery requirements:

| ID | Rule |
|---|---|
| **OBS-01** | Logs MUST be structured and machine-queryable |
| **OBS-02** | Every request or job MUST carry a correlation identifier through every log line |
| **OBS-03** | Every failure MUST produce exactly one classified log entry at the point of classification |
| **OBS-04** | Log levels MUST be used consistently, and production defaults MUST exclude debug volume |
| **OBS-05** | Secrets and personal data MUST be redacted at the sink |
| **OBS-06** | Log volume MUST be bounded — a failure loop MUST NOT produce unbounded output |
| **OBS-07** | Logs MUST be retained long enough to investigate a defect discovered late, per policy |

**Rationale for OBS-06.** An error inside a retry loop can generate gigabytes in minutes, which costs money, obscures everything else, and occasionally takes down the logging infrastructure during the incident it was supposed to help diagnose.

### 17.4.2 Metrics

| ID | Rule |
|---|---|
| **OBS-08** | T3+ systems MUST emit request rate, error rate, and latency distribution for every surface |
| **OBS-09** | Business-meaningful events MUST be measured, not only technical ones |
| **OBS-10** | Metrics MUST use bounded label cardinality. **User or request identifiers MUST NOT be labels** |
| **OBS-11** | Every metric MUST have a documented meaning, unit, and owner |
| **OBS-12** | Metrics MUST be emitted for saturation: queue depth, pool utilisation, memory, connection counts |
| **OBS-13** | A metric nobody looks at MUST be removed |

**Rationale for OBS-10.** Unbounded label cardinality is the standard way to make a metrics system fall over: one label per user identifier turns one metric into millions of series. It is expensive, it degrades queries for everyone, and it is usually added by accident.

**The four signals to cover, at minimum:**

| Signal | Meaning |
|---|---|
| **Latency** | How long requests take, as a distribution |
| **Traffic** | How much demand |
| **Errors** | How many requests fail, by class |
| **Saturation** | How full the constrained resource is |

### 17.4.3 Monitoring and Dashboards

| ID | Rule |
|---|---|
| **OBS-14** | Every T3+ service MUST have a dashboard showing the four signals |
| **OBS-15** | The dashboard MUST be the first thing consulted in an incident, and MUST be linked from the runbook |
| **OBS-16** | Dashboards MUST show comparison to a normal period, not only current values |
| **OBS-17** | Dashboards MUST be version-controlled where the tooling permits |
| **OBS-18** | A dashboard nobody uses during incidents MUST be simplified or removed |

**Rationale for OBS-16.** A number without a baseline is not information. "412 errors in the last hour" means nothing without knowing whether the normal figure is 400 or 4.

### 17.4.4 Alerting

| ID | Rule |
|---|---|
| **OBS-19** | Every alert MUST be **actionable**. If there is no action, it is not an alert |
| **OBS-20** | Every alert MUST link to a runbook |
| **OBS-21** | Alerts MUST be symptom-based where possible |
| **OBS-22** | Alert severity MUST determine routing: paging versus a ticket versus a dashboard |
| **OBS-23** | An alert that fires without requiring action MUST be fixed or deleted **within one week** |
| **OBS-24** | Alert thresholds MUST be reviewed after the first month of real data |
| **OBS-25** | Silencing an alert MUST be time-bound and MUST require a reason |
| **OBS-26** | Every alert MUST have an owner |

**Severity model:**

| Severity | Meaning | Routing | Expected Frequency |
|---|---|---|---|
| **Critical** | Users are affected now; act immediately | Page a human | Rare — a handful per quarter |
| **High** | Degradation or imminent failure | Ticket, same day | Weekly at most |
| **Warning** | A trend requiring attention | Ticket, this week | As needed |
| **Info** | Recorded, not pushed | Dashboard only | Continuous |

### 17.4.5 Health Checks

| ID | Rule |
|---|---|
| **OBS-27** | Every service MUST expose a **liveness** check: is the process functioning? |
| **OBS-28** | Every service MUST expose a **readiness** check: can it serve traffic right now? |
| **OBS-29** | A readiness check MUST verify critical dependencies; a liveness check MUST NOT |
| **OBS-30** | Health checks MUST be cheap and MUST NOT themselves cause load |
| **OBS-31** | A health check MUST NOT report healthy when the service cannot do its job |
| **OBS-32** | Scheduled work MUST have a liveness signal — **absence of execution MUST be detectable** |

**Rationale for OBS-29.** Conflating them causes a dependency blip to restart every instance simultaneously, converting a partial degradation into a total outage.

**Rationale for OBS-32.** The failure mode where a scheduled job silently stops running is one of the most under-detected in software: nothing errors, nothing alerts, and everything looks fine until someone notices data is stale. Detecting *absence* requires an explicit mechanism — a heartbeat, a freshness check, or an assertion that the schedule is enabled.

### 17.4.6 Tracing

| ID | Rule |
|---|---|
| **OBS-33** | Multi-service systems SHOULD emit distributed traces (T3+) |
| **OBS-34** | Trace context MUST propagate across service boundaries |
| **OBS-35** | Sampling MUST retain all error traces |
| **OBS-36** | Spans MUST cover external calls, database queries, and expensive computation |

### 17.4.7 Observability as a Delivery Requirement

| ID | Rule |
|---|---|
| **OBS-37** | A T3+ feature MUST NOT be considered done without logs, metrics, and alerts for its failure modes |
| **OBS-38** | A new failure mode MUST come with a runbook |
| **OBS-39** | Instrumentation MUST be reviewed as part of the change, not added later |
| **OBS-40** | After an incident, missing observability MUST be an explicit action item |

## 17.5 Real-World Examples

### Example 1 — The Silent Scheduled Job

A nightly synchronisation job stops running after an infrastructure change. Nothing errors. Nothing alerts. Data silently ages for nineteen days before a customer notices.

| | |
|---|---|
| Rule | OBS-32 |
| Root cause | Detection covered failure, not absence |
| Fix | A freshness metric and an alert on data age, plus a liveness heartbeat asserting the schedule is enabled |

### Example 2 — The Alert Nobody Read

A CPU alert fires four times a day for six months. It never corresponds to user impact. When a genuine incident occurs, the responder assumes it is that alert again and delays twenty minutes.

| | |
|---|---|
| Rules | OBS-19, OBS-21, OBS-23 |
| Cost | Twenty minutes of a real outage |
| The general lesson | The cost of a noisy alert is paid by a different alert, later |

### Example 3 — The Cardinality Explosion

A metric is added with a label for the requesting user identifier. Within two days the metrics backend is storing millions of series, queries slow for everyone, and costs increase sharply.

| | |
|---|---|
| Rule | OBS-10 |
| The correct pattern | Identifiers belong in logs and traces, never in metric labels |

### Example 4 — The Four-Minute Diagnosis

An error-rate alert fires with a link to a runbook. The runbook's first step is a dashboard link. The dashboard shows errors concentrated in one dependency. Logs filtered by correlation identifier confirm the cause. Total time from page to mitigation: four minutes.

| | |
|---|---|
| Rules | OBS-14, OBS-15, OBS-20, OBS-02 |
| Counterfactual | The same incident with unstructured logs and no dashboard is a two-hour investigation |

## 17.6 Common Mistakes

| # | Mistake | Symptom | Fix |
|---|---|---|---|
| 1 | Observability added after launch | Nobody knows what to instrument | OBS-37 |
| 2 | Cause-based alerting | Noise; missed real issues | OBS-21 |
| 3 | Alerts with no runbook | Responder starts from nothing | OBS-20 |
| 4 | Noisy alerts tolerated | All alerts ignored | OBS-23 |
| 5 | Unbounded metric cardinality | Backend degrades; costs rise | OBS-10 |
| 6 | Liveness check verifying dependencies | Mass restarts during a blip | OBS-29 |
| 7 | No detection of absent execution | Silent staleness | OBS-32 |
| 8 | Unstructured logs | Cannot query during an incident | OBS-01 |
| 9 | No correlation identifier | Cannot follow one request | OBS-02 |
| 10 | Dashboards without baselines | Numbers without meaning | OBS-16 |
| 11 | Personal data in logs | A security incident from observability | OBS-05 |
| 12 | Unbounded log volume in a failure loop | Cost spike; logs unusable | OBS-06 |

## 17.7 Anti-Patterns

| ID | Anti-Pattern | Description | Countermeasure |
|---|---|---|---|
| **AP-113** | **Alert Fatigue** | So many alerts that none is trusted | OBS-19, OBS-23 |
| **AP-114** | **The Dashboard Wall** | Forty panels, none consulted during an incident | OBS-18 |
| **AP-115** | **Log-and-Continue** | Logging an error and proceeding as if nothing happened | §24; classify and handle |
| **AP-116** | **The Vanity Metric** | Measured because it is easy, not because it informs a decision | OBS-13 |
| **AP-117** | **Health Check Theatre** | A check returning healthy unconditionally | OBS-31 |
| **AP-118** | **The Unmonitored Job** | Scheduled work with no liveness signal | OBS-32 |
| **AP-119** | **Debug in Production** | Adding temporary logging to diagnose, then removing it | Instrument permanently and properly |

## 17.8 Decision Tables

### 17.8.1 Log, Metric, or Trace?

| You want to know | Use |
|---|---|
| What happened in this specific request | Log |
| How often this happens | Metric |
| Where the time went across services | Trace |
| Whether it is getting worse | Metric trend |
| Why this particular user's action failed | Log, by correlation identifier |
| Whether we are near a resource limit | Metric (saturation) |
| The exact sequence of a rare failure | Log with debug enabled for that path |

### 17.8.2 Should This Alert?

| Question | If No |
|---|---|
| Would a human take action within the hour? | Not an alert — dashboard or ticket |
| Is a user affected, or imminently going to be? | Downgrade severity |
| Does a runbook exist? | Write it first |
| Would it fire during normal operation? | Fix the threshold before enabling |
| Does the message say what is wrong? | Rewrite it |
| Does it have an owner? | Assign one |

### 17.8.3 Alert Severity

| Situation | Severity |
|---|---|
| Users cannot complete a core action | **Critical** |
| Error rate materially above normal | **Critical** |
| Data loss or corruption occurring | **Critical** |
| Latency exceeds budget sustained | High |
| A dependency is degraded but handled | High |
| Resource trending toward a limit | Warning |
| A retry succeeded after a transient failure | Info — no alert |
| A single request failed | Info — no alert |

## 17.9 Checklists

### CHK-17.1 · Observability for a New Feature (T3+)

- [ ] Every failure path produces a classified log entry
- [ ] Logs carry the correlation identifier
- [ ] Request rate, error rate, and latency are measured
- [ ] Saturation is measured for any new constrained resource
- [ ] Metric labels have bounded cardinality
- [ ] Alerts exist for the failure modes that require action
- [ ] Every alert links to a runbook
- [ ] The dashboard shows the new surface
- [ ] Secrets and personal data cannot reach logs
- [ ] If scheduled: absence of execution is detectable

### CHK-17.2 · Monthly Observability Review

- [ ] Every alert that fired: did it require action? Delete or fix those that did not
- [ ] Any incident detected by a user rather than by monitoring? Add detection
- [ ] Alert volume per person is sustainable
- [ ] Dashboards still reflect the system
- [ ] Log volume and cost within expectation
- [ ] Unused metrics removed
- [ ] Every runbook referenced by an alert still works

## 17.10 Risk Analysis

| Risk | Likelihood | Impact | Mitigation | Residual |
|---|---|---|---|---|
| Alert fatigue causes a missed incident | **High** | High | OBS-19, OBS-23, monthly review | Medium |
| Failure undetectable in production | Medium | High | OBS-37 as a DoD criterion | Low |
| Silent absence of scheduled work | Medium | High | OBS-32 | Low |
| Metrics cardinality incident | Medium | Medium | OBS-10; review of new metrics | Low |
| Personal data leaked via logs | Low | **Critical** | OBS-05 sink-level redaction | Low |
| Observability cost growth | Medium | Medium | OBS-06, OBS-13, retention policy | Medium |
| Runbooks stale when alerts fire | Medium | High | DOC-28; monthly verification | Medium |

## 17.11 Future Improvements

| Item | When | Note |
|---|---|---|
| Standard instrumentation library | v1.1 | Correlation, structured logging, and the four signals by default |
| Alert quality scoring | v1.2 | Action rate per alert, reviewed monthly |
| Dashboards as code, shared across projects | v1.2 | Consistency and version control |
| Automated freshness monitoring for scheduled work | v1.1 | Makes OBS-32 free |

---

*End of Part 9. Part 10 covers deployment and multi-agent collaboration — getting work into production and coordinating the agents that produce it.*
