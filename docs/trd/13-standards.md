# Part 13 — Code, Naming, and File Standards

*Sections 67 through 69. Audience: every engineer and every AI coding agent. These standards exist to keep the codebase maintainable by one person in three years. Most are enforced by lint; the ones that are not are enforced in review.*

---

# 67. Code Standards

## 67.1 Language and Module Standards

| Standard | Rule |
|---|---|
| Module system | **ESM only. `.mjs` extension. No CommonJS anywhere** |
| Typing | JavaScript with JSDoc annotations, `checkJs` enabled, strict. **No build step** |
| Node APIs | Prefer `node:`-prefixed built-ins explicitly |
| Async | **`async`/`await` only.** No raw promise chains, no callbacks |
| Errors in `core/` | `Result` values, **never thrown exceptions** |
| Errors at boundaries | Throw classified errors; converted to outcomes at exactly one place |
| Immutability | Domain objects frozen after construction. **Reconciliation returns new objects; it never mutates its inputs** |
| Global state | **None. No module-level mutable variables. Ever.** Config and dependencies are passed in |
| Determinism in `core/` | No clock, no randomness, no environment |

| ID | Requirement |
|---|---|
| TR-STD-030 | Module-level mutable state MUST NOT exist anywhere in the codebase. It is the mechanism by which a pure module silently becomes impure and by which test isolation silently breaks. |
| TR-STD-031 | `core/` MUST return `Result` values. A thrown exception inside `core/` is a defect regardless of what it says. |

## 67.2 Structural Limits (Enforced by Lint)

| Limit | Value | Rationale |
|---|---|---|
| Cyclomatic complexity per function | **≤ 10** | A function above this cannot be reasoned about during an incident |
| Function length | **≤ 60 lines** | Reviewability |
| File length | **≤ 400 lines** | A file longer than this has more than one responsibility |
| Function parameters | **≤ 4**, or a single options object | Call sites stay readable |
| Nesting depth | **≤ 3** | Deep nesting in extraction code is where bugs hide |
| Module exports | Prefer named; **no default exports** | Refactorability and greppability |

| ID | Requirement |
|---|---|
| TR-STD-040 | These limits MUST be enforced by lint, not by review. A limit enforced by review is a limit that is negotiated away under deadline pressure. |
| TR-STD-041 | A justified exception MUST carry an inline comment stating why, and MUST be approved by a reviewer. |

## 67.3 Prohibited Patterns

| Prohibited | Reason |
|---|---|
| `any` in JSDoc without a written justification comment | Defeats the type checking that replaces a compiler |
| Empty catch blocks | Discards the only evidence of the failure |
| **Catch-and-return-empty-array** | **The path to a wiped payload** |
| `console.*` outside `infra/logger/` and `cli/` | Bypasses redaction |
| `process.exit()` outside `cli/` | Skips log flush, manifest write, and diagnostics upload |
| `Date.now()` / `Math.random()` in `core/` | Breaks purity and makes every property test meaningless |
| Dynamic `import()` of a path built from input | Injection vector |
| HTML-injection DOM APIs in `frontend/` | INV-05 |
| String concatenation to build selectors from input | Injection vector |
| Interpolating untrusted content into log format strings, shell commands, or workflow expressions | Injection vector |
| Magic numbers | Timings and thresholds belong in config with named defaults |
| Commented-out code | Version control exists |
| `TODO` without an issue reference | Becomes permanent otherwise |

| ID | Requirement |
|---|---|
| TR-STD-050 | Catch-and-return-empty-collection MUST be rejected in review and flagged by lint where detectable. This single pattern converts a failure into apparent success with zero reviews, which is exactly how a review widget silently wipes a client's reviews. |

**Agent Note.** Several of these are idioms a code generator produces by default: `Date.now()` as a default parameter, a broad `catch` returning `[]`, a default export, a magic timeout literal. Each is prohibited here for a stated reason, and each will pass a superficial test suite while breaking something this system depends on.

## 67.4 Purity Rules

