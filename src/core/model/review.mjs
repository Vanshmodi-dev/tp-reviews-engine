/**
 * The review record, in its four shapes.
 *
 * A review changes shape as it moves through the pipeline, and the shapes are
 * deliberately distinct types rather than one optional-heavy object:
 *
 * ```
 * ExtractedReview   raw strings straight off an adapter. Nothing is trusted.
 *       |  normalise
 * NormalizedReview  text is CleanString. Markup is gone, not escaped.
 *       |  reconcile
 * LedgerReview      durable state: streaks, revisions, tombstones. Private.
 *       |  project
 * PayloadReview     the public contract. Twenty-four fields, no internals.
 * ```
 *
 * **The `CleanString` brand is the point of this file.** It is a compile-time
 * marker that a string has been through `core/normalize/`. `PayloadReview.text`
 * is a `CleanString`, so assigning a raw extracted string to it is a type
 * error — which means "unnormalised text reached a client website" becomes a
 * failed build rather than an incident.
 *
 * TRD §52.5 is the authority for `PayloadReview`; §22.5 for `LedgerReview`.
 *
 * @module core/model/review
 */

/** Granularity of a resolved date. Never guessed finer than the source stated. */
export const DATE_PRECISIONS = Object.freeze(['day', 'week', 'month', 'year', 'unknown']);

/** How much to trust a resolved date. */
export const DATE_CONFIDENCES = Object.freeze(['high', 'medium', 'low']);

/** Review sources. Enables merged multi-source payloads without ambiguity. */
export const REVIEW_SOURCES = Object.freeze([
  'google',
  'facebook',
  'trustpilot',
  'justdial',
  'glassdoor',
  'yelp',
  'manual',
  'csv',
]);

/**
 * How complete a harvest was. This drives the absence asymmetry: absence is
 * only evidence of removal when the harvest was complete.
 */
export const COMPLETENESS = Object.freeze(['full', 'full_capped', 'partial', 'failed']);

/** Ledger lifecycle states. A tombstone is permanent; a suppression is permanent. */
export const LEDGER_STATES = Object.freeze(['active', 'unconfirmed', 'tombstoned', 'suppressed']);

/** Payload flags a consumer may branch on. */
export const REVIEW_FLAGS = Object.freeze([
  'unconfirmed',
  'rating_only',
  'reply_present',
  'text_clipped',
  'text_truncated',
]);

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/**
 * A string that has passed through the normalisation pipeline.
 *
 * The brand exists only in the type system; at runtime this is an ordinary
 * string. That is sufficient, because the failure it prevents — raw source text
 * reaching a payload — is a coding mistake, not an attack. An attacker's text
 * *is* normalised; the brand stops a developer from routing around the
 * normaliser by accident.
 *
 * @typedef {string & { readonly __cleanString: unique symbol }} CleanString
 */

/**
 * The single point at which a string becomes a `CleanString`.
 *
 * **Only `core/normalize/index.mjs` may call this**, at the end of the eight-step
 * pipeline and after the markup self-check. Calling it anywhere else defeats
 * the entire mechanism, which is why it is named to be conspicuous in review
 * rather than convenient to use.
 *
 * @param {string} normalised A string that has actually been normalised.
 * @returns {CleanString}
 */
export function markNormalised(normalised) {
  return /** @type {CleanString} */ (normalised);
}

/**
 * The author of a review, as published at the source.
 *
 * @typedef {object} Author
 * @property {CleanString | null} name        As published. **Never abbreviated by the engine.**
 * @property {string | null} initials         Derived, 1-2 graphemes, so a consumer can render
 *                                            an avatar without fetching an image.
 * @property {string | null} avatar_url       HTTPS, allowlisted host. **Referenced, never re-hosted.**
 * @property {string | null} profile_url      HTTPS, allowlisted host.
 * @property {boolean | null} is_local_guide  Source-specific badge. `null` when unknown.
 * @property {number | null} review_count_hint The author's total at the source.
 */

/**
 * A business reply to a review.
 *
 * @typedef {object} OwnerReply
 * @property {CleanString} text            Plain text, same sanitisation as review text.
 * @property {string | null} date          RFC 3339, pinned estimate.
 * @property {string} date_precision       One of {@link DATE_PRECISIONS}.
 * @property {string | null} relative_date The source's own phrasing, verbatim.
 * @property {string | null} author_label  Usually the business name. **Never a personal name.**
 */

/**
 * Straight off an adapter. Every field is a raw string or null, because nothing
 * from a source is trusted enough to have a type yet.
 *
 * There is no `identity_hash` here: identity is derived after normalisation, so
 * that the same review harvested through two adapters resolves to the same
 * hash (TR-HASH-004, PT-08).
 *
 * @typedef {object} ExtractedReview
 * @property {string | null} author_name
 * @property {string | null} author_profile_url
 * @property {string | null} author_avatar_url
 * @property {boolean | null} author_is_local_guide
 * @property {number | null} author_review_count_hint
 * @property {string | null} rating_raw        Unparsed. The three-parser cascade runs later.
 * @property {string | null} text_raw          May contain markup, entities, control characters.
 * @property {boolean} text_truncated          The source itself showed the text as truncated.
 * @property {string | null} relative_date_raw The source's phrasing, verbatim.
 * @property {number | null} likes
 * @property {number | null} photo_count
 * @property {string | null} reply_text_raw
 * @property {string | null} reply_relative_date_raw
 * @property {string | null} reply_author_label_raw
 * @property {boolean | null} verified         `null` when unknown. **Never fabricated.**
 * @property {string} source                   One of {@link REVIEW_SOURCES}.
 * @property {string | null} source_url        Engine-constructed, never scraped.
 * @property {number} strategy_index           Which selector strategy matched. Feeds pack health.
 */

