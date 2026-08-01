# Appendices

*Reference material consolidated from across the document. Nothing here is new specification — it is the same content reorganised for lookup rather than for reading.*

---

# Appendix A — Implementation Build Order

**For the engineer or AI agent implementing v1.0.** Built in this order, every phase is verifiable before the next begins, and nothing is blocked waiting on something later.

| Phase | Build | Verify By | Spec |
|---|---|---|---|
| **0** | Repo skeleton, `package.json`, lint/format/type config, test runner, CI `ci.yml` with a trivial passing test | CI green on a no-op PR | §18.1–§18.3 |
| **1** | `core/model/` types, `core/util/result.mjs`, `core/util/hash.mjs`, error taxonomy constants | Unit tests on hashing determinism | §17.11, §23.2 |
| **2** | `core/normalize/` — the security boundary. Build this before anything that produces data. | Adversarial string tests; PT-10, PT-11 | §20.6 |
| **3** | `core/dates/`, `core/lang/`, `core/identity/` | Locale matrix tests; PT-05, PT-06, PT-09 | §20.5.4, §21.4.3 |
| **4** | `core/validate/` | Per-finding tests; boundary tests | §20.6.7 |
| **5** | **`core/reconcile/`** — the hardest and most consequential module | PT-01…PT-07 property tests; the asymmetry test | §20.7 |
| **6** | `core/project/` and `core/gate/` | 100% gate coverage; PT-12…PT-14 | §20.8.1, §27.3 |
| **7** | `ports/` interfaces + `infra/` (logger, clock, random, retry, fs-atomic) | Redaction sentinel test | §17.16, §24 |
| **8** | `adapters/state/git-state.mjs`, `adapters/publisher/filesystem.mjs` | State round-trip integration test | §20.11 |
| **9** | `app/config/` loader with the six-layer chain | Precedence matrix tests; ceiling rejection | §39 |
| **10** | `cli/` skeleton + `validate-config`, `project`, `doctor` commands | Commands run against fixtures | §17.2, §42.3 |
| **11** | **`file:csv` adapter first** — proves the adapter interface with the simplest implementation | Contract test suite passes | §48, FR-027 |
| **12** | `selectors/` schema + loader + strategy resolver | Pack validation tests | §20.4 |
| **13** | `core/extract/` against saved fixtures (no browser yet) | Golden fixture suite, 3–4 fixtures | §20.5, §41.3 |
| **14** | `adapters/browser/playwright-chromium.mjs` + Browser Session Manager | Context isolation test; launch/close in `finally` | §17.8 |
| **15** | `fixtures/server/serve.mjs` + Navigator | Pagination and stall integration tests | §20.3 |
| **16** | `google-dom` adapter: resolver, consent, challenge detection, serialisation | Contract suite; fixtures 014–017 | §20.2, §29.3 |
| **17** | Orchestrator + target runner + preflight | Full offline pipeline run | §17.3, §17.5 |
| **18** | `adapters/publisher/git-data.mjs` + hash gating + rebase-retry | Publish integration test against a temp repo | §20.8.4 |
| **19** | `harvest.yml` + `setup-engine` composite action | Manual dispatch produces a payload | §22.2 |
| **20** | Diagnostics, health recorder, `notifier/github-issues` | Alert lifecycle integration test | §24.6, §25.6 |
| **21** | Chaos suite CH-01…CH-14 | All 14 pass | §41.5 |
| **22** | `google:places-api` and `google:business-profile-api` adapters | Contract suite ×4; PT-08 cross-adapter identity | §15.7, ADR-023 |
| **23** | `frontend/renderer/` + 5 integration recipes | Size budget; accessibility check | §34.6, FR-071 |
| **24** | `canary.yml`, `keepalive.yml`, `pages.yml`, `validate-config.yml`, `release.yml` | Each triggers and passes | §22.1 |
| **25** | Onboard Commerce Insight; begin the 30-day soak | S1–S8 tracked | §1.6 |

**Two ordering rules worth stating explicitly.** Phase 2 (the Normalizer) comes before anything that produces data, because it is the security boundary and retrofitting it is how INV-05 gets violated. Phase 11 (the CSV adapter) comes before any browser work, because implementing the simplest adapter first proves the interface is genuinely source-agnostic while it is still cheap to change.

---

# Appendix B — Complete Error Taxonomy Reference

Consolidated from §23.2. `R` = retry policy (`n` never, `b` backoff, `i` immediate); `S` = scope; `Sev` = alert severity.

