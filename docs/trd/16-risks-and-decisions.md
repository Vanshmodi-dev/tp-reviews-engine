# Part 16 — Risks, Decisions, Trade-offs, and Limitations

*Sections 92 through 96. Audience: architects, engineering leads, anyone inheriting this system. This part is deliberately unflattering. A document that only records what works is not useful to whoever has to maintain the result.*

---

# 92. Risks During Implementation

## 92.1 Implementation Risk Register

These are risks to **building** the system, distinct from the SAD's register of risks to **operating** it.

| ID | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| **IR-01** | **The absence asymmetry is "simplified" during implementation or a later refactor** | **High** | **Critical** | PT-07 + CH-04 + explicit Agent Notes in §22.5; review checklist item 1 | Backend |
| **IR-02** | Purity leaks into `core/` via a default `Date.now()` parameter | **High** | High | DR-2 architecture test; §67.4; called out as the most likely agent error | Backend |
| IR-03 | Selector pack authoring produces `css`-only strategies under time pressure | High | Medium | TR-SEL-011 blocks it; pack schema requires ≥ 2 strategies of different kinds | Backend |
| IR-04 | Date parser fails on singular forms ("a day ago", "yesterday") | **High** | Medium | Locale matrix unit tests are mandatory; §21.6.1 names the hazard explicitly | Backend |
| IR-05 | Length bounding implemented by code units rather than grapheme clusters | Medium | Medium | TR-NORM-020 + a ZWJ boundary test | Backend |
| IR-06 | `generated_at` accidentally included in the content hash | Medium | **High** | TR-HASH-034 and TR-HASH-035 as a matched pair; `MET-commit-churn` catches it in production | Backend |
| IR-07 | Line-ending drift on a Windows development machine breaks byte-determinism | Medium | Medium | `.gitattributes` LF enforcement; TR-BLD-002 | DevOps |
| IR-08 | The Gate is implemented with short-circuit evaluation | Medium | Medium | EDR-023; 100% coverage requirement surfaces unreached branches | Backend |
| IR-09 | Browser contexts leak because `finally` is omitted on an error path | Medium | **High** | TR-BRW-053 integration test **including a failing target** | Backend |
| IR-10 | The `data` checkout is skipped in the workflow to save time | Low | **Critical** | TR-CI-022; without it, G-02…G-05 silently stop working | DevOps |
| IR-11 | A retry is added to an `ERR-BLOCKED-*` path "just to see if it clears" | Medium | **High** | TR-NAV-042 enumerating test; INV-07 | Backend |
| IR-12 | Extraction implemented against live browser handles rather than a serialised string | Medium | **High** | EDR-015; DR-1 makes it impossible in `core/` | Backend |
| IR-13 | Owner replies ingested as reviews | Medium | **High** | EDR-016 ordering; fixture 004 | Backend |
| IR-14 | Aggregate business rating captured instead of a review rating | Medium | **High** | TR-EXT-040 integer post-check | Backend |
| IR-15 | Near-duplicate detection implemented as all-pairs comparison | Medium | Low | TR-PERF-031 bucketing requirement | Backend |
| IR-16 | Unknown `TPRE_*` variables silently ignored | Medium | Medium | EDR-006; startup rejection | Backend |
| IR-17 | Test suite grows past three minutes and stops being run locally | Medium | Medium | TR-BLD-011; suite timing tracked in CI | QA |
| IR-18 | Live tests added to the blocking path | Low | Medium | TR-TEST-021 excludes `tests/live/` from the default runner | QA |
| IR-19 | A production dependency added without DEP-1 justification | Medium | Medium | Dependency graph test; review checklist | Reviewer |
| IR-20 | Workflow written without an explicit `permissions` block | Medium | High | `security.workflow-lint` fails the build | DevOps |
| IR-21 | Secrets logged during early development before redaction is wired | Medium | **Critical** | Startup order (§11.5 step 4 before 5); sentinel test | Backend |
| IR-22 | Implementation begins with the browser adapter rather than the pure core | Medium | Medium | Build order is dependency-ordered; the Normalizer is phase 2 | Lead |
| IR-23 | The CSV adapter is deferred, so the adapter interface is never validated against a second implementation | Medium | **High** | Build phase 11 places it before any browser work | Lead |
| IR-24 | Ledger implemented as an array rather than a map | Low | Medium | TR-MEM-003; O(n²) becomes visible at 1,000 reviews | Backend |
| IR-25 | The first-publish exception applied when the `data` checkout merely failed to read | Low | **Critical** | TR-ENV-013 and TR-GATE-012 distinguish "no prior payload" from "could not read prior payload" | Backend |

