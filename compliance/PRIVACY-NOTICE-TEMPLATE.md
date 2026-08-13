# Privacy notice template

**§65.2 item 14 · SAD §15.8 · TRD §6.6 · TR-CFG-011, FR-087**

The notice a **client** publishes on their own site describing the reviews
displayed there. TradyPerch provides the template; the client publishes it.

Give this to the client during onboarding and record the date in their
authorisation record (§4 of `authorizations/TEMPLATE.md`). It is a blocking
onboarding prerequisite — not because a form is required, but because
reviewer names, photographs and opinions are personal data and third-party
content (CON-21), and the person whose name is displayed needs a route to
having it removed.

Replace every `<placeholder>`. Delete nothing else without reading §15.8.

---

## Template begins

### About the reviews shown on this page

The reviews displayed on this page were left by customers on our
`<Google Business Profile / other platform>` listing. We display them here so
you can read them without leaving our site.

**Where they come from.** They are copied from our own public listing at
`<listing URL>`. We do not write, edit, or reword them.

**How often they update.** Automatically, roughly `<daily / twice daily /
weekly>`. Updates are best-effort — if a review appeared on the platform very
recently, it may not be here yet.

**What we show.** The reviewer's display name as it appears publicly, their
star rating, the text of their review, its approximate date, and our reply if
we made one.

**What we do not do.**

- We do not hide, filter, or reorder reviews to make our rating look better.
  Low ratings are shown alongside high ones.
- We do not edit the words of a review.
- We do not re-host reviewer photographs.
- Your browser does not contact `<the platform>` when you view this page. No
  request leaves our site for these reviews, and no third party is told that
  you read them.

**If a review is missing.** Occasionally the platform changes how its pages are
built and our updates pause. When that happens we keep showing the reviews we
already had rather than removing any — so a temporarily out-of-date list is
possible, but reviews are never silently dropped.

### If you left a review and want it removed from this page

Contact us at `<client contact email>` and tell us which review is yours. We
will remove it from this page permanently, usually within `<N>` working days,
and it will not reappear in later updates.

Removing it here does **not** remove it from `<the platform>` — only the
platform can do that, and you can do it yourself from your own account there.

You can also ask us what we hold about you, or object to us displaying it, at
the same address.

### Who is responsible

`<Client legal entity name>` is the data controller for this page.
`<Registered address>` · `<contact email>`

`<Optional: "Our reviews display is operated on our behalf by TradyPerch, who
act as our processor.">`

Last updated: `<YYYY-MM-DD>`

## Template ends

---

## Notes for the account manager — not for the client's site

| Point                                            | Why it is worded that way                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| "best-effort"                                    | Sets the expectation the architecture actually meets. Promising real-time creates a support burden the design deliberately does not carry |
| "we keep showing the reviews we already had"     | INV-03 stated in plain language. It is the behaviour most likely to prompt a client question, so it is answered before it is asked        |
| "your browser does not contact `<the platform>`" | INV-01. It is a genuine privacy advantage over an embedded widget and worth stating                                                       |
| "does not remove it from `<the platform>`"       | Prevents a removal request being read as a platform deletion. Getting this wrong produces a complaint that TradyPerch cannot resolve      |
| Suppression is permanent                         | There is no un-suppress path, by design (`compliance/README.md`). Do not offer the client one                                             |

**On removal requests:** they are actioned through `compliance/denylist.json` on
`main`, never in a ledger. A suppression that lived only in `state` would be
resurrected by a documented recovery procedure — turning a recoverable incident
into a compliance breach.
