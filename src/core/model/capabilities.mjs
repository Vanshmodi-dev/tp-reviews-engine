/**
 * The adapter capability descriptor (FR-020, TR-EXT-P-041).
 *
 * **This exists so that a `null` in a payload is never ambiguous.** A consumer
 * looking at `owner_reply: null` needs to know whether this review has no reply
 * or whether the adapter that fetched it cannot see replies at all. Those are
 * completely different facts, and without a capability declaration they look
 * identical.
 *
 * The declaration is published in `provenance.adapter_capabilities`, so the
 * answer travels with the data rather than living in documentation a consumer
 * will not read.
 *
 * **An adapter declares its capabilities honestly, including the reduced ones.**
 * The Places API adapter returns roughly five reviews and cannot see owner
 * replies; saying so is not an admission of weakness, it is the entire reason a
 * client can be migrated onto a sanctioned API without their website silently
 * appearing to lose data.
 *
 * @module core/model/capabilities
 */

/**
 * Every capability an acquisition adapter may declare.
 *
 * Each maps to a payload field that is nullable precisely because not every
 * source exposes it.
 */
export const CAPABILITIES = Object.freeze([
  /** Review body text, not just a star rating. */
  'review_text',
  /** Business replies to reviews. */
  'owner_reply',
  /** Helpful/like counts. */
  'likes',
  /** Photo counts attached to a review. */
  'photo_count',
  /** A verified-purchase or verified-visit marker. */
  'verified',
  /** The reviewer's display name. */
  'author_name',
  /** A link to the reviewer's public profile. */
  'author_profile_url',
  /** The reviewer's avatar image URL. */
  'author_avatar_url',
  /** Source-specific reviewer badges, e.g. Local Guide. */
  'author_badges',
  /** The reviewer's total review count at the source. */
  'author_review_count',
  /** The source's own relative phrasing, e.g. "2 months ago". */
  'relative_date',
  /** An absolute date from the source rather than one estimated from a phrase. */
  'absolute_date',
  /** The source-reported total number of reviews. */
  'advertised_total',
  /** The source-reported aggregate rating. */
  'advertised_rating',
  /** More than a fixed handful of reviews per listing. */
  'full_pagination',
  /** Reviews can be requested newest-first. */
  'sort_by_newest',
]);

/**
 * @typedef {object} AdapterCapabilities
 * @property {string} adapter        e.g. `google:dom`.
 * @property {ReadonlyArray<string>} supports  Subset of {@link CAPABILITIES}.
 * @property {number | null} max_reviews_per_listing
 *   A hard ceiling the adapter itself imposes, or `null` when it can paginate
 *   freely. The Places API's ~5 is the reason this field exists.
 * @property {boolean} sanctioned    Whether the source permits this access method.
 */

/**
 * @param {string} adapter
 * @param {ReadonlyArray<string>} supports
 * @param {{ maxReviewsPerListing?: number | null, sanctioned?: boolean }} [options]
 * @returns {AdapterCapabilities}
 */
export function declareCapabilities(adapter, supports, options = {}) {
  return Object.freeze({
    adapter,
    supports: Object.freeze([...supports].sort()),
    max_reviews_per_listing: options.maxReviewsPerListing ?? null,
    sanctioned: options.sanctioned ?? false,
  });
}

/**
 * @param {AdapterCapabilities} capabilities
 * @param {string} capability
 * @returns {boolean}
 */
export function supports(capabilities, capability) {
  return capabilities.supports.includes(capability);
}

/**
 * Names any declared capability that is not in the known set.
 *
 * A typo here is worse than it looks: an adapter declaring `owner_replies`
 * instead of `owner_reply` publishes a capability list a consumer cannot match,
 * and every reply silently reads as "unsupported".
 *
 * @param {AdapterCapabilities} capabilities
 * @returns {string[]}
 */
export function unknownCapabilities(capabilities) {
  return capabilities.supports.filter((c) => !CAPABILITIES.includes(c));
}

/**
 * Explains a `null` field to a consumer.
 *
 * This is the whole point of the descriptor, expressed as one function.
 *
 * @param {AdapterCapabilities} capabilities
 * @param {string} capability
 * @returns {'unsupported' | 'absent'}
 *   `unsupported` — the adapter cannot supply this at all.
 *   `absent` — the adapter could have supplied it; this review simply has none.
 */
export function explainNull(capabilities, capability) {
  return supports(capabilities, capability) ? 'absent' : 'unsupported';
}
