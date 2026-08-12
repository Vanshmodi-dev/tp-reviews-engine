# Recipe — React

**Priority P1 · the most requested**

The renderer owns its subtree; React owns the container. Do not try to make
React render the reviews — you would be reimplementing the renderer in JSX and
losing the security scan, the size budget and the accessibility work with it.

## Integrate

```jsx
import { useEffect, useRef } from 'react';
import { mount } from './tp-reviews.mjs';
import './tp-reviews.css';

export function Reviews({ src, pageSize = 10 }) {
  const ref = useRef(null);

  useEffect(() => {
    const widget = mount(ref.current, { src, pageSize });

    // Required. Without it, StrictMode's double-invoke in development leaves
    // two mounted widgets and one orphaned in-flight fetch, and the symptom
    // (reviews rendered twice, only in dev) sends you looking in the wrong file.
    return () => widget.destroy();
  }, [src, pageSize]);

  return <div ref={ref} />;
}
```

Use it as `<Reviews src="/data/reviews.json" />`.

The `useEffect` dependency array holds the props the widget was built from. If
you add options, add them here too — otherwise changing a prop silently leaves
the old widget in place.

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

Handled inside the renderer: a missing or malformed payload renders
`No reviews to show yet.` with no error text and no layout jump. React is not
involved and there is no error boundary to write.

If you want the outage in your telemetry, pass `onError`. Do not throw from it
— it runs inside the renderer's catch, and throwing there would defeat the
empty state you are relying on:

```jsx
mount(ref.current, {
  src,
  onError: (error) => Sentry.captureException(error),
});
```

## CSP

`connect-src` for the payload origin. Nothing else changes:

```
default-src 'self'; connect-src 'self'
```

The renderer needs no `script-src` relaxation. If your bundler inlines the
module, your existing `script-src` already covers it.

Note for Create React App and Vite: import `tp-reviews.mjs` as a normal module
so it is bundled and hashed with everything else. Do not copy it to `public/`
and load it with a `<script>` tag — you lose the integrity your build gives
every other asset, for no gain.

## Network assertion

**The claim:** rendering reviews causes exactly one request, to your origin.
Zero requests reach Google or any other third party.

```jsx
import { render, waitFor } from '@testing-library/react';

it('reaches only our own origin', async () => {
  const seen = [];

  globalThis.fetch = async (url) => {
    seen.push(url);

    return { ok: true, json: async () => payload };
  };

  render(<Reviews src="/data/reviews.json" />);

  await waitFor(() => expect(seen).toEqual(['/data/reviews.json']));
});
```

The strong form, in a real browser:

```js
const seen = [];

page.on('request', (request) => seen.push(new URL(request.url()).origin));
await page.goto('https://your-site.example/reviews');
expect(seen.filter((origin) => origin !== 'https://your-site.example')).toEqual([]);
```

Run one of these in your own suite. It is the property the entire architecture
exists to provide, and your app is where it is observable.
