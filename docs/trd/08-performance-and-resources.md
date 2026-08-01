# Part 8 — Performance, Memory, CPU, and Storage

*Sections 43 through 46. Audience: backend engineers, DevOps. Every budget in this part is enforced by a CI test. A budget that is not enforced by CI is an aspiration, and this part contains no aspirations.*

---

# 43. Performance Requirements

## 43.1 Budgets

| Scope | Budget | Measured Where | Enforced By |
|---|---|---|---|
| Harvest per listing, DOM adapter, ≤ 200 reviews | **p50 ≤ 75 s, p95 ≤ 180 s** | Run manifest | `MET-harvest-duration` alert |
| Harvest per listing, API adapter | **p95 ≤ 10 s** | Run manifest | Alert |
| Pure pipeline (stages 3–9), 1,000 reviews | **≤ 2 s CPU** | Unit benchmark | `tests/budgets/` |
| Shard job total | **≤ 20 min** | Workflow | Job timeout at 30 min |
| Cold start (deps + browser restore) | **≤ 60 s** warm cache | Workflow | Manifest field |
| `reviews.json`, 200 reviews | **≤ 180 KB raw / ≤ 60 KB gzip** | Size budget test | `tests/budgets/payload-size.test.mjs` |
| `latest.json` | **≤ 24 KB raw / ≤ 9 KB gzip** | Size budget test | Same |
| Renderer bundle | **≤ 5 KB minified** | Size budget test | `tests/budgets/renderer-size.test.mjs` |
| Client page added weight | **≤ 15 KB compressed** | Manual Lighthouse | Integration verification |

| ID | Requirement |
|---|---|
| TR-PERF-001 | Size budgets MUST be enforced by tests that fail the build. |
| TR-PERF-002 | Duration budgets MUST be monitored, not build-enforced. Wall-clock duration on a shared CI runner is too variable to gate a build on, and a flaky performance gate trains engineers to re-run CI. |

**The distinction in TR-PERF-002 matters.** Size is deterministic and therefore gate-able. Duration is not, so it is alerted on trend rather than asserted on a single run.

## 43.2 Where the Time Actually Goes

Measured profile of a representative 120-review DOM harvest. **Understanding this distribution is what prevents optimisation effort being spent in the wrong place.**

| Phase | Typical | Share | Optimisable |
|---|---|---|---|
| Browser launch (amortised across shard) | 1.5 s | 2% | Already amortised |
| Context creation | 0.1 s | < 1% | No |
| Initial navigation + render | 4–8 s | 8% | Partly, via resource blocking |
| **Pagination (scroll + settle loops)** | **35–70 s** | **~65%** | **Yes — the dominant cost** |
| Text expansion | 8–20 s | 18% | Yes, via budget tuning |
| DOM serialisation | 0.3 s | < 1% | No |
| **Pure pipeline (extract → gate)** | **0.4 s** | **< 1%** | Already fast |
| Publish (Git ops, amortised) | 2 s | 3% | Already batched per shard |
| Inter-target pacing (deliberate) | 5–10 s | 10% | **Intentionally not optimised** |

**Two conclusions follow, and both are load-bearing.**

First, ~65% of harvest time is waiting for lazily-loaded content, so optimisation effort belongs almost entirely in the pagination loop.

Second — and more important for implementers — **the pure pipeline is under 1% of runtime.** There is no engineering reason to compromise the core's clarity, purity, or thoroughness for speed. That is an explicit licence to write the most obviously-correct reconciliation code rather than the fastest.

## 43.3 Optimisations Applied

| # | Optimisation | Mechanism | Measured Effect |
|---|---|---|---|
| O-1 | **Resource blocking** | Block images, media, fonts, analytics, non-allowlisted hosts | 60–80% fewer bytes; 25–40% faster page-ready |
| O-2 | **Adaptive settle wait** | Wait for a count increase *or* the settle timeout, whichever first — not a fixed sleep | 200–600 ms per scroll iteration; 3–7 s per harvest |
| O-3 | **Incremental scroll** | Scroll by 90% of container height | Avoids skipping past the virtualisation window — **a correctness win as much as a performance one** |
| O-4 | **Browser reuse across targets** | One browser per shard, fresh context per target | ~1.5 s per target after the first |
| O-5 | **Expansion prioritisation** | Longest-truncated first within the budget | Maximises recovered text per unit of budget |
| O-6 | **Batch Git operations** | One commit and push per shard | ~2 s per target; 5–20× fewer commits |
| O-7 | **Sparse, shallow checkouts** | `fetch-depth: 1` plus sparse paths | 5–15 s per job, and it degrades less as history grows |
| O-8 | **Ring-buffered debug logging** | Debug retained in memory, flushed only on failure | Eliminates megabytes of I/O per healthy run |
| O-9 | **Identity cache** | Resolved identity persisted; search step eliminated | 5–15 s per target, and removes the most fragile step |
| O-10 | **Cost-balanced sharding** | Partition by historical p50 duration | Slowest shard 20–40% shorter than naive partitioning |
| O-11 | **Hash-gated writes** | Skip writes when content is byte-identical | Most cycles for a stable listing write nothing at all |
| O-12 | **Precomputed aggregates** | Stats computed at build time | Renderer stays under 5 KB and does zero arithmetic |

