import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { launchBrowser } from '../../src/adapters/browser/playwright-chromium.mjs';
import { navigate } from '../../src/adapters/acquisition/google-dom/navigator.mjs';
import { resolveBudgets } from '../../src/adapters/browser/timeouts.mjs';
import { classifyCompleteness } from '../../src/core/validate/completeness.mjs';
import { extractReviews, parseHtml } from '../../src/core/index.mjs';
import { startFixtureServer } from '../../fixtures/server/serve.mjs';

/**
 * NAV-04: every navigation behaviour is demonstrated against the fixture server
 * before it is ever attempted against the live source.
 *
 * The server is what makes these deterministic. Driving scroll loops, stall
 * detection, and expansion budgets against a live page makes the suite flaky,
 * and a flaky acquisition suite gets disabled — at which point the most
 * consequential logic in the system has no tests at all.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'selectors', 'google-maps', 'v2.json'), 'utf8'),
);

/** Short budgets: these tests exercise the shapes, not the wall-clock values. */
const BUDGETS = resolveBudgets(
  { navigation_timeout_ms: 15_000, surface_timeout_ms: 4_000, pagination_budget_ms: 20_000 },
  {},
);

/** @type {any} */
let server;
/** @type {any} */
let browser;

beforeAll(async () => {
  server = await startFixtureServer();
  browser = await launchBrowser({ allowedHosts: ['127.0.0.1', 'localhost'] });
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
async function getJson(url) {
  const response = await fetch(url);

  return /** @type {any} */ (response.json());
}

/**
 * `navigate`, with the Result widened so assertions can reach both arms.
 *
 * @param {any} page
 * @param {any} options
 * @returns {Promise<any>}
 */
function drive(page, options) {
  return navigate(page, options);
}

/**
 * Extraction, with the Result narrowed for assertion.
 *
 * @param {string} html
 * @returns {any}
 */
function extract(html) {
  return /** @type {any} */ (extractReviews(html, PACK, { parse: parseHtml }));
}

/**
 * @param {string} path
 * @param {Record<string, any>} [nav]
 * @returns {Promise<any>}
 */
async function run(path, nav = {}) {
  const target = await browser.openTarget();

  try {
    return await navigate(target.page, {
      url: `${server.url}${path}`,
      pack: PACK,
      budgets: BUDGETS,
      nav: { stall_threshold: 2, ...nav },
      counters: target.counters,
    });
  } finally {
    await target.close();
  }
}

describe('DEL-83 — the fixture server', () => {
  it('serves every corpus case', async () => {
    const health = await getJson(`${server.url}/health`);

    expect(health.cases).toHaveLength(20);
  });

  it('logs every request, which is what makes interception measurable', async () => {
    const before = server.requests.length;

    await fetch(`${server.url}/health`);

    expect(server.requests.length).toBe(before + 1);
    expect(server.requests[server.requests.length - 1]).toMatchObject({ method: 'GET' });
  });

  it('names the available cases when asked for one that does not exist', async () => {
    // Otherwise a typo in a slug fails later as "surface not found", and the
    // engineer goes looking for a selector break that is not there.
    const response = await fetch(`${server.url}/listing/does-not-exist`);

    expect(response.status).toBe(404);
    expect((await getJson(`${server.url}/listing/does-not-exist`)).available).toContain(
      '001-standard-120-reviews',
    );
  });
});

describe('the happy path — ALG-PAGINATE against a lazy feed', () => {
  it('paginates to the advertised total and says why it stopped', async () => {
    const result = await run('/listing/001-standard-120-reviews?batch=20');

    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.value.finalCount).toBe(120);
    expect(result.value.stopReason).toBe('target_reached');
    expect(classifyCompleteness({ stop_reason: result.value.stopReason })).toBe('full');
  });

  it('retains the growth curve, not just the final count (EDR-014)', async () => {
    // When a harvest returns 12 of 118, the question is WHERE it stopped
    // growing, and without the curve that is unanswerable after the fact.
    const result = await run('/listing/001-standard-120-reviews?batch=20');
    const curve = result.value.growthCurve;

    expect(curve.length).toBeGreaterThan(1);
    expect(curve[0]).toBeLessThan(/** @type {number} */ (curve[curve.length - 1]));
    // Monotonic: a feed that loses rows mid-harvest is a different failure, and
    // a curve that went backwards would make the stall arithmetic meaningless.
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index]).toBeGreaterThanOrEqual(curve[index - 1]);
    }
  });

  it('serialises the surface subtree, and extraction reads it', async () => {
    // The end-to-end point of the phase: what the navigator hands over is what
    // the pure pipeline consumes, with no browser in between (EDR-015).
    const result = await run('/listing/002-single-review');
    const extracted = extract(result.value.html);

    expect(extracted.ok).toBe(true);
    expect(extracted.value.reviews).toHaveLength(1);
    expect(extracted.value.reviews[0].author.name).toBe('Priya Sharma');
  });

  it('serialises the surface only, never the whole document (TR-EXT-011)', async () => {
    const result = await run('/listing/002-single-review');

    expect(result.value.html.startsWith('<div role="feed"')).toBe(true);
    expect(result.value.html).not.toContain('<html');
  });
});

