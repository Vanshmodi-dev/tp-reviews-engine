# Part 13 — Task Breakdown: Spine, First Slice, and Acquisition

*Tasks T-127 through T-257. Phases PH-07 through PH-17. Milestones MS-3 through MS-6. Sprints SP-3 through SP-6. Weeks 6–13.*

*Column conventions are defined at the head of Part 12 and are not repeated. Reserved ID blocks for discovered work in these phases: T-931…T-960.*

---

# PH-07 · Ports and Infrastructure

**Sprint SP-3 · Week 6 · 44 IEH · 16 tasks · Difficulty D3 (D4 for redaction)**

**Sequencing Note.** T-131 (`redact.mjs`) is built and covered to 100% **before** T-132 (the log sink). This ordering is the mitigation for IR-21 and MUST NOT be inverted (LOG-ORD-01).

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-127 | `ports/` interface set | Eight interface files: acquisition, state, publisher, notifier, browser, clock, random, logger — **no executable behaviour** | T-126 | D3 | P0 | 5 | Eight files + README | Architecture test asserts zero behaviour | Reviewer confirms each file only declares | Revert |
| T-128 | `infra/clock.mjs` | System `ClockPort` implementation | T-127 | D1 | P0 | 1 | Module | Test doubles already exist (T-041) | Unit | Revert |
| T-129 | `infra/random.mjs` | System `RandomPort` implementation | T-127 | D1 | P0 | 1 | Module | Seeded double exists (T-041) | Unit | Revert |
| T-130 | `infra/fs-atomic.mjs` | Write-temp-then-rename; **the only permitted write path** (LEDG-06, TR-STOR-001) | T-127 | D3 | P0 | 3 | Module | Crash injection leaves the target untouched | Reviewer kills mid-write | Revert |
| T-131 | **`infra/logger/redact.mjs` at 100%** | Sink-level redaction seeded at startup; the six test classes in §25.2 (EDR-031, IR-21) | T-127 | D4 | P0 | 6 | Module + `tests/security/redaction.test.mjs` | **100% statement coverage**; sentinels redacted at every level and position | Reviewer seeds a sentinel and greps all artifacts | **Corrected forward, not rolled back** |
| T-132 | `infra/logger/jsonl.mjs` | Structured sink composing redaction unconditionally; mandatory field set (LOG-ORD-02) | T-131 | D3 | P0 | 4 | Module | **Exactly one write path**, and it redacts | Code search for alternative write helpers | Revert |
| T-133 | Child loggers and correlation | Per-run and per-target child loggers carrying `runId` and target identity | T-132 | D2 | P0 | 2 | Functions | Every event correlatable | Unit | Revert |
| T-134 | Ring buffer for `debug`/`trace` | Bounded buffer flushed only on target failure (EDR-032) | T-132 | D3 | P0 | 3 | Implementation | Bound respected; flush only on failure | Memory test + failure test | Revert |
| T-135 | `infra/logger/pretty.mjs` | Human-readable local formatter | T-132 | D1 | P2 | 2 | Module | Dev ergonomics only | Manual | **Cuttable (§9.5 item 7)** |
| T-136 | **`infra/retry/policy.mjs`** | Lookup table keyed by error class; executor knows no class names (RETRY-01) | T-050 | D3 | P0 | 4 | Module | Every class has a policy | Reviewer diffs against SAD Appendix B's `R` column | Revert |
| T-137 | **`retry-policy.blocked-never` enumerating test** | Programmatic enumeration proving every `ERR-BLOCKED-*` returns `never` (INV-07, RETRY-02) | T-136 | D4 | P0 | 2 | Test file | Enumerates the taxonomy, not a hand list | Reviewer adds a fake blocked class; test catches it | Revert |
| T-138 | `infra/retry/execute.mjs` | Generic executor; jittered exponential backoff; **budget-checked before every sleep** (RETRY-03, EDR-027) | T-136 | D3 | P0 | 4 | Module | Contains no error-class literal | Code search | Revert (set all policies `never`) |
| T-139 | `infra/breaker/circuit.mjs` | `closed → open → half-open`, escalating cooldown, per source-access pair, persisted | T-138 | D3 | P0 | 4 | Module | Transitions tested; state round-trips | Unit + persistence test | Revert |
| T-140 | `infra/limiter/token-bucket.mjs` | Hourly/daily counters, **written before the request**, fail closed (RETRY-04, EDR-034) | T-138 | D3 | P0 | 3.5 | Module | Crash over-counts, never under-counts | Crash-injection test | Revert |
| T-141 | `infra/http.mjs` | Fetch wrapper: timeouts, classified errors, no redirect surprises; used by API adapters only | T-136 | D3 | P1 | 3 | Module | Errors drawn from the taxonomy | Unit | Revert |
| T-142 | Architecture tests DR-3…DR-6 | Adapter isolation, `app/` purity from adapters, composition-root-only construction, no import past an index | T-127 | D3 | P0 | 4 | Tests | Each rule fires on a deliberate violation | Reviewer creates one violation per rule | Revert |

