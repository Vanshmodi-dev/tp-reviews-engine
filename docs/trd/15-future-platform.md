# Part 15 — Future Adapters and Platform

*Sections 76 through 91. Audience: architects, product. **None of this is v1.0 work.** These sections exist so that v1.0's seams are correct, not so that v1.0 builds them. Each section states the trigger that justifies building it, the seam it depends on, and the honest cost.*

> **Agent Note.** An implementing agent MUST NOT build anything in this part. Its purpose is to constrain v1.0 design — for example, §87 is why `StatePort` exists, and §84 is why the payload remains the origin of truth. Building any of it early adds cost with no option value.

---

# 76. Future Google Business API Adapter

## 76.1 Status Correction — This Ships in v1.0

**The Business Profile API adapter is not future work.** It is a first-class v1.0 deliverable, alongside `google:places-api`, and this section documents it as shipped rather than planned.

| Adapter | v1.0 Status | Why |
|---|---|---|
| `google:business-profile-api` | ✅ **Ships in v1.0** | It is the migration path off DOM reading, and a migration path that does not yet exist is not a migration path |
| `google:places-api` | ✅ **Ships in v1.0** | Fallback for clients who will not complete an OAuth grant |
| `google:dom` | ✅ Ships in v1.0 | Default only for clients who decline the OAuth grant |

**Building the official adapters in v1.0 costs an estimated +20–25% effort and is the single most important risk mitigation in the project.** It converts "we would have to rewrite the acquisition layer" into "change one line of configuration." The quarterly migration drill (§60.10) exists to keep that claim true.

## 76.2 Capability Comparison

| Capability | `google:dom` | `google:places-api` | `google:business-profile-api` |
|---|---|---|---|
| Sanctioned | ❌ | ✅ | ✅ |
| Cost | free | free tier, then metered | free |
| Client friction | none | none | **OAuth grant, ~5 min** |
| Review coverage | ~95%, pagination-bounded | **~5 reviews only** | **complete** |
| Absolute dates | ❌ estimates only | ✅ | ✅ |
| Owner replies | ✅ | ❌ | ✅ |
| Historical backfill | ❌ | ❌ | ✅ |
| Immune to shared-egress blocks | ❌ | ✅ | ✅ |
| Write-back (reply management) | ❌ | ❌ | **✅ — future** |

**For any client willing to grant OAuth access to their own Business Profile, this adapter is strictly superior on every axis.** The DOM adapter exists for clients who will not complete that grant.

## 76.3 What Remains Future

| Capability | Version | Requires |
|---|---|---|
| Reply management — drafting and publishing owner replies | v4.0 | Write scope on the OAuth grant |
| Historical backfill beyond the first harvest | v1.1 | A one-time backfill command |
| Multi-location batch fetch | v2.0 | Batch endpoint usage and quota accounting |

**Reply management is only available on this adapter**, which is one more argument for the migration recommendation: the highest-value future feature is structurally unavailable to DOM clients.

## 76.4 Migration Path

| # | Step | Property |
|---|---|---|
| 1 | Client completes the OAuth grant | ~5 min of client time |
| 2 | Store the refresh token as `GBP_REFRESH_TOKEN__<SLUG_UPPER>` | Independently revocable |
| 3 | Change `listings[].adapter` in the client config | **Config-only change** |
| 4 | Dry-run harvest; compare the observed set to the current Ledger | Verification |
| 5 | Verify identity reconciliation: **zero spurious inserts** | PT-08 in practice |
| 6 | Full harvest and publish | Coverage improves |
| **Total** | | **≤ 1 hour** |

---

# 77. Future Facebook Adapter

| Aspect | Assessment |
|---|---|
| **Version** | v2.0 |
| **Access method** | **Official API only.** Page access token via the client's Business Manager |
| **Client friction** | Medium — token grant through Business Manager |
| **Data quality** | ★★★★☆ — recommendations and replies |
| **Demand** | Medium-high |
| **Effort** | Adapter 3 d + fixtures 1 d + mapping 1 d = **5 d** |
| **Seam it uses** | `AcquisitionAdapter` port; `source` enum extension |

