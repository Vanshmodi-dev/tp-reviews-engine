# Part 9 — Security, Validation, Schema, and Hashing

*Sections 47 through 54. Audience: security engineers, backend engineers. §51 protects every client website simultaneously and §53 determines whether the adapter migration guarantee is real. Both are load-bearing.*

---

# 47. Security Requirements

## 47.1 Security Model Summary

| Question | Answer |
|---|---|
| Most valuable asset | **Write access to the repository** — it can alter every client's published data simultaneously |
| Most likely attack | Supply-chain compromise of a dependency or CI action, executing in a runner that holds a write token |
| Highest-impact attack | **Stored XSS via review text reaching every client website at once** |
| Most damaging accident | A secret committed or logged into a public repository |
| What protects visitors | The payload contains no markup and no executable content **by construction** |
| What protects clients from each other | Path-disjoint sharding and per-target isolation |

## 47.2 Security Principles

| # | Principle | Application |
|---|---|---|
| 1 | **Least privilege, always explicit** | Every workflow declares `permissions:`; the alert job has `issues: write` and no content access |
| 2 | **Fail closed on authorisation** | Missing secret, missing authorisation record, unreadable budget → stop, never degrade to a less-controlled path |
| 3 | **Untrusted until validated** | All source content crosses the Normalizer boundary; no stage may read raw content |
| 4 | **Defence in depth on output** | Payload is markup-free **and** the renderer uses text-only DOM APIs. Either alone would suffice; both are required |
| 5 | **Pin everything** | Actions by commit SHA, dependencies by lockfile, browser by version |
| 6 | **Ephemeral compute** | No persistent runner; nothing to compromise between runs |
| 7 | **No secret ever touches an artifact** | Redaction at the sink; secrets never in config; scanning on every push |
| 8 | **Assume the repository is public** | Because it is |

## 47.3 Threat Register Summary

| ID | Threat | L | I | Residual |
|---|---|---|---|---|
| THREAT-01 | Malicious review text becomes stored XSS on client sites | 2 | 5 | **Low** |
| THREAT-02 | Malicious review text triggers workflow expression injection | 1 | 5 | Very low |
| THREAT-03 | Malicious avatar/profile URL becomes an open redirect or tracker | 3 | 3 | Low |
| THREAT-04 | Source serves crafted content to exhaust runner memory or time | 2 | 2 | Low |
| **THREAT-05** | **Compromised npm dependency executes in the runner and pushes malicious payloads** | 2 | 5 | **Medium — the highest residual** |
| THREAT-06 | Compromised third-party CI action steals the write token | 2 | 5 | Low-Medium |
| THREAT-07 | Malicious Playwright/Chromium build | 1 | 5 | Low |
| THREAT-08 | Secret committed or logged into the public repository | 2 | 4 | Low |
| THREAT-09 | Engine defect wipes a client's payload | 2 | 5 | Very low |
| THREAT-10 | Attacker with repository write access publishes false reviews | 1 | 5 | Low |
| THREAT-11 | CDN or DNS compromise serves a malicious payload | 1 | 4 | Low |
| THREAT-12 | Denial of service against the source, caused by us | 1 | 4 | Very low |
| THREAT-13 | Reviewer personal data exposed beyond its public context | 2 | 3 | Low |
| THREAT-14 | Ledger tampering alters published history | 1 | 4 | Low |
| THREAT-15 | Client A's harvest corrupts client B's data | 1 | 4 | Very low |
| THREAT-16 | Alert channel abuse via crafted issue content | 1 | 4 | Very low |
| THREAT-17 | Stale or absent monitoring conceals a long outage | 3 | 3 | Low |

## 47.4 The Dominant Residual Risk

**THREAT-05 carries the highest residual risk and deserves explicit acknowledgement rather than a reassuring summary.** A malicious dependency executing in a runner holding a repository write token could publish arbitrary content to every client's payload simultaneously.

| Aspect | Assessment |
|---|---|
| Why it cannot be eliminated | Running third-party code is unavoidable — Playwright alone is a large dependency with a native binary |
| What bounds it | Fewer than 10 production dependencies; lockfile pinning; audit gating; ephemeral runners; branch protection on `main`; and the fact that **the payload is data, not code** — a poisoned payload displays wrong reviews, it does not execute on client sites |
| What would reduce it further | **The v1.1 job split**: run the browser job with `contents: read` and publish from a separate job with `contents: write`. The job that executes the most third-party code would then hold no write credential at all |
| Detection | Unexpected payload changes trip the Publish Gate; unexpected commits are visible in history; `MET-commit-churn` catches anomalous write volume |

| ID | Requirement |
|---|---|
| TR-SEC-020 | The v1.1 job split MUST be implemented before client count exceeds 25. It is the single highest-value security improvement available and costs one extra job. |

## 47.5 CI/CD Security Controls

| Control | Rule | Enforcement |
|---|---|---|
| Explicit permissions | Every workflow declares a minimum `permissions` block | CI lint fails the build otherwise |
| Action pinning | Third-party actions pinned to full commit SHA | CI lint + Dependabot for SHA updates |
| No `pull_request_target` | **Forbidden outright** | CI lint |
| No secrets in fork PRs | Platform default, relied upon deliberately | `validate-config` runs network-free |
| **Expression injection** | Untrusted values MUST NOT be interpolated into `run:` blocks; pass via `env:` and quote | CI lint + review |
| Branch protection | `main` requires review, passing CI, no force-push | Repository settings |
| Machine-owned branches | `data` and `state` writable only by the workflow token and admins | Repository settings |
| Token scope | `GITHUB_TOKEN` per job, minimum scope, never persisted | Design |
| Self-hosted runners | **Forbidden** | §14.2 |

