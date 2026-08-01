# `selectors/` — versioned packs of volatile knowledge

**The rule: a merged pack is never edited. A change creates `v<n+1>.json`.**

This directory isolates the single most volatile knowledge in the system — how
to find a rating, an author, or a review body in someone else's markup — into
versioned data files that carry no code. When the markup changes, the fix is a
new JSON file and a one-line profile edit, not an engine release.

**Why old packs are kept forever.** Fixtures captured under pack `v2` continue
to be tested against `v2`. That is what proves the golden corpus tests
*extraction* rather than today's markup. Delete `v2` and the corpus silently
starts asserting that the parser matches whatever the site looks like now, which
is the opposite of a regression test.

Three further rules:

- **Every pack validates against `schema/selector-pack.schema.json` at load
  time.** A malformed pack fails immediately with `ERR-PARSE-SELECTOR-PACK`,
  never as a mysterious extraction failure three stages later.
- **Version pinning lives in a profile**, never in a client config and never in
  code. That is what makes a staged rollout possible: point `conservative` at
  the new pack, observe one cycle, then move `default`. A staged rollout of the
  highest-risk change in the system, achieved with a one-line edit in two files.
- **`assertions.json` is structural, not content-based.** The canary asserts
  that the page still has the shape the pack expects, so a break is detected on
  a reference listing before it reaches a paying client.

Each pack records the date it was authored and the fixture cases it was
validated against.

Specified by TRD §6.5. TR-SEL-001 through TR-SEL-004.