**PH-07 totals: 16 tasks · 44 IEH.**

---

# PH-08 · State Adapter and Filesystem Publisher

**Sprint SP-3 · Week 6 · 28 IEH · 11 tasks · Difficulty D3 · Closes MS-3 at DG-04**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-143 | Ledger serialisation | Pretty-printed, stable key order, trailing newline (EDR-021) | T-130 | D3 | P0 | 2.5 | Function | Byte-stable across runs | Two-run comparison | Revert |
| T-144 | **Ledger parsing with unknown-field preservation** | Unknown fields survive a read-write cycle (TR-STOR-003, LEDG-07) | T-143 | D4 | P0 | 3 | Function | An older engine cannot strip a newer engine's data | Reviewer adds an unknown field and round-trips | Revert |
| T-145 | **PT-15 ledger round-trip** | `parse(serialize(L)) ≡ L`, including unknown fields | T-144 | D4 | P0 | 2.5 | Property test | Green at ≥ 1,000 cases | CI | Revert |
| T-146 | Path templates module | One module per store; all templates from TRD §69.4 (LEDG-08, TR-STD-110) | T-127 | D2 | P0 | 2.5 | Module | No path assembled at a call site | Code search for string concatenation of paths | Revert |
| T-147 | `adapters/state/git-state.mjs` — ledger | Read/write ledgers rooted at a `state` checkout | T-146, T-144 | D3 | P0 | 3.5 | Module | Atomic write via `fs-atomic` only | Integration | Revert |
| T-148 | `git-state` — cache and budget | Identity cache and rate-budget counter persistence | T-147 | D3 | P0 | 2.5 | Functions | TTL respected; counters durable | Unit | Revert |
| T-149 | `git-state` — health and breaker | Append-only health JSONL; breaker state files | T-147 | D3 | P0 | 2.5 | Functions | Append-only; no read-modify-write (HLTH-01) | Concurrent append test | Revert |
| T-150 | Corrupt-ledger handling | `ERR-STATE-CORRUPT`; target aborts; LKG retained; runbook referenced | T-147 | D3 | P0 | 2.5 | Logic + test | Never partially applies a corrupt ledger | Feed invalid JSON | Revert |
| T-151 | `adapters/publisher/filesystem.mjs` | Local development publication; the dev default | T-127 | D2 | P0 | 2.5 | Module | Writes artifacts to `.publish/` | Integration | Revert |
| T-152 | `tests/integration/state.roundtrip.test.mjs` | Write, read, re-serialise byte-identically; atomic rename; unknown fields | T-147 | D3 | P0 | 3 | Test | **MS-3's demo** | Reviewer runs it | Revert |
| T-153 | Crash-injection test for `fs-atomic` | Kill mid-write; assert temp present, target untouched | T-130 | D3 | P0 | 1.5 | Test | Deterministic | Reviewer runs it | Revert |

**PH-08 totals: 11 tasks · 28 IEH.**

---

# PH-09 · Configuration Loader