## 92.2 The Five Risks Worth Re-reading Before Coding

| # | Risk | Why It Tops the List |
|---|---|---|
| 1 | **IR-01 — absence asymmetry simplified** | The only implementation defect that can silently delete a paying client's entire review set. Everything else degrades; this one destroys |
| 2 | **IR-10 — `data` checkout skipped** | A three-second saving that disables the system's most valuable safety rules, with no visible symptom until a bad payload publishes |
| 3 | **IR-25 — unreadable prior payload treated as empty** | Turns a transient infrastructure failure into an unvalidated publish over a healthy payload |
| 4 | **IR-21 — secrets logged before redaction is seeded** | Irreversible in a public repository |
| 5 | **IR-02 — clock leaks into `core/`** | Does not fail anything visibly; it silently converts fifteen property laws into tests that prove nothing |

**Note the common shape of items 1, 2, 3, and 5: none of them produce a failing test or an error message.** They produce a system that appears to work. That is what makes them the top risks, and it is why each has a *named, mandatory* test rather than a review guideline.

## 92.3 Schedule Risks

| Risk | Assessment |
|---|---|
| Selector pack authoring is slower than estimated | **Likely.** The first pack for a source is substantially harder than subsequent versions. Budget 3 days, not 1 |
| The date locale matrix expands | Likely. Six locales is a minimum, not a ceiling. The phrase table is data, so expansion is cheap once the mechanism exists |
| Fixture capture and sanitisation is fiddly | Likely. `scripts/capture-fixture.mjs` and `sanitize-html.mjs` are load-bearing tooling and deserve real effort in phase 13 |
| Building four adapters instead of one | **Known and accepted: +20–25%.** Not a risk; a decision |
| The 60-minute selector repair target is not met initially | Expected. The target assumes the diagnostics bundle, the fixture tooling, and the `parse:fixture` loop all exist and work |

## 92.4 Risk-to-Test Traceability

| Risk | Enforcing Test |
|---|---|
| IR-01 | **PT-07, CH-04** |
| IR-02 | DR-2 architecture test |
| IR-03 | Pack schema validation |
| IR-04 | Locale matrix unit tests |
| IR-05 | ZWJ boundary unit test |
| IR-06 | TR-HASH-034 / TR-HASH-035 pair; hash-gating integration test |
| IR-08 | Gate 100% coverage |
| IR-09 | Context-isolation test with a failing target |
| IR-11 | `retry-policy.blocked-never` |
| IR-12 | DR-1 architecture test |
| IR-13 | Fixture 004 |
| IR-14 | Rating integer post-check unit test |
| IR-20 | `security.workflow-lint` |
| IR-21 | `security.redaction` sentinel test |
| IR-24 | Pure pipeline benchmark at 1,000 reviews |
| IR-25 | Gate unit test for the unreadable-prior case |

**Ten of the twenty-five implementation risks have a dedicated named test.** The remainder are caught by review, by build ordering, or by production metrics — and that distribution is deliberate: tests are expensive, and they are spent on the failures that are silent.

---

# 93. Engineering Decisions

## 93.1 Decision Register

Forty implementation-level decisions, each subordinate to an architectural decision in the SAD. The full text of each appears inline at the point of relevance; three that had no natural inline home appear in full below.

