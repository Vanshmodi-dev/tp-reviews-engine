# `adapters/` — concrete implementations, one port each

**The rule: an adapter implements exactly one port and never imports another
adapter.**

Everything that talks to the outside world lives here and nowhere else. An
adapter may import from `core/`, `ports/`, and `infra/`. It may not import a
sibling adapter, and it may not be constructed anywhere except
`cli/composition.mjs`.

**Why sibling imports are forbidden rather than discouraged.** The moment the
DOM adapter imports the Places API adapter — even for one shared mapping
helper — losing a source stops being a configuration change and becomes a code
change. The whole point of the acquisition port is that an adapter can be
switched off in a client config in under an hour. Shared logic between adapters
belongs in `core/` if it is pure, or in `infra/` if it is generic. If it is
neither, it is a sign the port contract is missing something.

Two constraints here are safety properties rather than style:

- `browser/playwright-chromium.mjs` is the **only** file in the repository that
  may import `playwright`. That confinement is what makes the documented
  migration to another browser driver a one-file exercise.
- An adapter whose required secret is missing fails closed with
  `ERR-CONFIG-SECRET-MISSING` and exits. It must never fall back to another
  adapter. An expired OAuth token silently downgrading a sanctioned API client
  to unsanctioned DOM scraping is a serious policy violation arising from a
  trivial operational event, and it is designed out rather than trusted to
  attention.

Every adapter declares its capabilities honestly — including reduced ones. An
adapter that can only return five reviews says so.

Specified by TRD §6.4.1, §7.6, and §70. Dependency rules DR-3 and DR-5;
TR-SEC-010.
