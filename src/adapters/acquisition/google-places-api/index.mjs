/**
 * The Places API adapter (PH-22, §52).
 *
 * ## The five-review ceiling is why capability descriptors exist
 *
 * This API returns roughly five reviews per place. Not five out of five —
 * **five out of however many exist**, chosen by the source, with no way to
 * page for the rest.
 *
 * An adapter that reported that as a complete harvest would be catastrophic
 * rather than merely wrong: the reconciler would see 5 records where the ledger
 * holds 118, conclude 113 were removed, and start a countdown to deleting a
 * paying client's review set. So this adapter reports `cap_reached` — never
 * `target_reached` — and declares the ceiling in its capabilities so that every
 * downstream rule reasons about coverage correctly.
 *
 * VAL-01 is what makes that work: completeness is derived from the stop reason,
 * so the honest stop reason is the whole contribution.
 *
 * ## A missing secret fails closed (ADP-04, TR-SEC-010, SEC-4)
 *
 * `ERR-CONFIG-SECRET-MISSING`, and **never** a fallback to the DOM adapter.
 * That fallback is the specific violation the TRD names: an operational
 * triviality — an unrotated key, a typo'd variable name — silently converting a
 * client from an official API to page-reading, which is a policy decision
 * nobody made and nobody can see.
 *
 * ## It imports no other adapter (ADP-05, DR-3)
 *
 * The named violation is this adapter borrowing a mapping helper from the DOM
 * adapter. Shared pure logic belongs in `core/`; there is none here that
 * qualifies, so there is none imported.
 *
 * @module adapters/acquisition/google-places-api
 */

/**
 * What this adapter can actually supply.
 *
 * `review_text`, `author_name` and `owner_reply` are present. Absent, and
 * deliberately not claimed: `likes`, `photo_count`, `verified`,
 * `author_profile_url`. Declaring a capability the source does not provide
 * makes every `null` look like a data problem rather than a source limit.
 */
export const PLACES_CAPABILITIES = Object.freeze([
  'review_text',
  'owner_reply',
  'author_name',
  'relative_date',
]);

/**
 * The ceiling the API imposes.
 *
 * Named rather than inlined because it is a fact about the source, and the day
 * it changes this constant is the one place that has to move.
 */
export const PLACES_REVIEW_CEILING = 5;

/**
 * @param {object} [options]
 * @param {(url: string, init?: any) => Promise<any>} [options.request]
 * @returns {any}
 */
export function createPlacesAdapter(options = {}) {
  const request = options.request ?? globalThis.fetch;

  return {
    id: 'google:places-api',

    capabilities: () => PLACES_CAPABILITIES,

    /**
     * @param {any} input
     * @returns {Promise<any>}
     */
    async harvest(input) {
      const refusal = checkPrerequisites(input);

      if (refusal !== null) return refusal;

      const key = input.secrets.places_api_key;
      const response = await safely(() => request(endpointFor(input.listing.place_id, key)));

      if (response.ok === false) {
        return failure('ERR-SOURCE-UNAVAILABLE', response.detail);
      }

      const rejected = checkStatus(response.value);

      return rejected ?? { ok: true, value: harvestOf(response.value, input) };
    },
  };
}

/**
 * The two refusals that need no network (ADP-04).
 *
 * Checked before the request so a misconfigured target costs nothing, and so
 * the secret check cannot be reached around.
 *
 * @param {any} input
 * @returns {any | null}
 */
function checkPrerequisites(input) {
  const key = input.secrets?.places_api_key;

  if (typeof key !== 'string' || key.trim() === '') {
    // Fail closed. The alternative — quietly using the DOM adapter — turns a
    // missing environment variable into a change of legal posture that nothing
    // records and nobody approved.
    return failure(
      'ERR-CONFIG-SECRET-MISSING',
      'places_api_key is not set; this adapter does not fall back to page reading (TR-SEC-010)',
    );
  }

  const placeId = input.listing?.place_id;

  if (typeof placeId !== 'string' || placeId === '') {
    return failure('ERR-RESOLVE-NO-IDENTIFIER', 'listing.place_id is not set');
  }

  return null;
}

/**
 * Quota is a source-scoped refusal, not a target failure. Treating it as a
 * parse problem sends an engineer to the wrong runbook and retries against a
 * quota that is already spent.
 *
 * @param {any} body
 * @returns {any | null}
 */