| EDR | Decision | § | Serves |
|---|---|---|---|
| EDR-001 | Stage functions are free functions over an explicit context, not classes | §1.3 | ADR-018 |
| EDR-002 | `Result` is a discriminated union; `core/` never throws | §7.4 | ADR-018 |
| **EDR-003** | **One composition root; adapters constructed nowhere else** | **§93.2** | DR-5 |
| EDR-004 | Stage boundaries typed by branded record types | §5.1 | INV-05 |
| EDR-005 | Config deeply frozen, carries a resolution trace | §8.2 | ADR-015 |
| EDR-006 | Unknown `TPRE_*` variables are a startup error | §9.7 | ADR-015 |
| **EDR-007** | **Dependencies pinned by lockfile; `npm ci` only** | **§93.3** | DEP-4 |
| EDR-008 | No transpilation; JSDoc-typed `.mjs` runs as committed | §12.1 | ADR-004 |
| EDR-009 | Browser control is a port; `playwright` imported by one file | §15.1 | ADR-005 |
| EDR-010 | Headless only in production; headed is a local debug flag | §17.1 | ADR-005 |
| EDR-011 | One browser per shard, one context per target, closed in `finally` | §18.1 | INV-09 |
| EDR-012 | Host allowlist plus resource-type denylist, both measured | §16.3 | THREAT-04 |
| EDR-013 | Scroll by container-height ratio, never to absolute bottom | §19.3 | ADR-009 |
| EDR-014 | The growth curve is a first-class retained output | §19.3 | RISK-04 |
| EDR-015 | Extraction operates on a serialised subtree string | §20.1 | ADR-017 |
| EDR-016 | Owner-reply detachment before any other extraction | §21.3 | FR-033 |
| EDR-017 | Three-parser rating cascade with a mandatory integer post-check | §21.5 | RISK-11 |
| EDR-018 | Two-tier duplicate detection; deterministic intra-run collapse | §22.2 | ADR-007 |
| EDR-019 | Eight-step ordered normalisation pipeline | §23.3 | INV-05 |
| EDR-020 | Grapheme-cluster-aware length bounding, applied last | §23.4 | INV-05 |
| EDR-021 | Payloads minified, ledgers pretty-printed, both stably ordered | §24.3 | FR-065 |
| EDR-022 | `generated_at` excluded from every content hash | §24.3 | FR-065 |
| EDR-023 | The Gate evaluates all rules and returns all reasons | §26.2 | ADR-011 |
| EDR-024 | Rejection discards observations from both stores | §26.5 | ADR-011 |
| EDR-025 | Publication order is payload-then-state | §26.7 | INV-04 |
| EDR-026 | Retry policy is a lookup table; the executor is generic | §29.1 | ADR-018 |
| EDR-027 | Every retry is budget-checked before sleeping | §29.3 | NFR-016 |
| EDR-028 | Six nested timeout levels, each strictly inside the next | §30.1 | NFR-016 |
| EDR-029 | The shard matrix is emitted by a job, never hard-coded | §32.2.1 | ADR-016 |
| EDR-030 | Exit codes 5, 6, 7 are CI successes and alerting failures | §2.3.1 | ADR-011 |
| EDR-031 | Redaction is a sink-level transform seeded at startup | §37.5 | FR-076 |
| EDR-032 | Debug and trace ring-buffered, flushed only on failure | §37.4 | NFR-036 |
| EDR-033 | Health records are append-only JSONL | §42.1 | ADR-021 |
| EDR-034 | Rate budget accounting is pessimistic | §57.5 | FR-089 |
| EDR-035 | Concurrency safety by path disjointness, not locking | §56.1 | INV-09 |
| EDR-036 | Identity hashing versioned, cross-adapter fields only | §53.3 | ADR-023 |
| EDR-037 | Feature flags are config keys, never runtime toggles | §73.1 | ADR-015 |
| EDR-038 | Adapters statically registered, not dynamically loaded | §74.1 | ADR-002 |
| EDR-039 | Schema files are the runtime authority | §52.1 | P-4 |
| **EDR-040** | **Every future-platform seam is an interface that already exists in v1.0** | **§93.4** | ADR-002 |

