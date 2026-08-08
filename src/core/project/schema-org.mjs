/**
 * schema.org structured-data projection — **opt-in, off by default** (T-120).
 *
 * ============================================================================
 * READ BEFORE ENABLING THIS FOR A CLIENT
 * ============================================================================
 *
 * Search engines have specific and changing policies about self-serving review
 * markup — review snippets a business publishes about itself. Emitting markup
 * that violates them can result in a **manual action against the client's own
 * site**, which is a harm to somebody else's business that the engine must not
 * cause by default and must not cause silently (TR-PROJ-040).
 *
 * `publish.schema_org` therefore defaults to `false` and requires per-client
 * opt-in. The policy position must be verified for the client's jurisdiction
 * and vertical before it is turned on. This is an assumption the documents flag
 * explicitly, not a settled fact.
 *
 * ## Honesty rules, which are the same rules as everywhere else
 *
 * `reviewCount` reflects **published** reviews. `advertised_total` is never
 * substituted to inflate it. Publishing "247 reviews" in machine-readable
 * markup while holding 180 is a claim the client cannot substantiate, made in
 * the format search engines are most likely to act on.
 *
 * `datePublished` is emitted **only** when `date_precision` is `day` or `week`.
 * Coarser precision omits the field rather than asserting a date the engine
 * inferred from "2 months ago". A wrong date in structured data is worse than
 * an absent one: consumers treat it as authoritative.
 *
 * @module core/project/schema-org
 */

/** `YYYY-MM-DD` is the first ten characters of an RFC 3339 timestamp. */
const ISO_DATE_LENGTH = 10;

/** Precisions specific enough to publish a date for. */
const PUBLISHABLE_PRECISIONS = Object.freeze(['day', 'week']);

/**
 * Whether a review's date is precise enough to assert.
 *
 * @param {any} review
 * @returns {boolean}
 */
export function datePublishable(review) {
  return (
    typeof review.date === 'string' && PUBLISHABLE_PRECISIONS.includes(review.date_precision ?? '')
  );
}

/**
 * Builds the schema.org artifact, or `null` when not opted in.
 *
 * Returning `null` rather than throwing lets the caller treat "not enabled" as
 * the ordinary case it is: the artifact simply is not written.
 *
 * @param {Record<string, any>} payload The `reviews` artifact.
 * @param {any} [publish] The `publish` config block.
 * @returns {Record<string, any> | null}
 */
export function projectSchemaOrg(payload, publish = {}) {
  if (publish.schema_org !== true) return null;

  const stats = payload.stats;

  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: payload.listing.display_name,
    ...(payload.listing.source_url === null ? {} : { url: payload.listing.source_url }),
    aggregateRating: buildAggregateRating(stats),
    review: payload.reviews.map((/** @type {any} */ review) => buildReview(review)),
  };
}

/**
 * @param {any} stats
 * @returns {Record<string, any> | undefined}
 */
function buildAggregateRating(stats) {
  // A business with no rated reviews has no aggregate rating. Emitting one with
  // a value of 0 would render as a one-star business in a search result.
  if (stats.total_count === 0) return undefined;

  return {
    '@type': 'AggregateRating',
    ratingValue: stats.mean_rating,
    reviewCount: stats.total_count,
    bestRating: 5,
    worstRating: 1,
  };
}

/**
 * @param {any} review
 * @returns {Record<string, any>}
 */
function buildReview(review) {
  return {
    '@type': 'Review',
    author: {
      '@type': 'Person',
      name: review.author_name ?? review.author_initials ?? 'Anonymous',
    },
    reviewRating: {
      '@type': 'Rating',
      ratingValue: review.rating,
      bestRating: 5,
      worstRating: 1,
    },
    ...(review.text === null ? {} : { reviewBody: review.text }),
    ...(datePublishable(review) ? { datePublished: review.date.slice(0, ISO_DATE_LENGTH) } : {}),
  };
}
