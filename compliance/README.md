# `compliance/` — authorisations, suppressions, and privacy records

**The rule: `denylist.json` lives here on `main`, never in the Ledger.**

**Why that placement is a design decision and not filing.** If suppressions
lived only inside ledgers on the `state` branch, then rebuilding `state` from
scratch — a documented, expected recovery procedure — would resurrect every
review a data subject had asked to have removed. That turns a recoverable
incident into a compliance breach. Keeping the denylist on `main`, under review,
in source history, means an erasure obligation survives the total loss of
internal state.

Suppression is permanent. There is no un-suppress path, by design.

## `authorizations/`

One file per client, recording written authorisation from the business that
owns the listing: who authorised it, when, their relationship to the business,
where the evidence lives, and an acknowledgement of scope.

This is not paperwork. A studio harvesting _its own client's_ reviews, at that
client's written instruction, from that client's own listing, for display on
that client's own site, is in a materially stronger position than an anonymous
party bulk-collecting third-party data — on legitimate-interest grounds, on any
implied-licence argument, and simply in how the activity would be characterised
if challenged. Harvesting a listing the client does not own destroys all of it.

A client configuration using the `google:dom` adapter without a matching
authorisation record fails validation. That check is the mechanism by which the
paragraph above stays true under deadline pressure.

## `PRIVACY-NOTICE-TEMPLATE.md`

The notice a client publishes describing what is displayed, sourced from where,
refreshed how often, and how a reviewer requests removal.

Specified by SAD §15 and TRD §6.6. TR-CFG-011, FR-087.