## 93.2 EDR-003 — One Composition Root

> **EDR-003 — All concrete implementations are constructed in exactly one file**
> **Serves:** DR-5, ADR-002.
> **Context:** Dependency injection can be done anywhere. Left unconstrained, each command file constructs the adapters it needs, and within a few months there is no single place that answers "which notifier is production actually using?"
> **Decision:** `cli/composition.mjs` is the only file in the repository permitted to construct a concrete adapter, port implementation, or infrastructure object. Everything else receives what it needs as an argument.
> **Alternatives Rejected:** *Construct where needed* — the default; makes the wiring unknowable and makes it trivially easy for `app/` to import a concrete adapter, violating DR-4. *A dependency-injection container* — solves a wiring problem that does not exist at thirty components, and replaces an explicit, greppable file with runtime resolution that static analysis cannot verify. *Factory functions per layer* — several composition roots instead of one, which is the problem restated.
> **Trade-off:** The composition root grows to a few hundred lines and is the least elegant file in the codebase. Accepted: it is also the file a new maintainer reads first to understand what the system is actually made of.
> **Scalability:** Grows linearly with implementation count, which is small and bounded. At v3.0 with a database adapter and an API publisher it remains one readable file.

## 93.3 EDR-007 — Lockfile-Only Installation

> **EDR-007 — Dependencies are pinned by a committed lockfile and installed with `npm ci` exclusively**
> **Serves:** DEP-4, ADR-005 (browser pinning).
> **Context:** `npm install` resolves version ranges at install time, so two installs from the same source can produce different trees — including a different Chromium build, since the browser version is determined by the Playwright version.
> **Decision:** The lockfile is committed. CI installs with `npm ci` only. `npm install` is never used in any workflow.
> **Alternatives Rejected:** *`npm install` in CI* — the browser could change between two runs of the same commit, which breaks the determinism that fixture-based regression testing depends on and makes "which browser produced this payload?" unanswerable. *Vendoring `node_modules`* — enormous repository growth for a property the lockfile already provides. *A dependency-version range policy with periodic manual pinning* — pinning that depends on someone remembering is not pinning.
> **Trade-off:** Dependency updates require an explicit pull request rather than arriving silently. That is the intent, not a cost.
> **Scalability:** Unchanged. The discipline matters more as the dependency tree grows, not less.

## 93.4 EDR-040 — Seams Before Features

> **EDR-040 — Every future-platform capability has an interface that already exists in v1.0**
> **Serves:** ADR-002, ADR-003.
> **Context:** Sixteen future capabilities are specified in Part 15. The two failure modes are building them early, and building v1.0 so tightly that adding them later requires a rewrite.
> **Decision:** For each future capability, v1.0 ships the *seam* and nothing else. `StatePort` exists so a database can be added. Stage 7 exists as a deterministic no-op so enrichment can be added. The `ai` block is declared nullable so consumers are already forward-compatible. The Ledger remains the source of truth so an API can project from it.
> **Alternatives Rejected:** *Build the features* — enormous cost for capabilities with no current user, and every one of them adds operating burden against a one-maintainer constraint. *Build nothing and refactor later* — the specific refactors that would be required (extracting a state port after the fact, adding a pipeline stage, adding a payload field to a live contract) range from tedious to genuinely breaking for consumers. *Build abstract base classes and framework scaffolding* — speculative generality; the seams here are interfaces with at least one real implementation, not empty extension points.
> **Trade-off:** A handful of interfaces and one no-op module exist in v1.0 with a single implementation each, which looks like over-abstraction to a reviewer who has not read Part 15. The `@see` references in module headers exist partly to answer that reviewer.
> **Scalability:** This is the mechanism by which roughly 60% of the codebase and 100% of the hard-won correctness logic survives from v1.0 to v4.0.

