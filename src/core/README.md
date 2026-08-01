# `core/` — the pure kernel

**The rule: everything in here is a pure function of its arguments.**

No I/O, no clock, no randomness, no environment, no network, no filesystem. The
only `node:` built-in that may be imported is `node:crypto`, and only for
SHA-256 digests. No package dependency of any kind. Nothing here throws —
failures are returned as `Result` values, so the set of failures a function can
produce stays visible in its contract instead of accumulating in undocumented
throw sites. Nothing outside `core/` may import past `core/index.mjs`.

**Why it is worth the inconvenience.** Six of the eleven pipeline stages live
here, and the pure pipeline is under 1% of runtime — which means there is no
engineering reason to trade clarity for speed, and every reason to make this
code exhaustively testable. Fifteen property laws are asserted against these
modules; all fifteen depend on determinism. A single `Date.now()` as a default
parameter value voids all of them without failing anything, which is precisely
what makes the rule structural rather than advisory: it is enforced by an ESLint
override on `src/core/**` and by the architecture test, not by anyone
remembering it during review.

`reconcile/`, `normalize/`, `identity/`, and `gate/` are D4/D5 by rule. Their
correctness is not observable from the happy path.

Specified by TRD §67.4 and §6.4.1. Dependency rules DR-1 and DR-2.