| ID | Requirement |
|---|---|
| TR-FUT-010 | A Facebook DOM adapter MUST NOT be built. Facebook has a sanctioned API path, so the v1.0 DOM justification does not apply. |

**Implementation notes for whoever builds it.** Facebook models "recommendations" rather than star ratings on Pages, so the mapping to the 1–5 integer rating must be explicit and documented, not inferred. A binary recommend/not-recommend mapped to 5/1 is a defensible choice **only if it is declared in the capability descriptor and visible in `provenance.adapter_capabilities`** — a consumer must be able to tell that these ratings are derived rather than native.

---

# 78. Future JustDial Adapter

## 78.1 Recommendation: Do Not Build a DOM Adapter

| Consideration | Assessment |
|---|---|
| API availability | No public reviews API known to be available for general use. **Assumption — must be re-verified before any work** |
| Consequence of building | Would require a DOM adapter, re-arguing the legal analysis for a different platform with different terms |
| Data value | Moderate — a supplementary rather than primary reputation signal for most businesses |
| Demand | Medium in the Indian market, which is the first client's market |
| **Recommendation** | **Support it via `file:csv`, not via a scraper** |

## 78.2 The CSV Path

| Aspect | Detail |
|---|---|
| Mechanism | The client or TradyPerch exports or transcribes reviews periodically into the documented CSV column contract |
| Effort | **2 d** — the CSV workflow is being built for v2.0 anyway |
| Legal position | Clean. No ToS question |
| Freshness | Manual cadence, appropriate for a source with low review velocity |
| Quality | Operator-dependent, and honestly labelled as `source: csv` in the payload |

**This is the pattern for every source without an API:** offer CSV import rather than a scraper. It is honest, cheap, legally clean, and adequate for sources where review velocity is low.

| ID | Requirement |
|---|---|
| TR-FUT-020 | A JustDial DOM adapter MUST NOT be built without a dedicated ADR re-arguing the legal analysis for that platform specifically. |

---

# 79. Future Trustpilot Adapter

| Aspect | Assessment |
|---|---|
| **Version** | v2.0 |
| **Access method** | Official API where the client has a paid plan; **documented CSV fallback otherwise** |
| **Client friction** | Low — the client provides API credentials |
| **Data quality** | ★★★★★ |
| **Demand** | Medium |
| **Effort** | Adapter 2 d + fixtures 1 d + mapping 1 d = **4 d** |

**The dual path is the interesting part of this adapter.** A client on a Trustpilot paid plan gets full API access; a client without one gets CSV import. Both produce reviews carrying `source: trustpilot`, and both reconcile into the same Ledger with the same identity derivation. **This is the adapter matrix doing exactly what it was designed for** — the access method varies per client while everything above the adapter layer is unchanged.

---

# 80. Future AI Analysis Module

## 80.1 Scope and Constraints

| Aspect | Rule |
|---|---|
| **Version** | v2.0 |
| **Status** | **Opt-in per client**, off by default |
| **Placement** | Stage 7 (Enrich) — already exists in v1.0 as a no-op |
| **Output target** | The reserved `ai` block in the payload, declared nullable at v1 so consumers are already forward-compatible |
| **Cost model** | Cached by content hash; only new or edited reviews are ever processed |

## 80.2 Reserved Field Block

Declared at v1 as nullable so a consumer written today does not break when it is populated.

| Field | Type | Description |
|---|---|---|
| `summary` | string \| null | One-sentence abstractive summary |
| `sentiment` | enum \| null | `positive` / `neutral` / `negative` / `mixed` |
| `sentiment_score` | number −1…1 \| null | |
| `topics` | string[] \| null | Extracted themes |
| `keywords` | string[] \| null | |
| `spam_score` | number 0–1 \| null | Higher means more likely inauthentic |
| `language_detected` | string \| null | Model-asserted, distinct from the heuristic `language` field |
| `model` | string \| null | Model identifier used |
| `generated_at` | string \| null | |
| `content_hash_at_generation` | string \| null | **Enables cache invalidation and prevents stale AI text against edited reviews** |

