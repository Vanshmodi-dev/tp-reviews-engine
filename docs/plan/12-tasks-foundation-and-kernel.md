# Part 12 — Task Breakdown: Foundation and Pure Kernel

*Tasks T-001 through T-126. Phases PH-00 through PH-06. Milestones MS-0, MS-1, MS-2. Sprints SP-0, SP-1, SP-2. Weeks 1–5.*

---

## How to Read a Task Row

| Column | Meaning |
|---|---|
| **ID** | `T-nnn`, stable and never reused. Branch name is `t/<nnn>-<slug>` |
| **Task** | The imperative name |
| **Description** | What is built, with the governing TRD section |
| **Deps** | Task IDs that must be merged first. `—` means none beyond the phase entry |
| **D** | Difficulty D1–D5 (§0.4.3) |
| **P** | Priority P0–P3 (§0.4.4) |
| **Est** | Ideal engineer-hours, agent multiplier applied |
| **Output** | The artifact(s) merged |
| **Acceptance** | What makes it correct |
| **Verify** | How a second person confirms it |
| **Rollback** | How to undo it |

**Every task also carries the eight universal Definition-of-Done conditions in §2.3.** They are not repeated per row.

**Reserved ID blocks for discovered work:** PH-00 → T-901…T-910 · PH-01…PH-06 → T-911…T-930. Adding a task inside an existing phase uses these and needs no PCR (§0.9.2).

---

# PH-00 · Repository, Toolchain, and CI

**Sprint SP-0 · Week 1 · 62 IEH · 46 tasks · Milestone MS-0 · Gate DG-01**

Six concurrent streams: repository (T-001…T-012), Git config (T-013…T-018), tree (T-019…T-022), toolchain (T-023…T-036), tests (T-037…T-043), CI (T-044…T-046). Streams A and B are DevOps; C–F absorb agents well.

## WP-01 · Repository Creation and Governance

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-001 | Create repository | Create `tp-reviews-engine`, public per OPQ-04, no auto-README (§11.1) | — | D1 | P0 | 0.5 | Repository | Exists, public, Actions available | Repo URL loads | Delete repo |
| T-002 | Commit `.gitattributes` first | `* text=auto eol=lf` plus binary declarations, as commit #1 (TR-BLD-002, INIT-01) | T-001 | D1 | P0 | 0.5 | `.gitattributes` | LF enforced repository-wide | `git ls-files --eol` on two OSes | Revert + `git add --renormalize` |
| T-003 | Commit `.gitignore` | Exclude `.state/`, `.publish/`, `.artifacts/`, `node_modules/`, `.env`, browser cache (TR-BLD-003) | T-002 | D1 | P0 | 0.5 | `.gitignore` | No artifact path is ever stageable | `git status` after a dry run | Revert |
| T-004 | Commit `.editorconfig` and `.nvmrc` | LF/UTF-8/final newline; Node major pin (TR-BLD-004) | T-002 | D1 | P0 | 0.5 | Two files | `.nvmrc` matches CI | `nvm use` succeeds | Revert |
| T-005 | Root documentation set | `README.md`, `LICENSE`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `CHANGELOG.md` | T-002 | D1 | P1 | 2 | Six files | CONTRIBUTING points at TRD §67–§69; CHANGELOG has `## Unreleased` | Reviewer reads each | Revert |
| T-006 | `package.json` skeleton | `"type": "module"`, `engines.node`, all fourteen script names from §15.3 | T-004 | D2 | P0 | 1.5 | `package.json` | Script names final; unimplemented ones exit 0 with a notice | `npm run <each>` | Revert |
| T-007 | Enable branch protection on `main` | Review required, CI required, no force-push, linear history — **before commit #2** (§11.1 step 5) | T-005 | D1 | P0 | 0.5 | Settings | Direct push rejected for everyone | Attempt a direct push | Disable |
| T-008 | Set Actions default token to read-only | Repository settings; workflows declare their own (TR-CI-001) | T-001 | D1 | P0 | 0.25 | Settings | Default is read | Settings export | Revert setting |
| T-009 | `CODEOWNERS` | Require review for `src/core/`, `schemas/`, `selectors/`, `compliance/` (TR-CI-005) | T-007 | D1 | P0 | 0.5 | `.github/CODEOWNERS` | A PR touching `src/core/` requests the owner | Throwaway PR | Revert |
| T-010 | Issue and PR templates | `incident.yml`, `selector-break.yml`, `client-onboarding.yml`, `pull_request_template.md` with the regression question | T-001 | D1 | P1 | 1.5 | Four files | PR template asks "which test would have caught this?" | Open a draft PR | Revert |
| T-011 | Enable secret scanning + push protection | Repository security settings | T-001 | D1 | P0 | 0.25 | Settings | A test secret push is blocked | Attempt with a dummy token | Disable |
| T-012 | Create the offsite mirror | `git clone --mirror` to a second account/host (TR-CI-161) | T-007 | D1 | P0 | 1 | Mirror + `docs/runbooks/` note | Clone **from** the mirror succeeds | Clone from mirror | Delete mirror |