describe('DEL-87 — the stall test, and the three protections it engages', () => {
  it('stops with `stalled` when the feed stops yielding', async () => {
    // The fixture server stops after 24 of 120. This is the case §31.3 makes an
    // exit criterion, because everything downstream of it is what stops a bad
    // page load from deleting a client's reviews.
    const result = await run('/listing/001-standard-120-reviews?batch=12&stopAfter=24');

    expect(result.ok).toBe(true);
    expect(result.value.finalCount).toBe(24);
    expect(result.value.stopReason).toBe('stalled');
  });

  it('classifies the harvest `partial`, which is protection one', async () => {
    const result = await run('/listing/001-standard-120-reviews?batch=12&stopAfter=24');

    expect(classifyCompleteness({ stop_reason: result.value.stopReason })).toBe('partial');
  });

  it('leaves a growth curve that shows exactly where it plateaued', async () => {
    // "A curve that plateaus at 12 with advertisedTotal 118 tells the whole
    // story of an incident in one array."
    const result = await run('/listing/001-standard-120-reviews?batch=12&stopAfter=24');

    expect(result.value.growthCurve.at(-1)).toBe(24);
    expect(result.value.advertisedTotal).toBe(120);
    expect(result.value.stopDetail).toContain('no growth');
  });

  it('does NOT report stalled when the plateau is within 95% of advertised', async () => {
    // Same mechanism, opposite conclusion. A feed that yielded 115 of an
    // advertised 120 and stopped is finished, not stuck — and calling it
    // `stalled` would mean removals were never confirmed again.
    const result = await run(
      '/listing/001-standard-120-reviews?batch=12&stopAfter=120&advertised=125',
    );

    expect(result.value.finalCount).toBe(120);
    expect(result.value.stopReason).toBe('exhausted');
    expect(classifyCompleteness({ stop_reason: result.value.stopReason })).toBe('full');
  });
});

describe('the cap and the budget', () => {
  it('stops at `cap_reached` and classifies `full_capped`', async () => {
    const result = await run('/listing/001-standard-120-reviews?batch=20', { max_reviews: 40 });

    expect(result.value.stopReason).toBe('cap_reached');
    expect(result.value.finalCount).toBeGreaterThanOrEqual(40);
    expect(classifyCompleteness({ stop_reason: result.value.stopReason })).toBe('full_capped');
  });

  it('stops at `budget_exhausted` and classifies `partial`', async () => {
    // A budget of zero means the first evaluation after the first iteration is
    // already over — the shape under test is that time ends the loop and says
    // so, not that any particular duration is correct.
    const target = await browser.openTarget();

    try {
      const result = await drive(target.page, {
        url: `${server.url}/listing/001-standard-120-reviews?batch=4`,
        pack: PACK,
        budgets: { ...BUDGETS, pagination_budget_ms: 1 },
        nav: { stall_threshold: 99 },
        counters: target.counters,
      });

      expect(result.value.stopReason).toBe('budget_exhausted');
      expect(classifyCompleteness({ stop_reason: result.value.stopReason })).toBe('partial');
    } finally {
      await target.close();
    }
  });
});

describe('§21.9 and §19.2 — the failure paths', () => {
  it('reports ERR-NAV-SURFACE-NOT-FOUND when no surface strategy matches', async () => {
    const result = await run('/listing/002-single-review?hideSurface=1');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-NAV-SURFACE-NOT-FOUND');
  });

  it('does NOT call a structure change a missing surface', async () => {
    // Fixture 015 keeps its container and loses its review nodes. That is a
    // different failure from "the container is gone", and conflating the two
    // sends the engineer to the wrong half of the runbook. Navigation stalls at
    // zero; it is EXTRACTION that reports the structure change.
    const result = await run('/listing/015-structure-changed');

    expect(result.ok).toBe(true);
    expect(result.value.finalCount).toBe(0);
    expect(result.value.stopReason).toBe('stalled');

    const extracted = extract(result.value.html);

    expect(extracted.ok).toBe(false);
    expect(extracted.error.code).toBe('ERR-PARSE-EMPTY-UNEXPECTED');
  });

  it('reports a challenge as a BLOCK, before any parsing (TR-NAV-011)', async () => {
    // ERR-PARSE-STRUCTURE here would send an engineer to the selector-repair
    // runbook for markup that is not broken, and trigger the retry that turns a
    // soft block hard.
    const result = await run('/listing/016-challenge-page');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-BLOCKED-CHALLENGE');
  });

  it('reports a consent wall with its own class, not the challenge class', async () => {
    const result = await run('/listing/017-consent-interstitial');

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-NAV-CONSENT-WALL');
  });

  it('carries a stop reason even on the failure paths', async () => {
    // A report with no stop reason would be classified by the fail-closed
    // default rather than by a stated fact, and the two must not be confused.
    const result = await run('/listing/016-challenge-page');

    expect(result.error.stopReason).toBe('error');
    expect(classifyCompleteness({ stop_reason: result.error.stopReason })).toBe('failed');
  });

  it('reports ERR-NAV-TIMEOUT when the response never arrives', async () => {
    const target = await browser.openTarget();

    try {
      const result = await drive(target.page, {
        url: `${server.url}/listing/002-single-review?delay=3000`,
        pack: PACK,
        budgets: { ...BUDGETS, navigation_timeout_ms: 500 },
        nav: {},
      });

      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('ERR-NAV-TIMEOUT');
    } finally {
      await target.close();
    }
  });

  it('treats a missing sort control as non-fatal (TR-NAV-010)', async () => {
    // A missing sort control is a product change, not a harvest failure.
    // Failing the target here would turn a cosmetic upstream change into an
    // outage, and the payload's ordering is decided by the projection anyway.
    const result = await run('/listing/002-single-review');

    expect(result.ok).toBe(true);
    expect(result.value.sortApplied).toBe(false);
  });
});
