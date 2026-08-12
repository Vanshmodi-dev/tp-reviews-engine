# Website integration

**§50 · PH-23**

Two files, zero dependencies, one request — to your own origin.

| File                      | What it is                                                           |
| ------------------------- | -------------------------------------------------------------------- |
| `renderer/tp-reviews.mjs` | The reference renderer. ESM, no imports, no build step.              |
| `renderer/tp-reviews.css` | Structural base styles. Unopinionated; theme with custom properties. |
| `SAFETY.md`               | **Read this before changing anything under `frontend/`.**            |
| `recipes/`                | Five integration recipes.                                            |

## Which recipe

| Your stack                     | Recipe                                            | Client-side requests        |
| ------------------------------ | ------------------------------------------------- | --------------------------- |
| Plain HTML, any CMS, WordPress | [static-html](recipes/static-html.md)             | 1                           |
| React (CRA, Vite, Remix)       | [react](recipes/react.md)                         | 1                           |
| Next.js App Router             | [nextjs-app-router](recipes/nextjs-app-router.md) | **0** — server-fetched      |
| Astro                          | [astro](recipes/astro.md)                         | **0** build-time, 1 runtime |
| Vue 3                          | [vue](recipes/vue.md)                             | 1                           |

"1 request" means one request, to **your** origin, for the payload. Never to
Google, never to us. That is INV-01 and it is the reason this whole system
exists — see `SAFETY.md` §3.

If your framework can read the payload at build or request time, prefer that
shape: `render(element, payload)` skips the fetch entirely. Otherwise
`mount(element, { src })` does it for you.

## The two APIs

```js
import { mount, render } from './tp-reviews.mjs';

// Fetches, then renders. Returns { ready, destroy }.
const widget = mount(document.querySelector('#reviews'), {
  src: '/data/reviews.json',
  pageSize: 10,
  emptyText: 'No reviews to show yet.',
  onError: (error) => myMonitoring.warn(error),
});

// Renders a payload you already have. No request is made.
render(document.querySelector('#reviews'), payload, { pageSize: 10 });
```

Always call `widget.destroy()` when the host component unmounts. In React's
StrictMode, skipping it leaves two mounted widgets in development and the
symptom — reviews rendered twice, dev only — sends you looking in the wrong
file.

## The three things people get wrong

### 1. Inline scripts and styles

An inline `<script type="module">` is blocked outright by `script-src 'self'`.
Put your integration in an external `.mjs` file. Do **not** add
`'unsafe-inline'` — that weakens the policy for your entire site so that one
section of one page can render.

The renderer itself evaluates nothing and writes no inline style, so it needs
no `script-src` or `style-src` exception at all.

### 2. `--tp-rows` must match `pageSize`

The container reserves its height in CSS before the payload arrives, so the
page does not shift when reviews land. CSS cannot read a JavaScript argument,
so this is one decision written in two places:

```css
.tp-reviews {
  --tp-rows: 10; /* the same number you pass as pageSize */
}
```

Too small and the page shifts; too large and you get a gap. If in doubt, round
up — a gap is cosmetic, a shift is in your Core Web Vitals.

### 3. Theming by overriding selectors

Set the custom properties instead. They are the supported surface; the class
names are not:

```css
.tp-reviews {
  --tp-color-star: #b8860b;
  --tp-color-text: #222;
  --tp-color-muted: #6b7280;
  --tp-color-line: #e5e7eb;
  --tp-space: 1rem;
  --tp-corner: 4px;
  --tp-row-height: 11em;
}
```

## Verifying an integration

Four checks, in the order a reviewer should do them (TR-CI-180 steps 6–7):

1. Open the page with the network panel. **Exactly one request** for review
   data, to your own host — and nothing to `google.com`, `googleapis.com`,
   `gstatic.com`, or anywhere else you did not put there.
2. Block that request and reload. A clean empty state, **no visible error**.
3. Watch the content below the widget while it loads. **It must not move.**
4. Tab to the pagination and press Enter. It must work, and the focus ring must
   be visible.

`examples/static/` runs all four automatically against a real browser
(`npm run test:browser`), under a strict CSP served as a real header.

## Budget

```
npm run size
```

The renderer is capped at **5 KB** and the check is blocking. The measurement
is deliberately conservative — comments and safe whitespace are stripped, but
identifiers are not mangled — so passing here guarantees passing under a real
minifier. See `scripts/size-report.mjs` for why that trade is made in that
direction.