| Class | R | S | Sev |
|---|---|---|---|
| `ERR-POLICY-KILLSWITCH` | n | target | info |
| `ERR-POLICY-UNAUTHORIZED` | n | target | error |
| `ERR-POLICY-ROBOTS` | n | target | warn |
| `ERR-POLICY-BUDGET` | n | target | info |
| `ERR-POLICY-BREAKER-OPEN` | n | source | warn |
| `ERR-CONFIG-INVALID` | n | target | error |
| `ERR-CONFIG-VERSION` | n | run | error |
| `ERR-CONFIG-SECRET-MISSING` | n | run | error |
| `ERR-RESOLVE-NO-IDENTIFIER` | n | target | error |
| `ERR-RESOLVE-NOTFOUND` | n | target | error |
| `ERR-RESOLVE-AMBIGUOUS` | n | target | error |
| `ERR-IDENTITY-DRIFT` | n | target | high |
| `ERR-NET-DNS` | b×3 | target | warn |
| `ERR-NET-TIMEOUT` | b×3 | target | warn |
| `ERR-NET-RESET` | b×3 | target | warn |
| `ERR-NET-TLS` | b×2 | target | warn |
| `ERR-HTTP-429` | b×2 (60 s base) | source | high |
| `ERR-HTTP-5XX` | b×3 | target | warn |
| `ERR-HTTP-4XX` | n | target | error |
| `ERR-HTTP-403` | n | source | high |
| `ERR-BROWSER-LAUNCH` | i×1 | run | error |
| `ERR-BROWSER-CRASH` | b×1 | target | warn |
| `ERR-BROWSER-OOM` | n | target | error |
| `ERR-NAV-TIMEOUT` | b×2 | target | warn |
| `ERR-NAV-SURFACE-NOT-FOUND` | n | target | high |
| `ERR-NAV-CONSENT-WALL` | n | source | high |
| `ERR-BUDGET-TARGET` | n | target | warn |
| **`ERR-BLOCKED-CHALLENGE`** | **never** | source + breaker | **critical** |
| **`ERR-BLOCKED-UNUSUAL-TRAFFIC`** | **never** | source + breaker | **critical** |
| `ERR-BLOCKED-GEO` | n | source | warn |
| `ERR-PARSE-STRUCTURE` | n | target | high |
| `ERR-PARSE-EMPTY-UNEXPECTED` | n | target | high |
| `ERR-PARSE-FIELD-REQUIRED` | n | record | warn |
| `ERR-PARSE-RATING-INVALID` | n | record | warn |
| `ERR-PARSE-SELECTOR-PACK` | n | run | error |
| **`ERR-CLEAN-MARKUP-SURVIVED`** | n | record | **critical** |
| `ERR-VALIDATE-QUARANTINE-RATE` | n | target | error |
| `ERR-VALIDATE-AGGREGATE` | n | target | error |
| `ERR-STATE-CORRUPT` | n | target | high |
| `ERR-STATE-WRITE` | b×2 | target | error |
| `ERR-GATE-REJECT-COUNT-DROP` | n | target | error |
| `ERR-GATE-REJECT-RATING-SHIFT` | n | target | error |
| **`ERR-GATE-REJECT-EMPTY`** | n | target | **critical** |
| `ERR-GATE-REJECT-COVERAGE` | n | target | warn |
| **`ERR-GATE-REJECT-SCHEMA`** | n | target | **critical** |
| `ERR-PUBLISH-CONFLICT` | b×3 | shard | warn |
| **`ERR-PUBLISH-AUTH`** | n | run | **critical** |
| **`ERR-INTERNAL-INVARIANT`** | n | run | **critical** |
| **`ERR-INTERNAL-UNCLASSIFIED`** | n | target | **critical** |

**Six critical classes only.** Bot challenge (×2), empty-payload rejection, schema rejection, markup-survived, publish-auth, and the two internal classes. Everything else is `high` or below. See §25.4 on why the critical set is deliberately narrow.

---

# Appendix C — Complete Configuration Key Reference

Consolidated from §20, §39, §40. Every key that affects behaviour, with its default and the section that specifies it.

## C.1 Resolution

| Key | Default | §|
|---|---|---|
| `resolution.allow_search` | `false` (prod) | 20.2.5 |
| `resolution.identity_threshold` | `0.82` | 20.2.5 |
| `resolution.cache_ttl_days` | `30` | 20.2.5 |
| `resolution.expected_name` | *required* | 20.2.5 |
| `resolution.advertised_drop_tolerance` | `0.40` | 20.2.5 |

## C.2 Navigation