## 80.3 Normative Guardrails

| ID | Requirement |
|---|---|
| TR-FUT-030 | AI fields MUST NEVER overwrite or influence source-of-truth fields — `rating`, `text`, `author`, or dates. Enrichment is **additive only**. |
| TR-FUT-031 | AI output MUST always be identifiable as machine-generated. |
| TR-FUT-032 | Enrichment MUST be cached by `content_hash`. Re-processing unchanged reviews on every harvest is the difference between a trivial cost and an unbounded one. |
| TR-FUT-033 | `content_hash_at_generation` MUST be stored, and enrichment MUST be invalidated when it no longer matches. Showing an AI summary of text the reviewer has since rewritten is a correctness failure. |
| TR-FUT-034 | Enrichment failure MUST be non-fatal. The stage is optional; a failed enrichment leaves `ai: null` and the harvest continues. |
| TR-FUT-035 | AI MUST NOT be used to generate, embellish, or translate review text presented as the reviewer's own words. |

## 80.4 Why the Seam Already Exists in v1.0

`app/enrich/index.mjs` and `app/enrich/noop.mjs` ship in v1.0 doing nothing, deterministically. That costs perhaps thirty lines and means adding enrichment in v2.0 requires **no change to the orchestrator, the pipeline stage list, the payload schema, or any consumer.**

**This is the pattern the whole of Part 15 follows:** build the seam now, build the feature when the trigger fires.

---

# 81. Future Dashboard Requirements

| Aspect | Detail |
|---|---|
| **Trigger** | More than ~200 health files, i.e. roughly 200 client-listings. Reading them by hand stops being viable |
| **Version** | v3.0 |
| **Effort** | ~5 d |
| **Replaces** | File-based monitoring, which is adequate below the trigger and impractical above it |

## 81.1 Information Architecture

| Screen | Purpose | Priority |
|---|---|---|
| **Fleet overview** | Every client's freshness, coverage, and last outcome in one view | **The only screen that matters during an incident** |
| Client detail | Last 30 harvests, yield trend, gate verdicts, selector health | High |
| Run detail | Per-target outcomes, timings, decisions for one run | Medium |
| Drift monitor | Selector strategy health and canary assertion history across packs | High |
| Alert history | Open and resolved conditions with time-to-resolution | Medium |

## 81.2 Technical Approach

| Decision | Choice | Reason |
|---|---|---|
| Generation | **Static site generated from the health series** by a scheduled job | Zero runtime cost, no server, consistent with the architecture |
| Hosting | The same static origin, under an authenticated path | No new infrastructure |
| Data source | `state:/health/*.jsonl` | Already exists; no new collection |
| Refresh | Per run, or on a schedule | — |

| ID | Requirement |
|---|---|
| TR-FUT-040 | The dashboard MUST be generated, not live-queried. A live dashboard implies a server and a datastore, which is the v3.0 platform decision and should not be smuggled in via a monitoring feature. |

---

# 82. Future Admin Panel

| Aspect | Detail |
|---|---|
| **Trigger** | Manual onboarding exceeding 30 minutes, or more than 4 onboardings per week |
| **Version** | v3.0 |
| **Effort** | ~12 d |

## 82.1 The Central Design Constraint

**The admin panel MUST write configuration by opening a pull request, not by mutating a database.**

| Property | Why It Must Be Preserved |
|---|---|
| Every config change is reviewable | The authorisation gate (V-3) depends on review |
| Every config change is revertible | Rollback is `git revert` |
| Every config change is audited | `git log` is the audit trail |
| The engine's config source does not change | No second configuration path to keep consistent |

| ID | Requirement |
|---|---|
| TR-FUT-050 | The admin panel MUST produce pull requests against `clients/`, `profiles/`, and `compliance/`. It MUST NOT introduce a parallel configuration store. A second source of configuration truth would divide the audit trail and eventually diverge. |