**On expression injection specifically.** A workflow that interpolates an issue title into a shell command allows anyone who can open an issue to execute code in a runner holding a write token. **This system's alerting reads and writes issues, which makes it exactly the shape of workflow where this mistake happens.** The lint rule is not optional.

## 47.6 Output Safety — Seven Layers

**The most consequential security property of the system**, because a failure here compromises every client site simultaneously, from a source an attacker can write to by simply leaving a review.

| Layer | Control | Owner |
|---|---|---|
| 1 · Extraction | Text is read as text content, never as markup | `core/extract/text.mjs` |
| 2 · Normalisation | Entity decoding then **complete markup removal**; control and bidi-override characters stripped | `core/normalize/markup.mjs` |
| 3 · Validation | Self-check asserts no markup survived; `ERR-CLEAN-MARKUP-SURVIVED` is **critical** | `core/validate/record.mjs` |
| 4 · Contract | Schema declares `text` as plain text; **there is no `text_html` field and there must never be one** | `schemas/payload.v1.schema.json` |
| 5 · Renderer | Text-only DOM APIs exclusively; lint forbids HTML-injection APIs in `frontend/` | `frontend/renderer/` |
| 6 · Documentation | `frontend/SAFETY.md` states why; every recipe repeats "never insert this as HTML" | `frontend/` |
| 7 · Test | Fixture `019-markup-in-review-text` contains payloads designed to survive naive sanitisation | `tests/security/` |

**Threat walk-through.** An attacker leaves a review containing a script payload. Layer 2 removes it. Even if layer 2 had a defect, layer 3 detects, quarantines, and alerts. Even if both failed, layer 5 renders it as visible text rather than executing it. **Three independent failures are required for exploitation.**

| ID | Requirement |
|---|---|
| TR-SEC-030 | All seven layers MUST be implemented. Removing any one because "the others cover it" defeats the defence-in-depth design and requires an EDR. |

## 47.7 Personal Data Protection

| Control | Detail |
|---|---|
| Minimisation | Only display name, avatar URL, text, rating, dates, reply |
| **No image re-hosting** | Avatars are referenced by URL; a deterministic initials avatar is the fallback. **The engine never fetches them** |
| Suppression | Denylist retains only a hash and a reason code; name and text are purged |
| Diagnostics | Screenshots may contain rendered personal data; 14-day retention; disableable by config |
| Logs | Author names never logged in plain text; only `author_key` hash prefixes at `debug` |
| Attribution | Every review carries a source link so provenance is verifiable |

| ID | Requirement |
|---|---|
| TR-SEC-040 | The engine MUST NEVER download, cache, or re-host a reviewer profile image. Re-hosting copies a person's photograph onto TradyPerch infrastructure, escalating both the data-protection footprint and the copyright position, for the benefit of slightly more reliable avatar rendering. |
| TR-SEC-041 | Suppression MUST purge name and text from the Ledger, retaining only the hash and a reason code. A suppression that leaves the data in place is not a suppression. |

## 47.8 Dependency and Supply-Chain Security

| Control | Detail |
|---|---|
| Minimal surface | Fewer than 10 production dependencies, each justified |
| Lockfile | Committed; CI installs with `npm ci` exactly |
| Audit | Every CI run; high-severity advisories block release |
| Update discipline | Dependency PRs reviewed; **never auto-merged for the browser pin** |
| Postinstall scripts | Require security review |
| Frontend | **Zero dependencies** |
| Provenance | Prefer packages publishing provenance attestations |

## 47.9 Network Security

| Control | Detail |
|---|---|
| Host allowlist | The browser blocks requests to hosts outside a configured allowlist — a compromised page cannot use the runner as a request source |
| No inbound surface | The system has no listening ports; there is nothing to attack from outside |
| TLS | All egress HTTPS; **no certificate validation bypass under any configuration** |
| No proxying | No proxy configuration exists |
| Egress minimisation | Resource blocking removes 60–80% of requests, incidentally shrinking the attack surface |

## 47.10 Security Test Obligations

| Test | Asserts |
|---|---|
| `security.xss-fixture.test.mjs` | Adversarial markup in review text never survives to the payload |
| `security.redaction.test.mjs` | Sentinel secrets never appear in any log level or artifact |
| `security.url-allowlist.test.mjs` | Off-allowlist avatar/profile URLs are nulled |
| `security.workflow-lint.test.mjs` | All workflows declare permissions; no `pull_request_target`; all actions SHA-pinned; no untrusted interpolation into `run:` |
| `security.renderer-api.test.mjs` | The renderer source contains no HTML-injection API usage |
| `security.isolation.test.mjs` | A failing target cannot write outside its own client path |

**Standing rule: every security incident adds a permanent regression test.** An incident that does not produce a test will recur.

---

# 48. Secrets Management

## 48.1 Secret Inventory

| Secret | Required When | Scope | Rotation |
|---|---|---|---|
| `GITHUB_TOKEN` | Always in CI | Per job, automatic | None needed — per-job |
| `GOOGLE_PLACES_API_KEY` | Any client uses `google:places-api` | Repository | Annually or on suspicion |
| `GBP_OAUTH_CLIENT_ID` | Any client uses `google:business-profile-api` | Repository | On suspicion |
| `GBP_OAUTH_CLIENT_SECRET` | Same | Repository | On suspicion |
| `GBP_REFRESH_TOKEN__<SLUG_UPPER>` | Per client using that adapter | Repository, one per client | **On client offboarding** or suspicion |
| `ALERT_WEBHOOK_URL` | Optional secondary channel | Repository | On suspicion |

## 48.2 Secret Handling Rules