| ID | Requirement |
|---|---|
| TR-PERF-010 | O-2 MUST wait for a count increase *or* the timeout, whichever comes first. A fixed sleep wastes the difference on every iteration, and there are dozens of iterations per harvest. |
| TR-PERF-011 | O-1's effectiveness MUST be asserted by an integration test. A regression that silently stops blocking images is otherwise invisible — the harvest still succeeds, just slower and heavier. |

## 43.4 Optimisations Deliberately Not Applied

| Rejected | Reason |
|---|---|
| **Parallel targets within one shard** | Multiplies concurrent requests to the source and multiplies peak memory. Politeness and predictability outweigh a 2× shard speedup |
| **Removing inter-target pacing** | It is a feature, not overhead (§57.3) |
| **Aggressive scroll-to-bottom** | Faster but skips records — trades correctness for speed |
| **Reusing browser contexts across clients** | Saves ~100 ms; breaks per-target isolation (INV-09) and leaks state between tenants |
| **Caching page HTML between runs** | Defeats the entire purpose; the point is to observe change |
| **Micro-optimising the pure pipeline** | It is < 1% of runtime. Clarity wins |
| **Compressing payloads at rest in Git** | Git already compresses objects; pre-compression would defeat delta compression and make diffs unreadable |
| **HTTP/2 tuning, connection pooling** | The browser handles it; there is nothing to tune at 8–14 requests |

**Agent Note.** Several entries in this table are optimisations a performance-minded implementer would reach for by default. Each was considered and rejected for a stated reason. Applying any of them requires an EDR that addresses that reason.

## 43.5 Frontend Performance

The consumer side is where performance is most visible to end users and where the budget is tightest.

| Concern | Approach |
|---|---|
| **Zero third-party origins** | Payload served from one origin the client already trusts, or a TradyPerch subdomain. No vendor script |
| **Build-time path (preferred)** | SSG frameworks import the payload at build and render into HTML. Runtime cost: **zero**. Works with JavaScript disabled |
| **Runtime path** | Fetch `latest.json` (≤ 9 KB gzip), render into pre-sized containers |
| **Layout stability** | Containers pre-sized from `stats.total_count` and a fixed card height, so **CLS is 0** |
| **Avatar images** | Lazy-loaded, `decoding="async"`, with `initials` rendered immediately. Avatars never block first paint |
| **Progressive enhancement** | Static markup first; the renderer enhances it. A failed fetch leaves existing markup untouched |
| **Pagination** | Client-side over an already-loaded payload — instant, no network |
| **Fonts** | The renderer inherits the host site's typography and loads no font of its own |

| ID | Requirement |
|---|---|
| TR-PERF-020 | The renderer MUST pre-size containers from `stats.total_count` so cumulative layout shift is zero. |
| TR-PERF-021 | A failed payload fetch MUST leave existing markup untouched and MUST NOT display an error. It is supplementary content; its absence must be invisible. |

## 43.6 Regression Prevention

| Guard | Mechanism |
|---|---|
| Size budgets | CI tests fail on payload or renderer size regression |
| Duration tracking | `MET-harvest-duration` p95 alert at > 240 s |
| Benchmark test | Pure pipeline against a 1,000-review fixture, asserting ≤ 2 s |
| Blocked-bytes assertion | Integration test asserts the blocker is active and effective |
| Cold-start tracking | Setup step duration recorded in the manifest |

---

# 44. Memory Limits

## 44.1 Budget

| Constraint | Value |
|---|---|
| Runner RAM available | ~16 GB (TA-01 — **verify at implementation**) |
| **Peak RSS, whole process tree** | **≤ 700 MB** |
| Node process alone | **≤ 120 MB** |
| Chromium | ≤ 500 MB typical, **≤ 600 MB peak** |
| Concurrency within a shard | **1 target at a time** |

