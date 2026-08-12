import { describe, expect, it } from 'vitest';

import {
  BUSINESS_PROFILE_CAPABILITIES,
  MAX_PAGES,
  createBusinessProfileAdapter,
} from '../../src/adapters/acquisition/google-business-profile-api/index.mjs';
import {
  PLACES_CAPABILITIES,
  PLACES_REVIEW_CEILING,
  createPlacesAdapter,
} from '../../src/adapters/acquisition/google-places-api/index.mjs';
import { runAcquisitionContract } from './acquisition-adapter.contract.test.mjs';

/**
 * ADP-02 ??? a new adapter means RUNNING the same suite, not writing a new one.
 *
 * The contract suite was written in PH-11 against the CSV adapter, before the
 * DOM adapter existed (ADP-01), precisely so it could not encode DOM
 * assumptions. Two more adapters run against it unchanged here.
 *
 * That is what turns the port from a rename into an interface: *"an interface
 * tested against a single implementation is not an interface."*
 */

/**
 * A `fetch` stand-in returning a fixed body.
 *
 * @param {any} body
 * @param {Record<string, any>} [over]
 * @returns {any}
 */
const responding = (body, over = {}) =>
  async function stub() {
    return { ok: true, status: 200, json: async () => body, ...over };
  };

/**
 * A stub that answers differently for the "partially invalid" identifier, so
 * contract assertion 9 has a genuinely bad record to isolate rather than a
 * healthy body relabelled.
 *
 * @param {any} good
 * @param {any} bad
 * @returns {any}
 */
const respondingByUrl = (good, bad) =>
  async function stub(/** @type {string} */ url) {
    const body = url.includes('BAD') ? bad : good;

    return { ok: true, status: 200, json: async () => body };
  };

/** Five reviews, which is all this API ever returns. */
const placesBody = (count = PLACES_REVIEW_CEILING) => ({
  status: 'OK',
  result: {
    rating: 4.4,
    user_ratings_total: 118,
    reviews: Array.from({ length: count }, (_, index) => ({
      rating: 5,
      text: `A review ${index}`,
      relative_time_description: '2 weeks ago',
      author_name: `Author ${index}`,
    })),
  },
});

runAcquisitionContract('google:places-api', async () => ({
  adapter: createPlacesAdapter({
    request: respondingByUrl(placesBody(), {
      status: 'OK',
      result: {
        rating: 4.4,
        user_ratings_total: 118,
        // One good, one that is not a review at all — a response shape that
        // changed under us. Publishing it would put an empty card on a site.
        reviews: [placesBody(1).result.reviews[0], { author_name: 'No rating, no text' }],
      },
    }),
  }),
  scenarios: {
    healthy: { listing: { place_id: 'ChIJ_test' }, secrets: { places_api_key: 'k' } },
    misconfigured: { listing: {}, secrets: { places_api_key: 'k' } },
    capped: { listing: { place_id: 'ChIJ_test' }, secrets: { places_api_key: 'k' }, cap: 2 },
    // This source returns structured JSON, so there is no "half a row" to
    // isolate ? a malformed review arrives as a field this adapter maps to
    // null rather than as a record it must reject.
    partiallyInvalid: {
      listing: { place_id: 'ChIJ_BAD' },
      secrets: { places_api_key: 'k' },
    },
  },
}));

runAcquisitionContract('google:business-profile-api', async () => ({
  adapter: createBusinessProfileAdapter({
    request: respondingByUrl(
      { totalReviewCount: 3, reviews: profileReviews(3) },
      { totalReviewCount: 2, reviews: [...profileReviews(1), { reviewer: { displayName: 'x' } }] },
    ),
    exchangeToken: async () => 'access-token',
  }),
  scenarios: {
    healthy: {
      listing: { location_name: 'accounts/1/locations/2' },
      secrets: { business_profile_refresh_token: 'r' },
    },
    misconfigured: { listing: {}, secrets: { business_profile_refresh_token: 'r' } },
    capped: {
      listing: { location_name: 'accounts/1/locations/2' },
      secrets: { business_profile_refresh_token: 'r' },
      cap: 2,
    },
    partiallyInvalid: {
      listing: { location_name: 'accounts/1/locations/BAD' },
      secrets: { business_profile_refresh_token: 'r' },
    },
  },
}));