| ID | Rule |
|---|---|
| TR-SEC-050 | Secrets MUST be stored as platform secrets only. **Never in files, never in config, never in the Ledger.** |
| TR-SEC-051 | Config references secrets **by name**; the engine resolves names to values at startup. |
| TR-SEC-052 | Secrets MUST be injected at the **step** level, never at workflow or job level, so an unrelated step cannot read them. |
| TR-SEC-053 | Secrets MUST NOT be passed as command-line arguments. Process lists are visible in some contexts. |
| TR-SEC-054 | The engine MUST read secrets exactly once at startup into a sealed object. |
| TR-SEC-055 | The log redaction filter MUST be seeded with every secret value at that moment (§37.5). |
| TR-SEC-056 | An adapter whose required secret is missing MUST **fail closed** with `ERR-CONFIG-SECRET-MISSING` and exit 2. It MUST NOT fall back to another access method. |

## 48.3 Per-Client Secret Isolation

**Business Profile refresh tokens are named per client** (`GBP_REFRESH_TOKEN__ACME_CORP`), so one client's grant can be revoked without affecting any other. This is what makes offboarding step 3 (§71.6) a single, safe operation.

| ID | Requirement |
|---|---|
| TR-SEC-060 | Per-client secrets MUST use the `<NAME>__<SLUG_UPPER>` convention. |
| TR-SEC-061 | Client offboarding MUST revoke the per-client OAuth token. |

## 48.4 Why Fail-Closed on a Missing Secret Matters

TR-SEC-056 exists because of a specific, plausible incident: an OAuth refresh token expires overnight, the API adapter fails, and a "helpful" fallback silently downgrades a sanctioned API client to unsanctioned DOM scraping.

**That is a serious policy violation arising from a trivial operational event.** It must be designed out rather than trusted to attention. A contract test asserts this behaviour on every API adapter.

## 48.5 Compromise Response

| Incident | Immediate Action | Follow-Up |
|---|---|---|
| Secret exposed | Revoke and rotate immediately; **assume compromised**; audit for use | Purge from history if committed; announce re-clone; post-mortem |
| Malicious payload published | Revert the `data` commit; regenerate from Ledger; verify at the CDN | Identify the vector; audit all payloads in the window; notify affected clients |
| Dependency advisory (critical) | Assess exploitability in our usage; patch or pin; re-run audit | Review whether the dependency is still justified |
| Runner compromise suspected | Disable workflows; rotate all secrets; audit all commits in the window | Implement the v1.1 job split permanently |
| XSS reported by a client | Verify; regenerate payloads with stricter sanitisation; notify all clients | **Add the payload to the adversarial fixture corpus permanently** |
| Data-subject complaint | Suppress via denylist same-day; respond within the statutory window | Review whether minimisation needs tightening |

---

# 49. Configuration Validation

## 49.1 Two Validation Layers

| Layer | Catches | When | Blocking |
|---|---|---|---|
| **Schema validation** | Shape errors: wrong types, missing required fields, unknown properties | Load time and CI | yes |
| **Semantic validation** | Errors that actually happen: mismatched slugs, missing authorisation, ceiling breaches | `validate-config` command and workflow | yes for `error`, no for `warning` |

## 49.2 Semantic Validation Rules

| # | Rule | Severity |
|---|---|---|
| V-1 | `slug` equals the filename stem | **error** |
| V-2 | Listing keys unique within a client | **error** |
| V-3 | `adapter: google:dom` requires a complete `authorization` block | **error — the compliance gate** |
| V-4 | Adapter's required secret names present in `secrets` and existing in the environment at run time | **error** |
| V-5 | No rate or cadence override exceeds a hard ceiling | **error** |
| V-6 | `identity` contains at least one of `place_id`, `cid`, or `url` when `resolution.allow_search` is false | **error** |
| V-7 | `expected_name` present for every listing | **error** |
| V-8 | `min_rating` set to a non-null value requires a `notes` justification | **warning — deliberate friction** |
| V-9 | `publish.schema_org: true` requires acknowledgement of the structured-data policy warning | warning |
| V-10 | Gate thresholds within sane bounds (`max_count_drop_ratio` ≤ 0.5) | warning |
| V-11 | Listing without an explicit identifier | warning |
| V-12 | `tier: premium` with `cadence: daily` — contradictory | warning |

| ID | Requirement |
|---|---|
| TR-CFG-040 | V-1 through V-7 MUST block the `validate-config` workflow. A config that fails any of them MUST NOT be merged. |
| TR-CFG-041 | V-3 MUST be enforced mechanically, not by review. It is the mechanism by which the written-authorisation requirement is guaranteed rather than hoped for. |
| TR-CFG-042 | One invalid config MUST fail only that client, never the whole run. |

**On V-8 as deliberate friction rather than prohibition.** The product position is that TradyPerch declines to filter out low ratings. The config system does not forbid it outright — a jurisdiction or platform might someday require selective display — but it makes the choice visible, justified in writing, and surfaced in review. **Mechanisms that make the wrong choice slightly uncomfortable are more durable than mechanisms that make it impossible and get bypassed.**

## 49.3 Startup Validation Sequence

| # | Check | Failure |
|---|---|---|
| 1 | `config_version` supported | `ERR-CONFIG-VERSION`, exit 2 |
| 2 | Every config validates against its schema | `ERR-CONFIG-INVALID`, that client only |
| 3 | Semantic rules V-1…V-7 | `ERR-CONFIG-INVALID`, that client only |
| 4 | Unknown `TPRE_*` variables rejected | exit 2 |
| 5 | Every value within its ceiling | exit 2 |
| 6 | Required secrets present for selected adapters | `ERR-CONFIG-SECRET-MISSING`, exit 2 |
| 7 | Timeout nesting relationship valid | exit 2 |