## 82.2 Capability Set

| Capability | Notes |
|---|---|
| Onboarding wizard | Resolve identity, scaffold config, capture authorisation, run a dry-run, open the PR |
| Client enable/disable | A one-field PR |
| Cadence and tier changes | A one-field PR |
| Adapter migration | Guides the OAuth grant, then a one-field PR |
| Manual harvest dispatch | Workflow dispatch, no config change |
| Suppression request handling | A PR against `compliance/denylist.json` |
| Health and alert viewing | Read-only, from the dashboard data |

---

# 83. Future Client Portal

| Aspect | Detail |
|---|---|
| **Trigger** | Client demand for visibility into their own review data |
| **Version** | v3.0 |
| **Effort** | ~12 d |

## 83.1 Trust Boundary

| Rule | Reason |
|---|---|
| A client sees **only their own** data | Multi-tenant isolation extends to the portal |
| The portal is **read-mostly** | Write operations are limited to refresh requests and suppression requests |
| A refresh request is **queued and rate-limited**, never immediate | Otherwise the portal becomes a way for a client to breach the source rate budget |
| Suppression requests go through **review**, not straight to the denylist | A suppression is permanent and must not be self-service |

| ID | Requirement |
|---|---|
| TR-FUT-060 | A client-initiated refresh MUST be subject to the same cadence floor and source budget as a scheduled harvest. A portal button that bypasses rate limiting is a rate-limiting bypass regardless of who presses it. |

## 83.2 Failure-State Copy

**Normative, because this is where client trust is won or lost.** The portal must state plainly when updates are paused, why, and what is being done — rather than showing a spinner or a stale-but-confident timestamp.

| State | Copy Principle |
|---|---|
| Healthy | Show last update time plainly |
| Stale < 24 h | No special messaging — this is normal |
| Stale 24–72 h | "Updates are temporarily paused while we resolve an issue with the review platform. Your website continues to show your reviews." |
| Stale > 72 h | Same, plus a named contact and an expected resolution |
| Adapter migration available | "You can enable faster, more complete updates in about five minutes." |

---

# 84. Future REST API

| Aspect | Detail |
|---|---|
| **Trigger** | At least **two** of the §70.3 conditions live |
| **Version** | v3.0 |
| **Effort** | ~10 d, plus ongoing operational cost |
| **Style** | **REST + JSON** |

## 84.1 Why REST

| Option | Verdict | Reason |
|---|---|---|
| **REST + JSON** | **Chosen** | Cacheable at the edge; trivially consumable; ETag and conditional requests; matches the existing payload shape |
| GraphQL | Rejected | §85 |
| gRPC | Rejected | Not browser-native without a proxy; violates the zero-dependency consumer principle |
| tRPC or similar | Rejected | Couples consumers to a TypeScript server; excludes non-JS clients |

**The dominant access pattern is "give me this client's reviews, optionally filtered."** That is a cacheable GET.

## 84.2 Endpoint Sketch

| Method | Path | Auth |
|---|---|---|
| `GET` | `/clients/{slug}/listings` | Read key |
| `GET` | `/clients/{slug}/listings/{key}/reviews` | Read key |
| `GET` | `/clients/{slug}/listings/{key}/stats` | Read key |
| `GET` | `/clients/{slug}/reviews` | Read key |
| `GET` | `/clients/{slug}/health` | Client key |
| `POST` | `/clients/{slug}/refresh` | Client key, rate-limited, queued |
| `POST` | `/clients/{slug}/reviews/manual` | Admin key |
| `PATCH` | `/clients/{slug}/reviews/{id}/suppress` | Admin key |
| `GET` | `/openapi.json` | Public |

**Query parameters** on the reviews collection: `limit`, `cursor` (**cursor pagination, never offset** — offsets are unstable when the underlying set changes), `min_rating`, `max_rating`, `language`, `has_text`, `has_reply`, `since`, `until`, `sort`, `fields`.

## 84.3 Contract Rules