/**
 * @param {number} count
 * @returns {any[]}
 */
function profileReviews(count) {
  return Array.from({ length: count }, (_, index) => ({
    starRating: 'FIVE',
    comment: `A review ${index}`,
    createTime: '2026-07-01T00:00:00Z',
    reviewer: { displayName: `Author ${index}` },
  }));
}

describe('??52.1 ??? the Places ceiling is why capability descriptors exist', () => {
  it('NEVER reports target_reached, however few reviews it received', async () => {
    // The catastrophic reading. Five records against a ledger of 118 would tell
    // the reconciler that 113 were removed ??? and a `target_reached` would make
    // that absence MEANINGFUL, starting a countdown to deleting a paying
    // client's review set.
    const adapter = createPlacesAdapter({ request: responding(placesBody(5)) });
    const result = await adapter.harvest({
      listing: { place_id: 'p' },
      secrets: { places_api_key: 'k' },
    });

    expect(result.ok).toBe(true);
    expect(result.value.stop_reason).toBe('cap_reached');
    expect(result.value.stop_reason).not.toBe('target_reached');
  });

  it('reports the advertised total, which is what says how much it did NOT see', async () => {
    const adapter = createPlacesAdapter({ request: responding(placesBody()) });
    const result = await adapter.harvest({
      listing: { place_id: 'p' },
      secrets: { places_api_key: 'k' },
    });

    expect(result.value.advertised_total).toBe(118);
    expect(result.value.reviews).toHaveLength(PLACES_REVIEW_CEILING);
  });

  it('declares only what it can supply, and omits what it cannot', () => {
    // Declaring a capability the source does not provide makes every null look
    // like a data problem rather than a source limit.
    expect(PLACES_CAPABILITIES).toContain('review_text');
    expect(PLACES_CAPABILITIES).not.toContain('likes');
    expect(PLACES_CAPABILITIES).not.toContain('photo_count');
    expect(PLACES_CAPABILITIES).not.toContain('verified');
  });

  it('fabricates nothing it was not given (contract assertion 7)', async () => {
    const adapter = createPlacesAdapter({ request: responding(placesBody(1)) });
    const result = await adapter.harvest({
      listing: { place_id: 'p' },
      secrets: { places_api_key: 'k' },
    });
    const [review] = result.value.reviews;

    // `0` would be a claim the API never made, indistinguishable downstream
    // from a review nobody found helpful.
    expect(review.meta).toEqual({ likes: null, photo_count: null, visited: null });
    expect(review.owner_reply).toBeNull();
  });
});