| ID | Requirement |
|---|---|
| TR-CFG-050 | A value exceeding a hard ceiling MUST be a **validation error, not a silent clamp**. Clamping hides operator intent, which is exactly what must be visible during an incident. |

## 49.4 Configuration Migration

| Aspect | Rule |
|---|---|
| Version field | `config_version`, integer, required |
| Unsupported version | `ERR-CONFIG-VERSION`, run aborts |
| Migration | `app/config/migrate.mjs` holds an ordered list of N→N+1 migrations |
| Application | `tpre validate-config --migrate` rewrites files in place and prints a diff for review |
| Policy | Migrations are additive and mechanical. **A migration that cannot be performed automatically MUST fail with a clear message telling the operator what to do** |
| Compatibility window | The engine supports the current version and the previous one |

---

# 50. Input Validation

## 50.1 Input Surfaces

Every place untrusted or semi-trusted data enters the system.

| Surface | Trust | Validation | Failure Mode |
|---|---|---|---|
| Rendered page content | **none** | Normalizer (§23) then Validator (§25) | Quarantine record |
| API response bodies | **none** | Same path | Quarantine record |
| Operator-supplied CSV | **none** | Column contract + per-row isolation | Skip row, report |
| Client configuration | semi | Schema + semantic rules (§49) | Reject config |
| Selector packs | semi | Pack schema at load | Abort run |
| Environment variables | semi | Type coercion + ceiling checks | Exit 2 |
| CLI flags | semi | Parser + allowlist | Exit 2 |
| Prior Ledger | semi | Schema validation on read | `ERR-STATE-CORRUPT` |
| Prior payload (for the Gate) | semi | Schema validation | Treat as unknown, not empty |

| ID | Requirement |
|---|---|
| TR-SEC-070 | **No stage may read raw acquired content directly.** Everything crosses the Normalizer. Enforced by the type system: only the Normalizer accepts `RawField`, and only it returns `CleanString`. |
| TR-SEC-071 | CSV parsing MUST isolate errors per row. One malformed row MUST NOT abort the import. |
| TR-SEC-072 | A ledger failing schema validation MUST NOT be partially parsed or silently repaired. |

## 50.2 Injection Surfaces

| Surface | Vector | Control |
|---|---|---|
| Shell commands | Interpolated review text or config free-text | `infra/git.mjs` is the only shell caller; it accepts no acquired content |
| Workflow expressions | Issue titles, PR bodies, review content in `run:` blocks | Untrusted values passed via `env:`, quoted; CI lint |
| Log format strings | Review text | Structured logging only; no format-string interpolation |
| Dynamic imports | Path built from input | **Forbidden** (§67.3) |
| Selector construction | String concatenation from input | **Forbidden** — selectors come from packs, not from data |
| Client DOM | Review text | Seven-layer output safety (§47.6) |

| ID | Requirement |
|---|---|
| TR-SEC-080 | Dynamic `import()` of a path built from any input MUST NOT appear in the codebase. |
| TR-SEC-081 | Selectors MUST NOT be constructed by string concatenation from data. They come from validated pack files. |

## 50.3 Numeric and Enum Validation

| Input | Rule |
|---|---|
| Rating | Integer in [1, 5]. Non-integer ⇒ `ERR-PARSE-RATING-INVALID`, quarantine |
| Likes, photo count | Non-negative integer or `null`. Locale-aware thousands separators parsed |
| Advertised total | Non-negative integer or `null` |
| Advertised rating | Number in [1.0, 5.0] or `null` |
| `source` | Member of the closed enum |
| `date_precision`, `date_confidence` | Member of the closed enum |
| Language code | ISO 639-1 or `null` |

---

# 51. Output Validation

## 51.1 What Gets Validated Before Publication

| Artifact | Validation | Failure |
|---|---|---|
| `reviews.json` | Full schema validation (G-01) | **REJECT**, `ERR-GATE-REJECT-SCHEMA`, critical |
| `latest.json` | Full schema validation | Same |
| `stats.json` | Full schema validation | Same |
| `schema-org.json` | Structural check | Same |
| `index.json` | Full schema validation | Same |
| Ledger | Schema validation before write | `ERR-STATE-WRITE` |
| Health record | Schema validation before append | `ERR-STATE-WRITE` |
| Run manifest | Schema validation before write | logged, non-fatal |

| ID | Requirement |
|---|---|
| TR-VAL-050 | **Every** generated artifact MUST be schema-validated before publication, not just `reviews.json`. |
| TR-VAL-051 | A schema validation failure at publication time MUST be treated as an **engine defect**, not a data problem. It means the projector produced a document its own contract forbids. |

## 51.2 Output Safety Assertions

| Assertion | Where | Failure |
|---|---|---|
| No field named `text_html` exists | Schema | Schema rejects |
| `text` contains no markup | Validator self-check | `ERR-CLEAN-MARKUP-SURVIVED`, critical |
| `text` length within bound | Validator | info (already enforced) |
| No control characters in any string | Validator | Quarantine |
| All URLs are HTTPS and allowlisted, or null | Normalizer + test | Set to null |
| No internal state fields present | Schema `additionalProperties: false` | Schema rejects |
| No secret-shaped strings | CI artifact entropy scan | Blocks publication |

| ID | Requirement |
|---|---|
| TR-VAL-060 | The payload schema MUST set `additionalProperties: false` on every object. This is what mechanically prevents internal state (streaks, tombstones, quarantine records) from leaking into a public contract. |

## 51.3 Published Payload Verification

An external check, run daily, that fetches each published payload over the public CDN URL **exactly as a visitor's browser would**.