| Aspect | Rule |
|---|---|
| Versioning | Major version in the path; additive-only within a major |
| Response envelope | `{ data, meta, links }` |
| Errors | Problem-details style plus a machine-readable `code` from the §38 taxonomy where applicable |
| Caching | `ETag` on every response; `304` on `If-None-Match` |
| Rate limits | Returned as headers on **every** response, not only on `429`, so consumers can self-pace |
| Idempotency | `Idempotency-Key` required on all `POST` |
| Time | RFC 3339 UTC everywhere |
| Nulls | Present-and-null rather than absent |

## 84.4 The Honest Cost

| Requirement | Implication |
|---|---|
| Availability target 99.9% | Needs monitoring, alerting, and someone on call |
| **Cost** | **Non-zero and recurring.** Compute, database, egress. **This breaks the zero-cost constraint and must be a deliberate, priced decision** |
| Security surface | **The first inbound attack surface in the system's history** |
| Compliance | Access logging, retention, and data-subject support over a live datastore |
| Support | An API has consumers who file issues |

**Do not build the API to be modern. Build it when at least two triggers are live, and price it into the client relationship first.**

---

# 85. Future GraphQL API

## 85.1 Recommendation: Do Not Build

| Consideration | Assessment |
|---|---|
| Advantage | One round trip for compound queries; a typed schema |
| **Disadvantage** | **Poor HTTP cacheability** — which is the property that makes the current architecture fast and free |
| Server complexity | Materially higher than REST for a read-mostly resource |
| Fit | Overkill for a resource with ~24 fields and one dominant access pattern |
| **Verdict** | **Rejected.** Revisit only if a consumer emerges with genuinely graph-shaped needs across clients, listings, and time |

**GraphQL's advantage is arbitrary compound queries — a solution to a problem this data shape does not have.** Its cost is edge cacheability, which is exactly what the architecture depends on. Trading the thing that works for a capability nobody has asked for is the wrong direction.

| ID | Requirement |
|---|---|
| TR-FUT-070 | If GraphQL is ever built, it MUST sit alongside REST rather than replacing it, and the static payload path MUST remain untouched. |

---

# 86. Future Webhook Support

| Aspect | Detail |
|---|---|
| **Trigger** | Client integration demand for push notification of new reviews |
| **Version** | v3.0 |
| **Effort** | ~4 d |

## 86.1 Design Sketch

| Aspect | Rule |
|---|---|
| Events | `review.created`, `review.updated`, `review.removed`, `harvest.completed`, `harvest.failed` |
| Delivery | At-least-once, with retry and exponential backoff |
| Ordering | **Not guaranteed.** Consumers must be idempotent |
| Payload | The event plus the affected review's public projection — **never internal state** |
| Signing | HMAC signature over the body, with a per-client secret |
| Replay protection | Timestamp in the signed payload; consumers reject stale deliveries |
| Failure | After N failed deliveries, the endpoint is disabled and an alert raised |

| ID | Requirement |
|---|---|
| TR-FUT-080 | Webhook payloads MUST contain only fields present in the public payload schema. A webhook is a second public contract and must not become a back door for internal state. |
| TR-FUT-081 | Webhook delivery MUST NOT block or delay a harvest. It is dispatched after publication, and its failure is not a harvest failure. |

---

# 87. Future Database Support

| Aspect | Detail |
|---|---|
| **Trigger** | Repository growth beyond manageable limits, cross-client query needs, or the API's latency requirements |
| **Version** | v3.0 |
| **Effort** | ~6 d |
| **Seam** | **`StatePort` already exists** — this is why |

## 87.1 Where Git-as-Database Gives Way

| Requirement | Why Git Cannot Serve It |
|---|---|
| Filtering and sorting by arbitrary fields | Requires reading and scanning every file per request |
| Cross-client aggregation | Requires reading every client's file per request |
| Sub-100 ms p95 response | Filesystem scans plus JSON parsing per request will not hold |
| Concurrent reads at request volume | Not what a Git checkout is for |

## 87.2 Design

