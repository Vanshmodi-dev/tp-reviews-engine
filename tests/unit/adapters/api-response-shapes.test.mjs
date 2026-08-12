/**
 * The two API adapters against responses that are not the happy shape.
 *
 * The contract suite (tests/contract/api-adapters.contract.test.mjs) proves
 * both adapters honour the acquisition port. It does that with well-formed
 * bodies, because its job is the contract rather than the vendor.
 *
 * This file is the other half: what these adapters do when Google returns
 * something else. That is not a hypothetical — a field disappearing from a
 * response is the single most common way a working integration breaks, and it
 * arrives with no version bump and no notice.
 *
 * The rule every case here enforces is ADP-04 and INV-03 together: an adapter
 * may return FEWER reviews than exist, but it may never report a shortfall as
 * completion, and it may never map a missing field to a plausible-looking
 * value. A rating invented as 5, or an author named "undefined", is worse than
 * a rejected row — it publishes to a client's site and nothing flags it.
 */

import { describe, expect, it } from 'vitest';

import { createBusinessProfileAdapter } from '../../../src/adapters/acquisition/google-business-profile-api/index.mjs';
import { createPlacesAdapter } from '../../../src/adapters/acquisition/google-places-api/index.mjs';

/**
 * A fetch-shaped stub returning one body.
 *
 * @param {any} body
 * @param {any} [over]
 * @returns {any}
 */
const responding = (body, over = {}) =>
  async function stub() {
    return { ok: true, status: 200, json: async () => body, ...over };
  };

const PLACES_INPUT = {
  listing: { place_id: 'ChIJ_test' },
  secrets: { places_api_key: 'k' },
};

const PROFILE_INPUT = {
  listing: { location_name: 'accounts/1/locations/2' },
  secrets: { business_profile_refresh_token: 'r' },
};