| Check | Threshold |
|---|---|
| Reachable over HTTPS | 200 response |
| Schema-valid | passes `payload.v1.schema.json` |
| Non-empty | `stats.total_count > 0` where the ledger is non-empty |
| Age | `generated_at` within SLO |
| Content type | `application/json` |
| No third-party origin contacted | Consumer recipe network assertion |

**This is the only Level-1 monitor and therefore the most important one.** Every other check watches the pipeline; this one watches the promise.

---

# 52. JSON Schema Specification

## 52.1 Schema Authority

> **EDR-039 — Schema files are the runtime authority; documentation and generated types are derived**
> **Serves:** P-4 (precedence rules).
> **Context:** The payload shape is described in three places: this document, the JSON Schema files, and JSDoc types in `core/model/`. They will drift.
> **Decision:** `schemas/*.json` is the single runtime authority. Documentation describes it; types are derived from it. Where they disagree, the schema wins and the others are defective.
> **Alternatives Rejected:** *Types as the authority, generating schemas* — schemas would then be build artifacts, and a consumer could not rely on a committed contract file. *Documentation as authority* — prose cannot be executed. *No schema, validate by hand* — hand-rolled validation is exactly where silent data corruption enters.
> **Trade-off:** Types must be kept in sync with schemas by hand or by generation. A CI check asserts correspondence.
> **Scalability:** Essential as consumer count grows — external integrators need a machine-readable contract they can pin.

| ID | Requirement |
|---|---|
| TR-VAL-070 | `schemas/payload.v1.schema.json` is the public contract. Consumers may rely on it. |
| TR-VAL-071 | Schemas MUST be validated in CI against every fixture and every client config. |
| TR-VAL-072 | Every schema file MUST set `additionalProperties: false` on all objects. |

## 52.2 Schema Inventory

| Schema | Public Contract | Versioning |
|---|---|---|
| `payload.v1.schema.json` | **Yes** | Additive-only within a major; new major requires 90-day parallel publication |
| `ledger.v1.schema.json` | No | Free to change; `ledger_version` internal |
| `client-config.v1.schema.json` | Operator-facing | `config_version` with migrations |
| `health-record.v1.schema.json` | No | Free to change |
| `run-manifest.v1.schema.json` | No | Free to change |
| `selector-pack.schema.json` | No | Free to change |

## 52.3 Payload Envelope

Every published artifact shares this envelope.

| Field | Type | Nullable | Description |
|---|---|---|---|
| `schema_version` | integer | No | Major version. `1` for v1.0. **Consumers MUST check this** |
| `artifact` | enum | No | `reviews` / `latest` / `stats` / `schema_org` / `index` |
| `generated_at` | RFC 3339 UTC | No | When produced. **Excluded from the content hash** |
| `client` | object | No | `{ slug, display_name }` |
| `listing` | object | No | Listing identity block (§52.4) |
| `provenance` | object | No | Engine and run provenance (§52.7) |
| `stats` | object | No | Aggregates (§52.6) |
| `reviews` | array | No (may be empty) | Review objects. Absent in the `stats` artifact |
| `pagination` | object | Yes | Present when the payload is sharded |
| `notices` | string[] | Yes | Human-readable notes, e.g. `"harvest_partial"`. **Never an error channel** |

## 52.4 Listing Object

| Field | Type | Nullable | Description |
|---|---|---|---|
| `key` | string | No | Stable internal listing key. Part of the artifact URL. **Never changes** |
| `source` | enum | No | `google` / `facebook` / `trustpilot` / `justdial` / `glassdoor` / `yelp` / `manual` / `csv` |
| `source_id` | string | Yes | Canonical identifier at the source, where publishable |
| `source_url` | URI | Yes | Deep link. **Engine-constructed, never scraped** |
| `display_name` | string | No | Business name as configured |
| `locale` | BCP 47 | Yes | Tag used during acquisition |
| `advertised_total` | integer | Yes | Source-reported total at harvest time |
| `advertised_rating` | number | Yes | Source-reported aggregate |
| `address_hint` | string | Yes | Coarse location label. **Never a precise address** |

## 52.5 Review Object — The Core Entity

| # | Field | Type | Nullable | v1.0 Populated | Description |
|---|---|---|---|---|---|
| 1 | `id` | string | No | ✅ | `identity_hash`, hex, 32 chars. Stable across harvests and adapters |
| 2 | `content_hash` | string | No | ✅ | Changes when the review is edited |
| 3 | `author` | object | No | ✅ | See below |
| 4 | `rating` | integer 1–5 | No | ✅ | Normalised star rating |
| 5 | `text` | string | Yes | ✅ | **Plain text, no markup.** `null` for rating-only |
| 6 | `text_truncated` | boolean | No | ✅ | Source text was longer than what was retrieved |
| 7 | `text_clipped` | boolean | No | ✅ | Engine bounded the length |
| 8 | `date` | RFC 3339 | Yes | ✅ | Pinned absolute estimate |
| 9 | `date_precision` | enum | No | ✅ | `day` / `week` / `month` / `year` / `unknown` |
| 10 | `date_confidence` | enum | No | ✅ | `high` / `medium` / `low` |
| 11 | `relative_date` | string | Yes | ✅ | The source's own phrasing, verbatim |
| 12 | `language` | string | Yes | ✅ | ISO 639-1 |
| 13 | `language_confidence` | number 0–1 | Yes | ✅ | |
| 14 | `likes` | integer | Yes | ⚠️ where available | Helpful count |
| 15 | `photo_count` | integer | Yes | ⚠️ where available | |
| 16 | `owner_reply` | object | Yes | ✅ | See below |
| 17 | `source` | enum | No | ✅ | Enables merged multi-source payloads |
| 18 | `source_url` | URI | Yes | ✅ | |
| 19 | `verified` | boolean | Yes | ⚠️ | `null` when unknown — **never fabricated** |
| 20 | `first_seen_at` | RFC 3339 | No | ✅ | When this engine first observed it |
| 21 | `last_updated_at` | RFC 3339 | No | ✅ | Last observed content change |
| 22 | `revision` | integer ≥ 1 | No | ✅ | Increments on each observed edit |
| 23 | `ai` | object | Yes | ❌ v2.0 | Reserved enrichment block |
| 24 | `flags` | string[] | Yes | ✅ | e.g. `unconfirmed`, `rating_only`, `reply_present` |

