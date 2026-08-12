/**
 * Server component (DEL-191).
 *
 * The payload is read here, on the server, so the visitor's browser makes zero
 * review requests. This is the one recipe that reaches zero rather than one.
 */

import { ReviewsClient } from './reviews-client';

export default async function Page() {
  const response = await fetch('https://data.example.com/reviews.json', {
    // Revalidate on the harvest cadence, not per visitor. The payload changes a
    // few times a day at most; per-request fetching turns a static file into
    // load on the data origin proportional to traffic.
    next: { revalidate: 3600 },
  });

  // No throw, and no `notFound()`. A failure to reach the data origin must cost
  // an empty widget, not a broken route — reviews are a section of a page, not
  // the page. `render` treats a null payload exactly as it treats an empty one.
  const payload = response.ok ? await response.json() : null;

  return (
    <main>
      <h1>What our customers say</h1>
      <ReviewsClient payload={payload} />
    </main>
  );
}
