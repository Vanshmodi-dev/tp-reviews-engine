/**
 * `google:dom` against the acquisition contract (ADP-02).
 *
 * The same `runAcquisitionContract` suite the CSV and the two API adapters
 * pass, run unchanged. Not one assertion in it is source-specific, and none was
 * added for this adapter — which is the whole claim ADP-02 makes: four
 * genuinely different sources behind one port, verified by one suite.
 *
 * ## What is faked, and why that is honest here
 *
 * The browser and the navigator. Everything else is real: the real adapter, the
 * real extractor, a real selector pack shape, real markup.
 *
 * Faking the navigator is not a shortcut around the hard part — it is the only
 * way to reach three of the four scenarios deterministically. "The source
 * returned a partially invalid record" and "the harvest hit our cap" are states
 * a live page reaches by accident, if at all. The navigator's own behaviour
 * against a real page — consent, challenges, stalls, scroll budgets — is tested
 * in `tests/integration/browser-navigation.test.mjs`, where a real Chromium
 * drives a real fixture server.
 */

import { createDomAdapter } from '../../src/adapters/acquisition/google-dom/index.mjs';
import { runAcquisitionContract } from './acquisition-adapter.contract.test.mjs';

/** A pack with the shape the extractor requires, and nothing more. */
const PACK = {
  meta: { version: 'contract' },
  containers: {
    surface: { strategies: [{ selector: '[data-feed]' }] },
    review_node: { strategies: [{ selector: '[data-review]' }] },
  },
  fields: {
    author_name: { required: true, strategies: [{ selector: '[data-author]' }] },
    rating: {
      strategies: [
        { selector: "[role='img']", attribute: 'aria-label', pattern: 'Rated ([0-9.]+) out of 5' },
      ],
    },
    text: { strategies: [{ selector: '[data-text]' }] },
  },
};

/**
 * @param {string} author
 * @param {number} rating
 * @returns {string}
 */
const review = (author, rating) =>
  `<div data-review><span data-author>${author}</span>` +
  `<span role='img' aria-label='Rated ${rating}.0 out of 5'></span>` +
  `<p data-text>Review text from ${author}.</p></div>`;

/** Four healthy reviews. */
const HEALTHY = `<div data-feed>${['Dana', 'Sam', 'Priya', 'Tom']
  .map((name, index) => review(name, 5 - (index % 2)))
  .join('')}</div>`;

/**
 * One good record and one that cannot be mapped — no author, which the pack
 * marks required. The contract's assertion 9 needs a genuinely bad record to
 * isolate, not a healthy one relabelled.
 */
const PARTIAL =
  '<div data-feed>' +
  review('Dana', 5) +
  "<div data-review><span role='img' aria-label='Rated 4.0 out of 5'></span></div>" +
  '</div>';

/** A browser whose page carries nothing; the navigator is faked instead. */
const browser = {
  async openTarget() {
    return {
      page: {},
      budgets: { navigation_timeout_ms: 1000, surface_timeout_ms: 500 },
      close: async () => {},
    };
  },
};

/**
 * Serves markup chosen by the listing being harvested.
 *
 * Keyed on the place id so the contract's scenarios stay ordinary requests —
 * the same shape every other adapter receives.
 *
 * @param {any} _page
 * @param {any} options
 * @returns {Promise<any>}
 */
async function fakeNavigate(_page, options) {
  const partial = options.url.includes('BAD');

  return {
    ok: true,
    value: {
      html: partial ? PARTIAL : HEALTHY,
      // A real stop reason from the navigator's vocabulary, passed through by
      // the adapter without adjustment.
      stopReason: 'target_reached',
      stopDetail: 'reached the configured target',
      growthCurve: [4],
      finalCount: 4,
      iterations: 1,
      elapsedMs: 90,
      advertisedTotal: 118,
      advertisedRating: 4.5,
      sortApplied: true,
      consentState: 'none',
      counters: {},
    },
  };
}

runAcquisitionContract('google:dom', async () => ({
  adapter: createDomAdapter({ browser, pack: () => PACK, navigate: fakeNavigate }),
  scenarios: {
    healthy: { listing: { place_id: 'ChIJ_test', source: 'google' }, cap: 100 },
    // No identifier at all. The adapter must refuse before it opens a context.
    misconfigured: { listing: { source: 'google' }, cap: 100 },
    capped: { listing: { place_id: 'ChIJ_test', source: 'google' }, cap: 2 },
    partiallyInvalid: { listing: { place_id: 'ChIJ_BAD', source: 'google' }, cap: 100 },
  },
}));