| Key | Default | Ceiling | §|
|---|---|---|---|
| `nav.navigation_timeout_ms` | `30000` | — | 20.3.6 |
| `nav.surface_timeout_ms` | `15000` | — | 20.3.6 |
| `nav.scroll_increment_ratio` | `0.9` | — | 20.3.6 |
| `nav.scroll_settle_ms` | `900` | — | 20.3.6 |
| `nav.stall_threshold` | `3` | — | 20.3.6 |
| `nav.pagination_budget_ms` | `120000` | — | 20.3.6 |
| `nav.max_reviews` | `1000` | `5000` | 20.3.6 |
| `nav.expand_max_count` | `200` | — | 20.3.5 |
| `nav.sort_order` | `newest` | — | 20.3.6 |
| `nav.locale` | client locale | — | 20.3.6 |

## C.3 Normalisation and Validation

| Key | Default | §|
|---|---|---|
| `normalize.max_text_length` | `5000` graphemes | 20.6.2 |
| `validate.coverage_min` | `0.95` | 20.6.7 |
| `validate.quarantine_max` | `0.05` | 20.6.7 |
| `validate.rating_tolerance` | `0.30` | 20.6.7 |
| `validate.near_duplicate_threshold` | `0.92` | 20.6.7 |

## C.4 Reconciliation

| Key | Default | Range | §|
|---|---|---|---|
| `reconcile.removal_confirmations` | `3` | 2–10 | 20.7.7 |
| `reconcile.coverage_min` | `0.95` | 0.5–1.0 | 20.7.7 |
| `reconcile.keep_tombstones` | `true` | — | 20.7.7 |

## C.5 Publish Gate

| Key | Default | §|
|---|---|---|
| `gate.max_count_drop_ratio` | `0.20` | 27.3.1 |
| `gate.max_rating_shift` | `0.50` | 27.3.1 |
| `gate.coverage_min` | `0.95` | 27.3.1 |
| `gate.quarantine_max` | `0.05` | 27.3.1 |
| `gate.max_payload_bytes` | `2000000` | 27.3.1 |

## C.6 Display and Publication

| Key | Default | §|
|---|---|---|
| `display.order` | `newest` | 20.8.1 |
| `display.latest_count` | `20` | 20.8.1 |
| `display.min_text_length` | `0` | 20.8.1 |
| `display.languages` | `null` (all) | 20.8.1 |
| `display.include_rating_only` | `true` | 20.8.1 |
| `display.min_rating` | **`null`** | 8.2, 39.5 |
| `publish.reviews` / `latest` / `stats` | `true` | 21.7 |
| `publish.schema_org` | **`false`** | 21.9 |
| `publish.payload_shard_threshold` | `1000000` | 33.4 |

## C.7 Rate Limiting and Budgets

| Key | Default | Hard Ceiling | §|
|---|---|---|---|
| `budget_target_ms` | `300000` | `300000` | 22.5 |
| `budget_run_ms` | `900000` | `900000` | 22.5 |
| `inter_target_delay_ms` | `10000` | floor `5000` | 28.3 |
| `min_request_delay_ms` | `500` | floor `250` | 28.3 |
| `source_hourly_budget` | `200` | `600` | 28.3 |
| `source_daily_budget` | `2000` | `6000` | 28.3 |
| `max_parallel` (shards) | `4` | `8` | 37.3 |
| `cadence_floor_hours` | `6` | floor `1` | 28.3 |

## C.8 Environment Variables (Complete List)

| Variable | §|
|---|---|
| `TPRE_ENV`, `TPRE_LOG_LEVEL`, `TPRE_LOG_FORMAT`, `TPRE_RUN_ID` | 40.2 |
| `TPRE_DRY_RUN`, `TPRE_NO_PUBLISH`, `TPRE_FORCE`, `TPRE_FORCE_PUBLISH`, `TPRE_FORCE_REASON` | 40.2 |
| `TPRE_SHARD`, `TPRE_TIER`, `TPRE_CLIENT`, `TPRE_LISTING` | 40.2 |
| `TPRE_CLIENTS_DIR`, `TPRE_PROFILES_DIR`, `TPRE_SELECTORS_DIR`, `TPRE_STATE_DIR`, `TPRE_PUBLISH_DIR`, `TPRE_ARTIFACT_DIR`, `TPRE_FIXTURE_DIR` | 40.3 |
| `TPRE_BUDGET_TARGET_MS`, `TPRE_BUDGET_RUN_MS`, `TPRE_MAX_REVIEWS`, `TPRE_INTER_TARGET_DELAY_MS`, `TPRE_MIN_REQUEST_DELAY_MS`, `TPRE_SOURCE_HOURLY_BUDGET`, `TPRE_SOURCE_DAILY_BUDGET`, `TPRE_SELECTOR_PACK`, `TPRE_DIAGNOSTICS_SCREENSHOT` | 40.4 |
| `TPRE_POLICY_ENABLED`, `TPRE_POLICY_DOM_ENABLED`, `TPRE_POLICY_ROBOTS_MODE`, `TPRE_POLICY_BREAKER_OVERRIDE`, `TPRE_MAINTENANCE_MODE` | 40.5 |
| `GITHUB_TOKEN`, `GOOGLE_PLACES_API_KEY`, `GBP_OAUTH_CLIENT_ID`, `GBP_OAUTH_CLIENT_SECRET`, `GBP_REFRESH_TOKEN__<SLUG>`, `ALERT_WEBHOOK_URL` | 40.6 |

