# Authorisation record — `<client-slug>`

**T-335 · §65.2 item 11 · non-waivable (V-3, SAD §15.6, CON-22)**

Copy this file to `compliance/authorizations/<client-slug>.md`, fill every
field from the **written** instruction, and merge it before the client's config.

> **This record is not paperwork.** A studio harvesting _its own client's_
> reviews, at that client's written instruction, from that client's own
> listing, for display on that client's own site, is in a materially stronger
> position than an anonymous party bulk-collecting third-party data — on
> legitimate-interest grounds, on any implied-licence argument, and in how the
> activity would be characterised if challenged. Harvesting a listing the
> client does not own destroys all of it (SAD §15.6).
>
> There is no workaround for a missing record. If the client will not put it in
> writing, the listing is not harvested by the DOM adapter. The sanctioned
> alternative is the Business Profile API adapter (§15.7).

---

## 1. The five fields

These are the fields V-3 checks mechanically. They must match the
`authorization` block in `clients/<client-slug>.config.json` exactly — the
config is what the engine reads; this file is the evidence behind it.

| Field                | Value                                                                  |
| -------------------- | ---------------------------------------------------------------------- |
| `authorized_by`      | `<Name and role of the person at the client who gave the instruction>` |
| `authorization_date` | `<YYYY-MM-DD — the date of the written instruction>`                   |
| `relationship`       | `owner` **or** `authorized_agent` — no other value is permitted        |
| `evidence_ref`       | `compliance/authorizations/<client-slug>.md` (this file)               |
| `scope_ack`          | `true` — only after section 3 below has been confirmed with the client |

**On `relationship`.** This is CON-22 as a mechanism. `owner` means the client
owns the business the listing describes. `authorized_agent` means the client
has written authority to act for the owner — and if you select this, section 2
must say where that authority comes from. Anything else is not authorisation
and the engine will refuse the target.

## 2. The written instruction

| Question                                      | Answer                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Where is the original held?                   | `<inbox / contract system / signed order form — be specific enough to retrieve it>` |
| What form does it take?                       | `<email / signed order form / contract clause reference>`                           |
| Dated                                         | `<YYYY-MM-DD>`                                                                      |
| If `authorized_agent`, what is the authority? | `<contract clause, letter of authority, or "N/A — owner">`                          |

Quote the operative sentence verbatim:

> `<paste the sentence in which the client instructs TradyPerch to display their
reviews — not a summary>`

## 3. Scope acknowledgement

`scope_ack: true` asserts the client has been told **all** of the following.
Do not set it otherwise.

- [ ] Reviews are read from **publicly displayed content** on the platform's
      listing page.
- [ ] Updates are **best-effort**, on a schedule, not real-time.
- [ ] The engine **never edits, filters, or reorders** reviews to misrepresent
      them (CON-23). In particular, TradyPerch declines to filter out low
      ratings by default.
- [ ] If the platform's markup changes, the display **holds the last known good
      state** rather than showing fewer reviews — absence is not deletion
      (INV-03).
- [ ] Reviewer names and text are **personal data and third-party content**.
      The client publishes a privacy notice (§4 below) and the engine supports
      permanent suppression on request.
- [ ] The sanctioned **Business Profile API** alternative was offered, and the
      answer is recorded in the client config's `notes` (T-337, SAD §15.3.1).

## 4. Privacy notice

| Question                         | Answer                         |
| -------------------------------- | ------------------------------ |
| Template provided to the client? | `<yes — date>` (§65.2 item 14) |
| Published at                     | `<URL, once live>`             |

## 5. Withdrawal

Authorisation can be withdrawn at any time, in writing, with no notice period.
On withdrawal: set `enabled: false` in the client config and merge. That stops
acquisition at the next cycle; published payloads stop being refreshed.

| Event     | Date                              | Recorded by |
| --------- | --------------------------------- | ----------- |
| Granted   | `<YYYY-MM-DD>`                    | `<name>`    |
| Reviewed  | `<YYYY-MM-DD or "not yet">`       | `<name>`    |
| Withdrawn | `<YYYY-MM-DD or "not withdrawn">` | `<name>`    |

---

**Merged by:** `<EM name>` · **Date:** `<YYYY-MM-DD>` · **PR:** `<#>`