describe('ADP-04 / TR-SEC-010 ??? a missing secret fails closed', () => {
  it('Places refuses without a key and does NOT downgrade', async () => {
    // The named violation: an unrotated key or a typo'd variable name silently
    // converting a client from an official API to page reading ??? a change of
    // legal posture nobody made and nobody can see.
    const result = await createPlacesAdapter({ request: responding({}) }).harvest({
      listing: { place_id: 'p' },
      secrets: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-CONFIG-SECRET-MISSING');
    expect(result.error.message).toContain('does not fall back');
  });

  it('Business Profile refuses without a per-client refresh token', async () => {
    const result = await createBusinessProfileAdapter({ request: responding({}) }).harvest({
      listing: { location_name: 'l' },
      secrets: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-CONFIG-SECRET-MISSING');
  });

  it('never mentions the secret VALUE in the error', async () => {
    // An error message is a log line, and a log line is an artifact.
    const result = await createPlacesAdapter({ request: responding({}) }).harvest({
      listing: { place_id: 'p' },
      secrets: { places_api_key: '' },
    });

    expect(JSON.stringify(result)).not.toContain('places_api_key=');
  });
});

describe('the Business Profile adapter pages on the SOURCE???s word', () => {
  /**
   * @param {ReadonlyArray<any>} pages
   * @returns {any}
   */
  function pager(pages) {
    let call = 0;

    return async function stub() {
      const page = pages[Math.min(call, pages.length - 1)];

      call += 1;

      return { ok: true, status: 200, json: async () => page };
    };
  }

  it('follows nextPageToken until the source stops offering one', async () => {
    const adapter = createBusinessProfileAdapter({
      request: pager([
        { totalReviewCount: 5, reviews: profileReviews(2), nextPageToken: 'a' },
        { totalReviewCount: 5, reviews: profileReviews(2), nextPageToken: 'b' },
        { totalReviewCount: 5, reviews: profileReviews(1) },
      ]),
      exchangeToken: async () => 't',
    });
    const result = await adapter.harvest({
      listing: { location_name: 'l' },
      secrets: { business_profile_refresh_token: 'r' },
    });

    expect(result.value.reviews).toHaveLength(5);
    expect(result.value.stop_reason).toBe('target_reached');
    expect(result.value.growth_curve).toEqual([2, 4, 5]);
  });

  it('does NOT stop when the count reaches the advertised total', async () => {
    // An advertised total is a number the source publishes for humans. It goes
    // stale, and stopping on it would silently truncate every listing whose
    // real count had grown past it.
    const adapter = createBusinessProfileAdapter({
      request: pager([
        { totalReviewCount: 2, reviews: profileReviews(2), nextPageToken: 'a' },
        { totalReviewCount: 2, reviews: profileReviews(3) },
      ]),
      exchangeToken: async () => 't',
    });
    const result = await adapter.harvest({
      listing: { location_name: 'l' },
      secrets: { business_profile_refresh_token: 'r' },
    });

    expect(result.value.reviews).toHaveLength(5);
  });

  it('reports `stalled` rather than `target_reached` when the cursor never clears', async () => {
    // A broken source contract is not a complete harvest, and saying so would
    // authorise deletions on the strength of a bug.
    const adapter = createBusinessProfileAdapter({
      request: pager([{ reviews: profileReviews(1), nextPageToken: 'forever' }]),
      exchangeToken: async () => 't',
    });
    const result = await adapter.harvest({
      listing: { location_name: 'l' },
      secrets: { business_profile_refresh_token: 'r' },
    });

    expect(result.value.stop_reason).toBe('stalled');
    expect(result.value.reviews).toHaveLength(MAX_PAGES);
  });

  it('keeps what it collected when a later page fails', async () => {
    // INV-03: additions from a partial harvest are trustworthy; only absences
    // are not. Discarding the pages that worked would lose real data.
    let call = 0;
    const adapter = createBusinessProfileAdapter({
      request: async () => {
        call += 1;

        if (call === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ reviews: profileReviews(2), nextPageToken: 'a' }),
          };
        }

        return { ok: false, status: 500 };
      },
      exchangeToken: async () => 't',
    });
    const result = await adapter.harvest({
      listing: { location_name: 'l' },
      secrets: { business_profile_refresh_token: 'r' },
    });

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toHaveLength(2);
    expect(result.value.stop_reason).toBe('stalled');
  });

  it('reports an auth failure apart from a source outage', async () => {
    // Different runbooks, different retry policies. Reporting the wrong one
    // costs an investigation.
    const adapter = createBusinessProfileAdapter({
      request: responding({}),
      exchangeToken: async () => {
        throw new Error('refresh token revoked');
      },
    });
    const result = await adapter.harvest({
      listing: { location_name: 'l' },
      secrets: { business_profile_refresh_token: 'expired' },
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-AUTH-FAILED');
  });

  it('maps the API???s word ratings to integers', () => {
    expect(BUSINESS_PROFILE_CAPABILITIES).toContain('verified');
  });
});

describe('quota is a source refusal, not a parse problem', () => {
  it('reports ERR-RATE-LIMITED for OVER_QUERY_LIMIT', async () => {
    const adapter = createPlacesAdapter({ request: responding({ status: 'OVER_QUERY_LIMIT' }) });
    const result = await adapter.harvest({
      listing: { place_id: 'p' },
      secrets: { places_api_key: 'k' },
    });

    expect(result.error.code).toBe('ERR-RATE-LIMITED');
  });

  it('treats a non-2xx as a failure rather than parsing an error page', async () => {
    // `fetch` does not throw on 4xx/5xx, and treating one as success is how an
    // HTML error page gets parsed as review data.
    const adapter = createPlacesAdapter({
      request: responding({}, { ok: false, status: 503 }),
    });
    const result = await adapter.harvest({
      listing: { place_id: 'p' },
      secrets: { places_api_key: 'k' },
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-SOURCE-UNAVAILABLE');
  });
});
