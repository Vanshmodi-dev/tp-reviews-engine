# Recipe — static HTML

**Priority P1 · the default, and the simplest proof of INV-01**

No build step, no framework, no package manager. Copy two files onto the site
and add four lines.

## Integrate

Copy `tp-reviews.mjs` and `tp-reviews.css` next to your pages, add a small
integration file of your own, and reference both:

```html
<link rel="stylesheet" href="/assets/tp-reviews.css" />
<div id="reviews"></div>
<script type="module" src="/assets/reviews-init.mjs"></script>
```

```js
// /assets/reviews-init.mjs
import { mount } from './tp-reviews.mjs';

mount(document.querySelector('#reviews'), {
  src: '/data/reviews.json',
  pageSize: 10,
});
```

**Use an external file, not an inline `<script type="module">`.** An inline
script is blocked outright by `script-src 'self'` — it needs `'unsafe-inline'`,
a hash, or a nonce, and the first of those weakens the policy for your whole
page in order to render reviews. That is a bad trade, and it is easy to make by
accident because the inline version is shorter to paste.

`src` is **your own origin**. It is the payload your engine publishes — copied
into your site's deploy, or served from a path your CDN already fronts. The
renderer has no other address and cannot acquire one.

### If you change `pageSize`, change `--tp-rows` too

The container reserves its height in CSS, before the payload arrives, so the
page does not shift when reviews land. CSS cannot read a JavaScript argument,
so the two are one decision written in two places:

```css
.tp-reviews {
  --tp-rows: 10; /* same number as pageSize */
}
```

Get it wrong and the reservation is the wrong size — too small shifts the page,
too large leaves a gap.

## Empty state

If `/data/reviews.json` is missing, returns a 404, or is malformed, the widget
renders `No reviews to show yet.` and nothing else. No error text, no console
noise on the page, no layout jump. That is the same thing a client with no
reviews yet sees, deliberately — see `SAFETY.md` §4.

To be told about it in your own monitoring:

```js
mount(el, {
  src: '/data/reviews.json',
  onError: (error) => myTelemetry.warn('reviews payload unavailable', error),
});
```

Override the wording with `emptyText: 'Be the first to review us.'`.

## CSP

The renderer needs `connect-src` for the payload origin only. Same-origin
payloads need no change at all under a default policy:

```
Content-Security-Policy: default-src 'self'; connect-src 'self'; style-src 'self'
```

If the payload is on a separate host you control:

```
connect-src 'self' https://data.example.com
```

**No `script-src` or `style-src` exception is needed**, provided you follow the
external-file pattern above. The renderer evaluates nothing and writes no
inline style, so `'unsafe-eval'` and `'unsafe-inline'` stay off.

If you find yourself adding either to make reviews work, the cause is almost
certainly one of two things, and neither needs a weaker policy:

| Symptom                           | Cause                                          | Fix                                    |
| --------------------------------- | ---------------------------------------------- | -------------------------------------- |
| Nothing renders at all            | The integration is an inline `<script>`        | Move it to an external `.mjs`          |
| Reviews render but the page jumps | Inline `<style>` blocked, or `--tp-rows` unset | Move styles to a file; set `--tp-rows` |

`examples/static/` runs under exactly this policy, served as a real header, so
a regression breaks it visibly rather than silently.

## Network assertion

**The claim:** rendering reviews causes exactly one request, to your origin.
Zero requests reach Google or any other third party.

Verify by hand — reviewer step, TR-CI-180 step 7:

1. Open the page with the network panel filtered to All.
2. Confirm exactly one request for review data, to your own host.
3. Confirm no request to any `google.com`, `googleapis.com`, `gstatic.com`, or
   any other origin you did not put there yourself.
4. Block that one request and reload. Confirm the clean empty state, with no
   visible error.

Verify automatically:

```js
const seen = [];

page.on('request', (request) => seen.push(new URL(request.url()).origin));
await page.goto('https://your-site.example/reviews');

const foreign = seen.filter((origin) => origin !== 'https://your-site.example');

if (foreign.length > 0) throw new Error(`third-party requests: ${foreign.join(', ')}`);
```

This is the property the whole architecture exists to provide, and this page is
the only place it is directly observable. `examples/static/` ships a working
version of exactly this check.
