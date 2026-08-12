# Recipe — Astro

**Priority P2**

Astro's default is zero client JavaScript, and the payload can be read at build
time. Used that way this recipe ships reviews as static HTML with **no runtime
request and no renderer download at all**.

Two shapes, and the choice matters.

## Integrate — build-time (recommended for a static site)

```astro
---
// src/components/Reviews.astro
const response = await fetch('https://data.example.com/reviews.json');
const payload = response.ok ? await response.json() : { reviews: [] };
const reviews = payload.reviews ?? [];
---

<div class="tp-reviews">
  {reviews.length === 0 ? (
    <p class="tp-reviews__empty">No reviews to show yet.</p>
  ) : (
    <ol class="tp-reviews__list" aria-label="Customer reviews">
      {reviews.map((review) => (
        <li class="tp-reviews__review">
          <div class="tp-reviews__head">
            <span class="tp-reviews__author">{review.author_name ?? 'Anonymous'}</span>
            <span class="tp-reviews__stars" role="img"
                  aria-label={`Rated ${review.rating} out of 5`}>
              {Array.from({ length: 5 }, (_, i) => (
                <span class:list={['tp-reviews__star',
                  { 'tp-reviews__star--filled': i < review.rating }]} aria-hidden="true" />
              ))}
            </span>
          </div>
          {review.text && <p class="tp-reviews__text">{review.text}</p>}
        </li>
      ))}
    </ol>
  )}
</div>

<link rel="stylesheet" href="/tp-reviews.css" />
```

Astro escapes interpolated values, so `{review.text}` is text, not markup —
the same guarantee `textContent` gives in the renderer. **Never** reach for
`set:html` here. It is Astro's `innerHTML` and it is forbidden for the same
reason (`SAFETY.md` §1).

Reviews change when you rebuild. Trigger a rebuild from your publish workflow
if you want them fresher than your deploy cadence.

## Integrate — runtime

If you need reviews to update without a rebuild, use the renderer directly:

```astro
<div id="reviews"></div>
<link rel="stylesheet" href="/tp-reviews.css" />

<script>
  import { mount } from '../scripts/tp-reviews.mjs';

  mount(document.querySelector('#reviews'), { src: '/data/reviews.json' });
</script>
```

Astro bundles this automatically. There is no `client:` directive because this
is a plain script, not a framework island — do not wrap it in one.

### If you change `pageSize`, change `--tp-rows` too

The container reserves its height in CSS before the payload arrives, so the page
does not shift when reviews land. CSS cannot read a JavaScript argument, so the
two are one decision written in two places:

```css
.tp-reviews {
  --tp-rows: 10; /* same number as pageSize */
}
```

The renderer writes no inline style, deliberately — `style-src 'self'` blocks
CSSOM style writes, so a reservation made in JavaScript would silently do
nothing on exactly the sites with the strictest policies.

## Empty state

Build-time: the ternary above renders the same `No reviews to show yet.` when
the fetch fails, because `payload` falls back to `{ reviews: [] }`.

Do **not** let a failed build-time fetch throw. It would fail the whole site
build over a review file, turning a cosmetic outage into a deploy outage.

Runtime: handled inside the renderer, as in the static-HTML recipe.

## CSP

Build-time needs nothing — there is no runtime request:

```
default-src 'self'
```

Runtime needs `connect-src` for the payload origin:

```
default-src 'self'; connect-src 'self' https://data.example.com
```

## Network assertion

**The claim:** the build-time form causes zero requests from the visitor's
browser; the runtime form causes exactly one, to your origin. Neither reaches
Google or any other third party.

```js
const seen = [];

page.on('request', (request) => seen.push(new URL(request.url()).origin));
await page.goto('https://your-site.example/reviews');
expect(seen.filter((origin) => origin !== 'https://your-site.example')).toEqual([]);
```

For the build-time form, also assert the output is genuinely static — otherwise
the recipe degrades to the runtime one without anyone noticing:

```js
const html = await readFile('dist/reviews/index.html', 'utf8');

expect(html).toContain('tp-reviews__review');
expect(html).not.toContain('data.example.com');
```