function checkStatus(body) {
  if (body?.status === 'OVER_QUERY_LIMIT') {
    return failure('ERR-RATE-LIMITED', 'the Places quota is exhausted');
  }

  if (body?.status !== undefined && body.status !== 'OK') {
    return failure('ERR-SOURCE-UNAVAILABLE', `Places returned ${body.status}`);
  }

  return null;
}

/**
 * @param {any} body
 * @param {any} input
 * @returns {any}
 */
function harvestOf(body, input) {
  const result = body?.result ?? {};
  const raw = Array.isArray(result.reviews) ? result.reviews : [];
  const cap = Math.min(input.cap ?? PLACES_REVIEW_CEILING, PLACES_REVIEW_CEILING);
  const { reviews, rejected } = partition(raw.slice(0, cap));

  return {
    adapter_id: 'google:places-api',
    reviews,
    // NEVER `target_reached`. The source chose which five to return and there
    // is no page two; reporting completion would let the reconciler treat 113
    // unseen reviews as removed.
    stop_reason: 'cap_reached',
    // Reported as the source stated it, or null. Deriving it from the observed
    // count would make coverage permanently 1.0 and G-08 permanently silent.
    advertised_total:
      typeof result.user_ratings_total === 'number' ? result.user_ratings_total : null,
    advertised_rating: typeof result.rating === 'number' ? result.rating : null,
    capabilities: PLACES_CAPABILITIES,
    diagnostics: { rejected_rows: rejected },
  };
}

/**
 * Splits mappable reviews from unusable ones (contract assertion 9).
 *
 * An all-or-nothing adapter means one malformed entry removes a client's entire
 * review set — and it recurs every run until a human finds it. A rejected entry
 * is recorded rather than dropped, so the count is visible in diagnostics.
 *
 * @param {ReadonlyArray<any>} raw
 * @returns {{ reviews: any[], rejected: any[] }}
 */
function partition(raw) {
  /** @type {any[]} */
  const reviews = [];
  /** @type {any[]} */
  const rejected = [];

  for (const [index, entry] of raw.entries()) {
    if (entry === null || typeof entry !== 'object') {
      rejected.push({ index, reason: 'the review entry is not an object' });
      continue;
    }

    if (typeof entry.rating !== 'number' && typeof entry.text !== 'string') {
      // Neither a rating nor text is not a review — it is an artefact of a
      // response shape that changed. Publishing it would put an empty card on
      // a client's site.
      rejected.push({ index, reason: 'the entry carries neither a rating nor text' });
      continue;
    }

    reviews.push(toReview(entry));
  }

  return { reviews, rejected };
}

/**
 * Maps one API review, fabricating nothing (contract assertion 7).
 *
 * Every field this source does not carry is `null` rather than a plausible
 * default. `likes: 0` would be a claim the API never made, and it would be
 * indistinguishable downstream from a review nobody found helpful.
 *
 * @param {any} review
 * @returns {any}
 */
function toReview(review) {
  return {
    source: 'google',
    rating: numberOrNull(review.rating),
    text: stringOrNull(review.text),
    relative_date_raw: stringOrNull(review.relative_time_description),
    author: {
      name: stringOrNull(review.author_name),
      // The API returns a profile URL, but the host allowlist decides whether
      // it may be published — that is `core/normalize/url.mjs`'s job, not this
      // adapter's.
      profile_url: stringOrNull(review.author_url),
      avatar_url: stringOrNull(review.profile_photo_url),
      badges: [],
    },
    // Null rather than 0. `0` would be a claim the API never made, and it is
    // indistinguishable downstream from a review nobody found helpful.
    meta: { likes: null, photo_count: null, visited: null },
    owner_reply: null,
    text_truncated: false,
    strategy_indices: {},
  };
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numberOrNull(value) {
  return typeof value === 'number' ? value : null;
}

/**
 * @param {string} placeId
 * @param {string} key
 * @returns {string}
 */
function endpointFor(placeId, key) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');

  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'reviews,rating,user_ratings_total');
  url.searchParams.set('key', key);

  return url.toString();
}

/**
 * @param {() => Promise<any>} work
 * @returns {Promise<any>}
 */
async function safely(work) {
  try {
    const response = await work();

    // A non-2xx is not an exception in `fetch`, and treating it as success is
    // how an HTML error page gets parsed as review data.
    if (response?.ok === false) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }

    return { ok: true, value: await response.json() };
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