**Sprint SP-3 · Week 7 · 32 IEH · 12 tasks · Difficulty D3**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-154 | `schemas/client-config.v1.schema.json` | The client configuration contract per TRD §8.3 | T-112 | D3 | P0 | 4 | Schema | Every section present with descriptions | Architect reviews | Revert |
| T-155 | `app/config/defaults.mjs` | **A default for every schema key** (TR-APP-031) | T-154 | D2 | P0 | 3 | Module | Correspondence test green | Delete one default; test fails | Revert |
| T-156 | Correspondence test | Every schema key has a code default | T-155 | D2 | P0 | 1.5 | Test | Fails on any gap | Reviewer removes a default | Revert |
| T-157 | Layer 3: client config load + validate | Schema validation with useful error messages | T-155 | D3 | P0 | 3 | Loader step | Malformed config names the offending path | Feed a broken config | Revert |
| T-158 | Layer 2: profile `$ref` inheritance | Profile resolution and merge | T-157 | D3 | P0 | 3 | Loader step | Profile beats default, loses to client | Precedence tests | Revert |
| T-159 | Layer 4: listing overrides | Per-listing override merge | T-158 | D3 | P0 | 2 | Loader step | Nested override wins | Precedence tests | Revert |
| T-160 | **Layer 5: environment + unknown-variable rejection** | Coercion; unknown `TPRE_*` ⇒ exit 2 naming the nearest match (EDR-006, IR-16) | T-159 | D3 | P0 | 4 | Loader step | `TPRE_MAX_REVIEW` typo rejected with a suggestion | Reviewer sets a typo'd variable | Revert |
| T-161 | Layer 6: CLI flags | Flag layer beats environment | T-160 | D2 | P0 | 1.5 | Loader step | Precedence correct | Tests | Revert |
| T-162 | **Precedence matrix test suite** | All ten tests from §24.2, including the **array-replace** rule (TR-CFG-020) | T-161 | D3 | P0 | 4 | Test suite | Arrays replace, never merge | Reviewer overrides an array | Revert |
| T-163 | **Ceiling and floor validation** | Breach ⇒ validation **error**, never a clamp (TR-CFG-030) | T-161 | D3 | P0 | 2.5 | Validation | `nav.max_reviews: 6000` ⇒ exit 2 | Reviewer sets it | Revert |
| T-164 | Resolution trace + secret masking | Per key: winning layer and value; secrets as `«set»`/`«unset»` (TR-CFG-021…024) | T-161 | D3 | P0 | 2.5 | Trace | No secret value in the trace | `security.redaction` extension | Revert |
| T-165 | Deep freeze + `config_version` migration framework | Frozen config; ordered N→N+1 migration scaffolding (EDR-005) | T-164 | D3 | P0 | 2 | Functions | Mutation throws; migration framework tested with a synthetic migration | Reviewer attempts mutation | Revert |

**PH-09 totals: 12 tasks · 32 IEH.**

---

# PH-10 · CLI Skeleton and Diagnostic Commands

**Sprint SP-3 · Week 7 · 34 IEH · 12 tasks · Difficulty D2 · Closes MS-4 at DG-05**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-166 | `bin/tpre.mjs` | Shebang wrapper delegating to `src/cli/index.mjs`. **Three lines** | T-165 | D1 | P0 | 0.5 | File | No logic whatsoever | Reviewer counts the lines | Revert |
| T-167 | `cli/exit-codes.mjs` | The eight canonical exit codes (TR-CLI-002) | T-165 | D1 | P0 | 1 | Module | Constants only, stability test | Unit | Revert |
| T-168 | `cli/index.mjs` | Command registry, argument parsing, dispatch, top-level catch (TR-CLI-005/006) | T-167 | D3 | P0 | 5 | Module | Unknown command/flag ⇒ exit 2 with usage | Reviewer passes a bogus flag | Revert |
| T-169 | Argument parser decision (OIQ-01) | Use `node:util`'s built-in parser; record the decision | T-168 | D2 | P0 | 2 | Implementation + note | No dependency added unless a documented gap exists | Reviewer reads the note | Revert |
| T-170 | `cli/composition.mjs` | **The only file constructing concrete implementations** (DR-5, TR-CLI-001) | T-168 | D3 | P0 | 4 | Module | Architecture test DR-5 green | Reviewer attempts construction elsewhere | Revert |
| T-171 | Flush-before-exit guarantee | Logs flushed, manifest written, diagnostics uploaded **before** every exit including failures (TR-CLI-004) | T-168 | D3 | P0 | 3 | Logic | Holds for all eight exit codes | Reviewer forces each code | Revert |
| T-172 | `tpre doctor` | Versions, caches, secrets present, branch checkouts, connectivity (REC-03) | T-170 | D2 | P0 | 4 | Command | Fixes nothing; reports everything | Run on a broken environment | Revert |
| T-173 | `tpre validate-config` + `--explain` | Schema + semantic validation; trace printing | T-170, T-164 | D3 | P0 | 4 | Command | Readable trace with masked secrets | Reviewer runs `--explain` | Revert |
| T-174 | Semantic rules V-1…V-12 | Implemented in `validate-config`, **not** the loader (§24.1 step 12) | T-173 | D3 | P0 | 5 | Rules + tests | **V-3 (authorisation) has two tests** | Reviewer checks V-3 both ways | Revert |
| T-175 | `tpre project` | Rebuild payloads from the ledger with **zero network** (RB-01) | T-170, T-114 | D3 | P0 | 3 | Command | Architecture assertion: no acquisition adapter in its closure | Run with networking disabled | Revert |
| T-176 | `tpre plan` | Print the due set and shard assignment; **zero side effects** (TR-APP-030) | T-170 | D2 | P0 | 1.5 | Command | Runs against a read-only checkout | Reviewer runs it twice and diffs | Revert |
| T-177 | `tpre replay` and `tpre export` | Re-run stages 3–10 from a stored artifact; full client export (FR-093) | T-170 | D2 | P2 | 1 | Two commands | Replay reproduces a prior outcome | Integration | **Cuttable (§9.5 items 1–2)** |