**The budget is deliberately an order of magnitude below available RAM.** Not because memory is scarce, but because staying far under the ceiling means a pathological listing (5,000 reviews with long text) cannot OOM the job, and because a rising memory profile is only a useful leak indicator when the baseline is low.

## 44.2 Where Memory Goes

| Consumer | Typical | Growth Driver | Control |
|---|---|---|---|
| Chromium renderer process | 300–500 MB | DOM node count; review count | `max_reviews` cap; resource blocking |
| Serialised DOM subtree | 2–20 MB | Review count × text length | Subtree only, never the whole document |
| Extracted/normalised records | 1–10 MB | Review count | Bounded text length; single-pass transformation |
| Ledger in memory | 0.2–5 MB | Total historical reviews including tombstones | Pruning policy at 5 MB |
| Log ring buffer | ≤ 4 MB | Event volume | Hard cap by count and bytes |
| Playwright internals | 50–80 MB | Contexts open | One context at a time |

## 44.3 Techniques Applied

| # | Technique | Detail |
|---|---|---|
| M-1 | **Serialise only the review subtree** | Never serialise the whole document. Reduces parser input by 5–20× |
| M-2 | **Hard review cap** | `max_reviews` default 1,000, hard ceiling 5,000. Beyond this, `cap_reached` rather than unbounded growth |
| M-3 | **Bounded text length** | 5,000 graphemes per review, enforced during normalisation **before records accumulate** |
| M-4 | **Bounded log buffer** | 2,000 events or 4 MB, whichever first |
| M-5 | **Single-pass transformation** | Extract → normalise → validate per record where possible, rather than materialising three full arrays |
| M-6 | **Close contexts in `finally`** | A leaked context leaks tens of MB and compounds across a 20-target shard |
| M-7 | **Release the DOM handle before the pure pipeline** | The serialised string is retained; the page and its handles are released, letting Chromium reclaim memory during processing |
| M-8 | **Ledger map, not array** | Keyed by `identity_hash`. Reconciliation is O(n) with no nested scans, avoiding O(n²) temporary allocation at 1,000+ reviews |
| M-9 | **No raw HTML retention after extraction** | Kept only if diagnostics are triggered; discarded on success |
| M-10 | **Streaming-friendly health writes** | Health series is appended, never read-modify-written in full |

| ID | Requirement |
|---|---|
| TR-MEM-001 | M-3 MUST apply during normalisation, before records accumulate. Bounding after accumulation defeats the purpose — the unbounded text has already been allocated. |
| TR-MEM-002 | M-6 MUST be enforced by both a lint rule and an integration test asserting the open-context count returns to zero. |
| TR-MEM-003 | M-8 MUST be implemented. A ledger represented as an array forces a nested scan per observed record, producing O(n²) behaviour and substantial temporary allocation at 1,000+ reviews. |

## 44.4 Memory Failure Handling

| Scenario | Detection | Response |
|---|---|---|
| Chromium OOM | Context crash / `ERR-BROWSER-OOM` | **Never retried.** Target fails; alert recommends lowering `max_reviews` for that client |
| Node heap exhaustion | Process crash | Shard fails; the missing run manifest is itself the signal. Prevented by M-2 and M-3 |
| Gradual growth across a shard | `peakRssBytes` sampled per target in the manifest | A monotonic rise across targets indicates a leak (usually a leaked context) and raises a `warn` alert |

| ID | Requirement |
|---|---|
| TR-MEM-010 | Peak RSS MUST be recorded per target in the run manifest. |

## 44.5 Leak Detection

**Ephemeral processes hide leaks.** A leak that would be obvious in a long-running service is invisible here — the process exits before it matters, until one day a shard has twenty targets and it does.

| ID | Requirement |
|---|---|
| TR-MEM-020 | Peak RSS per target MUST be trended within a run. A monotonic increase across targets in a single shard is the leak signature and MUST raise a `warn` alert. |
| TR-MEM-021 | The integration test asserting zero open contexts after a multi-target run MUST include a run in which a target fails, since the failure path is where `finally` blocks get skipped. |

---

# 45. CPU Requirements

## 45.1 CPU Profile

The workload is **I/O-bound, not CPU-bound**. This single fact governs every decision in this section.