**`author` object:**

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `name` | string | Yes | As published at the source. **Never abbreviated by the engine** |
| `initials` | string | Yes | Derived, 1–2 graphemes, so a consumer can render an avatar without fetching an image |
| `avatar_url` | URI | Yes | Allowlisted host, HTTPS. **Referenced, never re-hosted** |
| `profile_url` | URI | Yes | Allowlisted host |
| `is_local_guide` | boolean | Yes | Source-specific badge |
| `review_count_hint` | integer | Yes | Author's total at the source |

**`owner_reply` object:**

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `text` | string | No | Plain text, same sanitisation as review text |
| `date` | RFC 3339 | Yes | Pinned estimate |
| `date_precision` | enum | No | As above |
| `relative_date` | string | Yes | Verbatim |
| `author_label` | string | Yes | e.g. the business name. **Never a personal name** |

## 52.6 Stats Object

| Field | Type | Description |
|---|---|---|
| `total_count` | integer | Published count, post-filter, post-suppression |
| `advertised_total` | integer \| null | Source-reported total |
| `coverage` | number 0–1 \| null | `total_count / advertised_total` |
| `mean_rating` | number | Computed from published reviews, 2 dp |
| `advertised_rating` | number \| null | Source-reported aggregate |
| `distribution` | object | Counts keyed `"1"`…`"5"` |
| `with_text_count` | integer | |
| `with_reply_count` | integer | |
| `newest_review_date` | string \| null | |
| `oldest_review_date` | string \| null | |
| `languages` | object | Count per detected code |
| `completeness` | enum | `full` / `full_capped` / `partial` |
| `last_full_harvest_at` | string \| null | **The honest freshness signal** |

## 52.7 Provenance Object

| Field | Type | Description |
|---|---|---|
| `engine_version` | string | SemVer of the engine |
| `schema_version` | integer | Duplicated for convenience |
| `adapter` | string | e.g. `google:dom` |
| `adapter_capabilities` | string[] | What this adapter could supply — **explains any nulls** |
| `selector_pack_version` | string \| null | `null` for API adapters |
| `identity_algo_version` | integer | Enables safe future identity migration |
| `run_id` | string | Links to logs, manifest, diagnostics |
| `harvest_started_at` | string | |
| `harvest_completeness` | enum | `full` / `full_capped` / `partial` |
| `content_hash` | string | Over canonical bytes **excluding `generated_at`** |

**INV-06 is satisfied entirely by this object.** Given a payload, an engineer can identify the exact code, the exact selector pack, and the exact run that produced it — the difference between a 10-minute investigation and a 2-hour one.

## 52.8 Illustrative Payload

*Data, not code — an example instance of the contract.*

```json
{
  "schema_version": 1,
  "artifact": "latest",
  "generated_at": "2026-07-30T06:04:11Z",
  "client": { "slug": "commerce-insight", "display_name": "Commerce Insight" },
  "listing": {
    "key": "main",
    "source": "google",
    "source_id": "REDACTED_PLACE_IDENTIFIER",
    "source_url": "https://maps.google.com/?cid=REDACTED",
    "display_name": "Commerce Insight",
    "locale": "en-IN",
    "advertised_total": 118,
    "advertised_rating": 4.9,
    "address_hint": "Indore, MP"
  },
  "provenance": {
    "engine_version": "1.0.3",
    "schema_version": 1,
    "adapter": "google:dom",
    "adapter_capabilities": ["reviews", "owner_replies", "relative_dates", "avatars", "likes"],
    "selector_pack_version": "google-maps/v3",
    "identity_algo_version": 1,
    "run_id": "20260730T060112Z-a91f",
    "harvest_started_at": "2026-07-30T06:01:12Z",
    "harvest_completeness": "full",
    "content_hash": "9f2c41ab77de0356"
  },
  "stats": {
    "total_count": 116,
    "advertised_total": 118,
    "coverage": 0.983,
    "mean_rating": 4.87,
    "advertised_rating": 4.9,
    "distribution": { "1": 1, "2": 0, "3": 2, "4": 8, "5": 105 },
    "with_text_count": 103,
    "with_reply_count": 41,
    "newest_review_date": "2026-07-28T00:00:00Z",
    "oldest_review_date": "2023-02-15T00:00:00Z",
    "languages": { "en": 92, "hi": 21, "mr": 3 },
    "completeness": "full",
    "last_full_harvest_at": "2026-07-30T06:03:48Z"
  },
  "reviews": [
    {
      "id": "b41f0c7d5e2a9836c1d40f7b8a2e5c93",
      "content_hash": "77de0356b41f0c7d",
      "author": {
        "name": "Ananya Sharma",
        "initials": "AS",
        "avatar_url": "https://lh3.googleusercontent.com/REDACTED=s64-c",
        "profile_url": "https://www.google.com/maps/contrib/REDACTED",
        "is_local_guide": true,
        "review_count_hint": 34
      },
      "rating": 5,
      "text": "The advanced module completely changed how I approach client work. Structured, practical, and the mentor actually responds to questions.",
      "text_truncated": false,
      "text_clipped": false,
      "date": "2026-07-28T00:00:00Z",
      "date_precision": "day",
      "date_confidence": "high",
      "relative_date": "2 days ago",
      "language": "en",
      "language_confidence": 0.97,
      "likes": 3,
      "photo_count": 0,
      "owner_reply": {
        "text": "Thank you Ananya — delighted the advanced module landed well.",
        "date": "2026-07-29T00:00:00Z",
        "date_precision": "day",
        "relative_date": "a day ago",
        "author_label": "Commerce Insight"
      },
      "source": "google",
      "source_url": "https://maps.google.com/?cid=REDACTED",
      "verified": null,
      "first_seen_at": "2026-07-28T12:01:44Z",
      "last_updated_at": "2026-07-29T18:02:10Z",
      "revision": 2,
      "ai": null,
      "flags": ["reply_present"]
    }
  ],
  "notices": []
}
```