## 93.5 Decision Density by Area

| Area | EDRs | Why So Many / Few |
|---|---|---|
| Acquisition and browser | 9 | The most volatile area, where a wrong choice is expensive to reverse |
| Data processing and hashing | 8 | Where silent corruption enters |
| Publication and recovery | 6 | Where a wrong choice reaches a visitor |
| Configuration and environment | 5 | Where operator confusion originates |
| Observability | 3 | Constrained by CON-01 into few real options |
| Structure and standards | 5 | Enforced mechanically, so few decisions needed |
| Extensibility | 4 | Mostly decisions **not** to build |

---

# 94. Technical Trade-offs

## 94.1 The Trade-off Register

Every entry states what was given up, what was gained, and the condition under which the trade should be revisited.

| ID | Trade-off | Given Up | Gained | Revisit When |
|---|---|---|---|---|
| **TT-01** | Deletions propagate slowly (up to 3 cadence intervals, ~18 h) | Prompt removal of genuinely deleted reviews | **Immunity to mass deletion from a bad harvest** | Never. This asymmetry is the product |
| **TT-02** | The Gate sometimes refuses genuinely correct data | Freshness in rare legitimate-large-change cases | Protection against every silent-corruption mode | Gate rejection rate persistently > 10% |
| **TT-03** | Freshness measured in hours, not seconds | Real-time updates | Zero cost, zero latency at render, zero third-party origins | A client genuinely needs sub-hour freshness |
| **TT-04** | Dates are estimates, pinned at first observation | Absolute date precision on the DOM path | Stable sort order that does not scramble on every run | Client migrates to an official API — the problem disappears |
| **TT-05** | Review text loses all formatting | Emphasis, links, lists in review text | **Elimination of stored XSS across every client site simultaneously** | Never |
| **TT-06** | No transpilation, JSDoc types | TypeScript syntax ergonomics | Stack traces that point at committed source at 2 a.m. | Codebase outgrows JSDoc's expressiveness |
| **TT-07** | Four adapters built in v1.0 instead of one | ~20–25% additional effort | A tested migration path, and a validated abstraction | Never |
| **TT-08** | Git as the database | Queries, concurrent writes, unbounded history | Versioning, atomicity, replication, audit log, code review on data, free PITR, zero cost | ~500 clients, or cross-client query needs |
| **TT-09** | Public repository | Private ledgers | Unmetered CI minutes | A client objects; private mode is available at a cost |
| **TT-10** | Parallelism capped at 4 shards | Wall-clock completion time | Bounded instantaneous request pressure on the source | Never below ~100 clients |
| **TT-11** | Sequential targets within a shard | ~2× shard speedup | Bounded memory, bounded request rate, readable logs | Never |
| **TT-12** | Debug logs discarded on success | Post-hoc analysis of healthy-but-wrong runs | No megabytes of noise per run | The Gate stops catching "subtly wrong" |
| **TT-13** | Alerts are GitHub Issues, no paging | 3 a.m. notification | Zero cost, stateful, threaded, deduplicable | A failure mode emerges that requires urgent response |
| **TT-14** | Monitoring is files, not a time-series database | Ad-hoc querying | Monitoring data versioned alongside the data it describes | ~200 clients |
| **TT-15** | Identity uses only cross-adapter fields | Marginal precision on adapters with native IDs | **The entire migration guarantee** | Never |
| **TT-16** | Commit batching per shard | Per-target commit granularity | 5–20× fewer commits | Never — safe because reconciliation is idempotent |
| **TT-17** | Hard ceilings are compile-time constants | Operator flexibility during an incident | An operator cannot turn a soft rate-limit signal into a hard block | Never |
| **TT-18** | No CAPTCHA handling of any kind | Continued access when challenged | Legal defensibility, flat maintenance cost, diagnosability | Never |
| **TT-19** | Avatars referenced, never re-hosted | Reliable avatar rendering | No copying of personal photographs onto TradyPerch infrastructure | Legal sign-off changes |
| **TT-20** | Coverage target is 95%, not 100% | A handful of reviews | A harvest that completes in bounded time | Client migrates to an official API |

