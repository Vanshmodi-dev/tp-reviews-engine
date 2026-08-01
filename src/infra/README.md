# `infra/` — generic technical utilities

**The rule: nothing in here may know what a review is.**

`infra/` holds domain-ignorant infrastructure — logging, retry execution,
circuit breaking, rate limiting, atomic file writes, git invocation, HTTP,
clock, randomness, diagnostics capture. It is the layer that would be
substantially reusable in a completely different product.

**The test is simple, and it is the rule most often broken.** If a function's
name or body mentions a domain noun — review, listing, ledger, client, rating,
author — it is not infrastructure and it belongs in `core/`. A "review-aware
retry policy" is not a retry policy; it is reconciliation logic wearing a retry
policy's name, and once it lives here it is outside the reach of every property
law that guards the domain.

The inverse direction is equally load-bearing: `infra/retry/execute.mjs`
executes retries but never classifies errors itself, and
`infra/retry/policy.mjs` is a lookup table that returns `never` for every
`ERR-BLOCKED-*` class. Retry policy is data, so that "never retry a challenge"
is a value that can be asserted rather than a branch someone must not add.

`infra/logger/redact.mjs` carries a 100% coverage requirement. It is seeded with
every secret value at startup and is the only thing standing between a secret
and a public CI log.

Specified by TRD §6.4.1 and §7.6.