## 52.9 Consumer Contract Rules

| Rule | Reason |
|---|---|
| Check `schema_version` and refuse unknown majors gracefully | Prevents silent misinterpretation |
| Treat every nullable field as null-possible, **always** | Adapter capabilities differ per client |
| Ignore unknown fields | Forward compatibility |
| Use `relative_date` for display when `date_precision` is `month` or coarser | Avoids presenting false precision |
| Fall back to `author.initials` when `avatar_url` fails to load | Third-party image hosts are not guaranteed |
| **Never insert `text` as HTML** | INV-05 |

---

# 53. Hash Generation

## 53.1 Two Hashes, Two Jobs

| Hash | Answers | Stability Requirement |
|---|---|---|
| `identity_hash` | "Is this the same review?" | **Stable across harvests, across engine versions, and across adapters** |
| `content_hash` | "Did it change?" | Changes when and only when displayed content changes |

## 53.2 Algorithm

| Property | Value |
|---|---|
| Digest | SHA-256 |
| Input | Canonical, delimiter-escaped concatenation of ordered fields |
| Output | First **32 hex characters** (128 bits) |
| Versioning | `identity_algo_version`, currently `1`, is the first input |

## 53.3 `identity_hash` Inputs — Normative and Order-Fixed

| # | Input | Normalisation | Rationale |
|---|---|---|---|
| 1 | `identity_algo_version` | Literal, currently `1` | Allows a future algorithm change without ambiguity |
| 2 | `listing.key` | As stored | Scopes identity to a listing |
| 3 | `source` | Lowercase | The same person on two platforms is two reviews |
| 4 | `author_key` | Casefold, diacritic-strip, punctuation-strip, whitespace-collapse | Resilient to formatting differences |
| 5 | `text_identity_digest` | **First 512 graphemes** of normalised text, lowercased, whitespace-collapsed; `""` if no text | The strongest available discriminator, bounded so appending a sentence does not break identity |
| 6 | `rating` | Integer | Tiebreaker for short or empty texts |

> **EDR-036 — Identity hashing is versioned and uses only cross-adapter-available fields**
> **Serves:** ADR-023, INV-10.
> **Context:** The DOM path exposes different fields than the Business Profile API. Some access methods expose a source-internal review identifier, which would be a far better identity input.
> **Decision:** Identity uses only fields **every** adapter can supply. A source-specific identifier MUST NOT be used, even when available.
> **Alternatives Rejected:** *Use the source identifier where available, fall back otherwise* — identity would then differ between the DOM path and the API path for the same review, so migrating a client would insert every review as new and tombstone every old one. That single choice would destroy the migration guarantee that ADR-023 exists to provide. *Include the avatar URL* — changes when a reviewer updates their photo. *Include `relative_date`* — changes on every harvest by nature. *Hash the full text* — an appended sentence would create a new identity, producing a duplicate-then-vanish visible to visitors.
> **Trade-off:** Identity is weaker than it could be on adapters that offer a real identifier. Accepted deliberately: portability is worth more than marginal precision.
> **Scalability:** Every future adapter must supply these six inputs, which is a low and reasonable bar — it is also the first item on the adapter-addition checklist (§75.6).

| ID | Requirement |
|---|---|
| TR-HASH-001 | `identity_hash` MUST use only the six inputs above, in that order. |
| TR-HASH-002 | A source-specific review identifier MUST NOT be used, even when the adapter exposes one. |
| TR-HASH-003 | The text input MUST be bounded at 512 graphemes. |
| TR-HASH-004 | The same logical review harvested via two adapters MUST produce the same `identity_hash`. Verified by **PT-08** and by the quarterly migration drill. |
| TR-HASH-005 | Inputs MUST be delimiter-escaped so that concatenation is unambiguous. Without escaping, `("ab", "c")` and `("a", "bc")` hash identically. |

**Why the first 512 graphemes rather than the whole text.** A reviewer appending "Update: still great!" to a long review should be an UPDATE, not an INSERT. Truncating the identity input makes identity tolerant of appends — the most common form of review edit — while remaining highly discriminative.

**Collision analysis.** Within a single listing, an identity collision requires the same author key, same rating, and same first 512 graphemes. That is not a hash collision but a genuine duplicate: the same person posting the same text twice. Collapsing those is correct behaviour. Cryptographic collision at 128 bits is not a practical concern at this scale.

## 53.4 `content_hash` Inputs

**Computed over:** `rating`, full normalised `text`, `text_truncated`, `author.name`, `author.avatar_url`, `owner_reply.text`, `owner_reply.date`, `likes`, `photo_count`.

**Deliberately excluded:**

| Excluded | Why |
|---|---|
| `relative_date` | **Changes every harvest by nature.** Including it would mark every review as edited on every run — the single most common bug in naive implementations of this system |
| `first_seen_at`, `last_updated_at`, `revision` | Engine-generated; including them makes the hash self-referential |
| Anything engine-generated | Same |