## WP-02 · Git Configuration and Branches

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-013 | Commit convention + `commit-msg` spec | Conventional Commits with the scope/footer rules (§12.2) | T-005 | D1 | P1 | 1 | `CONTRIBUTING.md` section | Format documented with examples | Reviewer reads | Revert |
| T-014 | Branch naming convention | `t/<task-id>-<slug>` and the rest of §12.3 | T-005 | D1 | P2 | 0.5 | Doc section | Task-to-commit mapping is automatic | Reviewer reads | Revert |
| T-015 | Create `data` orphan branch | `git switch --orphan`; `.nojekyll`, `robots.txt`, `_headers`, `README.md`, empty `index.json` (BR-01…BR-03) | T-007 | D2 | P0 | 1 | `data` branch | `git merge-base main data` **fails** | Run the merge-base check | Delete branch |
| T-016 | Create `state` orphan branch | Directory placeholders + machine-owned README (TR-GIT-001/002) | T-007 | D2 | P0 | 0.75 | `state` branch | Same merge-base check fails | Run the check | Delete branch |
| T-017 | Enable Pages from `data` root | Configure Pages; serve a `ping.txt` test file | T-015 | D2 | P0 | 1 | Pages config | Test file served over HTTPS | Fetch the URL | Disable Pages |
| T-018 | **Measure and record Pages headers** | Capture literal response headers into `docs/runbooks/pages-headers.md` (TR-CI-160, OIQ-04) | T-017 | D2 | P0 | 1 | Runbook file | Dated header dump present | Independent fetch + compare | Revert file |

## WP-03 · Folder Tree

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-019 | Create the complete `src/` tree | Every directory from TRD §6.4, with `.gitkeep` (FLD-01) | T-003 | D1 | P0 | 1 | Directories | Tree matches TRD §6.4 exactly | Diff tree vs TRD | Delete |
| T-020 | Create data-as-code and test trees | `selectors/`, `schemas/`, `clients/`, `profiles/`, `compliance/`, `fixtures/`, `tests/` per TRD §6.5–§6.7 | T-003 | D1 | P0 | 1 | Directories | Matches TRD §6 | Diff tree | Delete |
| T-021 | Create consumer, script, and docs trees | `frontend/`, `scripts/`, `docs/{runbooks,decisions}/` per TRD §6.8 | T-003 | D1 | P1 | 0.5 | Directories | Matches TRD §6 | Diff tree | Delete |
| T-022 | Nine directory-rule READMEs | One paragraph per governed directory (FLD-02): `core/`, `infra/`, `ports/`, `adapters/`, `selectors/`, `compliance/`, `tests/live/`, `frontend/renderer/`, `fixtures/` | T-019, T-020, T-021 | D2 | P1 | 3 | Nine READMEs | Each states its rule and its rationale | Reviewer reads all nine | Revert |

