# Part 6 — Processing and Data Implementation

*Sections 34 through 38. Audience: the lead implementer and the second reviewer. Four of the five systems in this part are D4 or D5. Together they contain every mechanism whose failure is silent, and they are built in weeks 2 through 5 precisely because that is when there is still time to get them right.*

**Build-order reminder — this part is presented out of build order.**

| § | System | Built In | Sprint | Difficulty |
|---|---|---|---|---|
| 37 | **Normalizer** | **PH-02** | SP-1 | **D4** |
| 36 | Hash generator | PH-01 (`hash.mjs`) + PH-03 (identity) | SP-1 | D3 |
| 34 | Review validation | PH-04 | SP-2 | D3 |
| 35 | Duplicate detection | PH-05 | SP-2 | **D4** |
| 38 | Review ledger | PH-05 (shape + reconcile) + PH-08 (persistence) | SP-2, SP-3 | **D5** |

**Read §37 first.** The Normalizer is built before everything else in this part and before every producer of data anywhere in the system (X-7). The other four sections assume its output vocabulary.

---

# 37. Normalizer

**Phase PH-02 · Sprint SP-1 · Difficulty D4 · 40 IEH · The security boundary**

| Field | Value |
|---|---|
| **Purpose** | Convert hostile, arbitrary text from an untrusted source into a value that is safe as plain text on any client website, deterministically, for every possible input. |
| **Objectives** | (1) Eight ordered steps, order normative. (2) Markup **removed**, not escaped. (3) Unicode normalisation, control/zero-width/bidi stripping. (4) Whitespace canonicalisation. (5) URL host-allowlist validation. (6) Grapheme-cluster-aware length bounding, applied last. (7) Markup self-check producing `ERR-CLEAN-MARKUP-SURVIVED`. (8) PT-10 and PT-11 at ≥ 1,000 cases. |
| **Dependencies** | PH-01 (`Result`, `CleanString` brand). Nothing else — and nothing may depend on it being absent |
| **Estimated Complexity** | **D4.** Correctness is not observable from the happy path. Every input that matters is one nobody thought of |
| **Estimated Time** | 40 IEH |
| **Risks** | **IR-05 — length bounding by code units rather than grapheme clusters** (ZWJ emoji sequences split into invalid sequences) · escaping instead of removing (TRD §23.3 — the security boundary for every client website simultaneously) · step reordering that passes example tests and fails adversarial ones · length bound applied before markup removal, so the bound is computed on text that no longer exists |
| **Plan risks** | PR-08 |

## 37.1 Why This Is Phase 2

X-7 and INV-05. Retrofitting the security boundary requires re-deriving every golden fixture, re-auditing every producer, and re-establishing a property that was previously only asserted. Building it second — after the type vocabulary and before any producer — costs 40 IEH and buys a property that is true by construction for the remaining fifteen weeks.

**Stop Condition.** If any producer of data (extraction, CSV parsing, an adapter) is written before PH-02 closes, halt and escalate to DG-02. This is the one ordering violation with no cheap remedy.

## 37.2 The Eight Steps — Order Is Normative

TRD §23.3 specifies the order. The plan's contribution is the test that proves it:

| # | Step | If Moved Earlier | If Moved Later |
|---|---|---|---|
| 1 | Entity decoding | — | Encoded markup survives the removal step |
| 2 | Markup removal | Decoded entities become markup after removal | Markup reaches the output |
| 3 | Unicode NFC normalisation | Composed forms differ from decomposed in later comparisons | Hashes differ for visually identical text |
| 4 | Control-character stripping | — | Control characters reach the output |
| 5 | Zero-width and bidi-override stripping | — | **Bidi overrides reach the output — a display-spoofing vector** |
| 6 | Newline canonicalisation | — | Line-ending variation changes bytes and therefore hashes |
| 7 | Whitespace run collapsing | Collapses whitespace that markup removal was about to create | Ragged output |
| 8 | **Grapheme-aware length bounding** | **Bounds text that later steps then shorten — the bound becomes meaningless** | — |