| Consumer | CPU Share | Notes |
|---|---|---|
| Chromium rendering and script execution | ~70% | The page executes an application; this is unavoidable |
| Waiting (network, settle delays, pacing) | — | Not CPU; it is the majority of wall clock |
| Pure pipeline | **< 1%** | 0.4 s for 120 reviews |
| Hashing (SHA-256 per review × 2) | < 0.1% | Negligible at any realistic review count |
| JSON serialisation | < 0.5% | Minification and stable key ordering |
| Git operations | ~2% | Amortised per shard |

| Requirement | Value |
|---|---|
| Minimum cores | 2 |
| Recommended cores | 2–4 |
| Parallelism within a shard | **1 target at a time** |
| Worker threads | **none** |
| Native compilation | **none** (DEP-3) |

## 45.2 Why There Is No Parallelism Inside a Shard

| ID | Requirement |
|---|---|
| TR-PERF-030 | Targets within a shard MUST be processed sequentially. |

**Three independent reasons, any one of which would be sufficient:**

1. **Request pressure.** Two concurrent targets double the instantaneous request rate against the source, which §57 exists to minimise.
2. **Memory.** Two concurrent browser contexts with materialised DOMs roughly double peak RSS, breaching the §44 budget.
3. **Diagnosability.** Interleaved logs from concurrent targets are materially harder to read during an incident, and the run is not wall-clock-constrained anyway.

Parallelism exists at the **shard** level, where it is bounded by `max_parallel` and where each shard is a separate process with its own memory.

## 45.3 CPU-Sensitive Operations

| Operation | Cost | Mitigation |
|---|---|---|
| Grapheme segmentation for length bounding | Moderate on very long text | Applied once per review, bounded at 5,000 graphemes |
| String similarity for near-duplicate detection | **O(n²) pairs if done naively** | Compare only within `author_key` buckets, not across all pairs |
| Canonical serialisation for hashing | Low | Stable key ordering computed once per record |
| JSON parse of the prior ledger | Low | ~180 KB for 120 reviews |

| ID | Requirement |
|---|---|
| TR-PERF-031 | Near-duplicate detection MUST bucket by `author_key` before comparing. A naive all-pairs comparison is O(n²) and becomes visible at 1,000+ reviews — the only place in the pure pipeline where an algorithmic mistake would actually matter. |

## 45.4 What Not to Optimise

Given the < 1% figure in §43.2, the following are explicitly out of scope and require an EDR to pursue:

| Not Worth Doing | Why |
|---|---|
| Faster hashing algorithm | SHA-256 at this volume is sub-millisecond |
| Streaming JSON parser for the ledger | The ledger fits comfortably in memory and is read once |
| Worker threads for the pure pipeline | Adds complexity and serialisation cost to something taking 0.4 s |
| Caching normalisation results | Records are processed once per run |
| Lazy evaluation in the projector | Determinism is worth more than laziness, and the projector is fast |

---

# 46. Storage Requirements

## 46.1 What Is Stored, Where

| Store | Branch | Content | Growth Rate | Served |
|---|---|---|---|---|
| Engine | `main` | Code, config, selectors, schemas, fixtures | Slow, human-driven | no |
| Payloads | `data` | Published artifacts | Per changed harvest | **yes** |
| Ledgers | `state` | Full internal state | Per changed harvest | no |
| Health | `state` | Append-only JSONL | Every run, ~200 B/target | no |
| Caches | `state` | Identity, budgets, breaker | Tiny | no |
| Run manifests | `state` | ~4 KB per run | Every run | no |
| CI artifacts | Platform | Logs, diagnostics | Every run, expiring | no |

## 46.2 The Public-Repository Consequence

Because unmetered CI minutes require a public repository, **everything in the repository is world-readable.** This is acceptable only because of a strict invariant.

| Requirement | Enforcement |
|---|---|
| No secrets anywhere (INV-08) | Secret scanning on every push; redaction at the log sink; secrets exist only as platform secrets |
| No data beyond what is already public | Payloads contain review content already publicly displayed at the source |
| No additional personal data | Data minimisation; the Ledger holds no more personal data than the payload, plus hashes |
| Diagnostics containing rendered personal data expire | 14-day artifact retention; screenshots are CI artifacts, never committed |

| ID | Requirement |
|---|---|
| TR-STOR-030 | The public-ledger consequence MUST be disclosed to every client **at onboarding**, in writing. A client who objects MUST be deployed in private-repository mode, which costs CI minutes. |

