# SAFETY — what the renderer will never do, and why

**DEL-189 · §50 · applies to everything under `frontend/`**

This file ships to websites TradyPerch does not control. That single fact is
the reason for every rule below. A defect in the engine costs us a re-run; a
defect here executes in a stranger's browser on a client's domain, and the
client discovers it before we do.

---

## 1. No HTML-injection API. Ever.

**Forbidden:** `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTML`,
`document.write`, `DOMParser`, `createContextualFragment`, `srcdoc`, `eval`,
`new Function`, `javascript:` URLs.

**Instead:** `document.createElement`, `textContent`, `append`,
`setAttribute`, `replaceChildren`.

Review text is a stranger's keystrokes that have travelled through a scraper.
It is the exact input these APIs exist to be dangerous with.

### "But the normalizer already strips markup"

It does. That is _why_ this rule holds, not a reason to relax it.

Two independent defences against a review body containing `<script>` is the
design. If the renderer used `innerHTML` on the grounds that the text arrives
clean, the whole of INV-05 would rest on one normalizer with no second opinion —
and the day someone adds a field to the payload that the normalizer does not
cover, there would be nothing behind it.

Enforced twice, because the two mechanisms fail differently:

| Mechanism                              | What it catches                                 | How it fails                                                              |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `no-restricted-properties` lint        | The literal property name, on save              | Blind to computed access; stops applying if a file lands outside the glob |
| `tests/security/renderer-api.test.mjs` | The shipped bytes, whatever syntax reached them | Slower; runs in CI                                                        |

The scan strips comments before matching, so this document and the renderer's
own header can keep naming these APIs. A guard that fires on its own
documentation gets an exemption added, and the exemption is what actually
breaks the rule.

---

## 2. No dependencies. No imports at all.

`frontend/renderer/tp-reviews.mjs` imports nothing — not a package, not a
sibling file.

A dependency here is a supply-chain risk **multiplied by client count**. One
compromised transitive package would execute on every client site
simultaneously, with no deploy of ours involved, and nothing on our side would
look different. Zero imports also keeps "what ships" answerable by reading one
path, which is what makes the size budget and the security scan meaningful.

Enforced by `no-restricted-syntax` on `ImportDeclaration` in `frontend/**`, by
the dependency-graph test, and by the API scan.

---

## 3. Exactly one request, to an origin the caller names

The renderer has no knowledge of Google and no ability to reach it. It fetches
the URL it is given — the client's own payload origin — and nothing else.

There is no hard-coded host anywhere in the file. Not a CDN, not a font, not an
icon sprite. The star rating is drawn with `clip-path` in CSS for this reason:
an icon font would be a second request from the visitor's browser that the
client never agreed to and cannot see.

**This is INV-01, the property the entire engine exists to provide:** the
visitor's browser never contacts a review source. Every other part of the
architecture — the scheduled harvest, the git-committed payload, the static
hosting — is in service of it. The consumer side is the only place it is
directly observable, which is why every recipe carries a network assertion
(FE-03) rather than a paragraph promising the same thing.

The request is sent with `credentials: 'omit'`. A payload is public data on the
client's own origin; attaching the visitor's session to a static asset fetch
would make it non-cacheable and would tie a person to a file that does not need
to know who they are.

---

## 4. A failure is never the visitor's problem

If the payload is unavailable — network error, 404, malformed JSON — the
renderer shows the **same empty state** a client with no reviews yet sees.

No error text. No "couldn't load reviews". No console-visible stack on the
page. A visitor who sees our outage learns something true and useless, on a
page they did not come to debug, in a widget that is not the point of the page.

The host page is told through the `onError` callback it opted into. That is the
right audience.

---

## 5. The page must not move — and the reservation must survive a strict CSP

The container is sized **before** the fetch is issued, so arriving reviews do
not push the rest of the page down. A renderer that grows the page on load puts
our defect in the client's Core Web Vitals, on a page we do not own.

The reservation lives entirely in `tp-reviews.css`:

```css
min-height: calc(var(--tp-rows) * var(--tp-row-height) + var(--tp-chrome-height));
```

**It used to be an inline `style.minHeight` written by the renderer, and that
was wrong.** `style-src 'self'` blocks inline style — CSSOM writes included —
so on exactly the security-conscious sites most likely to deploy this, the
reservation silently did nothing and the page shifted. A layout guarantee that
fails quietly under a strict CSP is worse than none, because it is believed.

Nothing under `frontend/` writes a style attribute. Two consequences:

- **`--tp-rows` must match the `pageSize` you pass the renderer.** CSS cannot
  read a JavaScript argument, so this is one decision written in two places.
  Every recipe documents it next to `pageSize`.
- **Rows are a fixed height and review text is clamped.** A row whose height
  varies with its content makes the reservation a guess, and a guess that is
  ever too small is the shift it exists to prevent. Clamping also stops one
  2,000-character review dominating a section that is not the point of the page.

Reserving slightly _more_ than the content needs costs a few pixels of gap.
Reserving less costs a layout shift. Round up.

### The same rule applies to your integration code

An inline `<script type="module">` is blocked by `script-src 'self'`. Put the
integration in an external `.mjs` file rather than asking a client to add
`'unsafe-inline'` — which would weaken the policy for their entire page in
order to render reviews. `examples/static/` is built this way for that reason,
and serves the strict policy as a real header so a regression breaks it
visibly.

---

## 6. Accessibility is not a later pass

- Star ratings carry a **text equivalent**. `role="img"` with
  `aria-label="Rated 4.0 out of 5"`, and the individual stars are
  `aria-hidden`. Five star characters read literally announce as "black star
  black star black star" and leave the listener counting.
- Pagination uses real `<button>` elements. Focusable, Enter- and
  Space-operable, and announced as buttons, with none of that reimplemented in
  a keydown handler that would be the thing to quietly break.
- The active page is marked with `aria-current`, **not** `disabled`. Disabling
  it removes it from the tab order, so a keyboard user loses their place at the
  one control that says where they are.
- `:focus-visible` is restyled, never removed.

---

## 7. Things that look helpful and are not

| Tempting                                   | Why not                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `innerHTML` for a bold author name         | See §1. Build a `<strong>` and set `textContent`.                         |
| A tiny sanitizer library                   | A dependency (§2). If you need to sanitize, you have already parsed HTML. |
| Lazy-loading avatars from the source's CDN | A third-party request from the visitor's browser. Breaks INV-01 (§3).     |
| Showing "Reviews temporarily unavailable"  | Breaks §4.                                                                |
| `min-height: auto` "so it fits better"     | Breaks §5.                                                                |
| `outline: none` on the pagination          | Breaks §6.                                                                |
| Adding a second file under `frontend/`     | Breaks the one-file guarantee the budget and scan rest on (§2).           |

---

## 8. If you need to change this file

The rules above are enforced by tests that will fail, and each one names the
requirement it protects. If a change here is genuinely right, change the
requirement in `docs/` first and bring the test with it. Do not disable the
test to land the change — that inverts the only mechanism keeping this file
safe on sites we cannot inspect.