describe('google:places-api against unexpected responses', () => {
  it('reports a source outage, naming the status, when Places refuses the request', async () => {
    const adapter = createPlacesAdapter({ request: responding({ status: 'NOT_FOUND' }) });
    const result = await adapter.harvest(PLACES_INPUT);

    expect(result.ok).toBe(false);
    // The status has to reach the operator. "Places returned something" costs
    // an investigation that the body already answered.
    expect(result.error.message).toContain('NOT_FOUND');
    expect(result.error.code).toBe('ERR-SOURCE-UNAVAILABLE');
  });

  it('keeps quota exhaustion distinct from an outage', async () => {
    const adapter = createPlacesAdapter({ request: responding({ status: 'OVER_QUERY_LIMIT' }) });
    const result = await adapter.harvest(PLACES_INPUT);

    // Different runbook, different retry policy. Retrying against a spent quota
    // achieves nothing and can extend the block.
    expect(result.error.code).toBe('ERR-RATE-LIMITED');
  });

  it('does not parse a non-2xx body as review data', async () => {
    // `fetch` does not throw on 5xx. Treating it as success is how an HTML
    // error page becomes a review set.
    const adapter = createPlacesAdapter({
      request: responding({ status: 'OK' }, { ok: false, status: 503 }),
    });
    const result = await adapter.harvest(PLACES_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('503');
  });

  it('surfaces a transport failure rather than letting it escape as an exception', async () => {
    const adapter = createPlacesAdapter({
      request: async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    });
    const result = await adapter.harvest(PLACES_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error.message).toContain('ENOTFOUND');
  });

  it('still reports cap_reached when the body carries no result block at all', async () => {
    const adapter = createPlacesAdapter({ request: responding({ status: 'OK' }) });
    const result = await adapter.harvest(PLACES_INPUT);

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toEqual([]);
    // NOT `target_reached`, even with zero reviews. This adapter can never
    // prove it saw everything, and an empty harvest claiming completion tells
    // the reconciler that every review the client has was removed.
    expect(result.value.stop_reason).toBe('cap_reached');
  });

  it('treats a reviews field that is not an array as no reviews rather than iterating it', async () => {
    const adapter = createPlacesAdapter({
      request: responding({ status: 'OK', result: { reviews: 'unavailable' } }),
    });
    const result = await adapter.harvest(PLACES_INPUT);

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toEqual([]);
  });

  it('reports the advertised total as null, never as the observed count, when the source omits it', async () => {
    const adapter = createPlacesAdapter({
      request: responding({
        status: 'OK',
        result: { reviews: [{ author_name: 'A', rating: 5, text: 'x' }] },
      }),
    });
    const result = await adapter.harvest(PLACES_INPUT);

    // Deriving it from what arrived would make coverage permanently 1.0 and
    // G-08 — the gate rule that catches a truncated harvest — permanently
    // silent. Null is the honest answer to a question the source did not
    // answer.
    expect(result.value.advertised_total).toBeNull();
    expect(result.value.advertised_rating).toBeNull();
  });

  it('reports a non-numeric total as null rather than coercing it', async () => {
    const adapter = createPlacesAdapter({
      request: responding({
        status: 'OK',
        result: { reviews: [], user_ratings_total: '118', rating: '4.4' },
      }),
    });
    const result = await adapter.harvest(PLACES_INPUT);

    expect(result.value.advertised_total).toBeNull();
    expect(result.value.advertised_rating).toBeNull();
  });

  it('rejects a row that is not an object, keeping the rows around it', async () => {
    const adapter = createPlacesAdapter({
      request: responding({
        status: 'OK',
        result: { reviews: [{ author_name: 'A', rating: 5, text: 'x' }, null, 'not a review'] },
      }),
    });
    const result = await adapter.harvest(PLACES_INPUT);

    // All-or-nothing would mean one malformed entry removes the client's whole
    // review set, every run, until a human finds it.
    expect(result.value.reviews).toHaveLength(1);
    expect(result.value.diagnostics.rejected_rows).toHaveLength(2);
    expect(result.value.diagnostics.rejected_rows[0].index).toBe(1);
  });
});

describe('google:business-profile-api against unexpected responses', () => {
  it('maps an owner reply, which is the capability this adapter exists for', async () => {
    const adapter = createBusinessProfileAdapter({
      request: responding({
        totalReviewCount: 1,
        reviews: [
          {
            starRating: 'FOUR',
            comment: 'Prompt work.',
            createTime: '2026-01-02T00:00:00Z',
            reviewer: { displayName: 'Sam' },
            reviewReply: { comment: 'Thanks Sam!', updateTime: '2026-01-03T00:00:00Z' },
          },
        ],
      }),
      exchangeToken: async () => 'access-token',
    });
    const result = await adapter.harvest(PROFILE_INPUT);

    expect(result.value.reviews[0].owner_reply).toEqual({
      text: 'Thanks Sam!',
      relative_date_raw: '2026-01-03T00:00:00Z',
    });
  });

  it('maps a review with no reply to a null reply, not to an empty one', async () => {
    const adapter = createBusinessProfileAdapter({
      request: responding({
        totalReviewCount: 1,
        reviews: [{ starRating: 'FIVE', comment: 'Good', reviewer: { displayName: 'Sam' } }],
      }),
      exchangeToken: async () => 'access-token',
    });
    const result = await adapter.harvest(PROFILE_INPUT);

    // `{ text: null }` would render as an empty reply bubble on the client's
    // site. Absence and emptiness are different things (INV-04).
    expect(result.value.reviews[0].owner_reply).toBeNull();
  });

  it('maps a review whose reviewer block is missing rather than throwing on it', async () => {
    const adapter = createBusinessProfileAdapter({
      request: responding({
        totalReviewCount: 1,
        reviews: [{ starRating: 'THREE', comment: 'Fine' }],
      }),
      exchangeToken: async () => 'access-token',
    });
    const result = await adapter.harvest(PROFILE_INPUT);

    expect(result.value.reviews[0].author.name).toBeNull();
    expect(result.value.reviews[0].rating).toBe(3);
  });

  it('rejects an entry that carries neither a rating nor a comment', async () => {
    const adapter = createBusinessProfileAdapter({
      request: responding({
        totalReviewCount: 2,
        reviews: [{ starRating: 'FIVE', comment: 'Good' }, { reviewer: { displayName: 'Ghost' } }],
      }),
      exchangeToken: async () => 'access-token',
    });
    const result = await adapter.harvest(PROFILE_INPUT);

    // Neither means it is not a review — it is the residue of a response shape
    // that changed. Mapped, it would reach a site as an empty card.
    expect(result.value.reviews).toHaveLength(1);
    expect(result.value.diagnostics.rejected_rows).toHaveLength(1);
  });

  it('treats a page whose reviews field is not an array as an empty page', async () => {
    const adapter = createBusinessProfileAdapter({
      request: responding({ totalReviewCount: 4 }),
      exchangeToken: async () => 'access-token',
    });
    const result = await adapter.harvest(PROFILE_INPUT);

    expect(result.ok).toBe(true);
    expect(result.value.reviews).toEqual([]);
  });
});

describe('the default OAuth refresh exchange', () => {
  /**
   * @param {any} tokenBody
   * @param {any} [tokenOver]
   * @returns {{ adapter: any, calls: any[] }}
   */
  function withExchange(tokenBody, tokenOver = {}) {
    /** @type {any[]} */
    const calls = [];
    // No `exchangeToken` override — this exercises the real refresh flow.
    const adapter = createBusinessProfileAdapter({
      request: async (/** @type {string} */ url, /** @type {any} */ init) => {
        calls.push({ url, init });

        return url.includes('oauth2')
          ? { ok: true, status: 200, json: async () => tokenBody, ...tokenOver }
          : {
              ok: true,
              status: 200,
              json: async () => ({
                totalReviewCount: 1,
                reviews: [{ starRating: 'FIVE', comment: 'Good', reviewer: { displayName: 'S' } }],
              }),
            };
      },
    });

    return { adapter, calls };
  }

  it('exchanges the refresh token and bearers the result on the reviews request', async () => {
    const { adapter, calls } = withExchange({ access_token: 'fresh-token' });
    const result = await adapter.harvest(PROFILE_INPUT);

    expect(result.ok).toBe(true);
    expect(calls[0].url).toContain('oauth2.googleapis.com/token');
    // The refresh token is a long-lived credential and the access token is not.
    // Sending the refresh token to the reviews endpoint would put a permanent
    // credential in a request that is logged and retried.
    expect(calls[1].init.headers.authorization).toBe('Bearer fresh-token');
  });

  it('reports an auth failure, not a source outage, when the exchange is refused', async () => {
    const { adapter } = withExchange({}, { ok: false, status: 400 });
    const result = await adapter.harvest(PROFILE_INPUT);

    expect(result.ok).toBe(false);
    // A revoked refresh token needs a human to re-consent. Classed as an
    // outage it would be retried forever against a credential that will never
    // work again.
    expect(result.error.code).toBe('ERR-AUTH-FAILED');
  });

  it('reports an auth failure when the exchange succeeds but returns no token', async () => {
    const { adapter } = withExchange({ error: 'invalid_grant' });
    const result = await adapter.harvest(PROFILE_INPUT);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('ERR-AUTH-FAILED');
    // The naive failure is `Bearer undefined` reaching the API and coming back
    // as a 401, which reads as an outage.
    expect(result.error.message).toContain('access_token');
  });
});
