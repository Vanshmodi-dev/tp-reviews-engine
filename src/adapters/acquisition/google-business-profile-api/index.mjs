/**
 * The Business Profile API adapter (PH-22, §52).
 *
 * ## Materially different from the other three, on purpose
 *
 * §52.1 requires four adapters that differ in kind, because *"an interface
 * tested against a single implementation is not an interface, it is a rename"*.
 * This one contributes OAuth refresh, per-client secrets, and real pagination —
 * none of which the CSV, DOM, or Places adapters exercise.
 *
 * It is also the only adapter that can report `target_reached` honestly: it
 * pages until the source stops offering a next page, so "we have them all" is
 * something the source actually told us rather than something we inferred.
 *
 * ## Per-client secrets, and a missing one fails closed (ADP-04)
 *
 * The refresh token belongs to the client, not to the engine — this is the one
 * adapter where a secret is scoped per target. A missing one is
 * `ERR-CONFIG-SECRET-MISSING` and never a downgrade to page reading.
 *
 * ## Pagination stops on the source's word, not on a count
 *
 * The loop ends when `nextPageToken` is absent. It does **not** end when the
 * accumulated count reaches the advertised total — an advertised total is a
 * number the source publishes for humans, it goes stale, and stopping on it
 * would silently truncate every listing whose count had grown since.
 *
 * @module adapters/acquisition/google-business-profile-api
 */

/**
 * The full field set. This source carries more than Places does, and the
 * descriptor says so — an adapter that under-declares makes the gate reason
 * about coverage it actually has.
 */
export const BUSINESS_PROFILE_CAPABILITIES = Object.freeze([
  'review_text',
  'owner_reply',
  'author_name',
  'relative_date',
  'verified',
]);

/** A bound on the paging loop, so a broken cursor cannot spin forever. */
export const MAX_PAGES = 40;

/**
 * @param {object} [options]
 * @param {(url: string, init?: any) => Promise<any>} [options.request]
 * @param {(refreshToken: string) => Promise<any>} [options.exchangeToken]
 * @returns {any}
 */
export function createBusinessProfileAdapter(options = {}) {
  const request = options.request ?? globalThis.fetch;
  const exchangeToken = options.exchangeToken ?? defaultExchange(request);

  return {
    id: 'google:business-profile-api',

    capabilities: () => BUSINESS_PROFILE_CAPABILITIES,

    /**
     * @param {any} input
     * @returns {Promise<any>}
     */
    async harvest(input) {
      const refreshToken = input.secrets?.business_profile_refresh_token;

      if (typeof refreshToken !== 'string' || refreshToken.trim() === '') {
        return failure(
          'ERR-CONFIG-SECRET-MISSING',
          'business_profile_refresh_token is not set for this client; ' +
            'this adapter does not fall back to page reading (TR-SEC-010)',
        );
      }

      const locationName = input.listing?.location_name;

      if (typeof locationName !== 'string' || locationName === '') {
        return failure('ERR-RESOLVE-NO-IDENTIFIER', 'listing.location_name is not set');
      }

      const token = await safely(() => exchangeToken(refreshToken));

      if (token.ok === false) {
        // An expired or revoked refresh token is an auth failure, not a source
        // outage. They have different runbooks and different retry policies,
        // and reporting the wrong one costs an investigation.
        return failure('ERR-AUTH-FAILED', token.detail);
      }

      return paginate({ request, token: token.value, locationName, input });
    },
  };
}

/**
 * Pages until the source says there is no next page.
 *
 * @param {{ request: any, token: string, locationName: string, input: any }} context
 * @returns {Promise<any>}
 */
async function paginate({ request, token, locationName, input }) {
  const cap = input.cap ?? Number.POSITIVE_INFINITY;
  /** @type {any[]} */
  const reviews = [];
  /** @type {number[]} */
  const growthCurve = [];
  /** @type {string | null} */
  let cursor = null;
  let advertisedTotal = null;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const page = await safely(() =>
      request(endpointFor(locationName, cursor), { headers: { authorization: `Bearer ${token}` } }),
    );

    if (page.ok === false) {
      // Whatever was already collected is real. Returning it with an honest
      // `stalled` beats discarding it — additions are trustworthy even from a
      // partial harvest; only absences are not (INV-03).
      return reviews.length === 0
        ? failure('ERR-SOURCE-UNAVAILABLE', page.detail)
        : done({ reviews, growthCurve, advertisedTotal, stopReason: 'stalled' });
    }

    pages += 1;
    advertisedTotal = numberOr(page.value?.totalReviewCount, advertisedTotal);
    reviews.push(...pageReviews(page.value));
    growthCurve.push(reviews.length);

    if (reviews.length >= cap) {
      return done({
        reviews: reviews.slice(0, cap),
        growthCurve,
        advertisedTotal,
        stopReason: 'cap_reached',
      });
    }

    cursor = nextCursor(page.value);

    // The source's word, not our arithmetic. Stopping when the count reaches
    // the advertised total would truncate every listing whose real count had
    // grown past the number the source publishes.
    if (cursor === null) {
      return done({ reviews, growthCurve, advertisedTotal, stopReason: 'target_reached' });
    }
  }

  // The cursor never cleared. That is a broken source contract rather than a
  // complete harvest, and saying `target_reached` here would authorise
  // deletions on the strength of a bug.
  return done({ reviews, growthCurve, advertisedTotal, stopReason: 'stalled' });
}