| ID | Requirement |
|---|---|
| NORM-01 | The eight steps MUST execute in the specified order, and a unit test MUST assert the order by observing intermediate effects — not merely the final output. Two orderings can produce identical output on the test corpus and differ on the input that matters. |
| NORM-02 | Markup MUST be **removed**, never escaped (TRD §23.3). Escaping produces text that renders as markup source on a client site and re-becomes markup the moment any consumer unescapes it. |
| NORM-03 | Length bounding MUST be grapheme-cluster-aware and applied **last** (EDR-020, IR-05). A ZWJ emoji sequence split mid-cluster produces invalid output that some renderers display as replacement characters and others as unexpected glyphs. |
| NORM-04 | The markup self-check MUST run **after** the pipeline and produce `ERR-CLEAN-MARKUP-SURVIVED` (severity `critical`) if any markup remains. Defence in depth: the pipeline is the mechanism, the self-check is the proof. |

## 37.3 The Adversarial Corpus

This phase's real deliverable is not the eight steps; it is the corpus that proves they work.

| Class | Cases |
|---|---|
| Nested entities | `&amp;lt;script&amp;gt;`, double- and triple-encoded forms |
| Markup that survives naive stripping | Unclosed tags, tags split across attributes, comment-wrapped markup, `<` without a matching `>` |
| Bidi and zero-width | RLO/LRO overrides, ZWJ, ZWNJ, soft hyphens, BOM mid-string |
| Emoji | ZWJ family sequences, skin-tone modifiers, flag sequences, at the exact length boundary |
| Scripts | CJK, Arabic, Hebrew, Devanagari, mixed-direction strings |
| Length | Exactly at the bound, one under, one over, 10,000 graphemes |
| Control | Every C0 control, DEL, C1 range |
| Degenerate | Empty string, whitespace only, a single combining mark |

**Every case in this table is a named unit test.** Together they are roughly 60 of PH-02's tests, and they are the reason this phase costs 40 IEH rather than 12.

## 37.4 Property Laws

| Law | Statement | Cases |
|---|---|---|
| **PT-10** | For **all** generated inputs: output contains no markup, no control characters, and is within the length bound | ≥ 1,000 |
| **PT-11** | `normalize(normalize(x)) ≡ normalize(x)` | ≥ 1,000 |

**ID-13 applies: these are written before or with the implementation, never after.** A property written afterward tends to encode what the implementation does rather than what the law requires.

## 37.5 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-101 `core/normalize/index.mjs` · DEL-102 `unicode.mjs` · DEL-103 `whitespace.mjs` · DEL-104 `markup.mjs` · DEL-105 `url.mjs` · DEL-106 adversarial corpus tests · DEL-107 PT-10 and PT-11 · DEL-108 `tests/security/xss-fixture.test.mjs` |
| **Acceptance** | Eight steps in order; markup removed; graphemes respected; URLs host-allowlist validated with off-allowlist values nulled; self-check produces the critical class |
| **Exit** | `core/normalize/**` ≥ **95%** coverage; PT-10 and PT-11 green at ≥ 1,000 cases; the full adversarial corpus green; `security.xss-fixture` green against fixture 019 (which does not exist until PH-13 — so this exit criterion is satisfied initially by an inline adversarial string and **re-verified** at PH-13) |

## 37.6 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | **None available.** A normalizer defect is corrected forward, never rolled back — reverting removes the boundary entirely. If a defect is found in production, the response is to stop publishing (set `TPRE_POLICY_ENABLED=false`), fix, and regenerate with `tpre project` |
| **Verification** | Second reviewer independently constructs five adversarial strings **without reading the test file** and confirms all five produce safe output. This is the highest-value 30 minutes in the project |
| **Testing** | Unit ×~60 adversarial · Property PT-10, PT-11 · Security `xss-fixture` · Chaos CH-14 (PH-21) |
| **Documentation** | Module header stating what it does and explicitly what it does not (it does not validate, does not decide, does not escape); `frontend/renderer/SAFETY.md` cross-reference |
| **Future** | Additional Unicode security profiles as they are standardised (v1.1, data-driven); **never** a "permissive mode" — the request will be made and the answer is no |