**The Ledger remains the write-side source of truth on the `state` branch.** A sync worker projects it into a read-optimised store. The API reads only from that store.

| ID | Requirement |
|---|---|
| TR-FUT-090 | The database MUST be a **read model**, not the source of truth. A total loss of the read store MUST be repairable by replaying from the Ledger. |
| TR-FUT-091 | The engine MUST continue to write the Ledger to `state` even after the database exists, so the recovery property in TR-FUT-090 remains true. |

**Keeping Git as the write side preserves every property in §33.1** — versioning, audit log, code review on data changes, free point-in-time recovery — while adding query capability where it is actually needed. **A migration that moved the write side into the database would give all of that up in exchange for query performance the write path does not need.**

---

# 88. Future Redis Support

## 88.1 Recommendation: Almost Certainly Not Needed

| Candidate Use | Assessment |
|---|---|
| Caching payloads | The CDN already does this, better and free |
| Caching resolved identities | Already persisted to `state`; a 30-day TTL on a file is sufficient |
| Rate limit coordination | **The one genuine use** — but only at the scale where a central token service is warranted |
| Job queue | There is no queue; work is a cron-triggered batch |
| Session storage | There are no sessions |

## 88.2 The One Genuine Use

At the scale where DOM acquisition is no longer viable anyway (≈500 clients), advisory file-based rate accounting becomes too imprecise. **A central token service — Redis or equivalent — would provide exact per-source accounting.**

| ID | Requirement |
|---|---|
| TR-FUT-100 | Redis MUST NOT be introduced for caching. Every caching need in this system is already served by the CDN, the `state` branch, or the CI cache — all of them free. |
| TR-FUT-101 | If introduced for rate coordination, it MUST fail closed. An unreachable coordination service MUST defer targets, never permit unbounded requests. |

**Introducing Redis for caching would be adding a stateful service with an availability requirement to a system whose entire value proposition includes not having one.**

---

# 89. Future Docker Support

| Aspect | Detail |
|---|---|
| **Trigger** | Migration off the CI platform to a dedicated host, or a client requiring on-premises deployment |
| **Version** | v3.0 |
| **Effort** | ~1 d |

## 89.1 Why It Is Not Needed in v1.0

The CI runner already provides a clean, reproducible environment per run. A container would add a build step, an image registry, and a second dependency-pinning mechanism — **to solve a reproducibility problem the lockfile and the browser pin already solve.**

## 89.2 What a Container Would Need

| Element | Detail |
|---|---|
| Base | A Node LTS image matching `.nvmrc` |
| Browser | Playwright's own image variant, or an explicit browser install layer |
| Size | ~1.2 GB — dominated by the browser |
| Volumes | `main`, `data`, `state` checkouts mounted or cloned at start |
| Secrets | Environment variables only, exactly as today |
| Entrypoint | `tpre` with arguments passed through |

| ID | Requirement |
|---|---|
| TR-FUT-110 | A container image MUST NOT become a second dependency-pinning mechanism. The lockfile and the browser pin remain authoritative; the image reproduces them rather than overriding them. |
| TR-FUT-111 | The engine MUST remain runnable **without** a container. The local development story and the disaster-recovery path both depend on running the CLI directly. |

---

# 90. Future Kubernetes Support

## 90.1 Recommendation: Do Not Build Before v4.0

| Consideration | Assessment |
|---|---|
| What the workload is | A scheduled batch job that runs for minutes and exits |
| What Kubernetes provides | Orchestration of long-running services, rolling deploys, service discovery, autoscaling |
| Overlap | **Cron scheduling, and essentially nothing else** |
| Cost | A cluster to operate, secure, upgrade, and pay for — against a constraint of one part-time maintainer and zero recurring cost |

**The honest assessment: Kubernetes solves problems this system does not have.** A `CronJob` resource is the only useful primitive, and a plain cron entry on a small host provides the same thing for a fraction of the operational cost.

## 90.2 When It Would Become Reasonable