/**
 * @param {any} body
 * @returns {any[]}
 */
function pageReviews(body) {
  return Array.isArray(body?.reviews) ? body.reviews.map(toReview) : [];
}

/**
 * @param {any} body
 * @returns {string | null}
 */
function nextCursor(body) {
  return typeof body?.nextPageToken === 'string' && body.nextPageToken !== ''
    ? body.nextPageToken
    : null;
}

/**
 * @param {any} input
 * @returns {any}
 */
function done({ reviews, growthCurve, advertisedTotal, stopReason }) {
  // Contract assertion 9: a malformed entry is isolated and recorded, never
  // allowed to fail the whole harvest. The rest of the data is still worth
  // having.
  const mappable = reviews.filter((/** @type {any} */ review) => review !== null);
  const rejected = reviews
    .map((/** @type {any} */ review, /** @type {number} */ index) =>
      review === null ? { index, reason: 'unmappable review entry' } : null,
    )
    .filter((/** @type {any} */ entry) => entry !== null);

  return {
    ok: true,
    value: {
      adapter_id: 'google:business-profile-api',
      reviews: mappable,
      stop_reason: stopReason,
      growth_curve: growthCurve,
      advertised_total: advertisedTotal,
      advertised_rating: null,
      capabilities: BUSINESS_PROFILE_CAPABILITIES,
      diagnostics: { rejected_rows: rejected },
    },
  };
}

/**
 * @param {any} review
 * @returns {any}
 */
function toReview(review) {
  if (review === null || typeof review !== 'object') return null;

  const rating = STAR_RATINGS[/** @type {keyof typeof STAR_RATINGS} */ (review.starRating)] ?? null;

  // Neither a rating nor a comment is not a review — it is an artefact of a
  // response shape that changed. It is rejected rather than mapped to a row of
  // nulls that would reach a client's site as an empty card.
  if (rating === null && typeof review.comment !== 'string') return null;

  const reviewer = review.reviewer ?? {};

  return {
    source: 'google',
    rating,
    text: stringOrNull(review.comment),
    relative_date_raw: stringOrNull(review.createTime),
    author: {
      name: stringOrNull(reviewer.displayName),
      profile_url: null,
      avatar_url: stringOrNull(reviewer.profilePhotoUrl),
      badges: [],
    },
    // Not carried by this source. Null rather than 0, because `0` is a claim
    // the API never made and is indistinguishable downstream from a real zero.
    meta: { likes: null, photo_count: null, visited: null },
    owner_reply: replyOf(review?.reviewReply),
    text_truncated: false,
    strategy_indices: {},
  };
}

/** The API states ratings as words. */
const STAR_RATINGS = Object.freeze({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 });

/**
 * @param {any} reply
 * @returns {any}
 */
function replyOf(reply) {
  if (reply === null || reply === undefined) return null;

  return { text: stringOrNull(reply.comment), relative_date_raw: stringOrNull(reply.updateTime) };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

/**
 * @param {any} request
 * @returns {(refreshToken: string) => Promise<string>}
 */
function defaultExchange(request) {
  return async (refreshToken) => {
    const response = await request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });

    if (response?.ok === false) throw new Error(`token exchange failed: HTTP ${response.status}`);

    const body = await response.json();

    if (typeof body?.access_token !== 'string') throw new Error('no access_token in the response');

    return body.access_token;
  };
}

/**
 * @param {string} locationName
 * @param {string | null} cursor
 * @returns {string}
 */
function endpointFor(locationName, cursor) {
  const url = new URL(`https://mybusiness.googleapis.com/v4/${locationName}/reviews`);

  if (cursor !== null) url.searchParams.set('pageToken', cursor);

  return url.toString();
}

/**
 * @param {unknown} value
 * @param {number | null} fallback
 * @returns {number | null}
 */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {() => Promise<any>} work
 * @returns {Promise<any>}
 */
async function safely(work) {
  try {
    const result = await work();

    if (typeof result === 'string') return { ok: true, value: result };
    if (result?.ok === false) return { ok: false, detail: `HTTP ${result.status}` };

    return { ok: true, value: await result.json() };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {any}
 */
function failure(code, message) {
  return { ok: false, error: { code, message } };
}