---

# 36. Hash Generator

**Phase PH-01 (`core/util/hash.mjs`) + PH-03 (`core/identity/*`) · Sprint SP-1 · Difficulty D3**

| Field | Value |
|---|---|
| **Purpose** | Produce stable, versioned, cross-adapter-portable identity for every review, and content hashes that change exactly when content changes and never otherwise. |
| **Objectives** | (1) Canonical serialisation with stable key order. (2) SHA-256 digest helpers. (3) Author-key normalisation. (4) Identity hash from six ordered, cross-adapter-available inputs. (5) Content hash from nine inputs with explicit exclusions. (6) **`generated_at` excluded from every content hash.** (7) PT-08 and PT-09. |
| **Dependencies** | PH-01 for `hash.mjs`; PH-02 (normalize) for identity — identity is computed over **normalised** text |
| **Estimated Complexity** | **D3**, with one **D4** consequence: an identity change invalidates every stored id and is on TRD §66.8's irreversible list |
| **Estimated Time** | 8 IEH (PH-01) + 16 IEH (PH-03) |
| **Risks** | **IR-06 — `generated_at` accidentally included in a content hash**, producing a rewrite of every file on every run and ~50× commit churn · identity derived from source-specific ids, breaking INV-10's migration guarantee · homoglyph author names merged, collapsing two distinct people into one · unstable key ordering making hashes platform-dependent |
| **Plan risks** | PR-13 |

## 36.1 Implementation Order

| # | Step | Phase | Test |
|---|---|---|---|
| 1 | Canonical serialisation — stable key order, no insignificant whitespace | PH-01 | Same object, different key insertion order ⇒ identical bytes |
| 2 | SHA-256 digest helper | PH-01 | Known-vector test |
| 3 | `identity/author-key.mjs` — casefold, diacritic strip, punctuation strip, collapse, hash | PH-03 | **Homoglyphs must NOT merge**; diacritics must |
| 4 | `identity/identity-hash.mjs` — six ordered inputs (TRD §53.3), 32-hex output, **versioned** | PH-03 | **PT-08** (cross-adapter), **PT-09** (stability) |
| 5 | `identity/content-hash.mjs` — nine inputs, explicit exclusions | PH-03 | Stability across harvests; `relative_date` excluded |
| 6 | The `generated_at` exclusion, asserted as a matched pair (TR-HASH-034/035) | PH-03 | Two runs, unchanged content ⇒ identical hash |

| ID | Requirement |
|---|---|
| HASH-01 | Identity MUST use only fields available across **all** adapters (EDR-036). A `place_id`-derived identity is free today and blocks the API migration that RISK-03 exists to enable. |
| HASH-02 | Identity hashing MUST be **versioned**. A future algorithm change is then a declared migration rather than a silent id churn. |
| HASH-03 | `generated_at` MUST be excluded from every content hash (EDR-022, TR-HASH-034). This is asserted by a test that runs the projector twice with different clocks and compares bytes. |
| HASH-04 | Author-key normalisation MUST strip diacritics and MUST NOT merge homoglyphs. These pull in opposite directions and both have explicit tests. |

## 36.2 PT-08 Is Scheduled Twice

PT-08 (cross-adapter identity) cannot be *fully* satisfied in PH-03, because only one adapter will exist. The plan handles this explicitly:

| When | What Is Asserted |
|---|---|
| PH-03 (SP-1) | The law, against **synthetic** records constructed as if from two adapters — proves the derivation uses no adapter-specific field |
| PH-11 (SP-4) | Re-run against the CSV adapter's real output alongside synthetic DOM output |
| **PH-22 (SP-7)** | **Re-run against genuine output from all four adapters** — the real proof, and an MS-8 exit criterion |

**Manager Note.** This is why PH-22 (API adapters) is above the cut line in §9.5's ordering discussion but its *second* adapter is cuttable. With two adapters PT-08 is proven; with four it is proven better. With one it is not proven at all.