**PH-10 totals: 12 tasks · 34 IEH.**

---

# PH-11 · CSV Adapter — Proving the Interface

**Sprint SP-4 · Week 8 · 24 IEH · 9 tasks · Difficulty D3**

**X-8 applies: this phase precedes every browser task.** Its purpose is to validate the `AcquisitionPort` against a second, materially different implementation while changing it is still free.

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-178 | Finalise `ports/acquisition.mjs` | Contract shape for `capabilities`, `resolve`, `acquire` (IF-ACQ-01) | T-127 | D3 | P0 | 3 | Interface | No Playwright-shaped assumptions | Architect reviews before implementation | Revert |
| T-179 | **`tests/contract/acquisition-adapter.contract.test.mjs`** | The nine assertions of §52.2, written **before** the DOM adapter exists (ADP-01) | T-178 | D4 | P0 | 5 | Contract suite | Reusable unchanged for four adapters | Architect confirms no source-specific assumption | Revert |
| T-180 | `file-csv/COLUMNS.md` | The column contract | T-178 | D1 | P0 | 1 | Doc | Unambiguous | Reviewer reads | Revert |
| T-181 | `file-csv/parse.mjs` | Column parsing with **per-row error isolation** | T-180 | D3 | P0 | 4 | Module | One bad row does not fail the file | `partially-invalid.csv` fixture | Revert |
| T-182 | `file-csv/index.mjs` | Adapter entry, capability declaration, stage wiring | T-181, T-179 | D3 | P0 | 3 | Module | Declares capabilities honestly | Contract assertion 1 | Revert |
| T-183 | CSV fixtures | `valid.csv`, `partially-invalid.csv`, `malformed.csv` | T-181 | D1 | P0 | 1.5 | Three fixtures | Each exercises a distinct path | Reviewer reads | Revert |
| T-184 | Register in the composition root | Static registration (EDR-038, ADP-03) | T-182, T-170 | D2 | P0 | 1 | Wiring | No dynamic loading | Code search for `import(` | Revert |
| T-185 | **First end-to-end run: CSV → payload** | `tpre harvest --client _fixture-csv --publisher filesystem` through all eleven stages | T-184, T-151 | D3 | P0 | 4 | Integration test | **MS-5's demo**; payload validates against the schema | Reviewer runs the command from a clean checkout | Revert |
| T-186 | **Re-run PT-08 with the real CSV adapter** | Cross-adapter identity against real CSV output plus synthetic DOM output (§36.2) | T-185 | D4 | P0 | 1.5 | Extended property test | Green | CI | Revert |

**PH-11 totals: 9 tasks · 24 IEH.**

---

# PH-12 · Selector Packs

**Sprint SP-4 · Week 8 · 26 IEH · 10 tasks · Difficulty D3**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-187 | `selectors/schema/selector-pack.schema.json` | Requires **≥ 2 strategies of different kinds** per field, plus `notes` per strategy (IR-03, SEL-03) | T-112 | D3 | P0 | 4 | Schema | Rejects single-strategy and two-`css` fields | Reviewer submits both invalid shapes | Revert |
| T-188 | `core/selectors/loader.mjs` | Parse and schema-validate **at load** ⇒ `ERR-PARSE-SELECTOR-PACK` (TR-SEL-003) | T-187 | D3 | P0 | 3 | Module | Malformed pack fails loudly at load, not mysteriously later | Feed a malformed pack | Revert |
| T-189 | `core/selectors/resolver.mjs` | Ordered strategy resolution recording `strategyIndex` | T-188 | D3 | P0 | 4 | Module | Fallback to index 1 recorded | Unit | Revert |
| T-190 | Strategy health recording | Per-field strategy index histogram output | T-189 | D3 | P0 | 2.5 | Function | Feeds the health record (§44.2) | Unit | Revert |
| T-191 | All-strategies-fail behaviour | Field-required error, not a silent null | T-189 | D3 | P0 | 2 | Logic | Quarantine path reachable | CH-08 at PH-21 | Revert |
| T-192 | Author `selectors/google-maps/v1.json` | Initial pack with `notes` on every strategy | T-187 | D3 | P0 | 5 | Pack | Validates; ≥ 2 strategy kinds per field | Reviewer reads the `notes` for comprehensibility | Revert |
| T-193 | `selectors/google-maps/assertions.json` | Structural assertions for the canary | T-192 | D3 | P1 | 2.5 | File | Assertions evaluate against fixture 001 | Reviewer runs them | Revert |
| T-194 | Profile pack pinning | `profiles/*.json` pin a pack version (TR-SEL-004) | T-192, T-155 | D2 | P0 | 1.5 | Profile edits | Pin change alters resolution | Change the pin in a scratch branch | **One-line revert** |
| T-195 | Pack immutability CI check | A merged pack file changing content fails CI (SEL-01) | T-192 | D3 | P1 | 2 | CI check | Editing `v1.json` after merge fails | Attempt an edit | Revert |
| T-196 | `selectors/README.md` | How to author, test, version, and stage a pack | T-192 | D2 | P1 | 1.5 | Doc | The six-step staged rollout documented | Reviewer follows it mentally | Revert |