## 94.2 The Trade-offs That Are Not Negotiable

Five entries above are marked "Revisit: Never." They are the ones where the trade **is** the product:

| TT | Statement |
|---|---|
| TT-01 | Absence is not deletion |
| TT-05 | Output is plain text |
| TT-07 | The migration path is built, not planned |
| TT-15 | Identity is portable across adapters |
| TT-18 | A challenge means stop |

**A change that reverses any of these is not a trade-off adjustment; it is a different product.** Each requires an ADR amending the SAD, not an EDR.

## 94.3 Trade-offs an Implementer Will Be Tempted to Reverse

| Temptation | Why It Looks Right | Why It Is Wrong |
|---|---|---|
| "Treat absence uniformly — the branching is redundant" | Simpler code, passes hand-written tests | Deletes clients' reviews on a partial page load |
| "Scroll to the bottom — it is faster" | Genuinely faster | Skips records past the virtualisation window |
| "Reuse the browser context — it saves time" | Saves ~100 ms per target | Leaks state between tenants |
| "Escape markup instead of removing it" | Preserves formatting | Leaves markup one careless `innerHTML` away from executing |
| "Retry the challenge once, it might clear" | Seems harmless | Escalates a soft block into a durable one |
| "Include the source's review ID in identity — it is more precise" | Objectively better identity | Destroys the migration guarantee |
| "Default `now` to `Date.now()`" | Idiomatic JavaScript | Silently voids fifteen property laws |
| "Skip the `data` checkout, the gate can work without it" | Saves three seconds | Disables the four most valuable gate rules |

---

# 95. Known Technical Limitations

**Stated plainly and completely.** Every limitation here is accepted, mitigated, or scheduled, and every one should be understood before promising anything to a client.

## 95.1 Data Completeness and Fidelity

| # | Limitation | Impact | Status |
|---|---|---|---|
| L-01 | **Absolute review dates are estimates, not facts** on the DOM path | A review may display as "May 2026" when posted in late April | Mitigated: `date_precision` and `date_confidence` published. **Eliminated on the API path** |
| L-02 | **No historical backfill** before the first harvest | A listing with 800 reviews may only ever surface the most recent several hundred | Accepted. Eliminated on the Business Profile API path |
| L-03 | Coverage target is 95%, not 100% | A handful of reviews may be absent from a "successful" harvest | Accepted and published as `coverage` |
| L-04 | Simultaneous author-rename and text-rewrite creates one transient duplicate | Briefly the same review appears twice, then the old one tombstones | Accepted; near-duplicate warning surfaces it |
| L-05 | Very long reviews may remain truncated if the expansion budget is exhausted | Text ends mid-sentence | Mitigated: `text_truncated` published |
| L-06 | Owner-reply dates are relative too | Same as L-01 | Same mitigation |
| L-07 | Some fields are unavailable on some adapters | Inconsistent richness across clients | **By design**: `adapter_capabilities` published so nulls are explicable |
| L-08 | `verified` is almost always null | The field exists but is unpopulated | Accepted. **Never fabricated** — a false verification badge would be deceptive |

## 95.2 Freshness and Availability

| # | Limitation | Impact | Status |
|---|---|---|---|
| L-09 | Freshness is hours, not seconds | A new review may take ~6 h 10 min to appear | By design; disclosed to clients |
| L-10 | Scheduled runs are best-effort and may be delayed | Occasional cycles run late | Accepted; SLO has margin |
| L-11 | Updates pause entirely during an upstream break or block | Reviews go stale until repaired | Mitigated: LKG means nothing looks broken; alerting at 24 h |
| L-12 | A scheduled workflow can be silently disabled after inactivity | Total silent stop | Mitigated by **two independent detectors** |

## 95.3 Method and Scale