## WP-04 · Toolchain

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-023 | Install and configure the type checker | `jsconfig.json` with every strict option from §18.1 including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` | T-006 | D2 | P0 | 2 | `jsconfig.json`, dev dep | `npm run typecheck` exits 0 on the empty tree | Run it | Revert |
| T-024 | Prove four strict options fire | Four throwaway branches, one deliberate violation each (LINT-02 analogue) | T-023 | D2 | P0 | 1.5 | Four branch records | Each violation fails the check | Reviewer re-runs two | N/A |
| T-025 | Node version consistency test | Unit test asserting `.nvmrc` matches `engines.node` (NODE-01) | T-023 | D2 | P1 | 1 | Test file | Mismatch fails | Deliberately mismatch | Revert |
| T-026 | Install ESLint + config skeleton | `eslint.config.mjs` with the base rule set | T-006 | D2 | P0 | 1.5 | Config, dev deps | `npm run lint` exits 0 | Run it | Revert |
| T-027 | Structural limit rules | Complexity ≤ 10, function ≤ 60, file ≤ 400, params ≤ 4, nesting ≤ 3, no default exports (§67.2) | T-026 | D2 | P0 | 2 | Rule block | Each limit configured | Deliberate violation | Revert |
| T-028 | Prohibited pattern rules | Empty catch, `console.*`, `process.exit()`, commented code, bare `TODO`, magic numbers (§67.3) | T-026 | D3 | P0 | 2.5 | Rule block | Each pattern flagged | Deliberate violations | Revert |
| T-029 | **`core/` purity rules** | No imports from `adapters/`/`infra/`/`app/`/`cli/`; no `node:` except `node:crypto`; no `Date.now`/`Math.random`/`process.env`/`fs`/`fetch` (DR-1, DR-2) | T-026 | D3 | P0 | 2.5 | Override block | Violations rejected in `src/core/**` only | Place a violation in `core/` and in `infra/`; only the first fails | Revert |
| T-030 | Layering rules | `app/` ⇏ adapters; adapters ⇏ adapters; composition-root-only construction; no import past an index (DR-3…DR-6) | T-026 | D3 | P0 | 2 | Override block | Each rule fires | Deliberate violations | Revert |
| T-031 | Scope exception overrides | `console.*` in `infra/logger/` + `cli/`; `process.exit()` in `cli/`; relaxed file length in `tests/` | T-028 | D2 | P0 | 1 | Overrides | Permitted paths pass, others fail | Two-file test | Revert |
| T-032 | Frontend rules | No HTML-injection DOM APIs; no imports (TR-STD-001/002) | T-026 | D2 | P1 | 1 | Override block | A deliberate injection API fails | Violation branch | Revert |
| T-033 | Prove nine lint rule groups fire | Nine throwaway branches, one per group (LINT-02) | T-027…T-032 | D2 | P0 | 2 | Nine branch records | Each group demonstrably rejects | Reviewer re-runs two at random | N/A |
| T-034 | Install and configure Prettier | `prettier.config.mjs` with `endOfLine: "lf"` (FMT-02) | T-006 | D1 | P0 | 1 | Config, dev dep | `format:check` exits 0 | Run it | Revert |
| T-035 | `.prettierignore` with fixture exclusions | Exclude `fixtures/**/page.html` and `**/expected.json` (FMT-01) | T-034 | D2 | P0 | 0.5 | `.prettierignore` | `npm run format` yields zero fixture changes | Run format, check `git status` | Revert |
| T-036 | Editor configuration | `.vscode/extensions.json` and `settings.json` (recommended, not required) | T-034 | D1 | P2 | 0.5 | Two files | Format-on-save works | Open the repo in the editor | Revert |

## WP-05 · Test Framework

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-037 | Install Vitest; configure projects | `default` and `live` projects; **`tests/live/**` excluded from default** (TR-TEST-021) | T-006 | D3 | P0 | 2.5 | `vitest.config.mjs` | `npm test` runs; `test:live` separate | Run both | Revert |
| T-038 | **Prove the live exclusion** | Add a deliberately failing test in `tests/live/`; confirm `npm test` stays green (IR-18) | T-037 | D2 | P0 | 0.75 | Proof record | Default suite unaffected | Reviewer runs `npm test` | Delete the test |
| T-039 | Per-path coverage thresholds | All eleven paths from §21.2, including paths that do not yet exist (TEST-CFG-01/02) | T-037 | D3 | P0 | 2 | Coverage config | 100% configured for gate and redact | Config diff | Revert |
| T-040 | Install fast-check; prove 1,000 cases | Property harness with a deliberately false property reporting a minimal counterexample | T-037 | D2 | P0 | 1.5 | Dev dep + proof test | Counterexample minimised | Reviewer runs it | Revert |
| T-041 | Determinism helpers | `tests/helpers/fixed-clock.mjs`, `seeded-random.mjs` (TR-TEST-032) | T-037 | D2 | P0 | 2 | Two helpers | Deterministic across runs | Run twice, compare | Revert |
| T-042 | Builder helpers | `build-review.mjs`, `build-ledger.mjs`, `temp-repo.mjs` (TR-TEST-033) | T-041 | D2 | P0 | 2.5 | Three helpers | Overrides work; defaults valid | Unit test each | Revert |
| T-043 | Trivial passing test + suite timing | One assertion; print suite duration in CI (TEST-CFG-03) | T-037 | D1 | P0 | 0.75 | Test + CI step | `npm test` green in < 5 s; timing printed | Read CI log | Delete in PH-01 |

## WP-06 · CI and Hooks

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-044 | `ci.yml` with all 14 gate groups | Setup, lint, format, typecheck, test, architecture, integration, security, size, schemas, workflow lint, secret scan, audit, coverage (TRD §62.3) | T-033, T-039, T-043 | D3 | P0 | 4 | `.github/workflows/ci.yml` | Green on a no-op PR in < 5 min; every group blocking | Open PR #1 | Revert |
| T-045 | **Prove six CI gate groups reject** | Six throwaway branches, one deliberate failure each (§PH-00 criterion 17) | T-044 | D2 | P0 | 2 | Six branch records | Each group demonstrably fails the build | Reviewer re-runs two | N/A |
| T-046 | Git hooks | `pre-commit` (< 3 s), `commit-msg` (< 0.2 s), `pre-push` (< 45 s); idempotent installer (HOOK-01…HOOK-04) | T-026, T-034, T-037 | D2 | P1 | 3 | Hook scripts + installer | Budgets met; CI re-runs everything hooks run | Time each hook | Delete hooks dir |

**PH-00 totals: 46 tasks · 62 IEH · closes MS-0 at DG-01.**

---

# PH-01 · Core Model, Result, Hash, Error Taxonomy

**Sprint SP-1 · Week 2 · 34 IEH · 14 tasks · Difficulty D2**

The vocabulary phase. Everything downstream imports from here, which is why it is small, mechanical, and first.

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-047 | `core/util/result.mjs` | `Result` discriminated union + combinators (EDR-002) | T-044 | D2 | P0 | 3 | Module + tests | Every combinator unit-tested; `core/` never throws | Reviewer reads the contract table | Revert |
| T-048 | `core/util/hash.mjs` canonical serialisation | Stable key order, no insignificant whitespace | T-047 | D3 | P0 | 3 | Module + tests | Same object, different insertion order ⇒ identical bytes | Reviewer constructs two orderings | Revert |
| T-049 | `core/util/hash.mjs` digest helpers | SHA-256 over canonical bytes, `node:crypto` only | T-048 | D2 | P0 | 1.5 | Functions + tests | Known-vector test passes | Compare to a reference digest | Revert |
| T-050 | **`core/model/errors.mjs` taxonomy** | Every `ERR-*` from SAD Appendix B with scope, severity, retry policy, runbook (ERR-01) | T-047 | D2 | P0 | 4 | Constants module | All 50 classes present with all four attributes | Reviewer diffs against Appendix B row by row | Revert |
| T-051 | Taxonomy completeness test | Programmatic assertion that the constant set matches the documented set and no attribute is missing (ERR-02) | T-050 | D2 | P0 | 2 | Test | Missing attribute fails | Delete one attribute; test fails | Revert |
| T-052 | `core/model/review.mjs` | `ExtractedReview`, `NormalizedReview`, `LedgerReview`, `PayloadReview`, `CleanString` brand | T-047 | D3 | P0 | 3 | Types module | Brand prevents unnormalised text reaching a payload type | Type-check a deliberate misuse | Revert |
| T-053 | `core/model/ledger.mjs` | Ledger shape, constructors, invariant helpers — **the shape PH-05 depends on** | T-052 | D3 | P0 | 3.5 | Module + tests | Map-backed records (IR-24); shape final | Architect reviews the shape against TRD §22 | Revert (expensive after PH-05) |
| T-054 | `core/model/payload.mjs` | Public payload shape per `schema_version: 1` | T-052 | D2 | P0 | 2.5 | Module | Matches `payload.v1.schema.json` field for field | Cross-check against the schema | Revert |
| T-055 | `core/model/report.mjs` | `AcquisitionReport`, `ValidationReport`, `DecisionLog`, `GateVerdict` | T-052 | D2 | P0 | 2 | Module | All four shapes present | Type-check | Revert |
| T-056 | `core/model/capabilities.mjs` | Adapter capability descriptor (FR-020) | T-052 | D2 | P1 | 1.5 | Module | Supports honest declaration of unsupported fields | Reviewer reads | Revert |
| T-057 | `core/index.mjs` public surface | The core's only entry point (DR-6) | T-052…T-056 | D2 | P0 | 1 | Module | Nothing outside imports past it | Architecture test | Revert |
| T-058 | Architecture test skeleton: DR-1, DR-2 | Import-graph assertions for `core/` purity, active from this phase | T-057 | D3 | P0 | 4 | `tests/architecture/` | A deliberate `Date.now()` in `core/` fails | Add and remove a violation | Revert |
| T-059 | Architecture test: acyclicity in `core/` | TR-TEST-070 | T-058 | D3 | P1 | 2 | Test | A deliberate cycle fails | Create a cycle | Revert |
| T-060 | Delete the trivial test | Remove T-043's placeholder now that real tests exist | T-047 | D1 | P2 | 0.25 | Deletion | Suite still green | CI | Restore |

**PH-01 totals: 14 tasks · 34 IEH.**

---

# PH-02 · Normalizer — The Security Boundary

**Sprint SP-1 · Weeks 2–3 · 40 IEH · 12 tasks · Difficulty D4 · Lead implementer, two reviewers**

**Sequencing Note.** Tasks T-061 and T-062 are the property laws, written **as failing tests before any implementation** (ID-13). No implementation task in this phase may start before both are merged and red.

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-061 | **PT-10 written first (failing)** | Output has no markup, no control characters, within the length bound, for all generated inputs (INV-05) | T-057 | D4 | P0 | 4 | `tests/property/normalize.invariants.test.mjs` | Fails against a no-op implementation | Reviewer confirms it is red | N/A |
| T-062 | **PT-11 written first (failing)** | `normalize(normalize(x)) ≡ normalize(x)` | T-061 | D4 | P0 | 2 | Property test | Fails against a non-idempotent stub | Reviewer confirms red | N/A |
| T-063 | Adversarial corpus construction | The eight case classes in §37.3 as named unit tests | T-061 | D4 | P0 | 6 | ~60 unit tests | Every class represented; each names what it probes | QA reviews the corpus for gaps | Revert |
| T-064 | Step 1–2: entity decode then markup **removal** | Decode entities, then remove markup entirely — never escape (NORM-02) | T-063 | D4 | P0 | 5 | `core/normalize/markup.mjs` | Nested and double-encoded forms removed | Reviewer constructs 5 adversarial strings blind | Revert |
| T-065 | Step 3–5: Unicode NFC, control, zero-width, bidi | NFC normalisation then stripping of controls, ZW, and bidi overrides | T-064 | D4 | P0 | 5 | `core/normalize/unicode.mjs` | Bidi overrides never survive | Adversarial subset | Revert |
| T-066 | Step 6–7: newline canonicalisation, run collapse | LF canonical; whitespace runs collapsed | T-065 | D3 | P0 | 2.5 | `core/normalize/whitespace.mjs` | Deterministic; no trailing whitespace | Unit tests | Revert |
| T-067 | **Step 8: grapheme-aware length bounding, last** | Bound by grapheme clusters, applied after all other steps (EDR-020, NORM-03, IR-05) | T-066 | D4 | P0 | 4 | Bounding function | ZWJ sequences never split mid-cluster | ZWJ boundary test at exact bound | Revert |
| T-068 | `core/normalize/index.mjs` — the eight-step pipeline | Compose steps in the normative order (NORM-01) | T-064…T-067 | D4 | P0 | 3 | Module | **Order asserted by observing intermediate effects**, not just output | Reviewer reorders two steps; test fails | Revert |
| T-069 | Markup self-check | Post-pipeline assertion producing `ERR-CLEAN-MARKUP-SURVIVED` (critical) (NORM-04) | T-068 | D3 | P0 | 2 | Function + test | Survived markup produces the critical class | Inject markup post-pipeline | Revert |
| T-070 | `core/normalize/url.mjs` | Host-allowlist validation, size-parameter normalisation; off-allowlist ⇒ `null` | T-068 | D3 | P0 | 3 | Module + tests | Never fetches anything; nulls off-allowlist | `security.url-allowlist` test | Revert |
| T-071 | `tests/security/xss-fixture.test.mjs` | Adversarial markup never survives to a payload-shaped value | T-069 | D4 | P0 | 2 | Security test | Green; re-verified against fixture 019 at PH-13 | Reviewer adds a new adversarial string | Revert |
| T-072 | Turn PT-10 and PT-11 green; coverage ≥ 95% | Close the phase against its property laws | T-068…T-071 | D4 | P0 | 1.5 | Green suite | Both laws pass at ≥ 1,000 cases; coverage ≥ 95% | CI + coverage report | N/A — corrected forward |

**PH-02 totals: 12 tasks · 40 IEH. Rollback for this phase is "none available" (§37.6) — defects are corrected forward.**

---

# PH-03 · Dates, Language, Identity

**Sprint SP-1 · Week 3 · 46 IEH · 14 tasks · Difficulty D3**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-073 | Locale phrase table (data) | The six-locale phrase table format from TRD §21.6 — **data, not code** (DATE-03) | T-072 | D2 | P0 | 4 | `core/dates/` data file | Six locales; extending it needs no code change | Add a seventh locale in a scratch branch | Revert |
| T-074 | `core/dates/relative.mjs` | Phrase → duration resolution across the matrix | T-073 | D3 | P0 | 5 | Module | Full matrix green | Locale matrix test | Revert |
| T-075 | **Singular-form handling** | "a day ago", "an hour ago", "yesterday", "last week" per locale (IR-04, DATE-01) | T-074 | D3 | P0 | 3 | Cases + tests | Every locale's singular forms covered | Reviewer checks each locale has singular cases | Revert |
| T-076 | Unparseable phrase handling | Returns `null`, never a guess; fails soft | T-074 | D2 | P0 | 1.5 | Behaviour + tests | No error raised; null propagates | Unit test with nonsense input | Revert |
| T-077 | `core/dates/precision.mjs` | Precision and confidence from phrase granularity | T-074 | D3 | P0 | 3 | Module | "3 months ago" ⇒ low precision, honestly stated | Unit tests | Revert |
| T-078 | **`core/dates/pin.mjs` + PT-06** | Pin on first observation; refuse to recompute (DATE-02) | T-077 | D4 | P0 | 4 | Module + property test | PT-06 green at ≥ 1,000 cases | Reviewer attempts a recompute path; it does not exist | Revert |
| T-079 | `core/lang/detect.mjs` | Script ranges then stopwords; `null` below 12 graphemes | T-072 | D3 | P1 | 4 | Module + tests | Never rejects a review; returns null when unsure | Mixed-language cases | Revert |
| T-080 | `core/util/similarity.mjs` | Normalised string similarity for identity verification and near-duplicates | T-072 | D3 | P0 | 3 | Module + tests | Threshold behaviour documented and tested | Boundary tests | Revert |
| T-081 | `core/identity/author-key.mjs` | Casefold, diacritic strip, punctuation strip, collapse, hash (HASH-04) | T-080 | D4 | P0 | 4 | Module | Diacritics merge; **homoglyphs do not** | Reviewer supplies homoglyph pairs | Revert |
| T-082 | **`core/identity/identity-hash.mjs`** | Six ordered, cross-adapter-available inputs; 32-hex output; **versioned** (HASH-01, HASH-02, EDR-036) | T-081 | D4 | P0 | 5 | Module | No source-specific field used | Architect reviews the input list against TRD §53.3 | **Not rollbackable after first publish** |
| T-083 | `core/identity/content-hash.mjs` | Nine content inputs with explicit exclusions | T-082 | D3 | P0 | 3 | Module | `relative_date` excluded | Reviewer checks the exclusion list | Revert |
| T-084 | **`generated_at` exclusion pair** | TR-HASH-034/035 as a matched pair; two-clock byte-identity test (IR-06, HASH-03) | T-083 | D4 | P0 | 2 | Test | Two runs, different clocks ⇒ identical hashes | Reviewer runs with two clocks | Revert |
| T-085 | **PT-09 hash stability** | Invariant under insignificant formatting and text appends beyond 512 graphemes | T-083 | D4 | P0 | 3 | Property test | Green at ≥ 1,000 cases | CI | Revert |
| T-086 | **PT-08 cross-adapter identity (synthetic)** | Same logical review from two synthetic adapters ⇒ same hash; re-run at PH-11 and PH-22 (§36.2) | T-082 | D4 | P0 | 2.5 | Property test | Green against synthetic pairs | Reviewer inspects the synthetic construction for adapter neutrality | Revert |

**PH-03 totals: 14 tasks · 46 IEH. Closes MS-1 together with PH-04, at DG-02.**

---

# PH-04 · Validation

**Sprint SP-2 · Week 4 · 26 IEH · 10 tasks · Difficulty D3**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-087 | `core/validate/record.mjs` | Per-record findings with severity; **no mutation** (VAL-02) | T-086 | D3 | P0 | 4 | Module + tests | One test per finding type | Mutation-attempt test proves inputs unchanged | Revert |
| T-088 | Coverage computation | extracted ÷ advertised, with boundary handling | T-087 | D3 | P0 | 2.5 | Function | Boundary at `coverage_min` exactly | Three-point boundary test | Revert |
| T-089 | Duplicate findings | Flag intra-run duplicates; do not remove them | T-087 | D3 | P0 | 2 | Function | Findings only; removal is PH-05's job | Reviewer confirms no removal | Revert |
| T-090 | Plausibility and distribution checks | Rating distribution and aggregate plausibility | T-087 | D3 | P1 | 3 | Functions | Produce findings, never errors | Unit tests | Revert |
| T-091 | Quarantine-rate computation | Rate against `quarantine_max` | T-087 | D2 | P0 | 1.5 | Function | Boundary tested | Boundary test | Revert |
| T-092 | **`core/validate/completeness.mjs`** | `full` / `full_capped` / `partial` / `failed` **from the navigator's stop reason** (VAL-01) | T-088 | D4 | P0 | 4 | Module | Never computed from counts alone | Reviewer traces the function's inputs | Revert |
| T-093 | Four-value completeness tests | One distinct scenario producing each value | T-092 | D3 | P0 | 2.5 | Tests | All four reachable | CI | Revert |
| T-094 | `ValidationReport` assembly | Compose findings and aggregates into the report shape | T-087…T-092 | D2 | P0 | 2 | Function | Schema-validated | Schema check | Revert |
| T-095 | Threshold boundary suite | A boundary test at the exact value for every threshold (VAL-03) | T-088, T-091 | D3 | P0 | 3 | ~10 tests | Off-by-one-inclusive impossible | Reviewer picks two thresholds and checks | Revert |
| T-096 | Vocabulary review | Confirm `coverage` and `completeness` are never interchanged in code, tests, or comments (TR-STD-080) | T-092 | D2 | P0 | 1.5 | Review record | Zero interchanges | Reviewer greps both terms | N/A |

**PH-04 totals: 10 tasks · 26 IEH.**

---

# PH-05 · Reconciliation and the Ledger

**Sprint SP-2 · Weeks 4–5 · 46 IEH · 15 tasks · Difficulty D5 · Staff engineer, two reviewers, no agent-led implementation**

**This is the critical-path apex.** Tasks T-097, T-098, and T-099 are property laws written as failing tests before any implementation (ID-13, LEDG-02).

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-097 | **PT-01 written first (failing)** | `reconcile(reconcile(L,H),H) ≡ reconcile(L,H)` for fixed `now` (INV-04) | T-096 | D5 | P0 | 3 | Property test | Red against a stub | Reviewer confirms red | N/A |
| T-098 | **PT-02 written first (failing)** | Shuffling `observed` yields an identical ledger | T-097 | D5 | P0 | 2.5 | Property test | Red against a stub | Reviewer confirms red | N/A |
| T-099 | **PT-07 written first (failing) — the most important test in the project** | For any `partial` harvest, streaks and states are unchanged (INV-03) | T-097 | D5 | P0 | 4 | Property test | Red against a stub; generates `partial` cases | **Architect reviews the generator** to confirm it produces partial harvests | N/A |
| T-100 | `reconcile/decide.mjs` classification | INSERT / UPDATE / UNCHANGED / MISSING | T-099 | D5 | P0 | 5 | Module | One test per branch | Reviewer traces each branch by hand | Revert |
| T-101 | **Streak arithmetic gated on completeness** | `missing_streak` increments **only** when `completeness === 'full'` (LEDG-01) | T-100 | D5 | P0 | 4 | Logic + tests | **PT-07 turns green here** | Reviewer removes the gate; PT-07 must fail | Revert |
| T-102 | Duplicate detection tier 1 | Exact `identity_hash` match across harvests | T-100 | D4 | P0 | 2 | Logic + tests | Repeat observations recognised | Unit tests | Revert |
| T-103 | Duplicate detection tier 2, author-scoped | Similarity ≥ threshold **within an author key only** (DUP-01) | T-102, T-080 | D4 | P0 | 4 | Logic + tests | Twelve identical short reviews from twelve authors ⇒ twelve survive | Reviewer constructs that exact case | Revert (set threshold 1.0) |
| T-104 | Bucketed comparison | Bucket by author key; never all-pairs (DUP-02, IR-15) | T-103 | D4 | P0 | 3 | Implementation | 1,000-review benchmark ≤ 2 s CPU | Benchmark run | Revert |
| T-105 | Deterministic intra-run collapse | Surviving record chosen by a total ordering (DUP-03) | T-103 | D4 | P0 | 2.5 | Logic | PT-02 unaffected by input order | PT-02 | Revert |
| T-106 | **`reconcile/removal.mjs` + PT-03** | Confidence-gated removal after `removal_confirmations`; tombstoning; monotonicity | T-101 | D5 | P0 | 5 | Module + property test | A tombstoned id never becomes active | PT-03 at ≥ 1,000 cases | Revert |
| T-107 | **`reconcile/suppress.mjs` + PT-04** | Denylist application, permanent; suppressed ids never appear in any projection | T-106 | D4 | P0 | 3.5 | Module + property test | PT-04 green | Reviewer attempts an un-suppress path; none exists | Revert |
| T-108 | **PT-05 first-seen preservation** | `first_seen_at` never changes after INSERT | T-100 | D4 | P0 | 2 | Property test | Green at ≥ 1,000 cases | CI | Revert |
| T-109 | `reconcile/index.mjs` composition | The merge function; pure; `now` an explicit required parameter (LEDG-03, LEDG-04) | T-100…T-108 | D5 | P0 | 4 | Module | **PT-01 and PT-02 turn green**; DR-2 holds | Reviewer confirms no default `now` anywhere | Revert |
| T-110 | Map-backed record storage | Replace any array indexing with map lookups (IR-24) | T-109 | D3 | P0 | 2 | Implementation | Benchmark at 1,000 and 5,000 reviews | Benchmark | Revert |
| T-111 | Module header: the asymmetry explained | Written explanation of why the logic is not redundant (LEDG-05, TRD A-4) | T-109 | D2 | P0 | 1.5 | Header comment | A reader is warned before simplifying | Reviewer reads it as if new to the code | Revert |

**PH-05 totals: 15 tasks · 46 IEH.**

---

# PH-06 · Projection and the Publish Gate

**Sprint SP-2 · Week 5 · 40 IEH · 15 tasks · Difficulty D4 · 100% coverage on the gate**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-112 | `schemas/payload.v1.schema.json` | The public contract, authoritative at runtime (EDR-039) | T-054 | D3 | P0 | 4 | Schema | Validates a hand-built exemplar payload | Architect reviews field by field | Revert (before first publish only) |
| T-113 | `schemas/ledger.v1.schema.json` | Internal state shape | T-053 | D2 | P0 | 2 | Schema | Validates fixture ledgers | Schema check | Revert |
| T-114 | `core/project/payload.mjs` | Ledger → payload with filters and field selection | T-111, T-112 | D4 | P0 | 5 | Module | Tombstoned and suppressed excluded | PT-04 | Revert |
| T-115 | **Total, stable composite sort key + PT-13** | Ties broken by identity hash; no two distinct reviews compare equal (PROJ-01) | T-114 | D4 | P0 | 3.5 | Sort + property test | PT-13 green at ≥ 1,000 cases | Reviewer constructs same-date reviews | Revert |
| T-116 | Minified stable-key serialisation | Payload minified, keys ordered (EDR-021, PROJ-02) | T-114 | D3 | P0 | 2.5 | Function | Byte-identical across runs | Two-run comparison | Revert |
| T-117 | Provenance block | Engine version, pack version, run id, adapter id (INV-06) | T-114 | D2 | P0 | 2 | Function | Schema-required fields populated | Schema validation | Revert |
| T-118 | `core/project/latest.mjs` | Top-N slice with no aggregate recomputation | T-114 | D2 | P0 | 1.5 | Module | Slice matches the ordered payload's head | Unit tests | Revert |
| T-119 | `core/project/stats.mjs` | Count, mean, distribution, languages, completeness (PROJ-04) | T-114 | D3 | P0 | 3 | Module | **Counts never inflated**; `advertised_total` never substituted | Arithmetic tests | Revert |
| T-120 | `core/project/schema-org.mjs` | Structured-data projection, opt-in, defaults `false` | T-119 | D2 | P2 | 2 | Module | Off by default | Config default test | Revert |
| T-121 | Manifest builders | Listing, client, and global manifests with freshness pointers | T-114 | D3 | P0 | 3 | Functions | Freshness pointer correct | Integration at PH-18 | Revert |
| T-122 | **PT-12 projection determinism** | Same ledger + config ⇒ byte-identical artifacts | T-116 | D4 | P0 | 2.5 | Property test | Green at ≥ 1,000 cases | Two-clock run | Revert |
| T-123 | **`core/gate/rules.mjs` — rules as data** | G-01…G-12 as independently testable data, not inline conditionals | T-114 | D4 | P0 | 5 | Module | Each rule callable and testable alone | Reviewer invokes three rules in isolation | Revert |
| T-124 | **`core/gate/index.mjs` — evaluate all, return all** | No short-circuiting (EDR-023, IR-08, GATE-01) | T-123 | D4 | P0 | 3 | Module | Three violations ⇒ three reasons | Multi-failure test | Revert |
| T-125 | **First-publish exception + unreadable-prior rejection** | Distinguish "no prior payload" from "could not read prior payload" (IR-25, GATE-03) | T-124 | D4 | P0 | 3 | Logic + tests | Unreadable prior ⇒ **reject** | Reviewer makes the prior unreadable | Revert |
| T-126 | **Force-override matrix + 100% coverage + PT-14** | Every override combination; `quarantine_max` **not** overridable; monotone safety (GATE-04, GATE-02) | T-125 | D4 | P0 | 4 | Tests | **100% statement coverage on `core/gate/`**; PT-14 green | Coverage report; reviewer attempts to force-override quarantine | Revert |

**PH-06 totals: 15 tasks · 40 IEH. Closes MS-2 at DG-03 — the project's first hard stop.**

---

## Part 12 Summary

| Phase | Tasks | IEH | Milestone | Key Exit |
|---|---|---|---|---|
| PH-00 | 46 | 62 | MS-0 | 19 proof branches; `ci.yml` green in < 5 min |
| PH-01 | 14 | 34 | — | Taxonomy complete; DR-1/DR-2 active |
| PH-02 | 12 | 40 | — | **PT-10, PT-11; ≥ 95% coverage** |
| PH-03 | 14 | 46 | MS-1 | PT-05, PT-06, PT-08, PT-09 |
| PH-04 | 10 | 26 | MS-1 | Completeness from stop reason |
| PH-05 | 15 | 46 | — | **PT-01, PT-02, PT-03, PT-04, PT-07** |
| PH-06 | 15 | 40 | MS-2 | **PT-12, PT-13, PT-14; gate at 100%** |
| **Total** | **126** | **294** | | |

**Twelve of the fifteen property laws are green by the end of Part 12**, in week 5 of 16. The three remaining (PT-08 against real adapters, PT-15 ledger round-trip, and PT-13's re-verification against real payloads) close in Parts 13 and 14.

---

*End of Part 12. Part 13 covers the spine, the first vertical slice, and real acquisition: tasks T-127 through T-257.*