---

# Appendix D — Traceability Matrix

Mapping the ten invariants to the requirements, tests, and sections that enforce them. **This is the audit trail: if an invariant has no test, it is not enforced.**

| Invariant | Requirements | Tests | Sections |
|---|---|---|---|
| **INV-01** website never contacts a source | FR-069, ADR-001 | Integration: network assertion on consumer recipes | 16.2, 34.6 |
| **INV-02** failure never degrades the payload | FR-062, FR-063 | CH-01, CH-04, CH-05, CH-06; gate suite | 27.3, 27.4 |
| **INV-03** absence ≠ deletion | FR-055, FR-053 | **PT-07**, CH-04 | 20.3.4, 20.7.3 |
| **INV-04** reconcile idempotent | FR-051, FR-052 | **PT-01**, CH-12 | 20.7.5 |
| **INV-05** output safe as text | FR-038, FR-060, FR-072 | **PT-10**, CH-14, `security.xss-fixture` | 20.6.2, 35.4 |
| **INV-06** full provenance | FR-066, FR-077 | Schema validation; manifest test | 21.6, 24.5 |
| **INV-07** challenge is terminal | FR-088 | CH-03, `retry-policy.blocked-never` | 29.3–29.5 |
| **INV-08** no secret in any artifact | NFR-026, FR-076 | `security.redaction`; push-time scan | 24.4, 35.5 |
| **INV-09** client isolation | NFR-014, FR-030 | `security.isolation`; `fail-fast: false` | 22.2.2, 38.3 |
| **INV-10** adapter switch by config only | FR-019, ADR-023 | PT-08; S7 migration drill | 15.7, 51.6 |

**Risk-to-mitigation coverage:**

| Risk | Primary Mitigation | Test |
|---|---|---|
| RISK-01 DOM change | Selector packs + canary | CH-07, CH-08; fixture 015 |
| RISK-02 challenge/rate-limit | Breaker + pacing | CH-02, CH-03 |
| RISK-03 ToS enforcement | Authorisation gate + API migration | S7 drill; V-3 config rule |
| RISK-04 silent partial data | Completeness + gate | **CH-04** |
| RISK-05 destructive delete | Confidence-gated removal | **PT-03, PT-07** |
| RISK-08 XSS | Seven-layer output safety | CH-14; fixture 019 |
| RISK-11 duplicates | Two-tier identity | PT-08, PT-09 |
| RISK-17 dormant schedule | Keepalive + staleness | Manual verification, §50.3 |

---

# Appendix E — Diagram Index

42 diagrams across the document. Listed for navigation.