| # | Limitation | Impact | Status |
|---|---|---|---|
| L-13 | The default DOM method is contrary to the source's terms | Contractual and reputational risk | Disclosed; migration path pre-built; authorisation gate enforced |
| L-14 | Egress IP reputation is shared and outside our control | Blocks may occur through no fault of ours | Accepted; breaker handles it; **the strongest argument for API migration** |
| L-15 | **The DOM path does not scale beyond ~50–100 clients defensibly** | A hard ceiling on the default configuration | Stated numerically in §57.2; API migration is the answer |
| L-16 | Bot challenges cannot be worked around | A challenged source stays unavailable until it clears or the client migrates | **By design** |
| L-17 | Only listings the client owns may be harvested | No competitor data, no market aggregates | By design |

## 95.4 Architectural and Operational

| # | Limitation | Impact | Status |
|---|---|---|---|
| L-18 | **The repository is public, so ledgers are publicly readable** | A client's full review history including tombstones is visible | Disclosed; private mode available at a cost. **MUST be surfaced at onboarding** |
| L-19 | No cross-client queries | Portfolio-level questions require a script | Accepted until v3.0 |
| L-20 | No real-time alerting or paging | Weekend failures may wait until Monday | Accepted — no failure mode requires urgency |
| L-21 | Monitoring is file-based and does not scale past ~200 clients | Manual analysis becomes impractical | Scheduled: §81 |
| L-22 | Onboarding requires an engineer | Not self-serve | By design for v1.0; §82 addresses it |
| L-23 | Payload sharding deferred to v1.1 | Listings above ~1,200 reviews produce a large single file | Scheduled; `max_reviews` protects in the interim |
| L-24 | Ledger history grows monotonically | Slow growth for very old, high-churn listings | Accepted; pruning policy defined at 5 MB |
| L-25 | Branch history rewriting is required periodically and is the most dangerous scripted operation | Requires care and coordination | Mitigated by the mandatory mirror-first procedure |

## 95.5 Consumer-Side

| # | Limitation | Impact | Status |
|---|---|---|---|
| L-26 | **No rich text in reviews** | Line breaks preserved; emphasis is not | By design (INV-05). **Non-negotiable** |
| L-27 | Avatars may fail to load, being hotlinked | Some cards show initials instead of a photo | By design; the `initials` fallback makes it look intentional |
| L-28 | Runtime integration requires JavaScript | JS-disabled visitors see the empty state on pattern A | Mitigated: build-time patterns need no JS |
| L-29 | Structured-data markup carries search-engine policy risk | Clients must decide with information | Opt-in, off by default |
| L-30 | A strict CSP requires a `connect-src` addition | One-line change during integration | Documented in every recipe |

## 95.6 Limitations Introduced by This Document's Own Decisions

**Stated separately because they are consequences of implementation choices rather than of the architecture.**

| # | Limitation | Source |
|---|---|---|
| L-31 | No debug detail for a run that succeeded but was subtly wrong | EDR-032 ring buffering. Mitigated because the Gate converts "subtly wrong" into a failure |
| L-32 | A crashed shard permanently over-counts its rate budget for that hour | EDR-034 pessimistic accounting. Self-corrects at rollover |
| L-33 | A crash between the two commits leaves a payload the ledger does not yet justify | EDR-025 ordering. Benign; the next run reproduces it |
| L-34 | A rejected harvest's genuine new reviews are discarded and must be re-observed | EDR-024. Cheap: the next cycle is hours away |
| L-35 | Branded types are erased at runtime and guard against accident, not malice | EDR-004. Accident is the realistic threat |
| L-36 | The composition root is the least elegant file in the codebase | EDR-003. It is also the first file a new maintainer should read |

---

# 96. Future Improvements

## 96.1 Improvement Register

Ordered by value per unit of effort, not by appeal.