## 36.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-109 `core/util/hash.mjs` · DEL-110 `core/identity/author-key.mjs` · DEL-111 `identity-hash.mjs` · DEL-112 `content-hash.mjs` · DEL-113 PT-08 · DEL-114 PT-09 |
| **Acceptance** | Canonical serialisation stable; identity versioned and adapter-neutral; content hash excludes `generated_at` and `relative_date`; homoglyphs separate; diacritics merge |
| **Exit** | `core/identity/**` ≥ 95%; PT-08 and PT-09 green at ≥ 1,000 cases; the two-clock byte-identity test green; a documented hash version constant exists |

## 36.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | **Not rollbackable after first publication** — TRD §66.8 lists identity migration as irreversible because consumers persisting `id` see every review as new. This is why the algorithm is versioned from day one and why PH-03 gets a second reviewer |
| **Verification** | Reviewer constructs two records differing only in `generated_at` and confirms identical content hashes; constructs two homoglyph author names and confirms distinct keys |
| **Testing** | Unit: canonical serialisation, digests, author-key normalisation, homoglyph separation, append-tolerance of the 512-grapheme window · Property: PT-08, PT-09 |
| **Documentation** | The six identity inputs and why each is cross-adapter-available; the nine content inputs and the exclusions, each with its reason |
| **Future** | Identity algorithm v2 with a documented migration (v2); the migration procedure itself is written now, in `docs/runbooks/`, because writing it during the migration is too late |

---

# 34. Review Validation

**Phase PH-04 · Sprint SP-2 · Difficulty D3 · 26 IEH**

| Field | Value |
|---|---|
| **Purpose** | Produce findings about a harvest — per record and in aggregate — without modifying any data, so that downstream decisions (reconcile, gate) act on evidence rather than on guesses. |
| **Objectives** | (1) Per-record findings with severity. (2) Aggregate metrics: coverage, duplicates, plausibility, rating distribution, quarantine rate. (3) **Completeness classification: `full` / `full_capped` / `partial` / `failed`.** (4) Threshold boundary behaviour. (5) No mutation of inputs. |
| **Dependencies** | PH-02 (normalize), PH-03 (identity, dates) |
| **Estimated Complexity** | **D3**, elevated because completeness classification is the input to the absence asymmetry |
| **Estimated Time** | 26 IEH |
| **Risks** | Completeness inferred from counts rather than from the navigator's stop reason — the defect CH-04 exists to catch · validation mutating records "while it is already iterating" · thresholds compared with the wrong inequality at the boundary · `coverage` and `completeness` used interchangeably (TR-STD-080 — a correctness defect, not a style issue) |

## 34.1 The Vocabulary Rule Is a Correctness Rule Here

| Term | Type | Meaning |
|---|---|---|
| `coverage` | number in [0,1] | extracted ÷ advertised |
| `completeness` | enum | `full` / `full_capped` / `partial` / `failed` |

TR-STD-080 forbids using them interchangeably. In this phase specifically, confusing them means the gate compares a ratio where it should compare a classification, and CH-04's protection silently disappears. **Every PR in PH-04 is reviewed against this rule explicitly.**

## 34.2 Implementation Order

| # | Step | Test |
|---|---|---|
| 1 | `validate/record.mjs` — per-record findings, each with a severity, no mutation | One test per finding type; an immutability assertion |
| 2 | Coverage computation from extracted vs advertised | Boundary: exactly at `coverage_min`, one below, one above |
| 3 | Duplicate detection findings (feeding §35) | Intra-run duplicates flagged, not removed |
| 4 | Plausibility and rating-distribution checks | Implausible distributions produce findings, not errors |
| 5 | Quarantine-rate computation | Boundary at `quarantine_max` |
| 6 | **`validate/completeness.mjs` — classification from the stop reason** | **CH-04**: a stalled harvest ⇒ `partial`, never `full` |
| 7 | `ValidationReport` assembly | Schema-validated |