| Condition | Version |
|---|---|
| Thousands of clients requiring genuine horizontal scale | v4.0 |
| An existing cluster already operated for other reasons | Any time — the marginal cost is then near zero |
| A client requiring deployment into their own cluster | On demand |

| ID | Requirement |
|---|---|
| TR-FUT-120 | Kubernetes MUST NOT be adopted before a container image exists and has been operated in production, and MUST NOT be adopted solely for scheduling. |

---

# 91. Future Multi-region Deployment

## 91.1 What Is Already Multi-region

**The part that matters is already global.** Payloads are served from a CDN edge, so visitors anywhere are served from a nearby point of presence. That is the only latency-sensitive path in the system.

| Component | Regional Status |
|---|---|
| Payload delivery | ✅ Already global via CDN |
| Harvest compute | Single region — **and this is fine** |
| Git storage | Provider-managed replication |
| Alerting | Provider-managed |

## 91.2 Why Multi-region Compute Is Not Valuable

| Motivation | Assessment |
|---|---|
| Latency | Irrelevant — harvests are batch jobs with an hours-scale SLO |
| Availability | A regional CI outage causes staleness, not visitor impact. LKG covers it |
| **Geo-varied source content** | **The one genuine motivation** — a source may render different content by region |
| Data residency | Would matter if personal data were stored per region; currently it is public review content in one public repository |

## 91.3 The Geo-Variation Case

If a client's listing renders materially differently by region, the correct answer is **not** multi-region compute. It is:

| Option | Preference |
|---|---|
| Set the context locale and timezone correctly per client | **First choice — already implemented in v1.0** |
| Migrate the client to an official API, which is region-neutral | **Second choice** |
| Run compute in a matching region | Last resort, and only if the first two fail |

| ID | Requirement |
|---|---|
| TR-FUT-130 | Regional variation MUST first be addressed through context locale configuration, then through adapter migration. Multi-region compute is a last resort. |
| TR-FUT-131 | Multi-region compute MUST NOT be used as a means of obtaining different egress identities. That is evasion, and it is prohibited regardless of the technical framing. |

**TR-FUT-131 exists because "multi-region deployment" is an entirely legitimate-sounding way to describe egress rotation.** The prohibition is on the behaviour, not on the vocabulary used to propose it.

---

## 91.4 Future Work Summary

| § | Item | Version | Effort | Seam in v1.0 |
|---|---|---|---|---|
| 76 | Business Profile API adapter | **v1.0 — ships** | — | `AcquisitionAdapter` |
| 76.3 | Reply management | v4.0 | ~5 d | OAuth write scope |
| 77 | Facebook adapter | v2.0 | 5 d | `AcquisitionAdapter` |
| 78 | JustDial via CSV | v2.0 | 2 d | `file:csv` adapter |
| 79 | Trustpilot adapter | v2.0 | 4 d | `AcquisitionAdapter` |
| 80 | AI enrichment | v2.0 | 6 d | Stage 7 no-op; reserved `ai` block |
| 81 | Dashboard | v3.0 | 5 d | Health series |
| 82 | Admin panel | v3.0 | 12 d | Config-as-files + PR flow |
| 83 | Client portal | v3.0 | 12 d | Health series + API |
| 84 | REST API | v3.0 | 10 d | Ledger as source of truth |
| 85 | GraphQL | **declined** | — | — |
| 86 | Webhooks | v3.0 | 4 d | Publication event |
| 87 | Database | v3.0 | 6 d | **`StatePort`** |
| 88 | Redis | **declined** except rate coordination | — | — |
| 89 | Docker | v3.0 | 1 d | Portable CLI |
| 90 | Kubernetes | v4.0 at earliest | — | Container image |
| 91 | Multi-region | **not planned** | — | CDN already global |

**Four of seventeen items are declined outright, and one already ships.** That is the intended shape of a roadmap: most future work should be work that has been *decided against* with a reason, so nobody re-proposes it every quarter.

---

*End of Part 15. Part 16 covers implementation risks, the consolidated engineering decision register, technical trade-offs, known limitations, and future improvements.*
