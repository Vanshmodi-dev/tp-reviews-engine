/**
 * The network assertion for the Next.js example (FE-03, DEL-191).
 *
 * Copy this into your own project's test suite. It is not run by this
 * repository — Next.js is not a dependency here and will not become one — so
 * it is written to run under Playwright in YOUR project, against YOUR deploy.
 *
 * `examples/static/` proves the same property inside this repository, on every
 * browser-suite run, with the same renderer.
 */

import { expect, test } from '@playwright/test';

const SITE = process.env.SITE_URL ?? 'http://localhost:3000';

test('the visitor never contacts a review source', async ({ page }) => {
  /** @type {string[]} */
  const origins = [];

  page.on('request', (request) => origins.push(new URL(request.url()).origin));

  await page.goto(`${SITE}/reviews`, { waitUntil: 'networkidle' });

  // INV-01. This is the property the entire architecture exists to provide,
  // and the consumer side is the only place it is directly observable.
  const foreign = origins.filter((origin) => origin !== SITE);

  expect(foreign).toEqual([]);
  expect(origins.some((origin) => /google|gstatic|googleapis/iu.test(origin))).toBe(false);
});

test('the reviews are in the server-rendered HTML', async ({ request }) => {
  const response = await request.get(`${SITE}/reviews`);
  const html = await response.text();

  // Without this, the recipe silently degrades to the client-fetching one the
  // day somebody swaps `render` for `mount`, and the test above still passes
  // because one same-origin request is also zero foreign ones.
  expect(html).toContain('tp-reviews__review');
});

test('a missing payload renders the empty state, not a broken route', async ({ page }) => {
  await page.route('**/reviews.json', (route) => route.abort());
  await page.goto(`${SITE}/reviews`, { waitUntil: 'networkidle' });

  await expect(page.locator('.tp-reviews__empty')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/error|failed|unavailable/i);
});