| ID | Requirement |
|---|---|
| TR-HASH-010 | `relative_date` MUST NOT contribute to `content_hash`. A test MUST assert that two harvests of an unchanged review, with different relative-date phrasings, produce the same `content_hash`. |

## 53.5 `author_key` Derivation

| # | Step |
|---|---|
| 1 | Casefold |
| 2 | Strip diacritics |
| 3 | Collapse whitespace |
| 4 | Remove punctuation |
| 5 | Hash |

| ID | Requirement |
|---|---|
| TR-HASH-020 | `author_key` MUST NOT be published. It is an internal matching key. |
| TR-HASH-021 | Homoglyph names MUST NOT be merged (§23.5). Diacritic stripping is not homoglyph normalisation, and the distinction MUST be tested. |
| TR-HASH-022 | Anonymous authors MUST derive a key from a per-listing anonymous bucket **plus content**, so two anonymous reviews are not merged. |

## 53.6 Identity Algorithm Versioning — The Dangerous Migration

`identity_algo_version` changes the meaning of every review's primary key.

| Rule | Detail |
|---|---|
| Trigger | **Only** a demonstrated defect — an identity collision class, or a change needed for cross-adapter stability |
| Never | For convenience, tidiness, or a "better" hash |
| Procedure | (1) Implement the new algorithm alongside the old. (2) Migrate each ledger record, computing the new hash while preserving `first_seen_at`, pinned dates, `revision`, `hash_history`, tombstones, and suppressions. (3) **Rewrite tombstone and suppression keys under the new algorithm** — omitting this resurrects deleted or erased reviews, the worst possible outcome. (4) Dry-run and diff. (5) Verify the payload differs only in `id` values. (6) Apply per client with manual review |
| Consumer impact | All `id` values change. **Must be announced as a breaking change for anyone persisting `id`**, even though the schema major does not change |
| Test | A dedicated migration test asserting preservation of all six properties |

**This is the only migration in the system that cannot be fully automated with confidence.** It is documented in detail precisely so that whoever contemplates it understands the cost before starting.

---

# 54. Change Detection

## 54.1 Three Levels of Change Detection

| Level | Question | Mechanism | Consequence |
|---|---|---|---|
| **Review** | Did this review change? | `content_hash` comparison | UPDATE vs UNCHANGED |
| **Artifact** | Did this file change? | Content hash over canonical bytes | Write or skip (FR-065) |
| **Payload** | Did the published payload change enough to be suspicious? | Publish Gate rules G-03, G-04 | ACCEPT or REJECT |

## 54.2 Artifact-Level Hash Gating

| ID | Requirement |
|---|---|
| TR-HASH-030 | Before writing any artifact, the engine MUST compare the new canonical bytes against the current bytes. If identical, **the file MUST NOT be touched at all** — no write, no stage, no commit. |
| TR-HASH-031 | The comparison MUST exclude `generated_at` (EDR-022). |
| TR-HASH-032 | An integration test MUST assert that a second identical run produces **zero** file writes and **zero** commits. |

**Hash-gating is the load-bearing control on repository growth.** Its silent failure is a 15× growth event (§46.5), which is why `MET-commit-churn` monitors it directly.

## 54.3 The Two Byte Sequences

Because `generated_at` is excluded from the hash but present in the file, every artifact has two byte sequences:

| Sequence | Contains `generated_at` | Used For |
|---|---|---|
| **Written bytes** | yes | The file on disk and the published artifact |
| **Canonical bytes** | no | The content hash, hash-gating, and change detection |

| ID | Requirement |
|---|---|
| TR-HASH-033 | Both sequences MUST be produced deterministically from the same source object, with stable key ordering. |
| TR-HASH-034 | A unit test MUST assert that two projections differing **only** in `generated_at` produce identical content hashes. |
| TR-HASH-035 | A unit test MUST assert that two projections differing in **any** other field produce different content hashes. |

**TR-HASH-034 and TR-HASH-035 are a matched pair.** The first proves the exclusion works; the second proves it is not over-broad. Implementing only the first permits a defect where the hash is computed over almost nothing and every change is invisible.

## 54.4 Content Addressing

| Mechanism | Detail |
|---|---|
| Every artifact carries a `content_hash` | Computed over canonical bytes |
| The manifest references artifacts with their hash | `{ path, bytes, content_hash }` |
| Consumers wanting guaranteed freshness | Request `reviews.json?v=<content_hash>` — a distinct cache key that changes only when the content changes |
| Consumers wanting simplicity | Request `reviews.json` and accept the TTL |
| `previous_content_hash` in the manifest | Enables a consumer to detect change **without downloading the payload** |

**This gives both audiences what they need without any cache-purge API** — which matters because the zero-cost hosting options do not offer programmatic purging.

## 54.5 Change Detection Failure Modes

| Failure | Symptom | Detection | Cause |
|---|---|---|---|
| Hash includes a volatile field | Every run writes every file | `MET-commit-churn` > 30/week | `generated_at` or `relative_date` in the hash input |
| Hash excludes too much | Real changes never publish | Payload age rises; `MET-payload-age` alert | Over-broad exclusion |
| Unstable key ordering | Every run writes every file | `MET-commit-churn` | Insertion-order serialisation |
| Line-ending drift | Every run writes every file | `MET-commit-churn` | Missing `.gitattributes` LF enforcement |
| Non-deterministic collapse rule | Intermittent rewrites | Intermittent churn | Iteration-order-dependent duplicate collapse (§22.4) |

**Every row in that table produces the same symptom — commit churn — which is why a single metric catches all five.** That is the value of having one observable that the whole change-detection design converges on.

---

*End of Part 9. Part 10 specifies caching, locking, concurrency, race-condition prevention, failure recovery, and disaster recovery.*