| Rule | Applies To | Enforcement |
|---|---|---|
| No I/O | `core/` | DR-1 architecture test |
| No clock | `core/` | DR-2 architecture test |
| No randomness | `core/` | DR-2 |
| No environment access | `core/` | DR-2 |
| No mutation of inputs | `core/` | Review + property tests |
| Deterministic output | `core/` | PT-12 |

| ID | Requirement |
|---|---|
| TR-STD-060 | `now` MUST be an explicit parameter to any function that needs the current time. A default parameter value of `Date.now()` is the most common way DR-2 is violated and looks entirely idiomatic. |

## 67.5 Documentation Standards

| Element | Requirement |
|---|---|
| Every exported function | JSDoc: purpose, `@param`, `@returns`, `@throws` if it throws, and a `@see` reference to the relevant SAD or TRD section |
| Every module | A header comment stating its responsibility **and what it explicitly does not do** |
| Every non-obvious decision in code | An inline comment stating **why**, not what |
| Every error class | Documented in the taxonomy table — a class not in the table is a defect |
| Every config key | Documented in §8 and in the schema's `description` |
| Every selector strategy | A `notes` field in the pack explaining what it targets and why it is ranked where it is |

**On the last row:** six months after a pack is written, nobody remembers why strategy 2 exists. The `notes` field is what makes a pack maintainable rather than archaeological.

**On the "what it does not do" clause:** the responsibility matrix in §4.1 is only enforceable if each module states its own boundary. A module header that lists only what the module does provides no defence against scope creep.

## 67.6 Code Review Standards

Reviewers check, in this order:

| # | Check |
|---|---|
| 1 | **Does this preserve the ten invariants?** Especially INV-02, INV-03, INV-05 |
| 2 | Does it respect the dependency rules? Is anything impure creeping into `core/`? |
| 3 | Is every new error classified and in the taxonomy? |
| 4 | Is every new timing, threshold, or limit configurable with a named default? |
| 5 | Would the change be diagnosable from artifacts alone if it failed in production? |
| 6 | Is there a test that would have caught the bug being fixed? |
| 7 | Is documentation or an ADR/EDR updated? |
| 8 | Could untrusted content reach a shell, a log format string, a workflow expression, or a client DOM? |
| 9 | **Is this client-specific in any way?** A conditional on a client slug is a defect |
| 10 | Is it simpler than what it replaces? If not, is the added complexity justified in writing? |

**Check 1 is first because it is the only one whose failure is unrecoverable.** A performance regression is annoying; an INV-03 violation deletes a client's reviews.

## 67.7 Testing Standards

| Standard | Rule |
|---|---|
| Naming | `<subject>.<behaviour>.test.mjs` |
| Structure | Arrange–Act–Assert, visually separated |
| Test names | Full sentences describing behaviour |
| Shared mutable state | **None between tests** |
| Builders over literals | A schema change breaks one builder, not 200 tests |
| Determinism | Fixed clock and seeded random in **every** test |
| Network | None in default suites |
| Assertions | One logical assertion per test |
| Invariant reference | Chaos and property tests name their invariant in a comment |

---

# 68. Naming Standards

## 68.1 Code Naming

