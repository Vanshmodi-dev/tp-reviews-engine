# Dependencies

Every production dependency needs a written justification and reviewer approval
(DEP-1). **The target is two, not ten** (TRD §10.2). This file is the record.

## Production

| Package      | Version | Role               | Justification                                                                                                                                                                                                       | If dropped                                   |
| ------------ | ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `playwright` | `^1.62` | Browser automation | Irreplaceable core capability. The target renders reviews client-side into a virtualised container; there is no server-rendered markup to parse, so there is nothing for an HTTP client to fetch (SAD §2, EDR-002). | Puppeteer — documented, confined to one file |

**One package, one importer.** `src/adapters/browser/playwright-chromium.mjs`
is the only file that may import it (TR-BRW-001), enforced by a lint rule _and_
by `tests/architecture/browser-confinement.test.mjs`. Two mechanisms because
this is the rule whose violation is most tempting and least visible — the usual
breach is the navigator importing it "just for a type", which makes the
navigator untestable without Chromium and takes the pure pipeline with it.

That confinement is what makes the Puppeteer migration path real rather than
aspirational: it is one file, and it stays one file only while the guards hold.

### DEP-3 review — `playwright`

| Check              | Finding                                                                                                                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native compilation | None. Ships a Node client that talks to a browser process over a pipe.                                                                                                                                                                     |
| Postinstall script | **Yes** — downloads the browser build. Reviewed and accepted: it is the mechanism by which the Chromium pin is honoured, and it writes only to its own cache directory. CI installs it as an explicit, cached step rather than implicitly. |
| Transitive depth   | `playwright` → `playwright-core`. Two levels; well inside the three-level limit.                                                                                                                                                           |
| Chromium pin       | Pinned through the Playwright version in `package-lock.json` (TR-BRW-011). **Never auto-upgraded** — DEP-5, and a browser bump lands as its own pull request that must pass the full fixture corpus and a live canary (TR-BRW-013).        |

### Two production dependencies were budgeted; one is in use

TRD §10.2 also lists a **JSON Schema validator**. It has not been added, and
the reason is recorded rather than left to be rediscovered: `validate:schemas`
currently checks that every JSON artifact parses, that every selector pack
satisfies the rules the schema _cannot_ express, and that every profile pins a
pack that exists. None of that needs a validator.

The point at which one earns its place is gate rule **G-01** — full payload
validation before publication. Until then, DEP-2 applies: no dependency for
work that is under a hundred readable lines.

The argument parser and the relative-date helper (OIQ-01, OIQ-02) were both
resolved toward "not needed": Node's built-in parser is sufficient, and the
six-locale phrase table is data.

## Development only

| Package                  | Role               | Notes                                                               |
| ------------------------ | ------------------ | ------------------------------------------------------------------- |
| `vitest`                 | Test runner        | ESM-native, no transpilation, good coverage integration.            |
| `@vitest/coverage-v8`    | Coverage           | The Gate's coverage obligation is load-bearing, not decorative.     |
| `fast-check`             | Property testing   | The property laws are how INV-03 and INV-04 are held. Not optional. |
| `parse5`                 | Fixture sanitising | **OIQ-03, resolved here.** See below.                               |
| `eslint` + `@eslint/js`  | Structural limits  | Enforces TRD §67 mechanically.                                      |
| `prettier`               | Formatting         | Removes formatting from review entirely.                            |
| `typescript`             | `checkJs` checking | Provides the type safety that replaces a compile step.              |
| `globals`, `@types/node` | Type/lint support  | —                                                                   |

### OIQ-03 — which HTML parser for offline fixture work

**`parse5`**, development-only, and it never appears in production dependencies.

It has exactly one job: `scripts/sanitize-html.mjs`. Sanitising markup with
regular expressions is the classic way to ship a sanitiser that does not
sanitise — `<scr<script>ipt>` defeats a single-pass tag stripper and does not
defeat a tree walk — so that file needs a spec-compliant parser.

`core/extract` reads markup **without** it, because TRD §10.4 gives `core/`
zero dependencies and TR-EXT-010 requires the extractor to accept a string.
Those two together leave one design, and the narrowing that makes a small
hand-written reader defensible is that its input is markup `parse5` already
produced and re-serialised.

DEP-3: no native compilation, no postinstall, one transitive dependency
(`entities`), which itself has none.

## The two that must stay at zero

| Surface              | Dependencies | Why                                                                                              |
| -------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `src/core/`          | **0**        | DR-1 forbids any I/O-capable package, which excludes essentially every npm package worth adding. |
| `frontend/renderer/` | **0**        | DEP-6, non-negotiable: it executes on client websites TradyPerch does not control.               |

Both are asserted by `tests/architecture/`, not by convention.
