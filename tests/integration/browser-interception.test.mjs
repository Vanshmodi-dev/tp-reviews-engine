import { afterAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '../../src/adapters/browser/playwright-chromium.mjs';

/**
 * DEL-76 — interception, measured (EDR-012, TR-BRW-030, TR-BRW-031).
 *
 * **Recording the actual number matters more than the threshold** (§29.3). A
 * test asserting "> 0% blocked" passes forever; a test that prints the counts
 * makes a regression from "everything blocked" to "almost nothing blocked"
 * visible in a CI log diff.
 *
 * That matters because interception is a control that decays *silently*. If it
 * stops working — a config typo, a source moving CDN — the only symptom is a
 * slower, heavier run that still produces perfectly correct reviews.
 *
 * The byte-reduction comparison in §29.3 needs a server that reports the size
 * of what it refused to send, and a blocked request is never fetched. That
 * arrives with the fixture server in PH-15; what is measured here is the
 * decision set against a real page, which needs no server.
 */

const ORIGIN = 'https://localhost';
const PAGE = `${ORIGIN}/listing`;

const MARKUP = `<!doctype html><html><head>
  <link rel="stylesheet" href="${ORIGIN}/layout.css">
  <script src="${ORIGIN}/app.js"></script>
  <script src="https://www.google-analytics.com/analytics.js"></script>
  <script src="https://evil.example/tracker.js"></script>
</head><body>
  <div role="article">a review</div>
  <img src="${ORIGIN}/avatar.png" alt="">
  <img src="https://cdn.other.example/hero.jpg" alt="">
</body></html>`;

/** @type {Array<{ close: () => Promise<void> }>} */
const sessions = [];

afterAll(async () => {
  for (const created of sessions) await created.close();
});

/**
 * Serves only the assets that SHOULD be allowed.
 *
 * Registered after the adapter's own `**` route, so these win — Playwright
 * gives precedence to the most recently added handler. Everything not listed
 * here falls through to the adapter, which is what puts the policy under test
 * rather than the fixture.
 *
 * @param {any} page
 * @returns {Promise<void>}
 */
async function serve(page) {
  /** @type {Array<[string, string, string]>} */
  const assets = [
    [PAGE, 'text/html', MARKUP],
    [`${ORIGIN}/layout.css`, 'text/css', 'body{margin:0}'],
    [`${ORIGIN}/app.js`, 'text/javascript', 'globalThis.__ran = true;'],
  ];

  for (const [url, contentType, body] of assets) {
    await page.route(url, (/** @type {any} */ route) =>
      route.fulfill({ status: 200, contentType, body }),
    );
  }
}

/**
 * @returns {Promise<any>}
 */
async function harvest() {
  const browser = await launchBrowser({ allowedHosts: ['localhost'] });

  sessions.push(browser);

  const target = await browser.openTarget();
  /** @type {string[]} */
  const arrived = [];

  target.page.on('response', (/** @type {any} */ response) => arrived.push(response.url()));

  await serve(target.page);
  await target.page.goto(PAGE, { waitUntil: 'load' });

  return { target, arrived, counters: target.counters };
}

describe('EDR-012 — both filters run, and both are counted', () => {
  it('blocks images by resource type even on an allowlisted host', async () => {
    // Resource-type filtering and the host allowlist are independent. A host
    // allowlist alone would happily fetch megabytes of avatars from the
    // permitted CDN — losing the byte reduction that makes the harvest cheap.
    const { arrived, counters } = await harvest();

    expect(arrived.some((/** @type {string} */ url) => url.endsWith('avatar.png'))).toBe(false);
    expect(counters.blocked_by_reason['resource-type']).toBeGreaterThanOrEqual(1);
  });

  it('blocks an off-allowlist host even for an allowed resource type', async () => {
    // Resource-type filtering alone permits arbitrary hosts, leaving the runner
    // usable as a request source by a compromised page (THREAT-04).
    const { arrived, counters } = await harvest();

    expect(arrived.some((/** @type {string} */ url) => url.includes('evil.example'))).toBe(false);
    expect(counters.blocked_by_reason['off-allowlist']).toBeGreaterThanOrEqual(1);
  });

  it('blocks telemetry hosts', async () => {
    const { arrived, counters } = await harvest();

    expect(arrived.some((/** @type {string} */ url) => url.includes('google-analytics'))).toBe(
      false,
    );
    expect(counters.blocked_by_reason['telemetry']).toBeGreaterThanOrEqual(1);
  });

  it('ALLOWS the stylesheet and the script, because extraction needs them', async () => {
    // Blocking stylesheets is tempting for speed and breaks the
    // layout-dependent visibility determinations extraction relies on.
    // Blocking scripts would leave nothing to extract — the content is not in
    // the initial response.
    const { arrived, target } = await harvest();

    expect(arrived.some((/** @type {string} */ url) => url.endsWith('layout.css'))).toBe(true);
    expect(arrived.some((/** @type {string} */ url) => url.endsWith('app.js'))).toBe(true);
    expect(await target.page.evaluate(() => /** @type {any} */ (globalThis).__ran)).toBe(true);
  });

  it('leaves the review markup intact — blocking never costs extraction', async () => {
    // The whole point. If interception broke the page, the correct response
    // would be to loosen it, and this test is what would say so.
    const { target } = await harvest();

    expect(await target.page.content()).toContain('a review');
  });
});

describe('TR-BRW-030 — the numbers are recorded, not just asserted', () => {
  it('reports counts by reason', async () => {
    const { counters } = await harvest();
    const total = counters.allowed_requests + counters.blocked_requests;

    // Printed on purpose. A threshold assertion passes forever; a recorded
    // number makes a regression visible in a log diff months later.
    process.stdout.write(
      `\n  interception: ${counters.blocked_requests}/${total} requests blocked ` +
        `${JSON.stringify(counters.blocked_by_reason)}\n`,
    );

    expect(counters.blocked_requests).toBeGreaterThanOrEqual(4);
    expect(counters.allowed_requests).toBeGreaterThanOrEqual(1);
    // Every blocked request is attributed to exactly one rule, so a future
    // reason added without a counter shows up as a mismatch here.
    expect(
      Object.values(counters.blocked_by_reason).reduce(
        (/** @type {number} */ sum, /** @type {number} */ n) => sum + n,
        0,
      ),
    ).toBe(counters.blocked_requests);
  });

  it('starts from zero for each target rather than accumulating across a shard', async () => {
    // Counters shared between targets would attribute one client's blocked
    // requests to the next one's report — and the acquisition report is
    // per-target.
    const first = await harvest();
    const second = await harvest();

    expect(second.counters.blocked_requests).toBe(first.counters.blocked_requests);
  });
});
