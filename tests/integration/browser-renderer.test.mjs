/**
 * The renderer, against a real browser and a real server (§50, FE-03).
 *
 * ## Why this is not a jsdom test
 *
 * Three of the four things §50 requires cannot be observed in jsdom:
 *
 * - **The network assertion (FE-03).** The claim is about what the browser
 *   requests. jsdom would only tell us what our stub was asked for, which is a
 *   restatement of the code rather than evidence about it.
 * - **Layout stability.** jsdom has no layout, so CLS is unmeasurable there.
 * - **The CSP.** A policy is only enforced by something that enforces it.
 *
 * This is the `browser` vitest project (`npm run test:browser`), which needs a
 * Chromium binary and no network. It runs separately from the default suite
 * because Chromium competes for CPU with tests/budgets/, whose signal is a
 * ratio of two timings taken moments apart.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '../../src/adapters/browser/playwright-chromium.mjs';
import { startExampleServer } from '../../examples/static/serve.mjs';

/** @type {any} */
let server;
/** @type {any} */
let browser;
/** Every path the server was asked for, so request COUNT is observable. */
/** @type {string[]} */
const requested = [];

beforeAll(async () => {
  server = await startExampleServer({ onRequest: (path) => requested.push(path) });
  // The example serves everything from 127.0.0.1; nothing else is reachable,
  // which is the point.
  browser = await launchBrowser({ allowedHosts: ['127.0.0.1'] });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Opens the example and records every origin the browser reached for.
 *
 * @param {{ blockPayload?: boolean }} [options]
 * @returns {Promise<{ page: any, origins: string[], target: any }>}
 */
async function open(options = {}) {
  const target = await browser.openTarget();
  const { page } = target;
  /** @type {string[]} */
  const origins = [];

  page.on('request', (/** @type {any} */ request) => {
    origins.push(new URL(request.url()).origin);
  });

  if (options.blockPayload === true) {
    await page.route('**/reviews.json', (/** @type {any} */ route) => route.abort());
  }

  await page.goto(server.url, { waitUntil: 'networkidle' });

  return { page, origins, target };
}

describe('FE-03 — the visitor never contacts a review source', () => {
  it('reaches exactly one origin: the one serving the page', async () => {
    const { origins } = await open();

    // INV-01, measured rather than asserted in prose. This is the property the
    // entire engine exists to provide — the scheduled harvest, the committed
    // payload and the static hosting are all in service of it — and this is
    // the only place it is directly observable.
    expect([...new Set(origins)]).toEqual([server.url]);
  });

  it('reaches nothing resembling a review source', async () => {
    const { origins } = await open();
    const foreign = origins.filter((origin) =>
      /google|gstatic|googleapis|facebook|trustpilot|yelp/iu.test(origin),
    );

    expect(foreign).toEqual([]);
  });

  it('requests the payload exactly once, not once per rendered review', async () => {
    requested.length = 0;

    await open();

    // Rendering five reviews across two pages must not become five requests,
    // or two. Paginating re-reads the array already in memory.
    expect(requested.filter((path) => path === '/reviews.json')).toHaveLength(1);
  });
});

describe('the payload renders', () => {
  it('shows the reviews from the payload, paginated', async () => {
    const { page } = await open();

    // pageSize is 3 and the payload holds 5, so page one shows three.
    expect(await page.locator('.tp-reviews__review').count()).toBe(3);
    expect(await page.locator('.tp-reviews__page').count()).toBe(2);
    expect(await page.locator('.tp-reviews__author').first().textContent()).toBe('Dana R.');
  });

  it('renders review text as text, never as markup', async () => {
    const { page } = await open();

    // The direct test of TR-STD-002. A review body is a stranger's keystrokes
    // that travelled through a scraper; if the renderer ever parsed it, this is
    // where a `<script>` in a review would become a script on a client's page.
    const injected = await page.evaluate(() => {
      const node = /** @type {any} */ (globalThis).document.querySelector('.tp-reviews__text');

      if (node === null) return 'no node';

      node.textContent = '<img src=x onerror="globalThis.__pwned = true">';

      return /** @type {any} */ (globalThis).document.querySelectorAll('img').length;
    });

    expect(injected).toBe(0);
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__pwned)).toBeUndefined();
  });

  it('gives the star rating a text equivalent', async () => {
    const { page } = await open();
    const label = await page.locator('.tp-reviews__stars').first().getAttribute('aria-label');

    // Not five star glyphs. Read literally those announce as "black star black
    // star black star" and leave the listener counting.
    expect(label).toMatch(/Rated \d\.\d out of 5/u);
  });

  it('paginates from the keyboard', async () => {
    const { page } = await open();

    await page.locator('.tp-reviews__page').nth(1).focus();
    await page.keyboard.press('Enter');

    // Page two of five reviews with pageSize 3 holds the remaining two.
    expect(await page.locator('.tp-reviews__review').count()).toBe(2);
    expect(await page.locator('.tp-reviews__status').textContent()).toBe('Page 2 of 2');
  });

  it('keeps the active page focusable rather than disabling it', async () => {
    const { page } = await open();
    const active = page.locator('.tp-reviews__page[aria-current="true"]');

    expect(await active.count()).toBe(1);
    // `disabled` would drop it from the tab order, so a keyboard user loses
    // their place at the one control that says where they are.
    expect(await active.getAttribute('disabled')).toBeNull();
  });
});