| Element | Convention | Example |
|---|---|---|
| Files | kebab-case, `.mjs` | `identity-hash.mjs` |
| Directories | kebab-case, singular unless a collection | `adapters/acquisition/google-dom/` |
| Functions | camelCase, **verb-first** | `resolveListing`, `computeIdentityHash` |
| Predicates | `is`/`has`/`can` prefix | `isTombstoned`, `hasOwnerReply` |
| Pure transformers | `to`/`from` prefix | `toNormalizedReview`, `fromLedgerRecord` |
| Constructors / builders | `create`/`build` prefix | `createLedger`, `buildPayload` |
| Types (JSDoc) | PascalCase | `NormalizedReview`, `AcquisitionReport` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_REVIEWS_CEILING` |
| Error classes | `ERR-<DOMAIN>-<SPECIFIC>` | `ERR-PARSE-STRUCTURE` |
| Log events | dot.notation, noun.verb | `nav.pagination.stalled` |
| Metric ids | `MET-kebab-case` | `MET-harvest-yield` |
| Config keys | **snake_case in JSON, camelCase in code** | `max_count_drop_ratio` ↔ `maxCountDropRatio` |
| Environment variables | `TPRE_<AREA>_<KEY>` | `TPRE_BUDGET_TARGET_MS` |
| Test files | `<subject>.<behaviour>.test.mjs` | `reconcile.idempotence.test.mjs` |

| ID | Requirement |
|---|---|
| TR-STD-070 | The JSON↔code case mapping MUST happen in exactly one place — the config loader — and MUST be tested. Scattered ad-hoc conversion produces keys that work in some paths and silently fail in others. |

**On the case split:** JSON uses `snake_case` because that is the convention in the schema and data ecosystem and it reads better in a hand-edited file. Code uses `camelCase` because that is JavaScript. Fighting either convention costs more than the single mapping point.

## 68.2 Domain Vocabulary Discipline

**The same concept must have exactly one name everywhere:** in code, in logs, in this document, and in conversation.

| Preferred | Never Use | Why |
|---|---|---|
| **harvest** | scrape, crawl, fetch-run, sync | One name for the unit of work, in logs, metrics, and speech |
| **listing** | place, location, business, profile | "Place" and "profile" are source-specific; the domain term must not be |
| **payload** | output, feed, file, export | Distinguishes the public artifact from everything else |
| **ledger** | database, store, cache, state file | Names the specific concept |
| **reconcile** | merge, sync, update, diff | One name for the operation with laws attached |
| **tombstone** | deleted, removed, archived | Precise: retained-but-not-published |
| **suppress** | hide, filter, block | Reserved specifically for compliance removal |
| **adapter** | driver, provider, connector, plugin | Matches the architectural pattern |
| **target** | job, task, item, client-run | The (client × listing) unit |
| **completeness** | quality, confidence, health | Reserved for the `full`/`partial`/`failed` classification |
| **coverage** | completeness, ratio | Reserved for extracted ÷ advertised |
| **gate** | check, validation, guard | Reserved for the Publish Gate specifically |
| **canary** | monitor, healthcheck, probe | Reserved for the reference-listing harvest |
| **selector pack** | selectors, config, rules | Names the versioned artifact |

**Why this table earns its place in a technical requirements document.** Vocabulary drift is how systems become incomprehensible. When "coverage" and "completeness" are used interchangeably in code and logs, the Publish Gate's rules stop being readable, and the next engineer cannot tell whether a comparison means the ratio or the classification. **One name per concept, enforced in review, is cheap discipline with compounding returns.**

| ID | Requirement |
|---|---|
| TR-STD-080 | `coverage` and `completeness` MUST NOT be used interchangeably. `coverage` is a number in [0,1]; `completeness` is an enum. Confusing them in the gate rules would be a correctness defect, not a style issue. |

## 68.3 Identifier Naming

| Family | Format | Assigned By |
|---|---|---|
| Technical requirement | `TR-<AREA>-<nnn>` | This document |
| Engineering decision | `EDR-<nnn>` | This document |
| Interface contract | `IF-<SUBJECT>-<nn>` | This document |
| Algorithm | `ALG-<NAME>` | This document |
| Architecture decision | `ADR-<nnn>` | The SAD |
| Invariant | `INV-<nn>` | The SAD |
| Error class | `ERR-<DOMAIN>-<SPECIFIC>` | `core/model/errors.mjs` |
| Metric | `MET-<kebab-case>` | The SAD |
| Gate rule | `G-<nn>` | The SAD |
| Property law | `PT-<nn>` | The SAD |
| Chaos scenario | `CH-<nn>` | The SAD |
| Dependency rule | `DR-<n>` | The SAD |
| Config validation rule | `V-<n>` | The SAD |

| ID | Requirement |
|---|---|
| TR-STD-081 | Identifiers MUST NOT be reused or renumbered once published. A retired identifier is marked retired; its number is never reassigned. |

---

# 69. File Naming Standards

## 69.1 Source and Test Files

| Element | Rule | Example |
|---|---|---|
| Source file | kebab-case, `.mjs` | `content-hash.mjs` |
| Test file | `<subject>.<behaviour>.test.mjs` | `gate.count-drop.test.mjs` |
| Test helper | kebab-case, `.mjs` | `fixed-clock.mjs` |
| Package index | `index.mjs` | — |
| Executable entry | `tpre.mjs` | — |

| ID | Requirement |
|---|---|
| TR-STD-090 | Test files MUST mirror the module they test file-for-file under `tests/unit/`. A test whose location does not indicate its subject is a test nobody finds. |

## 69.2 Data and Artifact Files

| Element | Rule | Example |
|---|---|---|
| Client slug | Lowercase kebab, ASCII, ≤ 40 chars, **immutable after first publish** | `commerce-insight` |
| Client config | `<slug>.config.json` | `commerce-insight.config.json` |
| Template / example config | `_`-prefixed, **excluded from the registry** | `_template.config.json` |
| Listing key | Lowercase kebab, **immutable after first publish** | `main`, `indore-central` |
| Payload artifacts | Fixed names | `reviews.json`, `latest.json`, `stats.json`, `index.json` |
| Sharded payloads | `reviews.page-<n>.json` | `reviews.page-2.json` |
| Selector packs | `v<integer>.json`, monotonic, **immutable once merged** | `v3.json` |
| Schemas | `<name>.v<major>.schema.json` | `payload.v1.schema.json` |
| Fixtures | `<nnn>-<kebab-description>/` | `014-partial-load-stalled/` |
| Run ids | `<yyyymmdd>T<hhmmss>Z-<short-random>` | `20260730T060112Z-a91f` |
| Alert fingerprints | `[tpre:<severity>:<condition>:<scope>]` | `[tpre:high:selector-drift:google-maps/v3]` |
| Runbooks | `<condition>.md` | `bot-challenge.md` |
| Authorisation records | `<slug>.md` | `commerce-insight.md` |

## 69.3 The Immutability Rule

| ID | Requirement |
|---|---|
| TR-STD-100 | Client slugs and listing keys MUST NEVER be changed after first publication. They are part of the public payload URL and part of the Ledger's primary key. |
| TR-STD-101 | A rename MUST be treated as a migration, not an edit. |
| TR-STD-102 | Selector pack files MUST NEVER be edited after merge. A change creates a new version file. |

**Choose keys carefully at onboarding, and prefer a neutral key over a descriptive one that might become wrong.** `main` survives an office move; `indore-office` does not.

## 69.4 Path Structure

| Store | Template |
|---|---|
| Payload | `data:/clients/<slug>/<listing-key>/<artifact>.json` |
| Client manifest | `data:/clients/<slug>/index.json` |
| Global manifest | `data:/index.json` |
| Ledger | `state:/ledger/<slug>/<listing-key>.json` |
| Health | `state:/health/<slug>.jsonl` |
| Identity cache | `state:/cache/identity/<slug>/<listing-key>.json` |
| Rate budget | `state:/cache/budget/<source>/<yyyy-mm-dd>.json` |
| Breaker | `state:/breaker/<source-access>.json` |
| Run manifest | `state:/runs/<yyyy-mm>/<run-id>.json` |
| Diagnostics | `<artifact-dir>/diagnostics/<slug>/<listing-key>/` |

| ID | Requirement |
|---|---|
| TR-STD-110 | Path templates MUST be constructed in exactly one module per store, never assembled ad hoc at call sites. A path built two different ways will eventually be built two different ways. |

## 69.5 File Encoding and Format

| Property | Rule |
|---|---|
| Encoding | **UTF-8, no BOM** |
| Line endings | **LF**, enforced by `.gitattributes` |
| Final newline | Required on all text files |
| Payload JSON | Minified, stable key order |
| Ledger JSON | Pretty-printed, stable key order, trailing newline |
| Config JSON | Pretty-printed, stable key order |
| Log/health files | JSONL, one object per line |

| ID | Requirement |
|---|---|
| TR-STD-120 | LF enforcement is **not** a style preference. A CRLF line ending in a payload changes its bytes and therefore its content hash, silently breaking hash-gating on Windows checkouts and multiplying commit churn by roughly fifty. |

---

*End of Part 13. Part 14 specifies the future API contracts, multi-client configuration, business configuration, feature flags, and the plugin and adapter architectures.*