/**
 * After normalisation, date resolution, language detection, and identity.
 *
 * `text` is a `CleanString`: markup has been **removed**, not escaped.
 *
 * @typedef {object} NormalizedReview
 * @property {string} identity_hash          32 hex characters. Stable across harvests and adapters.
 * @property {string} content_hash           Changes when and only when displayed content changes.
 * @property {string} author_key             Internal matching key. **Never published** (TR-HASH-020).
 * @property {Author} author
 * @property {number} rating                 Integer, {@link MIN_RATING}-{@link MAX_RATING}.
 * @property {CleanString | null} text       `null` for a rating-only review.
 * @property {boolean} text_truncated        The source's text was longer than what was retrieved.
 * @property {boolean} text_clipped          The engine bounded the length.
 * @property {string | null} date_estimated  RFC 3339.
 * @property {string} date_precision         One of {@link DATE_PRECISIONS}.
 * @property {string} date_confidence        One of {@link DATE_CONFIDENCES}.
 * @property {string | null} relative_date   Verbatim. **Excluded from content_hash** (TR-HASH-010).
 * @property {string | null} language        ISO 639-1.
 * @property {number | null} language_confidence
 * @property {number | null} likes
 * @property {number | null} photo_count
 * @property {OwnerReply | null} owner_reply
 * @property {string} source
 * @property {string | null} source_url
 * @property {boolean | null} verified
 */

/**
 * The durable record. Private to the `state` branch and never published.
 *
 * The five fields below the content are the whole reason the absence asymmetry
 * works, and TRD §22.5's mutation matrix governs every one of them:
 *
 * - `first_seen_at` is set once on INSERT and **preserved forever**.
 * - `date_estimated` is pinned on INSERT and **never recomputed** (PT-06).
 * - `missing_streak` increments **only** on a `full` or `full_capped` harvest.
 * - `tombstoned_at` is terminal. A tombstoned identity never becomes active
 *   again under any observation sequence (PT-03, TR-REC-014).
 * - `suppressed` is terminal and comes from the denylist on `main`, so that
 *   rebuilding `state` cannot resurrect an erased review.
 *
 * @typedef {object} LedgerReview
 * @property {NormalizedReview} review
 * @property {string} state                  One of {@link LEDGER_STATES}.
 * @property {string} first_seen_at          RFC 3339. Set on INSERT, preserved on every later path.
 * @property {string} last_seen_at           RFC 3339. Updated whenever the review is observed.
 * @property {string} last_updated_at        RFC 3339. Updated only when content actually changed.
 * @property {number} revision               Starts at 1, increments on each observed edit.
 * @property {number} missing_streak         Consecutive qualifying harvests without this review.
 * @property {string | null} tombstoned_at   RFC 3339 once tombstoned. Terminal.
 * @property {ReadonlyArray<string>} content_hash_history Prior content hashes, oldest first.
 */

/**
 * The public contract. TRD §52.5, twenty-four fields, `additionalProperties:
 * false` in the schema.
 *
 * No internal state field appears here: no `author_key`, no `missing_streak`,
 * no `content_hash_history`. A consumer sees what is true about the review, not
 * what the engine knows about its bookkeeping.
 *
 * @typedef {object} PayloadReview
 * @property {string} id                    The `identity_hash`.
 * @property {string} content_hash
 * @property {Author} author
 * @property {number} rating
 * @property {CleanString | null} text      **Plain text, no markup.**
 * @property {boolean} text_truncated
 * @property {boolean} text_clipped
 * @property {string | null} date           RFC 3339, pinned estimate.
 * @property {string} date_precision
 * @property {string} date_confidence
 * @property {string | null} relative_date
 * @property {string | null} language
 * @property {number | null} language_confidence
 * @property {number | null} likes
 * @property {number | null} photo_count
 * @property {OwnerReply | null} owner_reply
 * @property {string} source
 * @property {string | null} source_url
 * @property {boolean | null} verified      `null` when unknown. **Never fabricated.**
 * @property {string} first_seen_at
 * @property {string} last_updated_at
 * @property {number} revision
 * @property {null} ai                      Reserved enrichment block. Always `null` in v1.0.
 * @property {ReadonlyArray<string>} flags
 */

/**
 * @param {unknown} value
 * @returns {boolean} Whether the value is an integer star rating in range.
 */
export function isValidRating(value) {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_RATING &&
    value <= MAX_RATING
  );
}

/**
 * Whether a harvest's completeness permits treating absence as evidence of
 * removal.
 *
 * **This predicate is the absence asymmetry.** Getting it wrong is the only
 * defect in the system that can silently wipe a paying client's reviews, which
 * is why it lives here as one named function rather than as an inline
 * comparison at each call site (TR-REC-010, PT-07).
 *
 * @param {string} completeness One of {@link COMPLETENESS}.
 * @returns {boolean}
 */
export function absenceIsMeaningful(completeness) {
  return completeness === 'full' || completeness === 'full_capped';
}