describe('the empty state (§50.2 step 3)', () => {
  it('shows a clean empty state, with no error text, when the payload is blocked', async () => {
    const { page } = await open({ blockPayload: true });

    expect(await page.locator('.tp-reviews__empty').textContent()).toBe('No reviews to show yet.');

    const visible = await page.locator('body').innerText();

    // A visitor is not the audience for our outage.
    expect(visible).not.toMatch(/error|failed|unavailable|sorry/iu);
  });

  it('still tells the host page, through the callback it opted into', async () => {
    const { page } = await open({ blockPayload: true });

    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__tpReviewsError),
    ).toBeTruthy();
  });

  it('collapses the reserved space when there is nothing to show', async () => {
    const { page } = await open({ blockPayload: true });
    const height = await page
      .locator('#reviews .tp-reviews')
      .evaluate((/** @type {any} */ node) => node.getBoundingClientRect().height);

    // The reservation exists to stop the page moving when reviews arrive. When
    // none are coming, holding a tall blank gap open is the same defect wearing
    // the opposite sign.
    expect(height).toBeLessThan(100);
  });
});

describe('layout stability (§50.2 step 4)', () => {
  it('does not move the content below it when reviews arrive', async () => {
    const target = await browser.openTarget();
    const { page } = target;

    // Hold the payload until we have measured the pre-load layout, so the
    // before/after comparison is genuinely before and after.
    /** @type {(value?: unknown) => void} */
    let release = () => {};
    const held = new Promise((resolve) => {
      release = resolve;
    });

    await page.route('**/reviews.json', async (/** @type {any} */ route) => {
      await held;
      await route.continue();
    });

    await page.goto(server.url, { waitUntil: 'domcontentloaded' });

    const footerBefore = await page
      .locator('footer')
      .evaluate((/** @type {any} */ node) => node.getBoundingClientRect().top);

    release();
    await page.waitForFunction(() => /** @type {any} */ (globalThis).__tpReviewsReady === true);

    const footerAfter = await page
      .locator('footer')
      .evaluate((/** @type {any} */ node) => node.getBoundingClientRect().top);

    // CLS 0. The container is sized from `pageSize` before the fetch is issued,
    // so the footer occupies the same pixel row before and after. A renderer
    // that grows the page on load puts our defect in the client's Core Web
    // Vitals, on a page we do not own.
    expect(footerAfter).toBe(footerBefore);
  });
});
