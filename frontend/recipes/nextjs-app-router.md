# Recipe — Next.js App Router

**Priority P2**

Next.js can read the payload on the server, which makes this the one recipe
that reaches **zero** client-side requests instead of one. Reviews arrive in
the HTML document, already rendered.

## Integrate — server-fetched (recommended)

```jsx
// app/reviews/page.jsx
import { ReviewsClient } from './reviews-client';

export default async function Page() {
  const response = await fetch('https://data.example.com/reviews.json', {
    // Revalidate on your harvest cadence, not on every visitor. The payload
    // changes a few times a day at most; per-request fetching turns a static
    // file into load on your data origin proportional to your traffic.
    next: { revalidate: 3600 },
  });
  const payload = response.ok ? await response.json() : null;

  return <ReviewsClient payload={payload} />;
}
```

```jsx
// app/reviews/reviews-client.jsx
'use client';

import { useEffect, useRef } from 'react';
import { render } from './tp-reviews.mjs';
import './tp-reviews.css';

export function ReviewsClient({ payload }) {
  const ref = useRef(null);

  useEffect(() => {
    // `render`, not `mount`. The payload is already here; `mount` would fetch
    // it a second time from the browser, which is the request this recipe
    // exists to avoid.
    render(ref.current, payload ?? {}, { pageSize: 10 });
  }, [payload]);

  return <div ref={ref} />;
}
```

The `'use client'` boundary is required: the renderer builds DOM nodes and
attaches click handlers for pagination, neither of which exists on the server.

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

`render` treats a null payload, an absent `reviews` array, and an empty one
identically — `No reviews to show yet.`, no error text.

That is why the server component passes `payload ?? {}` rather than throwing on
a failed fetch. A build- or request-time failure to reach the data origin
**must not** fail the page: reviews are a section of a page, not the page.

Do not add `notFound()` or an error boundary here. Both would turn a missing
review file into a broken route.

## CSP

Server-fetched means the browser makes **no** review request at all, so
`connect-src` needs no entry:

```
default-src 'self'
```

If you switch to client-side `mount`, add `connect-src` for the payload origin.

The server-side fetch needs egress from your Next.js host to your data origin —
that is a server network policy, not a CSP concern, and it is worth writing
down because it is the one that fails in staging.

## Network assertion

**The claim:** rendering reviews causes zero client-side requests in this
recipe, and never any request to Google or another third party.

```js
const seen = [];

page.on('request', (request) => seen.push(new URL(request.url()).origin));
await page.goto('https://your-site.example/reviews');

// Zero — the payload came down inside the document.
expect(seen.filter((origin) => origin !== 'https://your-site.example')).toEqual([]);
expect(seen.some((origin) => origin.includes('google'))).toBe(false);
```

Assert the reviews are in the server-rendered HTML too, or the recipe silently
degrades to the client-fetching one the day someone swaps `render` for `mount`:

```js
const html = await fetch('https://your-site.example/reviews').then((r) => r.text());

expect(html).toContain('tp-reviews__review');
```

`examples/nextjs/` ships a working version of this check.