| ID | Requirement |
|---|---|
| VAL-01 | Completeness MUST be derived from the navigator's stop reason (§31), never from counts alone. A harvest that stopped at 12 of 118 has a perfectly plausible count. |
| VAL-02 | Validation MUST NOT modify data. It produces findings; the reconciler and gate act on them. A validator that "cleans up while it is there" makes the pipeline's data flow untraceable. |
| VAL-03 | Every threshold comparison MUST have a boundary test at the exact value. Off-by-one-inclusive is the most common defect in threshold code and is invisible in normal operation. |

## 34.3 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-115 `core/validate/record.mjs` · DEL-116 `aggregate.mjs` · DEL-117 `completeness.mjs` · DEL-118 `ValidationReport` model · DEL-119 boundary test suite |
| **Acceptance** | Every finding type produced with correct severity; coverage arithmetic correct; completeness derived from stop reason; zero mutation |
| **Exit** | `core/validate/**` ≥ 95%; boundary tests at every threshold; a mutation-attempt test proves inputs are unchanged; the four completeness values each produced by a distinct scenario |

## 34.4 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Revert the phase; the reconciler cannot then classify absence and PH-05 is blocked. In practice this phase is corrected forward |
| **Verification** | Reviewer confirms `completeness` is never computed from a count anywhere in the module (code search for the classification function's inputs) |
| **Testing** | Unit: per-finding ×~12, boundaries ×~10, completeness ×4 · Chaos: CH-04, CH-08 |
| **Documentation** | The findings catalogue with severities; the coverage-vs-completeness distinction, stated in the module header |
| **Future** | Anomaly detection on rating distribution over time (v2); per-client learned plausibility bands (v2) |

---

# 35. Duplicate Detection

**Phase PH-05 · Sprint SP-2 · Difficulty D4 · part of the 46 IEH reconciliation block**

| Field | Value |
|---|---|
| **Purpose** | Recognise the same logical review across harvests and within a single harvest, without merging two different people and without O(n²) cost. |
| **Objectives** | (1) Two-tier detection: exact identity hash, then near-duplicate similarity. (2) Deterministic intra-run collapse. (3) Bucketing rather than all-pairs comparison. (4) Threshold configurable with a named default. (5) Homoglyph separation preserved. |
| **Dependencies** | PH-03 (identity, similarity) |
| **Estimated Complexity** | **D4** — a false merge silently deletes a review from the client's payload |
| **Estimated Time** | 12 IEH within PH-05 |
| **Risks** | **IR-15 — near-duplicate detection implemented as all-pairs comparison**, which is invisible at 100 reviews and quadratic at 5,000 · intra-run collapse non-deterministic, so two runs over the same data produce different ledgers (breaking PT-02) · similarity threshold too low, merging distinct short reviews ("Great!" × 12 different authors) |

## 35.1 The Two Tiers

| Tier | Mechanism | Purpose |
|---|---|---|
| 1 | Exact `identity_hash` match | The same review seen again, across harvests |
| 2 | Normalised similarity ≥ `validate.near_duplicate_threshold` (0.92) **within the same author key** | The same review whose text was edited, or whose extraction varied |

| ID | Requirement |
|---|---|
| DUP-01 | Tier 2 MUST be scoped by author key, not applied across all reviews. Twelve different people writing "Great service!" are twelve reviews, and cross-author similarity merging deletes eleven of them. |
| DUP-02 | Comparison MUST be bucketed, never all-pairs (IR-15, TR-PERF-031). The bucket key is the author key; within a bucket, n is small by construction. |
| DUP-03 | Intra-run collapse MUST be deterministic (EDR-018) — the surviving record is chosen by a total ordering, not by iteration order. PT-02 depends on this. |
| DUP-04 | The threshold MUST be configurable with a named default (EP-05) and MUST have boundary tests at 0.92 exactly. |

## 35.2 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-120 duplicate detection within `core/reconcile/` · DEL-121 `core/util/similarity.mjs` · DEL-122 bucketing benchmark |
| **Acceptance** | Exact matches recognised; near-duplicates within an author key merged deterministically; cross-author similarity never merges; bucketed comparison |
| **Exit** | Determinism proven by PT-02 (shuffled input ⇒ identical ledger); the pure-pipeline benchmark at 1,000 reviews stays ≤ 2 s CPU (which all-pairs would fail); boundary tests at the threshold |

## 35.3 Rollback / Verification / Testing / Documentation / Future

| Field | Content |
|---|---|
| **Rollback** | Disable tier 2 (set the threshold to 1.0). Produces occasional duplicate display — visible, annoying, and **safe**. The opposite failure (over-merging) is invisible and destructive, so the rollback direction is always toward fewer merges |
| **Verification** | Reviewer constructs twelve identical short reviews from twelve authors and confirms twelve survive; constructs one review with a two-character edit and confirms one survives |
| **Testing** | Unit: tier 1 ×4, tier 2 ×8, bucketing ×3 · Property: PT-02, PT-09 · Performance: 1,000-review benchmark |
| **Documentation** | The two-tier rationale; why author-scoping is mandatory; the threshold's meaning in plain language |
| **Future** | Embedding-based similarity (v2, TRD §80) — explicitly **not** v1.0: a non-deterministic similarity function breaks PT-02 and PT-12 |

---

# 38. Review Ledger

**Phase PH-05 (shape + reconciliation) + PH-08 (persistence) · Sprints SP-2, SP-3 · Difficulty D5**

| Field | Value |
|---|---|
| **Purpose** | Hold the durable, complete, per-listing record of every review ever observed — including ones no longer visible — so that every published payload is regenerable from state without touching the network. |
| **Objectives** | (1) Ledger shape fixed in PH-01. (2) Pure, idempotent, order-independent reconciliation. (3) **The absence asymmetry.** (4) Confidence-gated removal and tombstoning. (5) Permanent suppression via the denylist. (6) Atomic persistence with unknown-field preservation. (7) PT-01…PT-07 and PT-15. |
| **Dependencies** | PH-01 (shape), PH-03 (identity), PH-04 (completeness), PH-07 (`fs-atomic`), PH-08 (state adapter) |
| **Estimated Complexity** | **D5.** The apex of the critical path. Two reviewers, no time pressure, no agent-led implementation |
| **Estimated Time** | 34 IEH (PH-05 reconciliation) + 28 IEH (PH-08 persistence) |
| **Risks** | **IR-01 — the absence asymmetry is "simplified"**, likelihood `High`, impact `Critical`. The only defect that can silently wipe a paying client's reviews · **IR-02 — purity leaks via a `Date.now()` default parameter**, voiding every property law without failing anything · **IR-24 — ledger implemented as an array**, O(n²) at 1,000 reviews · tombstones resurrected by a later observation (PT-03) · unknown fields stripped on write, so an older engine silently deletes a newer engine's data (TR-STOR-003) |
| **Plan risks** | PR-22, PR-23 |

## 38.1 The Absence Asymmetry — The Single Most Important Rule in the System

| Harvest Completeness | What Reconciliation May Mutate |
|---|---|
| `full` | Everything: insert, update, increment `missing_streak`, remove after confirmations |
| `full_capped` | Insert and update only; **no streak increment** — a capped harvest legitimately did not see older reviews |
| **`partial`** | **Insert and update only. Streaks and states are unchanged. Nothing is removed. Nothing is tombstoned.** |
| `failed` | Nothing. The ledger is not written at all |

| ID | Requirement |
|---|---|
| LEDG-01 | `missing_streak` MUST increment **only** when `completeness === 'full'` (INV-03, TR-REC). A `partial` harvest mutates no streak and no state. |
| LEDG-02 | **PT-07 MUST be written before the reconciliation implementation** (ID-13). It is the law; the code satisfies it, not the reverse. |
| LEDG-03 | `now` MUST be an explicit parameter (TR-STD-060, DR-2). A `Date.now()` default parameter is idiomatic JavaScript and voids fifteen property laws (IR-02, and TRD §1.5's Agent Note). |
| LEDG-04 | Reconciliation MUST return new objects and MUST NOT mutate its inputs (TRD §67.1). PT-01 depends on it. |
| LEDG-05 | If the reconciliation logic looks redundant, **it is not** (TRD A-4). Read PT-07 and CH-04 before touching it. |

**Agent Note.** This is the module TRD A-4 was written about. The absence asymmetry looks like three branches doing nearly the same thing, and "simplifying" it to one branch passes every example test — because example tests are written for the `full` case. PT-07 generates `partial` cases. An agent MUST NOT restructure this module, and Part 16 makes it a human-led task by rule.

## 38.2 Implementation Order (PH-05)

**Strictly sequential.** ID-13's "properties first" applies to steps 1–2.

| # | Step | Test Written First |
|---|---|---|
| 1 | **PT-01 (idempotence), PT-02 (commutativity), PT-07 (absence asymmetry) written as failing tests** | — |
| 2 | `reconcile/decide.mjs` — INSERT / UPDATE / UNCHANGED / MISSING classification | One test per branch |
| 3 | Streak arithmetic gated on completeness | **PT-07 turns green here** |
| 4 | `reconcile/removal.mjs` — confidence-gated removal after `removal_confirmations` (default 3) | **PT-03** (tombstone monotonicity) |
| 5 | Tombstoning: retained-but-not-published | PT-03 |
| 6 | `reconcile/suppress.mjs` — denylist application, permanent | **PT-04** (suppression durability) |
| 7 | `first_seen_at` preservation | **PT-05** |
| 8 | `reconcile/index.mjs` — the merge function composing all of it | **PT-01, PT-02** turn green |
| 9 | Map-backed record storage (not an array) | Benchmark at 1,000 and 5,000 reviews |

## 38.3 Implementation Order (PH-08 — Persistence)

| # | Step | Test |
|---|---|---|
| 1 | `infra/fs-atomic.mjs` — write-temp-then-rename, the **only** permitted write path | Crash injection: temp file present, target untouched |
| 2 | Ledger serialisation: pretty-printed, stable key order, trailing newline | Byte-stability across runs |
| 3 | Ledger parsing with **unknown-field preservation** | **PT-15** round-trip including unknown fields |
| 4 | `adapters/state/git-state.mjs` — ledger, cache, health, breaker paths | Path templates from one module (TR-STD-110) |
| 5 | Corrupt-ledger handling ⇒ `ERR-STATE-CORRUPT`, target aborts, LKG retained | **CH-10** |
| 6 | `adapters/publisher/filesystem.mjs` — local development publication | Integration |

| ID | Requirement |
|---|---|
| LEDG-06 | Every file write MUST be write-temp-then-rename (TR-STOR-001). A partially-written ledger is unrecoverable; a partially-written temp file is inert. |
| LEDG-07 | Unknown fields encountered on read MUST be preserved on write (TR-STOR-003, PT-15). Without it, running an older engine against a newer ledger silently deletes data. |
| LEDG-08 | Path templates MUST be constructed in exactly one module per store (TR-STD-110). A path built two ways will eventually be built two ways. |

## 38.4 Deliverables / Acceptance / Exit

| Field | Content |
|---|---|
| **Deliverables** | DEL-123 `core/model/ledger.mjs` · DEL-124 `core/reconcile/index.mjs` · DEL-125 `decide.mjs` · DEL-126 `removal.mjs` · DEL-127 `suppress.mjs` · DEL-128 `infra/fs-atomic.mjs` · DEL-129 `adapters/state/git-state.mjs` · DEL-130 PT-01…PT-07, PT-15 · DEL-131 `tests/integration/state.roundtrip.test.mjs` |
| **Acceptance** | Pure, idempotent, order-independent; asymmetry enforced; removal confidence-gated; suppression permanent; atomic writes; unknown fields preserved |
| **Exit** | `core/reconcile/**` ≥ **95%**; **PT-01, PT-02, PT-03, PT-04, PT-05, PT-06, PT-07, PT-15 all green at ≥ 1,000 cases**; DR-2 architecture test green (no clock in `core/`); state round-trip integration green; CH-10 green in PH-21; the 1,000-review benchmark ≤ 2 s CPU |

## 38.5 Rollback Strategy

| Situation | Response |
|---|---|
| Reconciliation defect found pre-publication | Revert the PR; PT tests re-run |
| Reconciliation defect found post-publication | **Do not roll back the ledger first.** Fix the code, then run `tpre project` to regenerate payloads from the (sound) ledger. Only if the ledger itself is unsound does §66.6's ledger rollback apply |
| Ledger corruption | `ERR-STATE-CORRUPT`, target aborts, LKG retained; recovery per §66.6 — checkout the last schema-valid version, then run a harvest; **idempotence re-derives everything since** |
| Total `state` branch loss | Rebuild from the offsite mirror; if unavailable, the ledger is regenerable from a full harvest with the loss of `first_seen_at` history only |

**The third row is the payoff of PT-01.** Because reconciliation is idempotent, a ledger rolled back to any prior state re-converges after one harvest. That property is what makes ledger rollback a five-minute operation rather than a data-loss event.

## 38.6 Verification Checklist

- [ ] Second reviewer traces a `partial` harvest through `decide.mjs` by hand and confirms zero streak mutations
- [ ] Second reviewer confirms `now` is a required parameter with no default, in every function
- [ ] Reviewer confirms records are stored in a map, not an array
- [ ] Reviewer runs PT-07 with the completeness check removed and confirms it **fails** — the only proof the test tests anything
- [ ] Reviewer adds an unknown field to a fixture ledger, round-trips it, and confirms preservation
- [ ] Reviewer kills the process mid-write (crash injection) and confirms the target file is untouched

## 38.7 Testing / Documentation / Future

| Field | Content |
|---|---|
| **Testing** | Unit: every decision branch, streak arithmetic, tombstone and suppression handling, removal confirmations at 2/3/10 · Property: PT-01…PT-07, PT-15 · Integration: state round-trip, atomic write, corrupt ledger · Chaos: CH-04, CH-10, CH-12 |
| **Documentation** | The ledger record lifecycle state diagram; **a written explanation of the absence asymmetry in the module header**, because the next person to read it will be tempted to simplify it; the tombstone vs suppression distinction |
| **Future** | Ledger compaction for listings exceeding 5,000 reviews (v1.1); database-backed `StatePort` (v2, TRD §87) — the seam already exists |

---

## Part 6 Cross-Cutting Exit Criteria

These five systems together constitute the correctness argument for the entire product. MS-1 and MS-2 do not close until all of the following hold.

| # | Criterion | Section | Enforcing Test |
|---|---|---|---|
| 1 | For all inputs, output is safe as plain text | §37 | **PT-10**, CH-14, `security.xss-fixture` |
| 2 | Normalisation is idempotent | §37 | PT-11 |
| 3 | Identity is stable and cross-adapter portable | §36 | PT-08, PT-09 |
| 4 | Content hashes exclude `generated_at` | §36 | Two-clock byte-identity test |
| 5 | Completeness is derived from the stop reason | §34 | CH-04 |
| 6 | Duplicates never merge across authors | §35 | Unit + PT-02 |
| 7 | **Absence never deletes** | §38 | **PT-07, CH-04** |
| 8 | Reconciliation is idempotent and order-independent | §38 | PT-01, PT-02 |
| 9 | Tombstones never resurrect; suppressions never return | §38 | PT-03, PT-04 |
| 10 | Ledgers round-trip with unknown fields preserved | §38 | PT-15 |

**If any one of these ten is not green, the project does not proceed to Part 7.** That is not a stylistic position; it is §5.7's fourth row. Everything downstream derives from this part, and a defect here is invisible until it has already reached a client.

---

*End of Part 6. Part 7 specifies JSON generation, validation, the publication pipeline, rollback, and recovery.*