**PH-12 totals: 10 tasks · 26 IEH.**

---

# PH-13 · Extraction and the Fixture Corpus

**Sprint SP-4 · Week 9 · 42 IEH · 13 tasks · Difficulty D3 · Closes MS-5 at DG-06**

**Fixture capture began in SP-2** (§33.3). This phase consumes the corpus; it does not start it.

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-197 | `scripts/sanitize-html.mjs` | Strip scripts, tokens, cookies, tracking attributes, inline handlers; **retain review text and author names** (TR-TEST-012) | T-072 | D3 | P0 | 4 | Script | Retains what the parser needs | Reviewer inspects a sanitised fixture | Revert |
| T-198 | `scripts/capture-fixture.mjs` | Capture, trim to the review subtree, write `meta.json` (TR-TEST-011) | T-197 | D3 | P0 | 3 | Script | Full-page captures rejected | Reviewer checks a capture's size | Revert |
| T-199 | HTML parser decision (OIQ-03) | Choose a **dev-only** parser meeting DEP-3; record the decision | T-197 | D2 | P0 | 1.5 | Dev dep + note | Never appears in production dependencies | `npm ls --prod` | Revert |
| T-200 | **`core/extract/reply.mjs` — first** | Owner-reply subtree isolation, performed before any other field (EDR-016, EXT-01, IR-13) | T-189 | D4 | P0 | 4 | Module | Fixture 004: zero replies in the review list | Reviewer runs fixture 004 | Revert |
| T-201 | **`core/extract/rating.mjs`** | Three-parser cascade P1/P2/P3 with a **mandatory integer post-check** (EDR-017, EXT-02, IR-14) | T-200 | D4 | P0 | 5 | Module | A fractional aggregate rating is rejected | Reviewer feeds `4.3` | Revert |
| T-202 | `core/extract/author.mjs` | Display name, profile URL, avatar URL, badges | T-200 | D3 | P0 | 3.5 | Module | Absent fields are `null`, never fabricated (EXT-03) | Fixtures 008, 009 | Revert |
| T-203 | `core/extract/text.mjs` | Body lifting and truncation-marker detection; **no markup removal here** | T-200 | D3 | P0 | 3 | Module | Removal remains the normalizer's job | Fixtures 005, 019 | Revert |
| T-204 | `core/extract/meta.mjs` | Likes, photo counts, visit metadata where present | T-200 | D2 | P1 | 2 | Module | Never fabricates absent fields | Fixtures | Revert |
| T-205 | `core/extract/index.mjs` | Per-node orchestration in the TRD §21.3 order | T-200…T-204 | D3 | P0 | 3 | Module | Order matches the spec | Reviewer compares to §21.3 | Revert |
| T-206 | Baseline + boundary fixtures wired | 001, 002, 003, 018 with `expected.json` generated by the engine | T-205 | D3 | P0 | 4 | Four fixtures | Golden outputs machine-generated, not hand-written | Reviewer regenerates one | Revert |
| T-207 | Structural, text, locale, identity fixtures wired | 004–013, 020 | T-206 | D3 | P0 | 4 | Eleven fixtures | Each exercises its stated purpose | Reviewer opens two | Revert |
| T-208 | **Adversarial fixtures wired** | 014 partial, 015 structure-changed, 016 challenge, 017 consent, 019 markup — each asserting **correct failure** | T-206 | D4 | P0 | 4 | Five fixtures | 015 fails loudly; 019 yields plain text | Reviewer runs `parse:fixture -- 015` and `-- 019` | Revert |
| T-209 | `tests/regression/fixtures.golden.test.mjs` | Every parser × every applicable fixture, **against its pinned pack** (TR-TEST-051) | T-206…T-208 | D3 | P0 | 3 | Regression suite | Twenty fixtures green | CI | Revert |

**PH-13 totals: 13 tasks · 42 IEH.**

---

# PH-14 · Browser Adapter and Session Management