**Stated plainly:** the Ledger is public. Anyone can read a client's full review history including tombstones. That is a deliberate, disclosed consequence of the zero-cost constraint, and it is defensible because the content is already public at the source. It must be surfaced during onboarding, not discovered later.

## 46.3 Payload Storage Optimisation

| Technique | Detail | Saving |
|---|---|---|
| Minification | No whitespace in published artifacts | ~25% |
| Stable key ordering | Deterministic bytes; enables hash-gating and clean diffs | Enables everything else |
| Field omission | Absent optional fields omitted rather than emitted as `null` where the schema permits | 5–12% |
| Split artifacts | `latest.json` serves the common case | Most consumers fetch 8 KB instead of 38 KB |
| `stats.json` | 1 KB artifact for badge use cases | Avoids a 38 KB fetch for "4.9★ from 118 reviews" |
| Hash-gated writes | Unchanged content is not rewritten | Most cycles produce zero commits for stable listings |
| Rely on Git compression | No pre-compression at rest | Preserves delta compression and readable history |

**Measured for a 120-review listing:** `reviews.json` ≈ 108 KB raw / 37 KB gzip; `latest.json` ≈ 19 KB / 7 KB; `stats.json` ≈ 0.9 KB; `schema-org.json` ≈ 28 KB (opt-in).

## 46.4 Payload Sharding

| Aspect | Design |
|---|---|
| Trigger | `reviews.json` exceeds `publish.payload_shard_threshold` (default 1 MB, ~1,200 reviews) |
| Shape | `reviews.page-<n>.json`, each ≤ threshold, plus a `pagination` block in the listing manifest |
| Ordering | **Newest-first**, so page 1 is what almost every consumer needs |
| Compatibility | `latest.json` and `stats.json` unaffected — the common integration never notices |
| Status | Deferred to v1.1 (L-23); `max_reviews` protects in the interim |

## 46.5 History Growth Management

**The real risk in a Git-as-database design.**

| Scenario | Commits/day | Annual Commits | Annual `data` Growth |
|---|---|---|---|
| 1 client, stable listing (hash-gating active) | ~0.3 | ~110 | ~2 MB |
| 10 clients | ~3 | ~1,100 | ~20 MB |
| 50 clients | ~15 | ~5,500 | ~100 MB |
| 100 clients | ~30 | ~11,000 | ~200 MB |
| **100 clients, hash-gating broken** | **~400** | **~146,000** | **~3 GB** |

**Hash-gating is the load-bearing control, and its failure is a 15× growth event.** `MET-commit-churn` monitors it directly with a threshold of 30 commits per client per week, because a silent regression here is otherwise invisible until the repository is unwieldy.

| ID | Requirement |
|---|---|
| TR-STOR-040 | Hash-gating MUST be verified by an integration test asserting that a second identical run produces **zero** file writes. |

## 46.6 Truncation Policy

| Branch | Policy | Frequency | Rationale |
|---|---|---|---|
| `main` | **Never truncated** | — | Code history is permanent |
| `data` | Retain 90 days; older squashed into a baseline commit | Quarterly, scripted | Only current state matters for a published artifact |
| `state` | Retain 12 months; older squashed | Annually, manual with review | Ledger history is the audit trail and is worth more |

| ID | Requirement |
|---|---|
| TR-STOR-041 | Truncation MUST run against a **mirror first**, MUST verify the tip tree is byte-identical before and after, and MUST be announced so anyone holding a clone re-clones. |
| TR-STOR-042 | The mirror MUST be retained as the offsite backup (§60.6). |

## 46.7 Ledger Growth

| Aspect | Value |
|---|---|
| Size per review including history | ~1.5 KB |
| 120-review listing | ~180 KB |
| Growth | **Monotonic** — tombstones and revision history are never pruned in v1.0 |
| Pruning trigger | 5 MB per ledger |
| Pruning policy | Defined but not implemented in v1.0 (L-24) |

## 46.8 Disk Requirements at Run Time

| Item | Size |
|---|---|
| Repository checkout (`main`, shallow sparse) | ~15 MB |
| `data` checkout (shallow) | ~5–50 MB depending on client count |
| `state` checkout (shallow, sparse) | ~2–20 MB |
| `node_modules` | ~120 MB |
| Browser binaries | ~350 MB |
| Working artifacts (logs, diagnostics) | ~10–50 MB |
| **Total** | **~500 MB – 600 MB** |

---

*End of Part 8. Part 9 specifies security requirements, secrets management, the four validation layers, the JSON Schema specification, hash generation, and change detection.*