| # | Improvement | Effort | Value | Version |
|---|---|---|---|---|
| **1** | **Split acquisition and publication into separate jobs** so the browser job holds no write token | 1 d | **Highest — reduces THREAT-05, the dominant residual risk** | v1.1 |
| **2** | **Business Profile API migration campaign** — offer OAuth to every existing client | ~1 h per client | **Highest — reduces the method risk and lifts every capability limit** | v1.1 |
| 3 | Expand the fixture corpus with every incident encountered during the soak | ongoing | High | v1.1 |
| 4 | `tpre doctor` expansion: verify CDN headers, schedule liveness, secret presence | 0.5 d | High | v1.1 |
| 5 | Payload sharding implementation and verification | 2 d | Medium | v1.1 |
| 6 | Automated weekly digest generation | 1 d | Medium | v1.1 |
| 7 | Per-client SLO tier enforcement | 1 d | Medium | v1.1 |
| 8 | Selector pack authoring helper (`scripts/suggest-strategies.mjs`) | 2 d | Medium | v1.1 |
| 9 | Ledger pruning policy implementation | 1 d | Low until a ledger exceeds 5 MB | v1.2 |
| 10 | Historical backfill command for the API adapters | 2 d | Medium | v1.2 |

## 96.2 The Two That Matter

**Improvement 1 — the job split.** Today the harvest job executes the most third-party code in the system (a browser plus the entire npm tree) while holding a repository write token. Splitting it so that the browser job runs with `contents: read` and uploads staged artifacts, and a small separate job with `contents: write` downloads, re-validates against the schema, and commits, means **the job that executes untrusted code holds no write credential at all.**

This is the single highest-value security improvement available to the system and it costs one extra job.

| ID | Requirement |
|---|---|
| TR-FUT-140 | The job split MUST be implemented before client count exceeds 25. |

**Improvement 2 — the migration campaign.** Every client moved to the Business Profile API simultaneously: eliminates their exposure to L-13, L-14, L-15, and L-16; improves their coverage and date precision; removes them from the DOM adapter's request budget; and makes them immune to shared-egress reputation problems.

**These are not primarily engineering improvements. They are risk retirements**, which is why v1.1 is entirely risk reduction and contains no features.

## 96.3 Improvements Deliberately Not Planned

| Not Planned | Reason |
|---|---|
| CAPTCHA solving or any evasion capability | ADR-010 |
| Authenticated scraping | Out of scope by design |
| Harvesting listings the client does not own | Out of scope by design |
| Review filtering as a marketed feature | Product position |
| Fabricated, AI-generated, or incentivised reviews | Fraud |
| Re-hosting reviewer profile images | ADR-014, unless legal sign-off changes |
| GraphQL API | §85 |
| Redis for caching | §88 |
| Kubernetes for scheduling | §90 |
| Multi-region compute | §91 |

**Ten items on the "never" list against ten on the "planned" list.** A roadmap that only accumulates is a roadmap nobody can act on; recording what has been decided against, with a reason, is what stops the same proposals recurring every quarter.

## 96.4 Improvement Triggers

Pre-committed thresholds, so scaling and investment decisions are made on data rather than on anxiety.

| Trigger | Threshold | Action |
|---|---|---|
| Cycle wall-clock | > 50% of cadence interval | Increase shard count or reduce cadence tier |
| Source pressure signals | Any 429 or challenge in 30 days | Reduce cadence; accelerate API migration |
| Runner minutes | > 50,000/month | Evaluate a dedicated host |
| `data` branch size | > 500 MB | Truncate history; consider a cohort split |
| Commits per client per week | > 30 | **Investigate hash-gating defect** |
| Client count | > 25 | Implement the job split; introduce SLO tiers |
| Client count | > 100 | **DOM adapter becomes exceptional; API migration campaign** |
| Client count | > 300 | Begin platform restructuring |
| Health file count | > 200 | Build the generated dashboard |
| Manual onboarding time | > 30 min or > 4/week | Build the admin panel |

---

*End of Part 16. Part 17 contains the developer setup guide, the local development guide, the production deployment guide, and the final technical checklist.*