**Sprint SP-5 · Week 10 · 34 IEH · 11 tasks · Difficulty D3**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-210 | Install Playwright + DEP-1 justification | First production dependency; pinned; browser cache strategy noted (DEP-ORD-01/02) | T-209 | D2 | P0 | 2 | Dep + justification | Not installed before now | `git log` on `package.json` | Revert |
| T-211 | Finalise `ports/browser.mjs` | Written **before** any Playwright code (PW-02) | T-178 | D3 | P0 | 2.5 | Interface | No library type leaks into the port | Architect reviews | Revert |
| T-212 | `playwright-chromium.mjs` launch | Launch flags per TRD §16; headless only in production | T-211, T-210 | D3 | P0 | 4 | Module | **The only file importing `playwright`** (PW-01) | Repository-wide grep | Revert |
| T-213 | Context creation | Locale, timezone, viewport, user agent from config | T-212 | D3 | P0 | 3 | Functions | Options applied and asserted | Unit | Revert |
| T-214 | Route interception | Host allowlist + resource-type denylist (EDR-012) | T-213 | D3 | P0 | 4 | Implementation | Off-allowlist requests never issued | Request-log assertion (PH-15) | Revert |
| T-215 | **Interception measurement** | Byte reduction measured and **recorded as a number** (PW-03, §29.3) | T-214 | D3 | P0 | 2.5 | Test | Actual percentage recorded in the test | Reviewer reads the recorded number | Revert |
| T-216 | Six nested timeout levels | Each strictly inside the next (EDR-028) | T-213 | D3 | P0 | 3 | Implementation | Nesting asserted from resolved config | Nesting test | Revert |
| T-217 | **Teardown in `finally`, ordered** | page → context → browser; each tolerates prior failure (BRW-01/02) | T-213 | D4 | P0 | 3.5 | Implementation | Holds on the failure path | Reviewer removes the `finally`; the test must fail | Revert |
| T-218 | Open-context count assertion | Count returns to zero after every target (BRW-03) | T-217 | D3 | P0 | 2 | Instrumentation + test | Asserted per target, not per run | Integration | Revert |
| T-219 | **`tests/security/isolation.test.mjs`** | The five assertions of §30.2, **including a failing target** (TR-TEST-081, INV-09) | T-218 | D4 | P0 | 4.5 | Security test | No cookie, storage, or cache carryover | Reviewer runs with the `finally` removed | Revert |
| T-220 | Headed-mode debug flag | Local only; refused when `TPRE_ENV=production` (EDR-010, PW-04) | T-212 | D2 | P1 | 1 | Flag | Production refusal tested | Unit | Revert |

**PH-14 totals: 11 tasks · 34 IEH.**

---

# PH-15 · Fixture Server and Navigator

**Sprint SP-5 · Weeks 10–11 · 36 IEH · 12 tasks · Difficulty D3**

**The fixture server is built before the navigator**, in the same phase. It is what makes every acquisition test deterministic (§31.1).

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-221 | `fixtures/server/serve.mjs` — static serving | Serve sanitised corpus pages over HTTP, no internet | T-209 | D2 | P0 | 3 | Server | Serves fixture 001 | Manual fetch | Revert |
| T-222 | Fixture server — lazy-load simulation | Yield review batches progressively | T-221 | D3 | P0 | 3 | Capability | Pagination is exercised realistically | Integration | Revert |
| T-223 | Fixture server — **stall, delay, challenge, consent, request log** | The remaining five capabilities of §31.1 | T-222 | D3 | P0 | 4 | Capabilities | Each independently switchable | Server self-test | Revert |
| T-224 | Navigate + surface wait | Navigate and wait for the review surface | T-223, T-216 | D3 | P0 | 3 | Function | Absent surface ⇒ `ERR-NAV-SURFACE-NOT-FOUND` | Fixture without the surface | Revert |
| T-225 | `consent.mjs` | Dismiss **benign, dismissible** interstitials only | T-224 | D3 | P0 | 3 | Module | A non-dismissible wall ⇒ `ERR-NAV-CONSENT-WALL`, never a puzzle | Fixture 017 | Revert |
| T-226 | Open review pane; apply sort order | Sort applied and verified | T-224 | D3 | P0 | 2.5 | Function | Requested order confirmed on the page | Integration | Revert |
| T-227 | **Pagination loop** | Scroll by container-height ratio, settle, count (EDR-013, NAV-02) | T-226 | D3 | P0 | 5 | Function | Never scrolls to absolute bottom | Reviewer reads the scroll logic | Revert (lower `max_reviews`) |
| T-228 | Stall detection | Stop after `nav.stall_threshold` unproductive iterations | T-227 | D3 | P0 | 2.5 | Logic | Deterministic against the stall fixture | Integration | Revert |
| T-229 | Expansion of truncated reviews | Capped by `nav.expand_max_count` and the pagination budget | T-227 | D3 | P0 | 3 | Function | Cap and budget both respected | 5,000-review fixture | Revert |
| T-230 | **Stop reason as a first-class output** | Emit `complete`/`capped`/`stalled`/`budget`/`error` at the point of stopping (NAV-01, TR-NAV-001) | T-228 | D4 | P0 | 3 | Output field | Never inferred downstream | Reviewer traces the completeness input | Revert |
| T-231 | **Growth curve in the acquisition report** | Reviews observed per iteration retained (EDR-014, NAV-03) | T-227 | D3 | P0 | 2 | Report field | Present in every report | Schema validation | Revert |
| T-232 | **Pagination + stall integration tests** | Full pagination; stall ⇒ `stalled` + `partial` + **gate rejection** | T-230 | D4 | P0 | 4 | Integration tests | Three protections engage | Reviewer runs the stall scenario | Revert |