| § | Diagram | Type |
|---|---|---|
| 0.4.3 | Diagram legend | flowchart |
| 2.2 | Three-year vision | flowchart |
| 3.4 | The gap being filled | flowchart |
| 5.3 | Quality attribute priority order | flowchart |
| 9.3 | UC-04 new review sequence | sequence |
| 9.3 | UC-08 upstream change states | state |
| 14.1 | Risk exposure map | quadrant |
| 16.2 | System context (L1) | flowchart |
| 16.3 | Container view (L2) | flowchart |
| 16.4 | Ten-stage pipeline | flowchart |
| 16.5 | Dependency rule | flowchart |
| 16.6 | End-to-end data flow | sequence |
| 16.7 | Trust boundaries | flowchart |
| 16.8 | Deployment view | flowchart |
| 17.3.1 | Target outcome states | state |
| 20.1.1 | Engine module map | flowchart |
| 20.2.3 | Resolution flow | flowchart |
| 20.3.2 | Navigation phase machine | state |
| 20.7.2 | Reconciliation decisions | flowchart |
| 20.7.4 | Ledger record lifecycle | state |
| 22.2 | Harvest job graph | flowchart |
| 23.4 | Error propagation | flowchart |
| 25.2 | Monitoring signal hierarchy | flowchart |
| 26.3 | Retry decision flow | flowchart |
| 26.5 | Circuit breaker states | state |
| 27.4 | Recovery flow | flowchart |
| 29.4 | Challenge response sequence | sequence |
| 34.1 | Cache layers | flowchart |
| 36.2 | Threat boundaries | flowchart |
| 37.3 | Sharding and scheduling | flowchart |
| 39.2 | Config precedence chain | flowchart |
| 41.2 | Test portfolio | flowchart |
| 42.4 | Release deployment flow | flowchart |
| 44.1 | Branch model | flowchart |
| 47.2 | Roadmap timeline | timeline |
| 47.8 | Roadmap dependencies | flowchart |
| 51.2 | Detection layers | flowchart |
| 54.2 | API architectural position | flowchart |
| 55.2 | Dashboard information architecture | flowchart |
| 56.2 | Admin panel Git flow | sequence |
| 56.4 | Onboarding wizard states | state |
| 59.6 | AI enrichment flow | flowchart |

---

# Appendix F — Runbook Index

| Condition | Runbook | § |
|---|---|---|
| Selector break / extraction failure | `docs/runbooks/selector-break.md` | 51.3 |
| Bot challenge encountered | `docs/runbooks/bot-challenge.md` | 29.5 |
| Client stale > 24 h | `docs/runbooks/stale-client.md` | 27.6 |
| Publish conflict | `docs/runbooks/publish-conflict.md` | 20.8.4 |
| Ledger corruption | `docs/runbooks/disaster-recovery.md` §D-2 | 52.4 |
| Bad payload published | `docs/runbooks/disaster-recovery.md` §D-1 | 52.3 |
| Branch loss | `docs/runbooks/disaster-recovery.md` §D-3/D-4 | 52.5 |
| Total repository loss | `docs/runbooks/disaster-recovery.md` §D-5 | 52.6 |
| CI platform outage | `docs/runbooks/disaster-recovery.md` §D-6 | 52.7 |
| CDN outage | `docs/runbooks/disaster-recovery.md` §D-7 | 52.8 |
| Adapter migration | §15.7.1 | 15.7 |
| Security incident | §36.6 | 36.6 |
| Erasure request | UC-16 | 9.3 |
| Client onboarding | §53.5 + §15.10 | 38.6 |
| Quarterly maintenance | §50.4 | 50.4 |

---

# Appendix G — Quick Reference Card

*The one page to pin above a desk.*

## The Five Things

1. The website never talks to Google.
2. A failed harvest must never make the site worse. **LKG always.**
3. **Absence is not deletion.**
4. Volatile knowledge lives in data files, not code.
5. A challenge means **stop**, not try harder.

## Most-Used Commands

| Task | Command |
|---|---|
| Check environment | `tpre doctor` |
| What's due? | `tpre plan` |
| Explain a config value | `tpre validate-config --explain` |
| Test a client offline | `tpre harvest --client X --dry-run` |
| Rebuild payloads, no network | `tpre project --client X` |
| Reproduce a failure | `npm run parse:fixture -- <nnn>` |
| Export a client's data | `tpre export --client X` |

## Exit Codes

`0` ok · `1` internal · `2` usage/config · `3` all failed · `4` partial · `5` gate rejected · `6` policy blocked · `7` bot challenge

## Health at a Glance

| Metric | Healthy | Act |
|---|---|---|
| Success rate (30 d) | > 98% | < 95% |
| Coverage | > 0.97 | < 0.95 |
| Gate rejections | < 2% | > 10% |
| Strategy index-0 | 100% | < 95% |
| p95 duration | < 150 s | > 240 s |
| Payload age p95 | < 8 h | > 24 h |
| Challenges / 30 d | 0 | ≥ 1 |

## Emergency Levers

| Situation | Action |
|---|---|
| Stop all DOM acquisition now | Set `TPRE_POLICY_DOM_ENABLED=false` |
| Stop everything now | Set `TPRE_POLICY_ENABLED=false` |
| Undo a bad payload | `git revert` on `data`, or `tpre project` |
| Undo a bad selector pack | Revert the one-line pin in the profile |
| Silence non-critical alerts | Set `TPRE_MAINTENANCE_MODE=true` |

## When In Doubt

**Do not publish.** Stale correct data beats fresh wrong data, every time.

---

*End of appendices.*