**PH-15 totals: 12 tasks · 36 IEH.**

---

# PH-16 · Google DOM Adapter

**Sprint SP-5 · Week 11 · 44 IEH · 13 tasks · Difficulty D4**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-233 | `google-dom/index.mjs` | Adapter entry, capability declaration, stage wiring | T-232, T-178 | D3 | P0 | 4 | Module | Declares **reduced** capabilities honestly | Contract assertion 1 | Revert |
| T-234 | `resolver.mjs` — identifier precedence | Explicit canonical id → numeric id → cached → URL-parsed → search (last resort) | T-233 | D3 | P0 | 4 | Module | Search emits `warn` every time | Unit | Revert |
| T-235 | Identity verification on **every** run | Name similarity ≥ `identity_threshold` (TR-APP-020) | T-234, T-080 | D4 | P0 | 3.5 | Logic | Drift ⇒ `ERR-IDENTITY-DRIFT` | Rename test | Revert |
| T-236 | Name normalisation before comparison | Strip legal suffixes, collapse punctuation, casefold, remove diacritics (TR-APP-021) | T-235 | D3 | P0 | 2.5 | Function | A routine rebrand does not trip a false drift | Reviewer supplies rebrand pairs | Revert |
| T-237 | **Ambiguity refusal** | Two or more candidates above threshold ⇒ `ERR-RESOLVE-AMBIGUOUS`; **never guess** (TR-APP-022) | T-235 | D4 | P0 | 2.5 | Logic | No guessing path exists | Reviewer greps for a "best candidate" fallback | Revert |
| T-238 | `allow_search` production default | `false` when `TPRE_ENV=production` (TR-APP-023) | T-234 | D2 | P0 | 1 | Default | Enforced by config | Unit | Revert |
| T-239 | Identity cache with TTL | `resolution.cache_ttl_days`, persisted to `state` | T-234, T-148 | D3 | P0 | 2.5 | Logic | Cold cache produces identical output (CON-09) | Cache-clear test | Revert |
| T-240 | **`challenge-detect.mjs` — before parsing** | Classification precedes any parsing attempt (CHAL-01, INV-07) | T-233 | D4 | P0 | 4 | Module | Fixture 016 ⇒ `ERR-BLOCKED-CHALLENGE`, never a parse failure | Reviewer runs fixture 016 | Revert |
| T-241 | **Zero retry paths for challenges** | No retry, ever — including "one to see if it clears" (CHAL-02, IR-11) | T-240, T-137 | D4 | P0 | 2 | Verification | Enumerating retry test covers the new classes | **Second reviewer checks the enumeration** | Revert |
| T-242 | Challenge consequences | Breaker opens; `critical` alert; LKG retained; no ledger, no payload | T-240, T-139 | D3 | P0 | 3 | Wiring | Outcome table matches TRD §2.4.1 | CH-03 at PH-21 | Revert |
| T-243 | **`dom-serialize.mjs`** | Serialise the review subtree as a **string**; never the whole document (EDR-015, SER-01/02/03) | T-233 | D4 | P0 | 4 | Module | Output is fixture-shaped and reusable as a fixture | Reviewer saves the string and runs it as a fixture | Revert |
| T-244 | Wire extraction to the serialised subtree | The adapter feeds `core/extract/` a string | T-243, T-205 | D3 | P0 | 3.5 | Wiring | `core/` stays pure (DR-1) | Architecture test | Revert |
| T-245 | Contract suite × `google:dom` | Run the unchanged PH-11 suite against this adapter | T-244, T-179 | D3 | P0 | 3 | Test run | Nine assertions pass unchanged | Reviewer confirms the suite was not modified | Revert |

**PH-16 totals: 13 tasks · 44 IEH.**

---

# PH-17 · Orchestrator, Target Runner, Preflight

**Sprint SP-6 · Week 12 · 40 IEH · 12 tasks · Difficulty D3 · Closes MS-6 at DG-07**

| ID | Task | Description | Deps | D | P | Est | Output | Acceptance | Verify | Rollback |
|---|---|---|---|---|---|---|---|---|---|---|
| T-246 | **`app/registry.mjs` — pure** | Client discovery, `enabled` filter, listing expansion, due-set computation (SCHED-01, TR-APP-030) | T-165 | D3 | P0 | 5 | Module | Purity asserted by the architecture test | Reviewer confirms no I/O | Revert |
| T-247 | Due-set matrix tests | Tiers × last-run times × cadence floors | T-246 | D3 | P0 | 3 | Tests | Every combination covered | CI | Revert |
| T-248 | **`app/shard-planner.mjs` — pure** | Cost-balanced partitioning from historical p50, falling back to review count (TR-CFG-004) | T-246 | D3 | P0 | 5 | Module | **Never balances by target count alone** | Reviewer reads the cost model | Revert (`max_parallel: 1`) |
| T-249 | Shard determinism and spill | Deterministic for a given triple; spill to the next cycle (TR-CFG-005) | T-248 | D3 | P0 | 2.5 | Logic | `tpre plan` reproducible | Run twice, diff | Revert |
| T-250 | `app/preflight.mjs` — seven checks | Kill switch, source flag, client `enabled`, **authorisation (dom only)**, robots, budget, breaker | T-246 | D3 | P0 | 5 | Module | Checks in order, failing fast | One test per check | Revert |
| T-251 | Verdict recorded on allow **and** deny | TR-APP-010 | T-250 | D2 | P0 | 1.5 | Logic | Manifest contains the verdict either way | Manifest inspection | Revert |
| T-252 | Robots-fetch failure handling | `unknown` resolved per mode; **never silently passes** (TR-APP-011) | T-250 | D3 | P0 | 2 | Logic | `block` denies; `warn`/`ignore` proceed with a note | Unit | Revert |
| T-253 | **`app/target-runner.mjs` — the error envelope** | Per-target isolation, budget, context lifecycle, diagnostics trigger; **the single exception→outcome conversion point** (ERR-04, TR-APP-001) | T-250, T-219 | D4 | P0 | 5 | Module | No error crosses targets | `security.isolation` | Revert |
| T-254 | `app/orchestrator.mjs` — the loop | Eleven stages × targets, run budget, pacing | T-253 | D3 | P0 | 4 | Module | No conditional keyed on slug, source, or adapter (TR-APP-007) | Code search for slug conditionals | Revert |
| T-255 | Deterministic target ordering | Pseudo-random permutation seeded by `runId + slug` (SCHED-02) | T-254 | D3 | P0 | 2 | Logic | Reproducible from the run id | Two runs, same seed | Revert |
| T-256 | **Budget semantics** | Target expiry ⇒ `ERR-BUDGET-TARGET`, continue; run expiry ⇒ remaining `deferred`, exit 4 (SCHED-03, TR-APP-005) | T-254 | D4 | P0 | 3 | Logic | **`deferred`, never `failed`** | CH-13 at PH-21 | Revert |
| T-257 | `app/run-manifest.mjs` | Assemble the manifest; **every target present**, including blocked and deferred (SCHED-04) | T-254 | D3 | P0 | 2 | Module | A missing target fails the manifest test | Reviewer removes a target from the outcome list | Revert |

**PH-17 totals: 12 tasks · 40 IEH.**

---

## Part 13 Summary

| Phase | Tasks | IEH | Milestone | Key Exit |
|---|---|---|---|---|
| PH-07 | 16 | 44 | MS-3 | **Redaction at 100%**; blocked-never enumerated |
| PH-08 | 11 | 28 | MS-3 | **PT-15**; atomic writes; unknown fields preserved |
| PH-09 | 12 | 32 | MS-4 | Precedence matrix; ceilings reject |
| PH-10 | 12 | 34 | MS-4 | `doctor`, `plan`, `validate-config`, `project` |
| PH-11 | 9 | 24 | MS-5 | **Contract suite exists; CSV → payload end to end** |
| PH-12 | 10 | 26 | MS-5 | Pack schema enforces multi-kind strategies |
| PH-13 | 13 | 42 | MS-5 | **Twenty golden fixtures, five adversarial** |
| PH-14 | 11 | 34 | MS-6 | One Playwright importer; isolation with a failing target |
| PH-15 | 12 | 36 | MS-6 | Stop reason first-class; stall ⇒ partial ⇒ reject |
| PH-16 | 13 | 44 | MS-6 | **Challenge terminal, zero retries** |
| PH-17 | 12 | 40 | MS-6 | Isolation, deferral semantics, complete manifest |
| **Total** | **131** | **384** | | |

---

*End of Part 13. Part 14 covers publication, automation, hardening, and launch: tasks T-258 through T-342.*
